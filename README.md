# Switch to audible tab

[Install from AMO](https://addons.mozilla.org/en-US/firefox/addon/switch-to-audible-tab/) / [Gitlab](https://gitlab.com/klntsky/switch-to-audible-tab) / [Github](https://github.com/8084/switch-to-audible-tab)

![preview](screenshot.png)

This WebExtension allows the user to switch to the tab that is currently making sound.

Default **Alt+Shift+A** hotkey can be used instead of the toolbar button.

# Configuration options

## Hotkey

Firefox implements unified UI for hotkey preferences. The default hotkey [can be changed in Firefox addons settings](https://support.mozilla.org/en-US/kb/manage-extension-shortcuts-firefox).

## Multiple tabs

If there are multiple audible tabs, the addon will cycle through them and then return to the initial tab (the latter can be opted off at the settings page).

If there are audible tabs belonging to other windows, these windows will be switched too (this can be opted off as well).

It is also possible to control the order in which tabs will be visited: available options are left-to-right and right-to-left. This will only make difference if there are more than two tabs in a cycle.

If there are no audible tabs, the addon will do nothing.

## Notifications

Some websites play short notification sounds when user's attention is needed. Notification following feature makes it possible to react to a notification during some configurable period of time after the notification sound has ended. A sound is treated as a notification if it is not coming from currently active tab AND its duration is less than notification duration limit (configurable).

Notifications can be given first priority or treated the same.

## Muted tabs

Tabs that are muted by the user are also considered audible (this can be changed at the settings page).

## Marking tabs as audible by domain

There is an option to enter a list of domains which will be marked as audible regardless of actual state. Can be used to avoid spending your time on finding *that bandcamp tab*.

Also, there is an option to include domains in the list only if there are no "actually" audible tabs.

## Default settings

Although tuning advanced options is highly recommended, the defaults will always stay simple to avoid newcomer confusion.

# Building from source

You'll need to install spago & purescript. Via npm:

```
npm install spago purescript
```

Or use alternative methods.

To build the extension and get the `.xpi` file, run:

```
npm install
npm run build
npm run pack
```
