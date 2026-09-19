const assert = require('node:assert/strict');
const { test } = require('node:test');
const { defaultSettings, waitFor, withHarness } = require('./harness.js');

const checked = (page, selector) => page.$eval(selector, element => element.checked);
const value = (page, selector) => page.$eval(selector, element => element.value);
const setValue = (page, selector, nextValue) => page.$eval(
    selector,
    (element, newValue) => {
        element.value = newValue;
        element.dispatchEvent(new Event('input', { bubbles: true }));
    },
    nextValue
);

test('validates, persists, restores, and applies options-page settings', {
    timeout: 30000,
}, async () => withHarness(async harness => {
    const options = await harness.openOptions();

    assert.equal(await checked(options, '#includeMuted'), true);
    assert.equal(await checked(options, '#allWindows'), true);
    assert.equal(await checked(options, '#sortBackwards'), false);
    assert.equal(await checked(options, '#includeFirst'), true);
    assert.equal(await options.$('#menuOnTab'), null);

    await options.click('#includeMuted');
    await options.click('#allWindows');
    await options.click('#sortBackwards');
    await options.click('#includeFirst');
    await options.click('#notifications');
    await waitFor(
        () => options.$eval('#timeout-field', element => element.disabled),
        'notification fields were not disabled'
    );
    await options.click('#notifications');
    await options.click('#notifications-first');
    await setValue(options, '#timeout-field', '3');
    await setValue(options, '#duration-field', '4');

    await options.click('input[value="Add domain"]');
    await harness.answerPermissionPrompt(['Tab', 'Return']);
    await options.waitForSelector('input[type="text"]');
    await setValue(options, 'input[type="text"]', 'media.test');
    await options.click('#withSubdomains0');
    await options.click('#websitesNoAudible');

    await harness.waitForSettings(settings =>
        settings.includeMuted === false
        && settings.allWindows === false
        && settings.sortBackwards === true
        && settings.includeFirst === false
        && settings.followNotifications === true
        && settings.notificationsFirst === false
        && settings.notificationsTimeout === 3
        && settings.maxNotificationDuration === 4
        && settings.websitesOnlyIfNoAudible === true
        && settings.markAsAudible.length === 1
        && settings.markAsAudible[0].domain === 'media.test'
        && settings.markAsAudible[0].withSubdomains === true
    );

    await options.click('#domain-checkbox-0');
    await harness.waitForSettings(settings =>
        settings.markAsAudible[0].enabled === false
    );
    await options.click('#domain-checkbox-0');
    await harness.waitForSettings(settings =>
        settings.markAsAudible[0].enabled === true
    );
    await options.click('input[value="Remove"]');
    await harness.waitForSettings(settings => settings.markAsAudible.length === 0);
    assert.equal(await options.$('input[type="text"]'), null);

    await options.click('input[value="Add domain"]');
    await setValue(options, 'input[type="text"]', 'media.test');
    await options.click('#withSubdomains0');
    await harness.waitForSettings(settings =>
        settings.markAsAudible.length === 1
        && settings.markAsAudible[0].domain === 'media.test'
        && settings.markAsAudible[0].withSubdomains === true
    );

    await options.reload();
    await options.waitForSelector('#container');
    assert.equal(await checked(options, '#includeMuted'), false);
    assert.equal(await checked(options, '#allWindows'), false);
    assert.equal(await checked(options, '#sortBackwards'), true);
    assert.equal(await checked(options, '#includeFirst'), false);
    assert.equal(await value(options, '#timeout-field'), '3');
    assert.equal(await value(options, '#duration-field'), '4');
    assert.equal(await value(options, 'input[type="text"]'), 'media.test');

    await setValue(options, 'input[type="text"]', 'invalid');
    await options.waitForSelector('input[type="text"].invalid');
    assert.equal((await harness.settings()).markAsAudible[0].domain, 'media.test');

    await setValue(options, 'input[type="text"]', 'media.test');
    await waitFor(
        async () => !(await options.$eval('input[type="text"]', element =>
            element.classList.contains('invalid')
        )),
        'valid domain remained invalid'
    );
    await setValue(options, '#timeout-field', '-1');
    await options.waitForSelector('#timeout-field.invalid');
    assert.equal((await harness.settings()).notificationsTimeout, 3);

    await options.click('#button-restore');
    await options.waitForSelector('input[value="Cancel"]');
    await options.click('input[value="Cancel"]');
    assert.equal(await value(options, '#timeout-field'), '-1');

    await options.click('#button-restore');
    await options.click('input[value="OK"]');
    await harness.waitForSettings(settings =>
        Object.entries(defaultSettings).every(([key, expected]) =>
            JSON.stringify(settings[key]) === JSON.stringify(expected)
        )
    );
    assert.equal(await checked(options, '#includeMuted'), true);
    assert.equal(await value(options, '#timeout-field'), '10');
    assert.equal(await options.$('input[type="text"]'), null);

    await options.click('#includeMuted');
    await harness.waitForSettings(settings => settings.includeMuted === false);
    const initial = await harness.newPage('silent');
    const muted = await harness.newPage('silent');
    await harness.setMuted(muted, true);
    await harness.activate(initial);
    await harness.expectActionStaysOn(initial);

    await options.bringToFront();
    await options.click('#includeMuted');
    await harness.waitForSettings(settings => settings.includeMuted === true);
    await harness.activate(initial);
    await harness.expectActionSwitch(initial, muted);
    await muted.close();
    await harness.activate(initial);

    const notification = await harness.newPage('audio');
    await options.bringToFront();
    await setValue(options, '#timeout-field', '0');
    await harness.waitForSettings(settings => settings.notificationsTimeout === 0);
    await harness.activate(initial);
    await harness.pulseAudio(notification);
    await harness.expectActionStaysOn(initial);

    await options.bringToFront();
    await setValue(options, '#timeout-field', '10');
    await setValue(options, '#duration-field', '0');
    await harness.waitForSettings(settings =>
        settings.notificationsTimeout === 10
        && settings.maxNotificationDuration === 0
    );
    await harness.activate(initial);
    await harness.pulseAudio(notification);
    await harness.expectActionStaysOn(initial);

    await options.bringToFront();
    await setValue(options, '#duration-field', '10');
    await harness.waitForSettings(settings => settings.maxNotificationDuration === 10);
    await harness.activate(initial);
    await harness.pulseAudio(notification);
    await harness.expectActionSwitch(initial, notification);
}, { headless: false }));
