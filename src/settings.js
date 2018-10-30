/** Default settings */
const defaults = {
    includeMuted: true,
    allWindows: true
};

let muted, all;

function save () {
    browser.storage.local.set({ settings: {
        includeMuted: muted.checked,
        allWindows: all.checked
    }});
}

async function load () {
    const settings = (await browser.storage.local.get({ settings: defaults })).settings;
    muted = document.querySelector('#include-muted');
    all = document.querySelector('#all-windows');

    muted.checked = settings.includeMuted;
    all.checked = settings.allWindows;

    [muted, all].forEach(e => e.onchange = save);
}

document.addEventListener('DOMContentLoaded', load);
