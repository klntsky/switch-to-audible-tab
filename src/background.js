/* global browser chrome */

const api = typeof browser !== 'undefined' ? browser : chrome;
const isFirefox = typeof api.runtime.getBrowserInfo === 'function';

/** Default settings. Keep in sync with Settings.purs. */
const defaults = {
    includeMuted: true,
    allWindows: true,
    includeFirst: true,
    sortBackwards: false,
    menuOnTab: false,
    markAsAudible: [],
    websitesOnlyIfNoAudible: false,
    followNotifications: true,
    notificationsTimeout: 10,
    maxNotificationDuration: 10,
    notificationsFirst: true,
};

// Flags returned by nextTab.
const NoTabs = Symbol('NoTabs');
const FromStart = Symbol('FromStart');

const MARK_MENU_ID = 'mark-as-audible';
const SETTINGS_MENU_ID = 'open-settings';
const RUNTIME_STATE_KEY = 'runtimeState';

let settings = defaults;

let firstActive = null;
let pendingActivationTabId = null;
let lastTabs = [];
let marked = [];
let possibleNotifications = new Map();

const catcher = f => async function () {
    try {
        return await f(...arguments);
    } catch (error) {
        console.error(`Error in ${f.name || 'event handler'}`, error);
    }
};

/** Returns the active tab in the currently focused window. */
const getActiveTab = async () => {
    const tabs = await api.tabs.query({ active: true, currentWindow: true });
    return tabs[0] || null;
};

const updateIcon = isChecked => {
    const icon = isChecked ? 'img/icon-checked.png' : 'img/128.png';
    return api.action.setIcon({
        path: api.runtime.getURL(icon)
    });
};

const runSettingsMigrations = storedSettings => ({
    ...defaults,
    ...storedSettings,
});

/** Loads settings before any event handler tries to use them. */
const loadSettings = async () => {
    const result = await api.storage.local.get({ settings: defaults });
    settings = runSettingsMigrations(result.settings);

    // Save added defaults so the options page and background agree after an
    // update from an older version.
    if (JSON.stringify(settings) !== JSON.stringify(result.settings)) {
        await api.storage.local.set({ settings });
    }

    return settings;
};

const saveRuntimeState = () => api.storage.session.set({
    [RUNTIME_STATE_KEY]: {
        firstActive,
        pendingActivationTabId,
        lastTabs,
        marked,
        possibleNotifications: [...possibleNotifications.entries()],
    }
});

const loadRuntimeState = async () => {
    const stored = (await api.storage.session.get(RUNTIME_STATE_KEY))[RUNTIME_STATE_KEY] || {};

    firstActive = stored.firstActive || null;
    pendingActivationTabId = stored.pendingActivationTabId || null;
    lastTabs = Array.isArray(stored.lastTabs) ? stored.lastTabs : [];
    marked = Array.isArray(stored.marked) ? stored.marked : [];
    possibleNotifications = new Map(
        Array.isArray(stored.possibleNotifications) ? stored.possibleNotifications : []
    );

    const activeTab = await getActiveTab();
    if (!firstActive) {
        firstActive = activeTab;
    }
    if (activeTab) {
        await updateIcon(marked.some(tab => tab.id === activeTab.id));
    }
    await saveRuntimeState();
};

const settingsReady = loadSettings().catch(error => {
    console.error('Unable to load settings; using defaults', error);
    settings = defaults;
});

const runtimeStateReady = loadRuntimeState().catch(error => {
    console.error('Unable to restore runtime state', error);
});

const addMarkedTab = tab => {
    if (tab && !marked.some(item => item.id === tab.id)) {
        marked.push(tab);
    }
};

const removeMarkedTab = tab => {
    if (tab) {
        marked = marked.filter(item => item.id !== tab.id);
    }
};

const sortTabs = tabs => {
    if (firstActive) {
        tabs = [...tabs, firstActive];
    }

    // Sort by window IDs, then by tab indices.
    tabs = tabs.sort((a, b) => {
        let ordering = a.windowId - b.windowId || a.index - b.index;
        if (settings.sortBackwards) {
            ordering *= -1;
        }
        return ordering;
    });

    const index = tabs.findIndex(tab => tab === firstActive);
    if (index !== -1) {
        tabs = [...tabs.slice(index + 1), ...tabs.slice(0, index)];
    }

    return tabs;
};

