/** Default settings */
const defaults = {
    includeMuted: true,
    allWindows: true,
    includeFirst: true,
    sortBackwards: false,
};

let muted, all, first, sort;

function save () {
    browser.storage.local.set({ settings: {
        includeMuted: muted.checked,
        allWindows: all.checked,
        includeFirst: first.checked,
        sortBackwards: sort.checked,
    }});
}

async function load () {
    const settings = (await browser.storage.local.get({ settings: defaults })).settings;
    muted = document.querySelector('#include-muted');
    all = document.querySelector('#all-windows');
    first = document.querySelector('#include-first');
    sort = document.querySelector('#sort-backwards');

    muted.checked = settings.includeMuted;
    all.checked = settings.allWindows;
    first.checked = settings.includeFirst;
    sort.checked = settings.sortBackwards;

    [muted, all, first, sort].forEach(e => e.onchange = save);
}

document.addEventListener('DOMContentLoaded', load);
