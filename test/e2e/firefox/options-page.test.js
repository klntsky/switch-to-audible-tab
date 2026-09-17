const assert = require('node:assert/strict');
const { test } = require('node:test');
const { sharedFirefox } = require('./harness.js');

const useHarness = sharedFirefox();

test('persists every general setting toggled in the options page', {
    timeout: 45000,
}, async () => {
    const harness = useHarness();

    await harness.clickOption('includeMuted');
    assert.equal((await harness.settings()).includeMuted, false);

    await harness.clickOption('allWindows');
    assert.equal((await harness.settings()).allWindows, false);

    await harness.clickOption('includeFirst');
    assert.equal((await harness.settings()).includeFirst, false);

    await harness.clickOption('sortBackwards');
    assert.equal((await harness.settings()).sortBackwards, true);

    await harness.clickOption('menuOnTab');
    assert.equal((await harness.settings()).menuOnTab, true);

    await harness.clickOption('notifications-first');
    assert.equal((await harness.settings()).notificationsFirst, false);

    await harness.clickOption('notifications');
    assert.equal((await harness.settings()).followNotifications, false);
});

test('saves valid domains and timeouts entered in the options page', {
    timeout: 15000,
}, async () => {
    const harness = useHarness();

    await harness.setOptionValue('timeout-field', '3');
    await harness.setOptionValue('duration-field', '4');
    await harness.clickButton('Add domain');
    await harness.setDomainValue(0, 'media.test');
    await harness.clickOption('websitesNoAudible');
    await harness.clickOption('withSubdomains0');

    const settings = await harness.waitForSettings(candidate =>
        candidate.notificationsTimeout === 3
        && candidate.maxNotificationDuration === 4
        && candidate.websitesOnlyIfNoAudible === true
        && candidate.markAsAudible.length === 1
        && candidate.markAsAudible[0].domain === 'media.test'
        && candidate.markAsAudible[0].withSubdomains === true);

});

test('marks invalid input without overwriting the stored settings', {
    timeout: 15000,
}, async () => {
    const harness = useHarness();

    const saved = await harness.settings();

    await harness.setOptionValue('timeout-field', '-1');
    await harness.waitForInvalid('timeout-field');
    assert.equal(
        (await harness.settings()).notificationsTimeout,
        saved.notificationsTimeout
    );

    await harness.setOptionValue('timeout-field', '10');
    await harness.waitForSettings(candidate => candidate.notificationsTimeout === 10);

    await harness.clickButton('Add domain');
    await harness.setDomainValue(0, 'not a domain');
    await harness.waitForDomainInvalid(0);
    assert.deepEqual((await harness.settings()).markAsAudible, saved.markAsAudible);
});

test('disables notification controls while notification following is off', {
    timeout: 15000,
}, async () => {
    const harness = useHarness();

    assert.equal((await harness.elementState('timeout-field')).disabled, false);

    await harness.clickOption('notifications');
    assert.equal((await harness.elementState('timeout-field')).disabled, true);
    assert.equal((await harness.elementState('duration-field')).disabled, true);
    assert.equal((await harness.elementState('notifications-first')).disabled, true);

    await harness.clickOption('notifications');
    assert.equal((await harness.elementState('timeout-field')).disabled, false);
});

test('restores defaults only after the confirmation is accepted', {
    timeout: 15000,
}, async () => {
    const harness = useHarness();

    await harness.clickOption('includeMuted');
    await harness.setOptionValue('timeout-field', '3');
    await harness.waitForSettings(candidate => candidate.notificationsTimeout === 3);

    await harness.clickButton('Restore defaults');
    await harness.clickButton('Cancel');
    assert.equal((await harness.settings()).notificationsTimeout, 3);
    assert.equal((await harness.settings()).includeMuted, false);

    await harness.clickButton('Restore defaults');
    await harness.clickButton('OK');
    await harness.waitForSettings(candidate =>
        candidate.notificationsTimeout === 10 && candidate.includeMuted === true);
    assert.deepEqual((await harness.settings()).markAsAudible, []);
});

test('manages the marked domain list from the options page', {
    timeout: 15000,
}, async () => {
    const harness = useHarness();

    await harness.clickButton('Add domain');
    await harness.setDomainValue(0, 'media.test');
    await harness.clickOption('withSubdomains0');
    await harness.clickButton('Add domain');
    await harness.setDomainValue(1, 'example.com');

    await harness.waitForSettings(candidate =>
        candidate.markAsAudible.length === 2
        && candidate.markAsAudible[0].withSubdomains === true
        && candidate.markAsAudible[1].domain === 'example.com');

    await harness.clickOption('domain-checkbox-0');
    await harness.waitForSettings(candidate => candidate.markAsAudible[0].enabled === false);

    await harness.clickButton('Remove');
    await harness.waitForSettings(candidate =>
        candidate.markAsAudible.length === 1
        && candidate.markAsAudible[0].domain === 'example.com');
    assert.equal(await harness.domainRowCount(), 1);
});