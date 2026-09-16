const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { test } = require('node:test');
const puppeteer = require('puppeteer');
const { stageExtension } = require('../../scripts/pack.js');

const pagesDirectory = path.join(__dirname, 'pages');

const waitFor = async (probe, message, timeout = 10000) => {
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
        origin: `http://127.0.0.1:${port}`,
        close: () => new Promise((resolve, reject) => {
            server.close(error => error ? reject(error) : resolve());
        }),
    };
};

const activeTab = worker => worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
});

const audibleUrls = worker => worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({ audible: true });
    return tabs.map(tab => tab.url);
});

test('switches to a real audible tab and returns after it is paused', {
    timeout: 30000,
}, async () => {
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

        const silentPage = await browser.newPage();
        const audioPage = await browser.newPage();
        const silentUrl = `${server.origin}/silent.html`;
        const audioUrl = `${server.origin}/audio.html`;

        await silentPage.goto(silentUrl);
        await audioPage.goto(audioUrl);
        await audioPage.waitForFunction(() => Boolean(window.audioTest));
        await audioPage.evaluate(() => window.audioTest.start());

        await waitFor(
            () => audioPage.evaluate(() => window.audioTest.isPlaying()),
            'audio element did not start'
        );
        await waitFor(
            async () => (await audibleUrls(worker)).includes(audioUrl),
            'Chromium did not mark the audio tab audible'
        );

        await silentPage.bringToFront();
        await waitFor(
            async () => (await activeTab(worker)).url === silentUrl,
            'silent tab did not become active'
        );

        const silentTab = await activeTab(worker);
        await waitFor(async () => worker.evaluate(async expectedId => {
            const { runtimeState } = await chrome.storage.session.get('runtimeState');
            return runtimeState
                && runtimeState.firstActive
                && runtimeState.firstActive.id === expectedId;
        }, silentTab.id), 'extension did not record the initial tab');

        await extension.triggerAction(silentPage);
        await waitFor(
            async () => (await activeTab(worker)).url === audioUrl,
            'extension did not activate the audible tab'
        );

        await audioPage.evaluate(() => window.audioTest.pause());
        await waitFor(
            async () => !(await audioPage.evaluate(() => window.audioTest.isPlaying())),
            'audio element did not pause'
        );
        await waitFor(
            async () => !(await audibleUrls(worker)).includes(audioUrl),
            'Chromium still marked the paused tab audible'
        );
        await waitFor(async () => worker.evaluate(async () => {
            const { runtimeState } = await chrome.storage.session.get('runtimeState');
            return runtimeState && runtimeState.pendingActivationTabId === null;
        }), 'extension activation did not settle');

        await extension.triggerAction(audioPage);
        await waitFor(
            async () => (await activeTab(worker)).url === silentUrl,
            'extension did not return to the initial tab'
        );
    } finally {
        if (browser) {
            await browser.close();
        }
        await server.close();
        fs.rmSync(extensionPath, { recursive: true, force: true });
    }
});
