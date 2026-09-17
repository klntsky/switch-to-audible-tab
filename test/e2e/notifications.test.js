const { test } = require('node:test');
const { waitFor, withHarness } = require('./harness.js');

test('follows, expires, filters, and prioritizes real notification sounds', {
    timeout: 25000,
}, async () => withHarness(async harness => {
    const initial = await harness.newPage('silent');
    const live = await harness.newPage('audio');
    const notification = await harness.newPage('audio');

    await harness.activate(initial);
    await harness.pulseAudio(notification);
    await harness.setSettings();
    await harness.expectActionSwitch(initial, notification);

    await harness.activate(initial);
    await harness.setSettings({ notificationsTimeout: 1 });
    const notificationTab = await harness.tab(notification);
    const state = await harness.runtimeState();
    const record = state.possibleNotifications.find(([id]) => id === notificationTab.id);
    const endedAt = record[1][1];
    await waitFor(
        () => Date.now() - endedAt >= 1000,
        'notification did not reach its configured timeout'
    );
    await harness.expectActionStaysOn(initial);

    await harness.pulseAudio(notification);
    await harness.setSettings({ followNotifications: false });
    await harness.expectActionStaysOn(initial);

    await harness.setSettings({ maxNotificationDuration: 0 });
    await harness.expectActionStaysOn(initial);

    await harness.setSettings();
    await harness.activate(live);
    await harness.startAudio(live);
    await harness.activate(initial);
    await harness.expectActionSwitch(initial, notification);

    await harness.activate(initial);
    await harness.setSettings({ notificationsFirst: false });
    await harness.expectActionSwitch(initial, live);
}));
