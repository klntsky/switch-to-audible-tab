/** Default settings */
const defaults = {
    includeMuted: true,
    allWindows: true,
    includeFirst: true
};

let muted, all, first;

function save () {
    browser.storage.local.set({ settings: {
        includeMuted: muted.checked,
        allWindows: all.checked,
        includeFirst: first.checked
    }});
}

async function load () {
    const settings = (await browser.storage.local.get({ settings: defaults })).settings;
    muted = document.querySelector('#include-muted');
    all = document.querySelector('#all-windows');
    first = document.querySelector('#include-first');

    muted.checked = settings.includeMuted;
    all.checked = settings.allWindows;
    first.checked = settings.includeFirst;

    [muted, all, first].forEach(e => e.onchange = save);
}

document.addEventListener('DOMContentLoaded', load);
