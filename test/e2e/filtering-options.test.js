const assert = require('node:assert/strict');
const { test } = require('node:test');
const { withHarness } = require('./harness.js');

test('applies muted-tab, domain, subdomain, and real-audio filters', {
    timeout: 25000,
}, async () => withHarness(async harness => {
    await harness.grantTabsPermission();
    const initial = await harness.newPage('silent');
    const muted = await harness.newPage('silent');
    await harness.setMuted(muted, true);
    await harness.activate(initial);

    await harness.setSettings({
        followNotifications: false,
        includeMuted: false,
    });
    await harness.expectActionStaysOn(initial);

    await harness.setSettings({ followNotifications: false });
    await harness.expectActionSwitch(initial, muted);
    await muted.close();

    const exact = await harness.newPage('silent', 'media.test');
    const subdomain = await harness.newPage('silent', 'child.media.test');
    await harness.activate(initial);

    const exactDomain = {
        domain: 'media.test',
        enabled: true,
        withSubdomains: false,
    };
    await harness.setSettings({
        followNotifications: false,
        markAsAudible: [exactDomain],
    });
    await harness.expectActionSwitch(initial, exact);

    await harness.activate(initial);
    await harness.setSettings({
        followNotifications: false,
        markAsAudible: [{ ...exactDomain, enabled: false }],
    });
    await harness.expectActionStaysOn(initial);

    await exact.close();
    await harness.setSettings({
        followNotifications: false,
        markAsAudible: [exactDomain],
    });
    await harness.expectActionStaysOn(initial);

    await harness.setSettings({
        followNotifications: false,
        markAsAudible: [{ ...exactDomain, withSubdomains: true }],
    });
    await harness.expectActionSwitch(initial, subdomain);
    await subdomain.close();

    const marked = await harness.newPage('silent', 'media.test');
    const audible = await harness.newPage('audio');
    await harness.activate(initial);
    await harness.startAudio(audible);
    await harness.setSettings({
        followNotifications: false,
        markAsAudible: [exactDomain],
        websitesOnlyIfNoAudible: true,
    });
    await harness.expectActionSwitch(initial, audible);

    await harness.pauseAudio(audible);
    await harness.activate(initial);
    await harness.expectActionSwitch(initial, marked);
}, { headless: false }));

test('limits searches to the current window when configured', {
    timeout: 20000,
}, async () => withHarness(async harness => {
    const initial = await harness.newPage('silent');
    const otherWindow = await harness.newWindowPage('audio');
    const initialTab = await harness.tab(initial);
    const otherTab = await harness.tab(otherWindow);
    assert.notEqual(initialTab.windowId, otherTab.windowId);

    await harness.startAudio(otherWindow);
    await harness.activate(initial);
    await harness.setSettings({
        allWindows: false,
        followNotifications: false,
    });
    await harness.expectActionStaysOn(initial);

    await harness.setSettings({ followNotifications: false });
    await harness.expectActionSwitch(initial, otherWindow);
}));
