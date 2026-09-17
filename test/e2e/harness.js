const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const puppeteer = require('puppeteer');
const { stageExtension } = require('../../scripts/pack.js');

const pagesDirectory = path.join(__dirname, 'pages');

const defaultSettings = Object.freeze({
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

    assert.fail(`${message}; last value: ${JSON.stringify(value)}`);
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

        response.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
        });
        fs.createReadStream(path.join(pagesDirectory, file)).pipe(response);
    });

    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address();
    return {
        port,
        close: () => new Promise((resolve, reject) => {
            server.close(error => error ? reject(error) : resolve());
        }),
    };
};

class ExtensionHarness {
    static async create() {
        const extensionPath = fs.mkdtempSync(
            path.join(os.tmpdir(), 'audible-tab-extension-')
        );
        const server = await startServer();
        let browser;

        try {
            stageExtension('manifest.chrome.json', extensionPath);
            browser = await puppeteer.launch({
                headless: true,
                pipe: true,
                enableExtensions: true,
                ignoreDefaultArgs: ['--mute-audio'],
                args: [
                    '--autoplay-policy=no-user-gesture-required',
                    '--host-resolver-rules=MAP media.test 127.0.0.1,MAP *.media.test 127.0.0.1',
                    `--disable-extensions-except=${extensionPath}`,
                    `--load-extension=${extensionPath}`,
                    '--no-sandbox',
                ],
            });

            const extensions = await browser.extensions();
            const extension = [...extensions.values()].find(candidate =>
                candidate.name === 'Switch to Audible Tab'
            );
            assert.ok(extension, 'extension was not loaded');

            let [worker] = await extension.workers();
            if (!worker) {
                const target = await browser.waitForTarget(candidate =>
                    candidate.type() === 'service_worker'
                    && candidate.url().endsWith('/src/service-worker.js')
                );
                worker = await target.worker();
            }
            assert.ok(worker, 'extension service worker was not started');

            const harness = new ExtensionHarness({
                browser,
                extension,
                extensionPath,
                server,
                worker,
            });
            await harness.setSettings();
            return harness;
        } catch (error) {
            if (browser) {
                await browser.close();
            }
            await server.close();
            fs.rmSync(extensionPath, { recursive: true, force: true });
            throw error;
        }
    }

    constructor({ browser, extension, extensionPath, server, worker }) {
        this.browser = browser;
        this.extension = extension;
        this.extensionPath = extensionPath;
        this.server = server;
        this.worker = worker;
        this.pageNumber = 0;
    }

    fixtureUrl(name, host = '127.0.0.1') {
        this.pageNumber += 1;
        return `http://${host}:${this.server.port}/${name}.html?test=${this.pageNumber}`;
    }

    async newPage(name = 'silent', host) {
        const page = await this.browser.newPage();
        await page.goto(this.fixtureUrl(name, host));
        if (name === 'audio') {
            await page.waitForFunction(() => Boolean(window.audioTest));
        }
        return page;
    }

    async newWindowPage(name = 'silent', host) {
        const url = this.fixtureUrl(name, host);
        const created = await this.worker.evaluate(async targetUrl => {
            const window = await chrome.windows.create({
                url: targetUrl,
                focused: true,
            });
            return { tabId: window.tabs[0].id, windowId: window.id };
        }, url);
        const target = await this.browser.waitForTarget(candidate =>
            candidate.type() === 'page' && candidate.url() === url
        );
        const page = await target.page();
        await page.waitForFunction(() => document.readyState === 'complete');
        if (name === 'audio') {
            await page.waitForFunction(() => Boolean(window.audioTest));
        }
        page.extensionWindowId = created.windowId;
        return page;
    }

    async tab(page) {
        return this.worker.evaluate(async url => {
            const tabs = await chrome.tabs.query({ url });
            return tabs[0] || null;
        }, page.url());
    }

    async activeTab() {
        return this.worker.evaluate(async () => {
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            return tabs[0] || null;
        });
    }

    async tabs() {
        return this.worker.evaluate(() => chrome.tabs.query({}));
    }

    async activate(page) {
        await page.bringToFront();
        const expected = await this.tab(page);
        assert.ok(expected, `tab not found for ${page.url()}`);
        await waitFor(async () => {
            const tab = await this.worker.evaluate(id => chrome.tabs.get(id), expected.id);
            return tab.active;
        }, `tab did not become active: ${page.url()}`);
        await this.waitForSettledActivation();
    }

