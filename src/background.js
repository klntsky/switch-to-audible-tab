/* global browser */

const isGoogle = navigator.vendor === "Google Inc.";

/** Default settings */
// This should be synchronised with Settings.purs
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

// A flag indicating that no tabs are selected by queries.
const NoTabs = Symbol('NoTabs');
// A flag indicating that the tab switching cycle was ended.
const FromStart = Symbol('FromStart');

let settings = null;
// First active tab, i.e. the tab that was active when the user started
// cycling through audible tabs.
let firstActive = null; // or { id: <tab id>, windowId: <window id>, ... }
// Whether we are waiting for tab activation (semaphore variable for switchTo)
let waitingForActivation = false;
let lastTabs = [];

// Tabs marked as audible by the user
let marked = [];
const MARK_MENU_ID = "mark-as-audible";
const SETTINGS_MENU_ID = "open-settings";

// Used to follow notifications
const possibleNotifications = new Map(); // tabId => timestamp

const catcher = (f) => async function () {
    try {
        return await f(...arguments);
    } catch (e) {
        console.log('Error in', unescape(f), e);
    }
};

const addMarkedTab = tab => {
  if (!marked.some(mkd => mkd.id === tab.id)) {
    marked.push(tab);
  }
};

const removeMarkedTab = tab => {
  marked = marked.filter(mkd => mkd.id !== tab.id);
};

const updateIcon = isChecked => {
    browser.browserAction.setIcon({
        path: isChecked ? 'img/icon-checked.png' : 'img/128.png'
    });
};

/** Returns active tab in the current window. */
const getActiveTab = async () => {
    return browser.tabs.query({ active: true, currentWindow: true })
        .then(x => x[0]);
};

const runSettingsMigrations = settings => {
    // TODO: get a list of properties from defaults itself?
    const added_props = [
        'websitesOnlyIfNoAudible',
        'followNotifications',
        'notificationsTimeout',
        'maxNotificationDuration',
        'notificationsFirst'
    ];

    for (let prop of added_props) {
        if (typeof settings[prop] == 'undefined') {
            settings[prop] = defaults[prop];
        }
    }

    return settings;
};

/** Returns settings object */
const loadSettings = catcher(async () => {
    const r = await browser.storage.local.get({
        settings: defaults
    });

    // Set global variable
    settings = runSettingsMigrations(r.settings) ;

    return r.settings;
});

browser.storage.onChanged.addListener((changes, area) => {
    if (typeof changes.settings === 'object') {
        settings = changes.settings.newValue;
        updateMenuContexts(settings);
    }
});

const sortTabs = tabs => {
    if (firstActive)
        tabs = [...tabs, firstActive];

    // Sort by windowIds, then by indices.
    tabs = tabs.sort((a, b) => {
        let ordering = a.windowId - b.windowId || a.index - b.index;
        if (settings.sortBackwards) {
            ordering *= -1;
        }
        return ordering;
    });

    let ix = tabs.findIndex(x => x === firstActive);
    if (ix != -1) {
        tabs = [...tabs.slice(ix + 1), ...tabs.slice(0, ix)];
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

/** Given an array of tabs and the active tab, returns next tab's ID.
    @param tabs {Tab[]}
    @param activeTab {Tab}
    @returns {Tab|NoTabs|FromStart}
*/
const nextTab = (tabs, activeTab) => {
    if (!tabs.length)
        return NoTabs;

    for (let i = 0; i < tabs.length - 1; i++) {
        if (tabs[i].id === activeTab.id) {
            return tabs[i+1];
        }
    };

    return FromStart;
};

browser.contextMenus.create({
    id: MARK_MENU_ID,
    type: "checkbox",
    title: "Mark this tab as audible",
    contexts: ["browser_action"],
});

browser.contextMenus.create({
    id: SETTINGS_MENU_ID,
    title: "Open Preferences",
    contexts: ["browser_action"],
});

// Add an item to context menu for tabs.
const updateMenuContexts = catcher(async settings => {
    const contexts = ["browser_action"];
    if (settings.menuOnTab && !isGoogle) {
        contexts.push("tab");
    }
    await browser.contextMenus.update(MARK_MENU_ID, {
        contexts
    });
});


loadSettings().then(updateMenuContexts);
getActiveTab().then(tab => firstActive = tab);

// When some tab gets removed, check if we are referencing it.
browser.tabs.onRemoved.addListener(tabId => {
    if (firstActive.id === tabId) {
        firstActive = null;
    }
    marked = marked.filter(mkd => mkd.id !== tabId);
    possibleNotifications.delete(tabId);
});

// Track the last active tab which was activated by the user or another
// extension
browser.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
    const checked = marked.some(mkd => mkd.id === tabId);
    // no need to await
    browser.contextMenus.update(MARK_MENU_ID, { checked });
    updateIcon(checked);

    if (waitingForActivation) {
        waitingForActivation = false;
    } else {
        const index = (await browser.tabs.query({}).then(r => r.find(r => r.id == tabId))).index;

        // This tab was activated by the user or another extension,
        // therefore we need to set it as firstActive.
        firstActive = { id: tabId, windowId, index };
    }
});

browser.windows.onFocusChanged.addListener(catcher(async (windowId) => {
    const activeTab = await getActiveTab();
    const checked = marked.some(mkd => mkd.id === activeTab.id);
    updateIcon(checked);
    if (lastTabs.every(tab => tab.id !== activeTab.id)) {
        firstActive = activeTab;
    }
}));

