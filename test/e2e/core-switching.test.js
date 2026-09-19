const assert = require('node:assert/strict');
const { test } = require('node:test');
const { withHarness } = require('./harness.js');

test('cycles audible tabs in both directions and optionally includes the initial tab', {
    timeout: 30000,
}, async () => withHarness(async harness => {
    assert.equal(await harness.hasTabsPermission(), false);
    await harness.setSettings({ followNotifications: false });

    const initial = await harness.newPage('silent');
    const first = await harness.newPage('audio');
    const second = await harness.newPage('audio');
    const third = await harness.newPage('audio');

    await harness.activate(initial);
    await harness.expectActionStaysOn(initial);

    await harness.startAudio(first);
    await harness.startAudio(second);
    await harness.startAudio(third);

    await harness.expectActionSwitch(initial, first);
    await harness.expectActionSwitch(first, second);
    await harness.expectActionSwitch(second, third);
    await harness.expectActionSwitch(third, initial);

    await harness.activate(initial);
    await harness.setSettings({
        followNotifications: false,
        sortBackwards: true,
    });
    await harness.expectActionSwitch(initial, third);
    await harness.expectActionSwitch(third, second);
    await harness.expectActionSwitch(second, first);
    await harness.expectActionSwitch(first, initial);

    await harness.activate(initial);
    await harness.setSettings({
        followNotifications: false,
        includeFirst: false,
    });
    await harness.expectActionSwitch(initial, first);
    await harness.expectActionSwitch(first, second);
    await harness.expectActionSwitch(second, third);
    await harness.expectActionSwitch(third, first);
}));