    async waitForSettledActivation() {
        const deadline = Date.now() + 6000;
        let stableReads = 0;
        let previousActiveId = null;

        while (Date.now() < deadline) {
            const state = await this.runtimeState();
            const active = await this.activeTab();
            const activeId = active ? active.id : null;
            const quiet = state
                && state.pendingActivationTabId === null
                && activeId !== null
                && activeId === previousActiveId;

            stableReads = quiet ? stableReads + 1 : 0;
            if (stableReads >= 3) {
                return;
            }

            previousActiveId = activeId;
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        throw new Error('extension activation did not settle');
    }

    async triggerAction(page) {
        await this.extension.triggerAction(page);
        if (!this.worker) {
            await this.refreshWorker();
        }
    }

    async refreshWorker() {
        this.worker = await waitFor(async () => {
            const [worker] = await this.extension.workers();
            return worker || false;
        }, 'extension service worker did not start');
        return this.worker;
    }

    async terminateWorker() {
        const workers = await this.extension.workers();
        const worker = workers[0] || this.worker;
        assert.ok(worker, 'extension service worker was not running');
        await worker.close();
        this.worker = null;
        await waitFor(
            async () => (await this.extension.workers()).length === 0,
            'extension service worker did not stop'
        );
    }

    async expectActive(page) {
        const expected = await this.tab(page);
        assert.ok(expected, `tab not found for ${page.url()}`);
        await waitFor(async () => {
            const tab = await this.worker.evaluate(id => chrome.tabs.get(id), expected.id);
            return tab.active;
        }, `extension did not activate ${page.url()}`);
        await this.waitForSettledActivation();
    }

    async expectActionSwitch(from, to) {
        await this.triggerAction(from);
        await this.expectActive(to);
    }

    async expectActionStaysOn(page) {
        const before = await this.tab(page);
        await this.triggerAction(page);
        await waitFor(async () => {
            const after = await this.tab(page);
            return after && after.id === before.id && after.active;
        }, `extension unexpectedly left ${page.url()}`);
    }

    async startAudio(page) {
        await page.evaluate(() => window.audioTest.start());
        await waitFor(
            () => page.evaluate(() => window.audioTest.isPlaying()),
            'audio element did not start'
        );
        await this.waitForAudible(page, true);
    }

    async pauseAudio(page) {
        await page.evaluate(() => window.audioTest.pause());
        await waitFor(
            async () => !(await page.evaluate(() => window.audioTest.isPlaying())),
            'audio element did not pause'
        );
        await this.waitForAudible(page, false);
    }

    async pulseAudio(page, milliseconds = 100) {
        await this.startAudio(page);
        await page.evaluate(duration => window.audioTest.playFor(duration), milliseconds);
        await this.waitForAudible(page, false);
    }

    async waitForAudible(page, audible) {
        const expected = await this.tab(page);
        await waitFor(async () => {
            const tab = await this.worker.evaluate(id => chrome.tabs.get(id), expected.id);
            return Boolean(tab.audible) === audible;
        }, `tab audible state did not become ${audible}: ${page.url()}`);
    }

    async setMuted(page, muted) {
        const tab = await this.tab(page);
        await this.worker.evaluate(
            ({ id, value }) => chrome.tabs.update(id, { muted: value }),
            { id: tab.id, value: muted }
        );
        await waitFor(async () => {
            const updated = await this.worker.evaluate(id => chrome.tabs.get(id), tab.id);
            return Boolean(updated.mutedInfo && updated.mutedInfo.muted) === muted;
        }, `tab muted state did not become ${muted}`);
    }

    async setSettings(overrides = {}) {
        const settings = { ...defaultSettings, ...overrides };
        await this.worker.evaluate(async nextSettings => {
            await chrome.storage.local.set({ settings: nextSettings });
            await new Promise(resolve => setTimeout(resolve, 0));
        }, settings);
        return settings;
    }

    async settings() {
        return this.worker.evaluate(async () =>
            (await chrome.storage.local.get('settings')).settings
        );
    }

    async waitForSettings(predicate, message = 'settings were not saved') {
        return waitFor(async () => {
            const settings = await this.settings();
            return predicate(settings) ? settings : false;
        }, message);
    }

    async runtimeState() {
        return this.worker.evaluate(async () =>
            (await chrome.storage.session.get('runtimeState')).runtimeState
        );
    }

    async openOptions() {
        const page = await this.browser.newPage();
        await page.setViewport({ width: 1200, height: 1400 });
        await page.goto(
            `chrome-extension://${this.extension.id}/static/settings.html`
        );
        await page.waitForSelector('#container');
        return page;
    }

    async close() {
        try {
            await this.browser.close();
        } finally {
            await this.server.close();
            fs.rmSync(this.extensionPath, { recursive: true, force: true });
        }
    }
}

const withHarness = async callback => {
    const harness = await ExtensionHarness.create();
    try {
        return await callback(harness);
    } finally {
        await harness.close();
    }
};

module.exports = {
    defaultSettings,
    waitFor,
    withHarness,
};
