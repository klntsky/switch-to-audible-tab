/* global browser exports */

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
