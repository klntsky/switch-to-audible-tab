const assert = require('node:assert/strict');
const { test } = require('node:test');
const { sharedFirefox, waitFor } = require('./harness.js');

const useHarness = sharedFirefox();

const MARK_LABEL = 'Mark this tab as audible';
const MENU_ABSENT_TIMEOUT = 3000;

test('options page renders Firefox-only settings and persists changes', {
    timeout: 30000,
}, async () => {
    const harness = useHarness();

    const page = await harness.optionsPage();
    const byId = new Map(page.inputs.map(input => [input.id, input]));

    assert.ok(page.ids.includes('menuOnTab'), 'Firefox did not show the context menu option');
    assert.equal(byId.get('includeMuted').checked, true);
    assert.equal(byId.get('allWindows').checked, true);
    assert.equal(byId.get('includeFirst').checked, true);
    assert.equal(byId.get('sortBackwards').checked, false);
    assert.equal(byId.get('notifications').checked, true);
    assert.equal(byId.get('notifications-first').checked, true);
    assert.equal(byId.get('menuOnTab').checked, false);
    assert.equal(byId.get('timeout-field').value, '10');
    assert.equal(byId.get('duration-field').value, '10');

    await harness.clickOption('menuOnTab');
    await harness.clickOption('sortBackwards');

    const settings = await harness.settings();
    assert.equal(settings.menuOnTab, true);
    assert.equal(settings.sortBackwards, true);
    assert.equal(settings.includeMuted, true);
    assert.equal(settings.notificationsFirst, true);
});

test('tab context menu offers marking only when enabled and marked tabs become targets', {
    timeout: 20000,
}, async () => {
    const harness = useHarness();

    const markedTab = await harness.newTab('silent');
    const otherTab = await harness.newTab('silent');

    await harness.select(markedTab);
    assert.deepEqual(await harness.tabContextMenuItems(MENU_ABSENT_TIMEOUT), []);

    await harness.clickOption('menuOnTab');
    await harness.select(markedTab);
    assert.deepEqual(await harness.tabContextMenuItems(), [MARK_LABEL]);

    await harness.toggleMarkFromTabContextMenu();
    assert.deepEqual(await harness.markedUrls(), [markedTab.url]);

    await harness.select(otherTab);
    await harness.waitForSelected(otherTab.url);
    await harness.clickToolbarButton();
    await harness.waitForSelected(markedTab.url, 'marked tab was not activated');

    await harness.select(markedTab);
    await harness.toggleMarkFromTabContextMenu();
    assert.deepEqual(await harness.markedUrls(), []);

    await harness.select(otherTab);
    await harness.clickToolbarButton();
    await harness.waitForStableSelection();
    assert.equal(await harness.selectedUrl(), otherTab.url);

    await harness.clickOption('menuOnTab');
    await harness.select(markedTab);
    assert.deepEqual(await harness.tabContextMenuItems(MENU_ABSENT_TIMEOUT), []);
});

test('marked tabs in other windows are only used when all windows are searched', {
    timeout: 20000,
}, async () => {
    const harness = useHarness();

    const localTab = await harness.newTab('silent');
    const otherWindowTab = await harness.newTab('silent', { newWindow: true });

    await harness.clickOption('menuOnTab');

    await harness.select(otherWindowTab);
    await harness.focusWindowOf(otherWindowTab.url);
    await harness.toggleMarkFromTabContextMenu();
    assert.deepEqual(await harness.markedUrls(), [otherWindowTab.url]);

    await harness.select(localTab);
    await harness.focusWindowOf(localTab.url);
    await harness.clickToolbarButton();
    await waitFor(
        async () => (await harness.selectedWindowTabUrl(otherWindowTab.url))
            === otherWindowTab.url,
        'marked tab in the other window was not activated'
    );

    // Leave the other window on a tab that is not the marked one, so a switch
    // would be visible if the addon ignored allWindows.
    await harness.select(otherWindowTab);
    const otherWindowTabUnrelated = await harness.newTab('silent');
    await harness.waitForActive(otherWindowTabUnrelated.url);

    await harness.clickOption('allWindows');
    await harness.select(localTab);
    await harness.focusWindowOf(localTab.url);
    const beforeClick = await harness.selectedWindowTabUrl(otherWindowTab.url);
    assert.notEqual(beforeClick, otherWindowTab.url);
    await harness.clickToolbarButton();
    await new Promise(resolve => setTimeout(resolve, 800));
    assert.equal(
        await harness.selectedWindowTabUrl(otherWindowTab.url),
        beforeClick
    );
});

test('tab menu checkbox reflects whether the current tab is marked', {
    timeout: 20000,
}, async () => {
    const harness = useHarness();

    const markedTab = await harness.newTab('silent');
    const otherTab = await harness.newTab('silent');
    await harness.clickOption('menuOnTab');

    const markEntry = async () => {
        const entries = await harness.tabContextMenuEntries();
        return entries.find(entry => entry.label === MARK_LABEL);
    };

    await harness.select(markedTab);
    assert.equal((await markEntry()).checked, null);

    await harness.toggleMarkFromTabContextMenu();
    await harness.select(markedTab);
    assert.equal((await markEntry()).checked, 'true');

    await harness.select(otherTab);
    assert.equal((await markEntry()).checked, null);
});