const filterRepeating = tabs => {
    const ids = new Set();

    return tabs.filter(tab => {
        if (ids.has(tab.id)) {
            return false;
        }
        ids.add(tab.id);
        return true;
    });
};

/**
 * Given an array of tabs and the active tab, returns the next tab.
 * @returns {object|NoTabs|FromStart}
 */
const nextTab = (tabs, activeTab) => {
    if (!tabs.length) {
        return NoTabs;
    }

    for (let index = 0; index < tabs.length - 1; index++) {
        if (tabs[index].id === activeTab.id) {
            return tabs[index + 1];
        }
    }

    return FromStart;
};

const updateMenuContexts = async currentSettings => {
    const contexts = ['action'];
    if (currentSettings.menuOnTab && isFirefox) {
        contexts.push('tab');
    }
    await api.contextMenus.update(MARK_MENU_ID, { contexts });
};

const createContextMenus = async () => {
    await api.contextMenus.removeAll();
    api.contextMenus.create({
        id: MARK_MENU_ID,
        type: 'checkbox',
        title: 'Mark this tab as audible',
        contexts: ['action'],
    });
    api.contextMenus.create({
        id: SETTINGS_MENU_ID,
        title: 'Open Preferences',
        contexts: ['action'],
    });
    await updateMenuContexts(settings);
};

api.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings && changes.settings.newValue) {
        settings = runSettingsMigrations(changes.settings.newValue);
        updateMenuContexts(settings).catch(error => {
            console.error('Unable to update context menu', error);
        });
    }
});

api.tabs.onRemoved.addListener(catcher(async tabId => {
    await runtimeStateReady;
    if (firstActive && firstActive.id === tabId) {
        firstActive = null;
    }
    if (pendingActivationTabId === tabId) {
        pendingActivationTabId = null;
    }
    marked = marked.filter(tab => tab.id !== tabId);
    possibleNotifications.delete(tabId);
    await saveRuntimeState();
}));

// Track whether activation came from this extension or from the user/another
// extension. The pending tab ID is persisted in case the worker is suspended
// between requesting and observing activation.
api.tabs.onActivated.addListener(catcher(async ({ tabId, windowId }) => {
    await runtimeStateReady;

    const checked = marked.some(tab => tab.id === tabId);
    await Promise.all([
        api.contextMenus.update(MARK_MENU_ID, { checked }).catch(() => {}),
        updateIcon(checked),
    ]);

    if (pendingActivationTabId === tabId) {
        pendingActivationTabId = null;
    } else {
        pendingActivationTabId = null;
        const tab = await api.tabs.get(tabId);
        firstActive = { id: tabId, windowId, index: tab.index };
    }
    await saveRuntimeState();
}));

api.windows.onFocusChanged.addListener(catcher(async windowId => {
    await runtimeStateReady;
    if (windowId === api.windows.WINDOW_ID_NONE) {
        return;
    }

    const activeTab = await getActiveTab();
    if (!activeTab) {
        return;
    }

    await updateIcon(marked.some(tab => tab.id === activeTab.id));
    if (lastTabs.every(tab => tab.id !== activeTab.id)) {
        firstActive = activeTab;
        await saveRuntimeState();
    }
}));