browser.browserAction.onClicked.addListener(catcher(async () => {
    // Choose how to switch to the tab, depending on `settings.allWindows`.
    // Maintain waitingForActivation flag.
    const switchTo = async (tab, activeTab) => {

        if (!tab || tab.id === activeTab.id || waitingForActivation)
            return;

        waitingForActivation = true;

        await browser.tabs.update(tab.id, { active: true });

        if (settings.allWindows) {
            await browser.windows.update(tab.windowId, { focused: true });
        }

        if (!settings.includeFirst) {
            firstActive = null;
        }

        waitingForActivation = false;
    };

    await updateMenuContexts(settings);
    const activeTab = await getActiveTab();
    let tabs = [];

    // Modify query w.r.t. settings.allWindows preference
    const refine = query => {
        if (!settings.allWindows) {
            query.currentWindow = true;
        }
        return query;
    };

    tabs = [...tabs, ...await browser.tabs.query(refine({ audible: true }))];

    const areReallyAudible = tabs.length != 0;

    if (settings.includeMuted)
        tabs = [...tabs, ...await browser.tabs.query(refine({ muted: true }))];

    if (marked.length)
        tabs = [...tabs, ...marked];

    // Include websites only if websitesOnlyIfAudible is false or
    // there are no "really" audible tabs.
    if (!areReallyAudible || !settings.websitesOnlyIfNoAudible) {
        const permanentlyMarked = settings.markAsAudible.reduce(
            (acc, { domain, enabled, withSubdomains }) => {
                if (enabled) {
                    acc.push(withSubdomains ? `*://*.${domain}/*` : `*://${domain}/*`);
                }
                return acc;
            }, []
        );

        if (permanentlyMarked.length)
            tabs = [...tabs, ...await browser.tabs.query(refine({ url: permanentlyMarked }))];
    }

    if (settings.followNotifications) {

        // Extract notifications from possibleNotifications
        const now = Date.now();
        let notifications = [...possibleNotifications.values()].filter(([start, end, tab]) => {
            end = end || now;
            return end - start < settings.maxNotificationDuration * 1000;
        });

        // Sort by starting time. Newest first.
        notifications.sort((a, b) => b[0] - a[0]);
        notifications = notifications.map(([_start, _end, tab]) => tab);

        if (settings.notificationsFirst) {
            // Prepend before others
            tabs = [...notifications, ...sortTabs(tabs)];
        } else {
            // Sort everything
            tabs = sortTabs([...notifications, ...tabs]);
        }
    } else {
        tabs = sortTabs(tabs);
    }

    tabs = filterRepeating(tabs);

    if (firstActive)
        tabs = tabs.filter(tab => tab.id !== firstActive.id);

    lastTabs = tabs;

    const next = nextTab(tabs, activeTab);

    switch (next) {
    case NoTabs:
        if (settings.includeFirst)
            switchTo(firstActive, activeTab);
        break;

    case FromStart:
        // If includeFirst is turned off
        if (!settings.includeFirst
            // or if the firstActive tab was removed
            || !firstActive
            || activeTab.id === firstActive.id) {
            await switchTo(tabs[0], activeTab);
        } else {
            await switchTo(firstActive, activeTab);
        }
        break;

    default:
        await switchTo(next, activeTab);
    }
}));


// WONTFIX: api is not supported, but also we can't use tabs context menus.
!isGoogle && browser.contextMenus.onShown.addListener(async function(info, tab) {
    if (info.menuIds.includes(MARK_MENU_ID)) {
        let checked = false;

        if (info.viewType === "sidebar") {
            checked = marked.some(mkd => mkd.id === tab.id);
        } else if (typeof info.viewType === 'undefined') {
            // clicked the toolbar button
            const activeTab = await getActiveTab();
            checked = marked.some(mkd => mkd.id === activeTab.id);
        }

        await browser.contextMenus.update(MARK_MENU_ID, { checked });
        await browser.contextMenus.refresh();
    }
});

browser.contextMenus.onClicked.addListener(async function(info, tab) {

    const activeTab = await getActiveTab();
    if (info.menuItemId === SETTINGS_MENU_ID) {
        browser.runtime.openOptionsPage();
    } else if (info.menuItemId === MARK_MENU_ID) {
        if (info.checked) {
            addMarkedTab(tab);
        } else {
            removeMarkedTab(tab);
        }

        if (activeTab.id === tab.id) {
            updateIcon(info.checked);
        }
    }
});

browser.tabs.onUpdated.addListener(catcher(async (tabId, changeInfo, tab) => {
    if (typeof changeInfo.audible == 'boolean') {
        if (changeInfo.audible) {
            if ((await getActiveTab()).id != tabId) {
                possibleNotifications.set(tabId, [Date.now(), null, tab]);
            }
        } else {
            if (possibleNotifications.has(tabId)) {
                const [startTime, _end, _tab] = possibleNotifications.get(tabId);
                const now = Date.now();
                possibleNotifications.set(tabId, [startTime, now, tab]);
                setTimeout(() => {
                    // Delete only if we added it.
                    if (possibleNotifications.get(tabId)[0] == startTime) {
                        possibleNotifications.delete(tabId);
                    }
                }, settings.notificationsTimeout * 1000);
            }
        }
    }
}));
