/* global browser */

/** Default settings */
const defaults = {
    includeMuted: true,
    allWindows: true,
    includeFirst: true,
    sortBackwards: false,
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

const menu = browser.menus.create({
  id: "open-settings",
  type: "checkbox",
  title: "Mark this tab as audible",
  contexts: ["browser_action", "tab"],
});


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


/** Returns settings object */
const loadSettings = () => browser.storage.local.get({
    settings: defaults
}).then(r => r.settings);


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


loadSettings().then(s => settings = s);
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
    browser.menus.update("open-settings", { checked });
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

    settings = await loadSettings();
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

    if (settings.includeMuted)
        tabs = tabs.concat(await query(refine({ muted: true })));

    tabs = tabs.concat(marked);

    tabs = sortTabs(tabs);

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
    if (info.menuIds.includes("open-settings") &&
        info.viewType === "sidebar") {
        const checked = marked.some(mkd => mkd.id === tab.id);
        await browser.menus.update("open-settings", { checked });
        await browser.menus.refresh();
    }
});

browser.menus.onClicked.addListener(async function(info, tab) {
    console.log(arguments);
    const activeTab = await getActiveTab();
    if (info.menuItemId === "open-settings") {
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
