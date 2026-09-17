const fs = require('node:fs');
const { spawn, spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { Builder } = require('selenium-webdriver');
const firefox = require('selenium-webdriver/firefox');
const geckodriver = require('geckodriver');
const { Browser, getInstalledBrowsers } = require('@puppeteer/browsers');
const { before, after, beforeEach } = require('node:test');
const { stageExtension } = require('../../../scripts/pack.js');

const pagesDirectory = path.join(__dirname, '..', 'pages');
const ADDON_ID = '{0cd726db-f954-44f2-bf4f-7ed0de734de2}';
const EXTENSION_UUID = '11111111-2222-4333-8444-555555555555';
const MARK_ITEM_LABEL = 'Mark this tab as audible';
const DEFAULT_SETTINGS = Object.freeze({
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
});

const versionParts = buildId => (buildId.match(/\d+(?:\.\d+)*/) || ['0'])[0]
    .split('.')
    .map(Number);

const compareVersions = (a, b) => {
    const left = versionParts(a);
    const right = versionParts(b);
    for (let index = 0; index < Math.max(left.length, right.length); index++) {
        const difference = (left[index] || 0) - (right[index] || 0);
        if (difference !== 0) {
            return difference;
        }
    }
    return 0;
};

let geckodriverPath = null;

const resolveGeckodriver = async () => {
    if (!geckodriverPath) {
        geckodriverPath = await geckodriver.download();
    }
    return geckodriverPath;
};

const resolveFirefoxBinary = async () => {
    const cacheDir = process.env.PUPPETEER_CACHE_DIR
        || path.join(os.homedir(), '.cache', 'puppeteer');
    const installed = (await getInstalledBrowsers({ cacheDir }))
        .filter(entry => entry.browser === Browser.FIREFOX)
        .sort((a, b) => compareVersions(b.buildId, a.buildId));

    if (!installed.length) {
        throw new Error(
            'Firefox is not installed; run `npm run test:e2e:install` first'
        );
    }

    return installed[0].executablePath;
};

const sleepSync = milliseconds =>
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);

let displayProcess = null;

const displayReady = display => {
    const probe = spawnSync('xdpyinfo', ['-display', display], { stdio: 'ignore' });
    if (probe.error) {
        // xdpyinfo is not installed: fall back to the X socket.
        return fs.existsSync(`/tmp/.X11-unix/X${display.slice(1)}`);
    }
    return probe.status === 0;
};

/**
 * Firefox only sets the tab audio indicator when it has a display, so the audio
 * tests need one. Start Xvfb on the first free display when DISPLAY is unset.
 */
const ensureDisplay = () => {
    if (process.env.DISPLAY) {
        return;
    }

    const which = spawnSync('which', ['Xvfb'], { encoding: 'utf8' });
    if (which.status !== 0) {
        throw new Error(
            'Firefox reports tab audibility only with a display; install Xvfb or'
            + ' run the suite through xvfb-run'
        );
    }
    const xvfb = which.stdout.trim();

    for (let number = 99; number < 120; number++) {
        const display = `:${number}`;
        if (displayReady(display)) {
            continue;
        }

        displayProcess = spawn(
            xvfb,
            [display, '-screen', '0', '1280x1024x24', '-nolisten', 'tcp'],
            { stdio: 'ignore' }
        );
        displayProcess.unref();
        process.on('exit', () => {
            if (displayProcess) {
                displayProcess.kill();
            }
        });

        const deadline = Date.now() + 10000;
        while (!displayReady(display)) {
            if (Date.now() > deadline) {
                break;
            }
            sleepSync(100);
        }

        if (displayReady(display)) {
            process.env.DISPLAY = display;
            return;
        }

        displayProcess.kill();
        displayProcess = null;
    }

    throw new Error('could not start Xvfb on any display');
};

const runPactl = (...args) => spawnSync('pactl', args, { encoding: 'utf8' });

/** Firefox plays only through PulseAudio, so it needs a daemon with a sink. */
const pulseAudioProblem = () => {
    const info = runPactl('info');

    if (info.error) {
        const runtime = process.env.XDG_RUNTIME_DIR;
        const sockets = [`${runtime}/pulse/native`, '/run/pulse/native'];
        if (sockets.some(socket => runtime !== undefined && fs.existsSync(socket))) {
            return null;
        }
        return 'pactl is not installed, and no PulseAudio socket was found:'
            + ' run scripts/install-dummy-audio.sh';
    }

    if (info.status !== 0) {
        const detail = (info.stderr || '').trim().split('\n')[0] || 'connection refused';
        return `PulseAudio is not reachable (${detail}): run scripts/install-dummy-audio.sh`;
    }

    const sinks = runPactl('list', 'short', 'sinks');
    if (sinks.status !== 0 || !sinks.stdout.trim()) {
        return 'PulseAudio has no sink: pulseaudio --start -n'
            + ' --load="module-null-sink sink_name=dummy"';
    }

    return null;
};

