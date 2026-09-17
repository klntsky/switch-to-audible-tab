# Development

## Tests

```
npm run test:e2e:install   # pinned browsers + geckodriver
npm run test:e2e           # both suites
npm run test:e2e:chrome
npm run test:e2e:firefox
```

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
