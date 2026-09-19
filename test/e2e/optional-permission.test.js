const assert = require('node:assert/strict');
const { test } = require('node:test');
const { waitFor, withHarness } = require('./harness.js');

const addDomainSelector = 'input[value="Add domain"]';
const setValue = (page, selector, value) => page.$eval(
    selector,
    (element, nextValue) => {
        element.value = nextValue;
        element.dispatchEvent(new Event('input', { bubbles: true }));
    },
    value
);

test('keeps marked domains unchanged when the tabs permission is rejected', {
    timeout: 30000,
}, async () => withHarness(async harness => {
    const options = await harness.openOptions();
    assert.equal(await harness.hasTabsPermission(), false);

    await options.click(addDomainSelector);
    await harness.answerPermissionPrompt(['Escape']);

    await options.click('#includeMuted');
    await harness.waitForSettings(settings => settings.includeMuted === false);
    assert.equal(await harness.hasTabsPermission(), false);
    assert.deepEqual((await harness.settings()).markAsAudible, []);
    assert.equal(await options.$('input[type="text"]'), null);
}, { headless: false }));

test('adds a marked domain after the tabs permission is approved', {
    timeout: 30000,
}, async () => withHarness(async harness => {
    const options = await harness.openOptions();
    assert.equal(await harness.hasTabsPermission(), false);

    await options.click(addDomainSelector);
    await harness.answerPermissionPrompt(['Tab', 'Return']);

    await waitFor(
        () => harness.hasTabsPermission(),
        'tabs permission was not granted'
    );
    await options.waitForSelector('input[type="text"]');
    await setValue(options, 'input[type="text"]', 'media.test');
    await harness.waitForSettings(settings =>
        settings.markAsAudible.length === 1
        && settings.markAsAudible[0].domain === 'media.test'
    );
}, { headless: false }));
