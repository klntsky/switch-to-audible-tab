const assert = require('node:assert/strict');
const { test } = require('node:test');
const { waitFor, withHarness } = require('./harness.js');

test('keeps cross-window notifications out of a current-window-only search', {
    timeout: 20000,
}, async () => withHarness(async harness => {
    const initial = await harness.newPage('silent');
    const notification = await harness.newWindowPage('audio');

    await harness.activate(initial);
    await harness.pulseAudio(notification);
    await harness.setSettings({ allWindows: false });
    await harness.expectActionStaysOn(initial);

    await harness.setSettings();
    await harness.expectActionSwitch(initial, notification);
}));

test('keeps playing muted audio eligible and deduplicates overlapping matches', {
    timeout: 20000,
}, async () => withHarness(async harness => {
    const initial = await harness.newPage('silent');
    const candidate = await harness.newPage('audio', 'media.test');

    await harness.activate(candidate);
    await harness.startAudio(candidate);
    await harness.setMuted(candidate, true);
    await harness.activate(initial);
    await harness.setSettings({
        includeMuted: false,
        followNotifications: false,
    });
    await harness.expectActionSwitch(initial, candidate);
    await harness.expectActionSwitch(candidate, initial);

    await harness.setSettings({
        followNotifications: false,
        markAsAudible: [{
            domain: 'media.test',
            enabled: true,
            withSubdomains: false,
        }],
    });
    await harness.expectActionSwitch(initial, candidate);
    await harness.expectActionSwitch(candidate, initial);
}));

test('resets repeated notifications and orders multiple notifications newest first', {
    timeout: 30000,
}, async () => withHarness(async harness => {
    const initial = await harness.newPage('silent');
    const first = await harness.newPage('audio');
    const second = await harness.newPage('audio');
    const firstTab = await harness.tab(first);
    const secondTab = await harness.tab(second);

    await harness.activate(initial);
    await harness.pulseAudio(first);
    const firstRecord = (await harness.runtimeState()).possibleNotifications
        .find(([id]) => id === firstTab.id)[1];

    await harness.pulseAudio(first);
    const repeatedRecord = (await harness.runtimeState()).possibleNotifications
        .find(([id]) => id === firstTab.id)[1];
    assert.ok(repeatedRecord[0] > firstRecord[0]);
    assert.ok(repeatedRecord[1] > firstRecord[1]);

    await harness.pulseAudio(second);
    await harness.expectActionSwitch(initial, second);

    await harness.activate(initial);
    await harness.setSettings({ notificationsTimeout: 1 });
    await waitFor(
        () => Date.now() - repeatedRecord[1] >= 1000,
        'older notification did not expire'
    );
    await harness.pulseAudio(second);
    await harness.expectActionSwitch(initial, second);

    const remaining = (await harness.runtimeState()).possibleNotifications;
    assert.equal(remaining.some(([id]) => id === firstTab.id), false);
    assert.equal(remaining.some(([id]) => id === secondTab.id), true);
}));

test('notification duration limit accepts short sounds and rejects long ones', {
    timeout: 25000,
}, async () => withHarness(async harness => {
    const initial = await harness.newPage('silent');
    const notification = await harness.newPage('audio');

    await harness.activate(initial);
    await harness.setSettings({
        maxNotificationDuration: 5,
        notificationsTimeout: 10,
    });
    await harness.pulseAudio(notification, 100);
    await harness.expectActionSwitch(initial, notification);

    await harness.activate(initial);
    await harness.setSettings({
        maxNotificationDuration: 1,
        notificationsTimeout: 10,
    });
    await harness.pulseAudio(notification, 1000);
    await harness.expectActionStaysOn(initial);
}));

test('rapid repeated actions still settle on a single tab', {
    timeout: 20000,
}, async () => withHarness(async harness => {
    const initial = await harness.newPage('silent');
    const audible = await harness.newPage('audio');
    const other = await harness.newPage('audio');

    await harness.activate(initial);
    await harness.startAudio(audible);
    await harness.startAudio(other);
    await harness.setSettings({ followNotifications: false });

    await Promise.all([
        harness.triggerAction(initial),
        harness.triggerAction(initial),
    ]);
    await harness.waitForSettledActivation();

    const active = await harness.activeTab();
    assert.ok(
        [audible.url(), other.url()].includes(active.url) || active.url === initial.url(),
        `unexpected active tab: ${active.url}`
    );
    assert.equal((await harness.runtimeState()).pendingActivationTabId, null);
}));

test('closing the target during activation leaves consistent state', {
    timeout: 20000,
}, async () => withHarness(async harness => {
    const initial = await harness.newPage('silent');
    const candidate = await harness.newPage('audio');
    const survivor = await harness.newPage('audio');
    const candidateTab = await harness.tab(candidate);

    await harness.activate(initial);
    await harness.startAudio(candidate);
    await harness.startAudio(survivor);
    await harness.setSettings({ followNotifications: false });

    await harness.triggerAction(initial);
    await candidate.close();
    await harness.waitForSettledActivation();

    const state = await harness.runtimeState();
    assert.equal(state.pendingActivationTabId, null);
    assert.deepEqual(state.marked, []);
    assert.ok(!state.possibleNotifications.some(([id]) => id === candidateTab.id));
    assert.ok(await harness.tab(initial), 'initial tab disappeared');
    assert.ok(await harness.tab(survivor), 'surviving audible tab disappeared');

    await harness.expectActionSwitch(initial, survivor);
}));

test('a competing user activation does not corrupt extension state', {
    timeout: 20000,
}, async () => withHarness(async harness => {
    const initial = await harness.newPage('silent');
    const audible = await harness.newPage('audio');
    const userChoice = await harness.newPage('silent');
    const scratch = await harness.newPage('silent');

    await harness.activate(initial);
    await harness.startAudio(audible);
    await harness.setSettings({ followNotifications: false });

    await harness.triggerAction(initial);
    await userChoice.bringToFront();
    await harness.waitForSettledActivation();

    const openTabs = await harness.tabs();
    const openIds = new Set(openTabs.map(tab => tab.id));
    const state = await harness.runtimeState();
    assert.equal(state.pendingActivationTabId, null);
    assert.ok(
        state.lastTabs.every(tab => openIds.has(tab.id)),
        `stale tabs recorded: ${JSON.stringify(state.lastTabs)}`
    );
    if (state.firstActive) {
        assert.ok(openIds.has(state.firstActive.id), 'firstActive references a closed tab');
    }

    await harness.activate(scratch);
    await harness.expectActionSwitch(scratch, audible);
}));

test('restores cycling and notification state after a service-worker restart', {
    timeout: 25000,
}, async () => withHarness(async harness => {
    const initial = await harness.newPage('silent');
    const audible = await harness.newPage('audio');

    await harness.setSettings({ followNotifications: false });
    await harness.activate(initial);
    await harness.startAudio(audible);
    await harness.expectActionSwitch(initial, audible);
    await harness.terminateWorker();
    await harness.expectActionSwitch(audible, initial);

    await harness.pauseAudio(audible);
    const notification = await harness.newPage('audio');
    await harness.activate(initial);
    await harness.setSettings();
    await harness.pulseAudio(notification);
    await harness.terminateWorker();
    await harness.expectActionSwitch(initial, notification);
}));