api.action.onClicked.addListener(catcher(async () => {
    await Promise.all([settingsReady, runtimeStateReady]);

    const switchTo = async (tab, activeTab) => {
        if (!tab || tab.id === activeTab.id || pendingActivationTabId !== null) {
            return;
        }

        pendingActivationTabId = tab.id;
        await saveRuntimeState();

        try {
            await api.tabs.update(tab.id, { active: true });

            if (settings.allWindows) {
                await api.windows.update(tab.windowId, { focused: true });
            }

            if (!settings.includeFirst) {
                firstActive = null;
            }
            await saveRuntimeState();
        } catch (error) {
            if (pendingActivationTabId === tab.id) {
                pendingActivationTabId = null;
                await saveRuntimeState();
            }
            throw error;
        }
    };

    await updateMenuContexts(settings);
    const activeTab = await getActiveTab();
    if (!activeTab) {
        return;
    }

    const refine = query => {
        if (!settings.allWindows) {
            query.currentWindow = true;
        }
        return query;
    };

    let tabs = await api.tabs.query(refine({ audible: true }));
    const areReallyAudible = tabs.length !== 0;

    if (settings.includeMuted) {
        tabs = [...tabs, ...await api.tabs.query(refine({ muted: true }))];
    }

    if (marked.length) {
        tabs = [...tabs, ...marked];
    }

    // Include configured websites unless they are restricted to the case where
    // no tab is actually audible.
    if (!areReallyAudible || !settings.websitesOnlyIfNoAudible) {
        const permanentlyMarked = settings.markAsAudible.reduce(
            (patterns, { domain, enabled, withSubdomains }) => {
                if (enabled) {
                    patterns.push(withSubdomains ? `*://*.${domain}/*` : `*://${domain}/*`);
                }
                return patterns;
            }, []
        );

        if (permanentlyMarked.length) {
            tabs = [...tabs, ...await api.tabs.query(refine({ url: permanentlyMarked }))];
        }
    }

    if (settings.followNotifications) {
        const now = Date.now();
        const notifications = [];

        for (const [tabId, notification] of possibleNotifications) {
            const [start, end, tab] = notification;
            const expired = end !== null
                && now - end >= settings.notificationsTimeout * 1000;

            if (expired) {
                possibleNotifications.delete(tabId);
            } else if ((end || now) - start < settings.maxNotificationDuration * 1000) {
                notifications.push(notification);
            }
        }

        // Newest notification first.
        notifications.sort((a, b) => b[0] - a[0]);
        const notificationTabs = notifications.map(([_start, _end, tab]) => tab);

        if (settings.notificationsFirst) {
            tabs = [...notificationTabs, ...sortTabs(tabs)];
        } else {
            tabs = sortTabs([...notificationTabs, ...tabs]);
        }
    } else {
        tabs = sortTabs(tabs);
    }

    tabs = filterRepeating(tabs);

    if (firstActive) {
        tabs = tabs.filter(tab => tab.id !== firstActive.id);
    }

    lastTabs = tabs;
    await saveRuntimeState();

    const next = nextTab(tabs, activeTab);

    switch (next) {
    case NoTabs:
        if (settings.includeFirst) {
            await switchTo(firstActive, activeTab);
        }
        break;

    case FromStart:
        if (!settings.includeFirst || !firstActive || activeTab.id === firstActive.id) {
            await switchTo(tabs[0], activeTab);
        } else {
            await switchTo(firstActive, activeTab);
        }
        break;

    default:
        await switchTo(next, activeTab);
    }
}));

// Chrome does not support tab context-menu items for this feature. Firefox
// also lets us refresh the checkbox just before its action menu is shown.
if (isFirefox) {
    api.contextMenus.onShown.addListener(catcher(async (info, tab) => {
        await runtimeStateReady;
        if (!info.menuIds.includes(MARK_MENU_ID)) {
            return;
        }

        let checked = false;
        if (info.viewType === 'sidebar') {
            checked = marked.some(item => item.id === tab.id);
        } else if (typeof info.viewType === 'undefined') {
            const activeTab = await getActiveTab();
            checked = activeTab && marked.some(item => item.id === activeTab.id);
        }

        await api.contextMenus.update(MARK_MENU_ID, { checked });
        await api.contextMenus.refresh();
    }));
}

api.contextMenus.onClicked.addListener(catcher(async (info, tab) => {
    await runtimeStateReady;

    if (info.menuItemId === SETTINGS_MENU_ID) {
        await api.runtime.openOptionsPage();
        return;
    }

    if (info.menuItemId !== MARK_MENU_ID) {
        return;
    }

    const activeTab = await getActiveTab();
    if (info.checked) {
        addMarkedTab(tab);
    } else {
        removeMarkedTab(tab);
    }

    if (activeTab && tab && activeTab.id === tab.id) {
        await updateIcon(info.checked);
    }
    await saveRuntimeState();
}));

api.tabs.onUpdated.addListener(catcher(async (tabId, changeInfo, tab) => {
    if (typeof changeInfo.audible !== 'boolean') {
        return;
    }

    await runtimeStateReady;

    if (changeInfo.audible) {
        const activeTab = await getActiveTab();
        if (!activeTab || activeTab.id !== tabId) {
            possibleNotifications.set(tabId, [Date.now(), null, tab]);
        }
    } else if (possibleNotifications.has(tabId)) {
        const [startTime] = possibleNotifications.get(tabId);
        possibleNotifications.set(tabId, [startTime, Date.now(), tab]);
    }

    await saveRuntimeState();
}));

api.runtime.onInstalled.addListener(catcher(async details => {
    await settingsReady;
    await createContextMenus();

    if (details.reason === 'install') {
        await api.runtime.openOptionsPage();
    }
}));
