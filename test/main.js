/* global test require */

const test = require('ava');
const firefoxManifest = require('../manifest.json');
const chromeManifest = require('../manifest.chrome.json');

test('browser-specific manifests use Manifest V3', t => {
    t.is(firefoxManifest.manifest_version, 3);
    t.true(Array.isArray(firefoxManifest.background.scripts));
    t.falsy(firefoxManifest.background.service_worker);
    t.truthy(firefoxManifest.action);
    t.truthy(firefoxManifest.commands._execute_action);
    t.falsy(firefoxManifest.browser_action);
    t.falsy(firefoxManifest.applications);
    t.deepEqual(
        firefoxManifest.browser_specific_settings.gecko.data_collection_permissions.required,
        ['none']
    );

    t.is(chromeManifest.manifest_version, 3);
    t.truthy(chromeManifest.background.service_worker);
    t.falsy(chromeManifest.background.scripts);
    t.truthy(chromeManifest.action);
    t.truthy(chromeManifest.commands._execute_action);
    t.is(chromeManifest.minimum_chrome_version, '123');
    t.falsy(chromeManifest.browser_specific_settings);
});

test('background registers MV3 menus and switches to an audible tab', async t => {
    const listeners = {};
    const event = name => ({
        addListener(listener) {
            listeners[name] = listener;
        }
    });
    const localStorage = {};
    const sessionStorage = {};
    const menuItems = [];
    const activatedTabs = [];
    const activeTab = { id: 1, windowId: 10, index: 0, active: true };
    const audibleTab = { id: 2, windowId: 10, index: 1, audible: true };

    Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: { vendor: 'Google Inc.' }
    });

    delete globalThis.browser;
    globalThis.chrome = {
        action: {
            setIcon: async () => {},
            onClicked: event('action.onClicked'),
        },
        contextMenus: {
            create(item) {
                menuItems.push(item);
            },
            removeAll: async () => {
                menuItems.length = 0;
            },
            update: async () => {},
            refresh: async () => {},
            onClicked: event('contextMenus.onClicked'),
            onShown: event('contextMenus.onShown'),
        },
        runtime: {
            onInstalled: event('runtime.onInstalled'),
            getURL: path => `chrome-extension://test/${path}`,
            openOptionsPage: async () => {},
        },
        storage: {
            local: {
                async get(defaults) {
                    return { ...defaults, ...localStorage };
                },
                async set(values) {
                    Object.assign(localStorage, values);
                },
            },
            session: {
                async get(key) {
                    return { [key]: sessionStorage[key] };
                },
                async set(values) {
                    Object.assign(sessionStorage, values);
                },
            },
            onChanged: event('storage.onChanged'),
        },
        tabs: {
            onRemoved: event('tabs.onRemoved'),
            onActivated: event('tabs.onActivated'),
            onUpdated: event('tabs.onUpdated'),
            async query(query) {
                if (query.active) {
                    return [activeTab];
                }
                if (query.audible) {
                    return [audibleTab];
                }
                return [];
            },
            async get(id) {
                return id === activeTab.id ? activeTab : audibleTab;
            },
            async update(id) {
                activatedTabs.push(id);
                return id === activeTab.id ? activeTab : audibleTab;
            },
        },
        windows: {
            WINDOW_ID_NONE: -1,
            onFocusChanged: event('windows.onFocusChanged'),
            update: async () => {},
        },
    };

    require('../src/background.js');
    await new Promise(resolve => setImmediate(resolve));

    await listeners['runtime.onInstalled']({ reason: 'update' });
    t.deepEqual(menuItems.map(item => item.contexts), [['action'], ['action']]);

    await listeners['action.onClicked']();
    t.deepEqual(activatedTabs, [audibleTab.id]);
    t.is(sessionStorage.runtimeState.firstActive.id, activeTab.id);
    t.is(sessionStorage.runtimeState.pendingActivationTabId, audibleTab.id);

    await listeners['tabs.onActivated']({
        tabId: audibleTab.id,
        windowId: audibleTab.windowId,
    });
    t.is(sessionStorage.runtimeState.pendingActivationTabId, null);
    t.is(sessionStorage.runtimeState.firstActive.id, activeTab.id);

    const settingsApi = require('../src/SettingsFFI.js');
    const savedSettings = { includeMuted: false };
    await settingsApi.save_(savedSettings)();
    t.deepEqual(await settingsApi.load_({})(), savedSettings);
});
