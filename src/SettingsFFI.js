/* global browser exports */

exports.isGoogle = navigator.vendor === "Google Inc.";

exports.save_ = function (settings) {
    return function () {
        return browser.storage.local.set({ settings: settings });
    };
};

exports.load_ = function (defaults) {
    return function () {
        return browser.storage.local.get({ settings: defaults }).then(function (res) {
            return res.settings;
        });
    };
};

exports.setFocus = function(elem) {
    return function() {
        elem.focus();
    };
};

// Adapted from https://github.com/miguelmota/is-valid-domain
exports.isValidDomain = function (v, opts) {
    if (typeof v !== 'string')
        return false;
    if (!(opts instanceof Object))
        opts = {};

    var parts = v.split('.');
    if (parts.length <= 1)
        return false;

    var tld = parts.pop();
    var tldRegex = /^(?:xn--)?[a-zA-Z0-9]+$/gi;

    if (!tldRegex.test(tld))
        return false;
    if (opts.subdomain == false && parts.length > 1)
        return false;

    var isValid = parts.every(function(host, index) {
        if (opts.wildcard && index === 0 && host === '*' && parts.length > 1)
            return true;

        var hostRegex = /^(?!:\/\/)([a-zA-Z0-9]+|[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9])$/gi;

        return hostRegex.test(host);
    });

    return isValid;
};

exports.openHotkeySettings = function () {
    browser.tabs.create({url: 'chrome://extensions/shortcuts'});
};
