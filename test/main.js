/* global test require __dirname */
const fs = require('fs');
const webExtensionsGeckoDriver = require('webextensions-geckodriver');

const manifestFile = __dirname + '/../manifest.json';
const manifest = require(manifestFile);

const { firefox, webdriver } = webExtensionsGeckoDriver;

const fxOptions =
      new firefox.Options()
      .headless()
      .windowSize({ height: 600, width: 800 });

const test = require('ava');

test("test", async t => {
    const webExtension = await webExtensionsGeckoDriver(
        manifestFile,
        { fxOptions }
    );

    const geckodriver = webExtension.geckodriver;

    const button = await geckodriver.wait(webdriver.until.elementLocated(
        // browser_actions automatically have applications.gecko.id as prefix
        // special chars in the id are replaced with _
        webdriver.By.id(
            manifest.applications.gecko.id.replace('@', '_') + '-browser-action'
        )
    ), 1000);

    t.is(await button.getAttribute('tooltiptext'), manifest.browser_action.default_title);

    geckodriver.quit();
    t.pass();
});
