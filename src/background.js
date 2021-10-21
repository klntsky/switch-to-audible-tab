/* global browser */

/** Default settings */
const defaults = {
    includeMuted: true,
    allWindows: true,
    includeFirst: true,
    sortBackwards: false,
    menuOnTab: false,
    markAsAudible: [],
    websitesOnlyIfNoAudible: false
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
const query = browser.tabs.query;
// Tabs marked as audible by the user
let marked = [];
const MENU_ID = "mark-as-audible";

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
    if (typeof settings.websitesOnlyIfNoAudible == 'undefined') {
        settings.websitesOnlyIfNoAudible = defaults.websitesOnlyIfNoAudible;
    }
    return settings;
};

/** Returns settings object */
const loadSettings = () => browser.storage.local.get({
    settings: defaults
}).then(r => {

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
        tabs = tabs.concat([firstActive]);

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
        tabs = tabs.slice(ix + 1).concat(tabs.slice(0, ix));
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
        let tab = tabs[i];

        if (tab.id === activeTab.id) {
            return tabs[i+1];
        }
    };

    return FromStart;
};

browser.menus.create({
    id: MENU_ID,
    type: "checkbox",
    title: "Mark this tab as audible",
    contexts: ["browser_action"],
});

const updateMenuContexts = async settings => {
    const contexts = ["browser_action"];
    if (settings.menuOnTab) {
        contexts.push("tab");
    }

    await browser.menus.update(MENU_ID, {
        contexts
    });
};

loadSettings().then(updateMenuContexts);
getActiveTab().then(tab => firstActive = tab);

// When some tab gets removed, check if we are referencing it.
browser.tabs.onRemoved.addListener(tabId => {
    if (firstActive.id === tabId) {
        firstActive = null;
    }
    marked = marked.filter(mkd => mkd.id !== tabId);
});

// Track the last active tab which was activated by the user or another
// extension
browser.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
    const checked = marked.some(mkd => mkd.id === tabId);
    // no need to await
    browser.menus.update(MENU_ID, { checked });
    updateIcon(checked);

    if (waitingForActivation) {
        waitingForActivation = false;
    } else {
        const index = (await query({}).then(r => r.find(r => r.id == tabId))).index;

        // This tab was activated by the user or another extension,
        // therefore we need to set it as firstActive.
        firstActive = { id: tabId, windowId, index };
    }
});

browser.windows.onFocusChanged.addListener(async (windowId) => {
    const activeTab = await getActiveTab();
    const checked = marked.some(mkd => mkd.id === activeTab.id);
    updateIcon(checked);
    if (lastTabs.every(tab => tab.id !== activeTab.id)) {
        firstActive = activeTab;
    }
});

browser.browserAction.onClicked.addListener(async () => {
    const switchTo = async (tab, activeTab) => {
        if (!tab  || tab.id === activeTab.id || waitingForActivation)
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

    tabs = tabs.concat(await query(refine({ audible: true })));

    const areReallyAudible = tabs.length != 0;

    if (settings.includeMuted)
        tabs = tabs.concat(await query(refine({ muted: true })));

    if (marked.length)
        tabs = tabs.concat(marked);

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
            tabs = tabs.concat(await query(refine({ url: permanentlyMarked })));
    }

    tabs = filterRepeating(sortTabs(tabs));

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
});

browser.menus.onShown.addListener(async function(info, tab) {
    if (info.menuIds.includes(MENU_ID)) {
        let checked = false;

        if (info.viewType === "sidebar") {
            checked = marked.some(mkd => mkd.id === tab.id);
        } else if (typeof info.viewType === 'undefined') {
            // clicked the toolbar button
            const activeTab = await getActiveTab();
            checked = marked.some(mkd => mkd.id === activeTab.id);
        }

        await browser.menus.update(MENU_ID, { checked });
        await browser.menus.refresh();
    }
});

browser.menus.onClicked.addListener(async function(info, tab) {
    const activeTab = await getActiveTab();
    if (info.menuItemId === MENU_ID) {
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