/** Fails once, up front, instead of deep inside a test. */
const assertEnvironment = async () => {
    const problems = [];

    try {
        await resolveFirefoxBinary();
    } catch (error) {
        problems.push(error.message);
    }

    try {
        ensureDisplay();
    } catch (error) {
        problems.push(error.message);
    }

    const pulse = pulseAudioProblem();
    if (pulse) {
        problems.push(pulse);
    }

    if (problems.length) {
        throw new Error(
            `Firefox test environment is not ready:\n- ${problems.join('\n- ')}`
        );
    }

    return true;
};

const assertOpen = state => {
    if (state === 'closed') {
        throw new Error('tab context menu did not open');
    }
};

const waitFor = async (probe, message, timeout = 5000) => {
    const deadline = Date.now() + timeout;
    let value;

    while (Date.now() < deadline) {
        value = await probe();
        if (value) {
            return value;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    throw new Error(`${message}; last value: ${JSON.stringify(value)}`);
};

const startServer = async () => {
    const routes = new Map([
        ['/silent.html', 'silent.html'],
        ['/audio.html', 'audio.html'],
    ]);
    const server = http.createServer((request, response) => {
        const file = routes.get(new URL(request.url, 'http://localhost').pathname);
        if (!file) {
            response.writeHead(404).end('Not found');
            return;
        }
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        fs.createReadStream(path.join(pagesDirectory, file)).pipe(response);
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    return { port: server.address().port, close: () => server.close() };
};

class FirefoxHarness {
    static async create() {
        const extensionPath = fs.mkdtempSync(
            path.join(os.tmpdir(), 'firefox-addon-')
        );
        const server = await startServer();
        let driver;

        try {
            stageExtension('manifest.json', extensionPath);
            const driverPath = await resolveGeckodriver();
            const firefoxBinary = await resolveFirefoxBinary();
            ensureDisplay();
            const options = new firefox.Options()
                .setBinary(firefoxBinary)
                .setPreference('network.proxy.type', 0)
                .setPreference('media.autoplay.default', 0)
                .setPreference('media.autoplay.blocking_policy', 0)
                .setPreference(
                    'network.dns.localDomains',
                    'media.test,child.media.test'
                )
                .setPreference('extensions.webextensions.uuids', JSON.stringify({
                    [ADDON_ID]: EXTENSION_UUID,
                }));
            driver = await new Builder()
                .forBrowser('firefox')
                .setFirefoxOptions(options)
                .setFirefoxService(
                    new firefox.ServiceBuilder(driverPath)
                        .addArguments('--allow-system-access')
                )
                .build();
            const addonId = await driver.installAddon(extensionPath, true);
            const harness = new FirefoxHarness({
                addonId,
                driver,
                extensionPath,
                server,
            });
            await harness.prepareToolbarButton();
            return harness;
        } catch (error) {
            if (driver) {
                await driver.quit();
            }
            await server.close();
            fs.rmSync(extensionPath, { recursive: true, force: true });
            throw error;
        }
    }

    constructor({ addonId, driver, extensionPath, server }) {
        this.addonId = addonId;
        this.driver = driver;
        this.extensionPath = extensionPath;
        this.server = server;
        this.tabNumber = 0;
        this.widgetId = `${addonId.replace(/[^a-zA-Z0-9_-]/g, '_')}-browser-action`;
    }

    fixtureUrl(name, host = '127.0.0.1') {
        this.tabNumber += 1;
        return `http://${host}:${this.server.port}/${name}.html?tab=${this.tabNumber}`;
    }

    optionsUrl() {
        return `moz-extension://${EXTENSION_UUID}/static/settings.html`;
    }

    async chrome(script) {
        await this.driver.setContext(firefox.Context.CHROME);
        return this.driver.executeScript(script);
    }

    async content(script) {
        await this.driver.setContext(firefox.Context.CONTENT);
        return this.driver.executeScript(script);
    }

    async newTab(name, { newWindow = false, host } = {}) {
        await this.driver.setContext(firefox.Context.CONTENT);
        await this.driver.switchTo().newWindow(newWindow ? 'window' : 'tab');
        const handle = await this.driver.getWindowHandle();
        const url = this.fixtureUrl(name, host);
        await this.driver.get(url);
        return { handle, url };
    }

    async select(tab) {
        await this.driver.setContext(firefox.Context.CONTENT);
        await this.driver.switchTo().window(tab.handle);
    }

    async state() {
        return this.chrome(`
            const windows = [];
            for (const win of Services.wm.getEnumerator('navigator:browser')) {
                windows.push({
                    selected: win.gBrowser.selectedTab.linkedBrowser.currentURI.spec,
                    focused: win === Services.focus.activeWindow,
                    tabs: [...win.gBrowser.tabs].map(tab => ({
                        url: tab.linkedBrowser.currentURI.spec,
                        selected: tab.selected,
                        soundPlaying: tab.hasAttribute('soundplaying'),
                        muted: tab.linkedBrowser.audioMuted,
                    })),
                });
            }
            return windows;
        `);
    }

    async selectedUrl() {
        const [window] = await this.state();
        return window.selected;
    }

    /** Focuses the window showing url and waits until Firefox agrees it is active. */
    async focusWindowOf(url) {
        await waitFor(() => this.chrome(`
            const win = [...Services.wm.getEnumerator('navigator:browser')].find(candidate =>
                candidate.gBrowser.selectedTab.linkedBrowser.currentURI.spec === ${JSON.stringify(url)});
            if (!win) {
                return false;
            }
            win.focus();
            return Services.focus.activeWindow === win;
        `), `could not focus the window showing ${url}`, 5000);
    }

    async selectedWindowTabUrl(url) {
        const windows = await this.state();
        const window = windows.find(candidate =>
            candidate.tabs.some(tab => tab.url === url));
        return window ? window.selected : null;
    }

    async waitForSelected(url, message = 'tab was not selected') {
        return waitFor(
            async () => (await this.selectedUrl()) === url,
            `${message}: ${url}`
        );
    }

    async prepareToolbarButton() {
        await this.chrome(`
            const win = Services.wm.getMostRecentWindow('navigator:browser');
            win.CustomizableUI.addWidgetToArea('${this.widgetId}', 'nav-bar');
        `);
        await waitFor(() => this.chrome(`
            const win = Services.wm.getMostRecentWindow('navigator:browser');
            return Boolean(win.document.querySelector('.webextension-browser-action'));
        `), 'extension toolbar button was not created');
    }

    async clickToolbarButton() {
        await this.chrome(`
            const win = Services.wm.getMostRecentWindow('navigator:browser');
            win.document.querySelector('.webextension-browser-action').click();
        `);
    }

    submenuScript(inner) {
        return `
            const win = Services.wm.getMostRecentWindow('navigator:browser');
            const popup = win.document.getElementById('tabContextMenu');
            ${inner}
        `;
    }

    async openTabContextMenu() {
        const state = await this.chrome(this.submenuScript(`
            popup.openPopupAtScreen(20, 20, true);
            return popup.state;
        `));
        assertOpen(state);
        return state;
    }

    async tabContextMenuEntries(timeout = 3000) {
        const deadline = Date.now() + timeout;
        let last = { entries: [], state: 'closed' };

        while (Date.now() < deadline) {
            await this.chrome(this.submenuScript(`
                popup.openPopupAtScreen(20, 20, true);
            `));
            await new Promise(resolve => setTimeout(resolve, 300));
            last = await this.chrome(this.submenuScript(`
                const submenu = [...popup.children].find(node =>
                    node.getAttribute('ext-type') === 'top-level-menu');
                const entries = submenu
                    ? [...submenu.querySelectorAll('menuitem')].map(node => ({
                        label: node.getAttribute('label'),
                        checked: node.getAttribute('checked'),
                    }))
                    : [];
                const state = popup.state;
                popup.hidePopup();
                return { entries, state };
            `));
            assertOpen(last.state);
            if (last.entries.length && last.entries.every(entry => entry.label)) {
                return last.entries;
            }
        }

        return last.entries;
    }

    async tabContextMenuItems(timeout = 5000) {
        const entries = await this.tabContextMenuEntries(timeout);
        return entries.map(entry => entry.label);
    }

    async toggleMarkFromTabContextMenu() {
        await this.openTabContextMenu();
        await this.chrome(this.submenuScript(`
            const submenu = [...popup.children].find(node =>
                node.getAttribute('ext-type') === 'top-level-menu');
            const item = [...submenu.querySelector('menupopup').children]
                .find(node => node.getAttribute('label') === ${JSON.stringify(MARK_ITEM_LABEL)});
            item.click();
            popup.hidePopup();
        `));
    }

    async markedUrls() {
        await this.openOptions();
        return this.content(
            `return browser.storage.session.get('runtimeState')
                .then(result => (result.runtimeState.marked || []).map(tab => tab.url))`
        );
    }

    async setSettings(overrides) {
        await this.openOptions();
        const settings = { ...await this.settings(), ...overrides };
        await this.content(`
            return browser.storage.local.set({ settings: ${JSON.stringify(settings)} })
        `);
        await waitFor(async () => {
            const stored = await this.settings();
            return Object.entries(overrides).every(([key, value]) =>
                JSON.stringify(stored[key]) === JSON.stringify(value)) || false;
        }, `settings were not applied: ${JSON.stringify(overrides)}`);
        return settings;
    }

    async tabInfo(url) {
        return this.chrome(`
            const target = [...Services.wm.getEnumerator('navigator:browser')]
                .flatMap(win => [...win.gBrowser.tabs])
                .find(candidate =>
                    candidate.linkedBrowser.currentURI.spec === ${JSON.stringify(url)});
            return target
                ? {
                    url: target.linkedBrowser.currentURI.spec,
                    selected: target.selected,
                    muted: target.linkedBrowser.audioMuted,
                    soundPlaying: target.hasAttribute('soundplaying'),
                }
                : null;
        `);
    }

    async extensionTab(url) {
        await this.openOptions();
        return this.content(`
            return browser.tabs.query({}).then(tabs => {
                const tab = tabs.find(candidate => candidate.url === ${JSON.stringify(url)});
                return tab
                    ? {
                        id: tab.id,
                        url: tab.url,
                        active: tab.active,
                        audible: tab.audible,
                        muted: tab.mutedInfo.muted,
                    }
                    : null;
            });
        `);
    }

    async setMuted(tab, muted) {
        const before = await this.extensionTab(tab.url);
        if (!before) {
            throw new Error(`tab not found: ${tab.url}`);
        }
        await this.openOptions();
        await this.content(`return browser.tabs.update(${before.id}, { muted: ${muted} })`);
        await waitFor(async () => {
            const updated = await this.extensionTab(tab.url);
            return updated && updated.muted === muted;
        }, `tab was not muted: ${tab.url}`);
    }

    async waitForStableSelection({
        reads = 3,
        interval = 100,
        timeout = 5000,
    } = {}) {
        const deadline = Date.now() + timeout;
        let previous = null;
        let stable = 0;
        while (Date.now() < deadline) {
            const selected = await this.selectedUrl();
            stable = selected === previous ? stable + 1 : 0;
            if (stable >= reads) {
                return selected;
            }
            previous = selected;
            await new Promise(resolve => setTimeout(resolve, interval));
        }
        return previous;
    }

    async waitForActive(url, message = 'tab was not activated') {
        return waitFor(async () => {
            const info = await this.tabInfo(url);
            return info ? info.selected : false;
        }, `${message}: ${url}`);
    }

    async expectToolbarSwitch(from, to) {
        await this.select(from);
        await this.focusWindowOf(from.url);
        await this.clickToolbarButton();
        await this.waitForActive(to.url);
    }

    async expectToolbarStaysOn(tab) {
        await this.select(tab);
        await this.focusWindowOf(tab.url);
        const before = await this.state();
        await this.clickToolbarButton();
        await this.waitForStableSelection();
        assert.deepEqual(await this.state(), before);
    }

    async settings() {
        await this.openOptions();
        const stored = await this.content(
            `return browser.storage.local.get('settings')
                .then(result => result.settings || null)`
        );
        return { ...DEFAULT_SETTINGS, ...(stored || {}) };
    }

    async openOptions() {
        if (!this.optionsTab) {
            await this.driver.setContext(firefox.Context.CONTENT);
            await this.driver.switchTo().newWindow('tab');
            const handle = await this.driver.getWindowHandle();
            this.optionsTab = { handle, url: this.optionsUrl() };
            await this.driver.get(this.optionsTab.url);
            await this.waitForOptionsRendered();
        }
        await this.select(this.optionsTab);
        return this.optionsTab;
    }

    async optionsPage() {
        await this.openOptions();
        return this.content(`
            return {
                ids: [...document.querySelectorAll('[id]')].map(node => node.id),
                inputs: [...document.querySelectorAll('input')].map(node => ({
                    id: node.id,
                    type: node.type,
                    checked: node.checked,
                    value: node.value,
                })),
            };
        `);
    }

    async clickOption(id) {
        const before = await this.settings();
        await this.openOptions();
        await this.content(`document.getElementById(${JSON.stringify(id)}).click()`);
        await waitFor(async () => {
            const after = await this.settings();
            return JSON.stringify(after) !== JSON.stringify(before);
        }, 'options page did not persist the change');
    }

    async setOptionValue(id, value) {
        await this.openOptions();
        await this.content(`
            const element = document.getElementById(${JSON.stringify(id)});
            element.value = ${JSON.stringify(value)};
            element.dispatchEvent(new Event('input', { bubbles: true }));
        `);
    }

    async clickButton(label) {
        await this.openOptions();
        await this.content(`
            const button = [...document.querySelectorAll('input[type="button"]')]
                .find(element => element.value === ${JSON.stringify(label)});
            button.click();
        `);
    }

    async elementState(id) {
        await this.openOptions();
        return this.content(`
            const element = document.getElementById(${JSON.stringify(id)});
            return {
                disabled: element.disabled,
                invalid: element.classList.contains('invalid'),
                value: element.value,
                checked: element.checked,
            };
        `);
    }

    async domainRowCount() {
        await this.openOptions();
        return this.content('return document.querySelectorAll("input[type=\\"text\\"]").length');
    }

    async setDomainValue(index, value) {
        await this.openOptions();
        await this.content(`
            const element = document.querySelectorAll('input[type="text"]')[${index}];
            element.value = ${JSON.stringify(value)};
            element.dispatchEvent(new Event('input', { bubbles: true }));
        `);
    }

    async waitForSettings(predicate, message = 'settings were not saved') {
        return waitFor(async () => {
            const settings = await this.settings();
            return predicate(settings) ? settings : false;
        }, message);
    }

    async waitForInvalid(id) {
        return waitFor(
            async () => (await this.elementState(id)).invalid,
            `field was not marked invalid: ${id}`
        );
    }

    async waitForDomainInvalid(index) {
        return waitFor(async () => {
            await this.openOptions();
            return this.content(`
                return document.querySelectorAll('input[type="text"]')[${index}]
                    .classList.contains('invalid');
            `);
        }, `domain ${index} was not marked invalid`);
    }

    /** Closes every tab except the options page, so tests start clean. */
    async closeExtraTabs() {
        await this.chrome(`
            for (const win of Services.wm.getEnumerator('navigator:browser')) {
                for (const tab of [...win.gBrowser.tabs]) {
                    if (tab.linkedBrowser.currentURI.spec
                        !== ${JSON.stringify(this.optionsUrl())}) {
                        win.gBrowser.removeTab(tab);
                    }
                }
            }
        `);
    }

    /** The settings app renders asynchronously; reload once before giving up. */
    async waitForOptionsRendered() {
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                await waitFor(
                    () => this.content(
                        'return document.querySelectorAll("input").length > 5'
                    ),
                    'options page did not render',
                    11000
                );
                return;
            } catch (error) {
                if (attempt === 1) {
                    throw error;
                }
                await this.driver.navigate().refresh();
            }
        }
    }

    /**
     * Restores defaults, reloads the settings app (it holds its own copy of the
     * settings and would otherwise save stale values), and drops leftover tabs.
     */
    async reset() {
        await this.setSettings({ ...DEFAULT_SETTINGS });
        const options = await this.openOptions();
        await this.driver.navigate().refresh();
        await this.waitForOptionsRendered();
        void options;
        await this.closeExtraTabs();
    }

    async closeTab(tab) {
        await this.chrome(`
            for (const win of Services.wm.getEnumerator('navigator:browser')) {
                const target = [...win.gBrowser.tabs].find(candidate =>
                    candidate.linkedBrowser.currentURI.spec === ${JSON.stringify(tab.url)});
                if (target) {
                    win.gBrowser.removeTab(target);
                    break;
                }
            }
        `);
        await waitFor(
            async () => (await this.tabInfo(tab.url)) === null,
            `tab was not closed: ${tab.url}`
        );
    }

    async notificationRecords() {
        await this.openOptions();
        return this.content(`
            return browser.storage.session.get('runtimeState').then(result =>
                ((result.runtimeState || {}).possibleNotifications || []).map(entry => ({
                    id: entry[0],
                    start: entry[1][0],
                    end: entry[1][1],
                    url: entry[1][2].url,
                })));
        `);
    }

    /** A tab playing a continuous tone; playback starts while it is selected. */
    async newAudibleTab({ host } = {}) {
        const tab = await this.newTab('audio', { host });
        await this.content('window.audioTest.start()');
        await this.waitForAudible(tab, true);
        return tab;
    }

    async newAudibleTabInNewWindow({ host } = {}) {
        await this.driver.setContext(firefox.Context.CONTENT);
        await this.driver.switchTo().newWindow('window');
        const handle = await this.driver.getWindowHandle();
        const url = this.fixtureUrl('audio', host);
        await this.driver.get(url);
        const tab = { handle, url };
        await this.content('window.audioTest.start()');
        await this.waitForAudible(tab, true);
        return tab;
    }

    /**
     * Plays a short sound that starts while the tab is in the background, which
     * is what the addon treats as a notification. Firefox needs a real user
     * gesture before it plays audio on a hidden tab, so the page has a button
     * that arms the sound.
     */
    /**
     * Plays a short sound that starts while its tab is not the active tab, which
     * is what the addon records as a notification. A background tab is never
     * reported as audible by Firefox, so the sound starts in a second window
     * that is unfocused by the time it plays. The page needs a real click before
     * Firefox will play audio, hence the button.
     */
    async playBackgroundNotification(returnTo, { duration = 1500, delay = 1200 } = {}) {
        for (let attempt = 1; attempt <= 2; attempt++) {
            await this.select(returnTo);
            await this.focusWindowOf(returnTo.url);

            const tab = await this.newTab('audio', { newWindow: true });
            await this.select(tab);
            await this.driver.setContext(firefox.Context.CONTENT);
            await this.driver.get(`${tab.url}&arm=${delay}&duration=${duration}`);
            await this.driver.findElement({ id: 'arm' }).click();

            await this.select(returnTo);
            await this.focusWindowOf(returnTo.url);
            await new Promise(resolve =>
                setTimeout(resolve, delay + duration + 4000));

            const record = (await this.notificationRecords())
                .find(candidate => candidate.url === tab.url);
            if (record && record.end !== null) {
                return tab;
            }

            await this.closeTab(tab);
        }

        throw new Error(
            'Firefox never reported a sound that started in an unfocused window as'
            + ' audible, so the addon could not record a notification'
        );
    }

    async pauseAudio(tab) {
        await this.select(tab);
        await this.content('window.audioTest.pause()');
        await this.waitForAudible(tab, false);
    }

    async audibleUrls() {
        await this.openOptions();
        return this.content(
            `return browser.tabs.query({ audible: true })
                .then(tabs => tabs.map(tab => tab.url))`
        );
    }

    /** Uses the same signal the addon does: tabs.query({ audible: true }). */
    async waitForAudible(tab, audible, timeout = 20000) {
        const message = audible
            ? `${tab.url} never became audible; the Firefox suite needs a working`
                + ' audio output device, because Firefox only reports a tab as'
                + ' audible while it is really playing sound'
            : `${tab.url} never stopped being audible`;
        await waitFor(
            async () => (await this.audibleUrls()).includes(tab.url) === audible,
            message,
            timeout
        );
    }

    async close() {
        try {
            await this.driver.quit();
        } finally {
            await this.server.close();
            fs.rmSync(this.extensionPath, { recursive: true, force: true });
        }
    }
}

/**
 * One browser for the whole file: launching Firefox and installing the addon
 * costs far more than the tests themselves.
 */
const sharedFirefox = () => {
    let harness = null;

    before(async () => {
        await assertEnvironment();
        harness = await FirefoxHarness.create();
    });

    after(async () => {
        if (harness) {
            await harness.close();
            harness = null;
        }
    });

    beforeEach(async () => {
        if (harness) {
            await harness.reset();
        }
    });

    return () => {
        if (!harness) {
            throw new Error('the shared Firefox harness is not ready');
        }
        return harness;
    };
};

module.exports = {
    FirefoxHarness,
    assertEnvironment,
    sharedFirefox,
    waitFor,
};