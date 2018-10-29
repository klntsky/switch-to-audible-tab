/** Default settings */
const defaults = {
    includeMuted: true,
    allWindows: true
};


/** Given an array of tabs and the active tab, returns next tab's ID.
    @param tabs {Tab[]}
    @param activeTab {Tab}
    @returns {Tab|null}
*/
const nextTab = (tabs, activeTab) => {
    if (!tabs.length)
        return null;

    tabs.push(tabs[0]);

    for (let i = 0; i < tabs.length; i++) {
        let tab = tabs[i];

        if (tab.id === activeTab.id) {
            return tabs[i+1];
        }
    };

    return tabs[0];
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


const query = browser.tabs.query;


browser.browserAction.onClicked.addListener(async () => {
    const settings = await loadSettings();
    const activeTab = await getActiveTab();
    let tabs = [];

    const refine = query => {
        if (!settings.allWindows) {
            query.currentWindow = true;
        }
        return query;
    };

    tabs = tabs.concat(await query(refine({ audible: true })));

    if (settings.includeMuted)
        tabs = tabs.concat(await query(refine({ muted: true })));

    const next = nextTab(tabs, activeTab);

    if (next) {
        await browser.tabs.update(next.id, { active: true });

        if (settings.allWindows) {
            await browser.windows.update(next.windowId, { focused: true });
        }
    }
});
