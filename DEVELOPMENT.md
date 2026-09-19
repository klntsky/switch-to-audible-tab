# Development

## Tests

```
npm run test:install   # pinned browsers + geckodriver
npm test               # both suites
npm run test:chrome
npm run test:firefox
```

## Chrome suite

The Chrome suite needs `xvfb-run`, `Xauth`, and `xdotool`. On Debian or Ubuntu,
install them with:

```
sudo apt-get update
sudo apt-get install --no-install-recommends xvfb xauth xdotool
```

Most Chrome tests run headlessly, but the optional `tabs` permission tests run
headed Chrome inside Xvfb. The permission request is browser-owned UI, so it is
not exposed through Puppeteer's page dialog API. `xdotool` sends keyboard input
to that real prompt to cover both approval and rejection; `xauth` is required by
`xvfb-run` when it creates the isolated display.

## Firefox suite

Firefox reports a tab as audible only when it is really playing sound, so the
suite needs a display and a PulseAudio sink. It checks both before running and
fails immediately with what is missing.

Display: the suite starts Xvfb itself on the first free display, so `Xvfb` has
to be on `PATH` (`xvfb-run` is not required). `xdpyinfo` is used to confirm the
display is up; without it the X socket is checked instead.

PulseAudio: `pactl` has to reach a server that has at least one sink. On a
machine without sound hardware:

```
sudo scripts/install-dummy-audio.sh
```

That installs the snd-dummy card and starts PulseAudio with a null sink. A
user-level daemon is enough:

```
pulseaudio --start -n --load="module-null-sink sink_name=dummy" \
    --load="module-native-protocol-unix"
```

The suite also runs the browser with proxies disabled, because the fixtures are
served from loopback and from the `media.test` hostnames.
