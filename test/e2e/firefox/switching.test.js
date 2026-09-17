const assert = require('node:assert/strict');
const { test } = require('node:test');
const { sharedFirefox } = require('./harness.js');

const useHarness = sharedFirefox();

test('includes muted tabs only while the option is enabled', {
    timeout: 45000,
}, async () => {
    const harness = useHarness();

    const initial = await harness.newTab('silent');
    const muted = await harness.newTab('silent');
    await harness.setMuted(muted, true);

    await harness.setSettings({
        followNotifications: false,
        includeMuted: false,
    });
    await harness.expectToolbarStaysOn(initial);

    await harness.setSettings({ includeMuted: true });
    await harness.expectToolbarSwitch(initial, muted);
});

test('matches configured domains exactly and optionally their subdomains', {
    timeout: 20000,
}, async () => {
    const harness = useHarness();

    const initial = await harness.newTab('silent');
    const exact = await harness.newTab('silent', { host: 'media.test' });
    const subdomain = await harness.newTab('silent', { host: 'child.media.test' });

    await harness.setSettings({
        followNotifications: false,
        includeMuted: false,
        markAsAudible: [{
            domain: 'media.test',
            enabled: true,
            withSubdomains: false,
        }],
    });
    await harness.expectToolbarSwitch(initial, exact);

    await harness.setSettings({
        markAsAudible: [{
            domain: 'media.test',
            enabled: false,
            withSubdomains: false,
        }],
    });
    await harness.expectToolbarStaysOn(initial);

    await harness.closeTab(exact);
    await harness.setSettings({
        markAsAudible: [{
            domain: 'media.test',
            enabled: true,
            withSubdomains: false,
        }],
    });
    await harness.expectToolbarStaysOn(initial);

    await harness.setSettings({
        markAsAudible: [{
            domain: 'media.test',
            enabled: true,
            withSubdomains: true,
        }],
    });
    await harness.expectToolbarSwitch(initial, subdomain);
});

test('rapid repeated toolbar clicks settle on a single tab', {
    timeout: 20000,
}, async () => {
    const harness = useHarness();

    const initial = await harness.newTab('silent');
    const first = await harness.newAudibleTab();
    const second = await harness.newAudibleTab();
    await harness.setSettings({ followNotifications: false });

    await harness.select(initial);
    await harness.focusWindowOf(initial.url);
    await Promise.all([
        harness.clickToolbarButton(),
        harness.clickToolbarButton(),
    ]);
    const selected = await harness.waitForStableSelection();
    assert.ok(
        [initial.url, first.url, second.url].includes(selected),
        `unexpected selected tab: ${selected}`
    );
    const state = await harness.state();
    assert.equal(state.length, 1);
});

test('closing the target during activation leaves consistent state', {
    timeout: 20000,
}, async () => {
    const harness = useHarness();

    const initial = await harness.newTab('silent');
    const candidate = await harness.newAudibleTab();
    const survivor = await harness.newAudibleTab();
    await harness.setSettings({ followNotifications: false });

    await harness.select(initial);
    await harness.focusWindowOf(initial.url);
    await harness.clickToolbarButton();
    await harness.closeTab(candidate);
    await harness.waitForStableSelection();

    assert.ok(await harness.tabInfo(initial.url), 'initial tab disappeared');
    assert.ok(await harness.tabInfo(survivor.url), 'surviving tab disappeared');

    await harness.expectToolbarSwitch(initial, survivor);
});