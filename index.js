import {
    eventSource,
    event_types,
    getContext,
    extension_settings,
    saveSettingsDebounced,
    saveChatDebounced,
    syncMesToSwipe,
    updateMessageBlock,
} from '../../../../script.js';
import { renderExtensionTemplateAsync } from '../../../extensions.js';

const MODULE_NAME = 'reasoning-to-message';
const EXTENSION_NAME = `third-party/${MODULE_NAME}`;

export { MODULE_NAME };

/** 扩展自身设置的默认值。 */
const defaultSettings = {
    enabled: true,
    /** 是否记录搬移日志到控制台。 */
    log: false,
};

/**
 * 读取扩展设置，缺失字段用默认值补齐，并写回 extension_settings 对象。
 * 注意：这一阶段只保证内存中的对象完整，落盘由 saveSettingsDebounced 完成。
 */
function loadSettings() {
    if (!extension_settings[MODULE_NAME] || typeof extension_settings[MODULE_NAME] !== 'object') {
        extension_settings[MODULE_NAME] = {};
    }

    for (const key of Object.keys(defaultSettings)) {
        if (extension_settings[MODULE_NAME][key] === undefined) {
            extension_settings[MODULE_NAME][key] = defaultSettings[key];
        }
    }

    return extension_settings[MODULE_NAME];
}

/**
 * 判断正文是否「完全为空」。
 * 仅当去除首尾空白后没有任何字符时视为空，避免把「只剩换行/空格」误判为有内容。
 * @param {string} mes 消息正文
 * @returns {boolean}
 */
function isMesEmpty(mes) {
    return typeof mes !== 'string' || mes.trim().length === 0;
}

/**
 * 核心搬移逻辑：当一条助手消息正文完全为空、而思维链非空时，
 * 把思维链内容搬到正文，并清空思维链。
 *
 * @param {number} messageId 目标消息的绝对索引
 * @param {object} message 目标消息对象
 * @returns {boolean} 是否发生了搬移
 */
function moveReasoningToMessage(messageId, message) {
    const settings = loadSettings();

    // 仅处理助手消息，且需要是非系统/非用户消息（思维链只属于模型回复）。
    if (!message || message.is_system === true || message.is_user === true) {
        return false;
    }

    const reasoning = message?.extra?.reasoning;
    // 思维链不存在或为空，无事可做。
    if (typeof reasoning !== 'string' || reasoning.trim().length === 0) {
        return false;
    }

    // 正文非空，无需搬移。
    if (!isMesEmpty(message.mes)) {
        return false;
    }

    // 搬移：把思维链内容写入正文，然后清空思维链。
    message.mes = reasoning;
    if (message.extra) {
        message.extra.reasoning = '';
    }

    // 清空 provider 侧的思维链签名，因为思维链内容已经改变。
    if (message.extra) {
        delete message.extra.reasoning_signature;
    }

    // 同步 swipes（含 swipe_info.extra），保证 swipe 快照与正文/思维链一致。
    syncMesToSwipe(messageId);

    if (settings.log) {
        console.debug(`[${MODULE_NAME}] 已把思维链搬移到正文（messageId=${messageId}, 长度=${message.mes.length}）`);
    }

    return true;
}

/**
 * MESSAGE_RECEIVED 事件回调。
 * 此时消息已写入 chat 数组、思维链与正文字段均已就绪，但尚未渲染到 DOM。
 * 我们在这里做搬移，再触发保存与重渲染。
 *
 * @param {number} messageId 消息绝对索引
 * @param {string} type 生成类型（如 'swipe' / 'append' / 'streaming' 等）
 */
async function onMessageReceived(messageId, type) {
    const settings = loadSettings();
    if (!settings.enabled) {
        return;
    }

    // 某些扩展/命令会二次触发 MESSAGE_RECEIVED，此时消息可能不存在，做保护。
    const index = Number(messageId);
    const context = getContext();
    if (!context?.chat || !context.chat[index]) {
        return;
    }

    const message = context.chat[index];
    const moved = moveReasoningToMessage(index, message);

    if (!moved) {
        return;
    }

    // 落盘：用防抖保存，避免在 streaming 流程中与生成结束的立即保存产生同步阻塞，
    // 同时保证非 streaming 路径（如扩展触发的消息）也能最终持久化。
    saveChatDebounced();

    // 重渲染该消息，让正文立即显示。DOM 中消息已存在则更新，否则忽略（addOneMessage 流程会处理）。
    updateMessageBlock(index, message);
}

/**
 * 设置面板开关变更回调。
 */
function onEnabledToggle() {
    const value = $('#reasoning_to_message_enabled').prop('checked');
    extension_settings[MODULE_NAME].enabled = Boolean(value);
    saveSettingsDebounced();
}

function onLogToggle() {
    const value = $('#reasoning_to_message_log').prop('checked');
    extension_settings[MODULE_NAME].log = Boolean(value);
    saveSettingsDebounced();
}

function setupListeners() {
    $('#reasoning_to_message_enabled').off('change').on('change', onEnabledToggle);
    $('#reasoning_to_message_log').off('change').on('change', onLogToggle);
}

/**
 * 扩展激活入口（由 manifest.json 的 hooks.activate 调用）。
 */
export async function init() {
    loadSettings();

    async function addExtensionControls() {
        // 幂等保护：扩展可能因 enable/reload 被重复激活，避免重复挂载面板。
        if (document.getElementById('reasoning_to_message_settings')) {
            setupListeners();
            return;
        }

        const settingsHtml = await renderExtensionTemplateAsync(EXTENSION_NAME, 'settings', { defaultSettings });

        // 自建容器挂到右侧系统设置栏末尾，不依赖具体容器 id。
        const mount = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
        if (mount) {
            const container = document.createElement('div');
            container.id = 'reasoning_to_message_container';
            container.className = 'extension_container';
            container.innerHTML = settingsHtml;
            mount.appendChild(container);
        } else {
            $(document.body).append(settingsHtml);
        }

        setupListeners();

        // 把当前设置回填到面板控件。
        $('#reasoning_to_message_enabled').prop('checked', Boolean(extension_settings[MODULE_NAME].enabled));
        $('#reasoning_to_message_log').prop('checked', Boolean(extension_settings[MODULE_NAME].log));
    }

    await addExtensionControls();

    // 在消息落库后（渲染前）处理搬移。
    eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);

    console.debug(`[${MODULE_NAME}] 已激活`);
}