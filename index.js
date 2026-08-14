const MODULE_NAME = 'reasoning-to-message';
const EXTENSION_FOLDER = 'third-party/reasoning-to-message';

const DEFAULT_SETTINGS = {
    enabled: true,
    log: false,
};

function ctx() {
    return SillyTavern.getContext();
}

function getSettings() {
    const store = ctx().extensionSettings ?? ctx().extension_settings;
    if (!store[MODULE_NAME] || typeof store[MODULE_NAME] !== 'object') {
        store[MODULE_NAME] = {};
    }
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (store[MODULE_NAME][key] === undefined) {
            store[MODULE_NAME][key] = DEFAULT_SETTINGS[key];
        }
    }
    return store[MODULE_NAME];
}

function isMesEmpty(mes) {
    return typeof mes !== 'string' || mes.trim().length === 0;
}

function moveReasoningToMessage(messageId, message) {
    const settings = getSettings();

    if (!message || message.is_system === true || message.is_user === true) {
        return false;
    }

    const reasoning = message?.extra?.reasoning;
    if (typeof reasoning !== 'string' || reasoning.trim().length === 0) {
        return false;
    }

    if (!isMesEmpty(message.mes)) {
        return false;
    }

    // 搬移：把思维链内容写入正文，然后清空思维链。
    message.mes = reasoning;
    if (message.extra) {
        message.extra.reasoning = '';
        delete message.extra.reasoning_signature;
    }

    // 手动同步 swipe 快照
    if (Array.isArray(message.swipe_info) && message.swipe_id != null) {
        const si = message.swipe_id - 1;
        if (message.swipe_info[si]) {
            message.swipe_info[si].mes = message.mes;
            if (message.swipe_info[si].extra) {
                message.swipe_info[si].extra.reasoning = '';
                delete message.swipe_info[si].extra.reasoning_signature;
            }
        }
    }

    if (settings.log) {
        console.debug(`[${MODULE_NAME}] 已把思维链搬移到正文（messageId=${messageId}, 长度=${message.mes.length}）`);
    }

    return true;
}

async function onMessageReceived(messageId) {
    const settings = getSettings();
    if (!settings.enabled) {
        return;
    }

    const index = Number(messageId);
    const context = ctx();
    if (!context?.chat || !context.chat[index]) {
        return;
    }

    const message = context.chat[index];
    const moved = moveReasoningToMessage(index, message);

    if (!moved) {
        return;
    }

    // 落盘
    if (typeof context.saveChat === 'function') {
        await context.saveChat();
    }

    // 重渲染该消息
    if (typeof context.updateMessageBlock === 'function') {
        context.updateMessageBlock(index, message);
    } else if (typeof updateMessageBlock === 'function') {
        updateMessageBlock(index, message);
    }
}

async function addSettingsPanel() {
    const settings = getSettings();
    const html = await ctx().renderExtensionTemplateAsync(EXTENSION_FOLDER, 'settings');
    $('#extensions_settings2').append(html);

    $('#reasoning_to_message_enabled').prop('checked', settings.enabled).on('input', function () {
        getSettings().enabled = !!this.checked;
        ctx().saveSettingsDebounced();
    });

    $('#reasoning_to_message_log').prop('checked', settings.log).on('input', function () {
        getSettings().log = !!this.checked;
        ctx().saveSettingsDebounced();
    });
}

jQuery(async () => {
    const context = ctx();
    const { eventSource, event_types } = context;

    if (!event_types?.MESSAGE_RECEIVED) {
        console.error(`[${MODULE_NAME}] 找不到 MESSAGE_RECEIVED 事件，当前版本过低。`);
        return;
    }

    eventSource.on(event_types.MESSAGE_RECEIVED, onMessageReceived);

    try {
        await addSettingsPanel();
    } catch (error) {
        console.error(`[${MODULE_NAME}] 设置面板构建失败`, error);
    }

    console.debug(`[${MODULE_NAME}] 已激活`);
});
