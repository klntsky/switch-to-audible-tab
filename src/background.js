/** Default settings */
const defaults = {
    includeMuted: true,
    allWindows: true,
    includeFirst: true
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


/** Returns active tab in the current window. */
const getActiveTab = async () => {
    return browser.tabs.query({ active: true, currentWindow: true })
        .then(x => x[0]);
};


/** Returns settings object */
const loadSettings = () => browser.storage.local.get({
    settings: defaults
}).then(r => r.settings);


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
});


// Track the last active tab which was activated by the user or another
// extension
browser.tabs.onActivated.addListener(({ tabId, windowId }) => {
    if (waitingForActivation) {
        waitingForActivation = false;
    } else {
        // This tab was activated by the user or another extension,
        // therefore we need to set it as firstActive.
        firstActive = { id: tabId, windowId };
    }
});


browser.windows.onFocusChanged.addListener(async (windowId) => {
    const activeTab = await getActiveTab();
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
