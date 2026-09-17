const { test } = require('node:test');
const { sharedFirefox } = require('./harness.js');

const useHarness = sharedFirefox();

test('cycles audible tabs in both directions and honors includeFirst', {
    timeout: 60000,
}, async () => {
    const harness = useHarness();

    const initial = await harness.newTab('silent');
    const first = await harness.newAudibleTab();
    const second = await harness.newAudibleTab();
    const third = await harness.newAudibleTab();

    await harness.setSettings({
        followNotifications: false,
        includeMuted: false,
        includeFirst: true,
        sortBackwards: false,
    });

    await harness.expectToolbarSwitch(initial, first);
    await harness.expectToolbarSwitch(first, second);
    await harness.expectToolbarSwitch(second, third);
    await harness.expectToolbarSwitch(third, initial);

    await harness.setSettings({ sortBackwards: true });
    await harness.expectToolbarSwitch(initial, third);
    await harness.expectToolbarSwitch(third, second);
    await harness.expectToolbarSwitch(second, first);
    await harness.expectToolbarSwitch(first, initial);

    await harness.setSettings({ sortBackwards: false, includeFirst: false });
    await harness.expectToolbarSwitch(initial, first);
    await harness.expectToolbarSwitch(first, second);
    await harness.expectToolbarSwitch(second, third);
    await harness.expectToolbarSwitch(third, first);
});

test('limits audibility searches to the current window when configured', {
    timeout: 20000,
}, async () => {
    const harness = useHarness();

    const initial = await harness.newTab('silent');
    const otherWindow = await harness.newAudibleTabInNewWindow();

    await harness.setSettings({
        allWindows: false,
        followNotifications: false,
    });
    await harness.expectToolbarStaysOn(initial);

    await harness.setSettings({ allWindows: true });
    await harness.expectToolbarSwitch(initial, otherWindow);
});

test('keeps playing muted audio eligible when muted tabs are excluded', {
    timeout: 20000,
}, async () => {
    const harness = useHarness();

    const initial = await harness.newTab('silent');
    const audible = await harness.newAudibleTab();
    await harness.setMuted(audible, true);

    await harness.setSettings({
        includeMuted: false,
        followNotifications: false,
    });
    await harness.waitForAudible(audible, true);
    await harness.expectToolbarSwitch(initial, audible);
});

test('uses marked domains only when nothing is actually audible', {
    timeout: 20000,
}, async () => {
    const harness = useHarness();

    const initial = await harness.newTab('silent');
    const marked = await harness.newTab('silent', { host: 'media.test' });
    const audible = await harness.newAudibleTab();

    await harness.setSettings({
        includeMuted: false,
        followNotifications: false,
        markAsAudible: [{
            domain: 'media.test',
            enabled: true,
            withSubdomains: false,
        }],
        websitesOnlyIfNoAudible: true,
    });
    await harness.expectToolbarSwitch(initial, audible);

    await harness.pauseAudio(audible);
    await harness.expectToolbarSwitch(initial, marked);
});

test('accepts short notification sounds and rejects long ones', {
    timeout: 30000,
}, async () => {
    const harness = useHarness();

    const initial = await harness.newTab('silent');
    await harness.setSettings({
        followNotifications: true,
        notificationsTimeout: 15,
        maxNotificationDuration: 1,
    });

    await harness.playBackgroundNotification(initial, { duration: 3000 });
    await harness.expectToolbarStaysOn(initial);

    await harness.setSettings({ maxNotificationDuration: 10 });
    const short = await harness.playBackgroundNotification(initial);
    await harness.expectToolbarSwitch(initial, short);

    await harness.setSettings({ notificationsTimeout: 1 });
    await new Promise(resolve => setTimeout(resolve, 1300));
    await harness.expectToolbarStaysOn(initial);
});

test('prioritizes notifications over ordinary audible tabs when configured', {
    timeout: 30000,
}, async () => {
    const harness = useHarness();

    const initial = await harness.newTab('silent');
    const live = await harness.newAudibleTab();
    const notification = await harness.playBackgroundNotification(initial);

    await harness.setSettings({
        followNotifications: true,
        notificationsTimeout: 15,
        maxNotificationDuration: 10,
        notificationsFirst: true,
    });
    await harness.expectToolbarSwitch(initial, notification);

    await harness.setSettings({ notificationsFirst: false });
    await harness.expectToolbarSwitch(initial, live);
});
