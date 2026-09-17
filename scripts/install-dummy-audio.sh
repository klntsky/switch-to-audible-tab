#!/usr/bin/env bash
#
# Installs an empty audio device for the browser test suites: the snd-dummy
# ALSA card plus a system PulseAudio server with a null sink. Firefox plays only
# through PulseAudio, so the sink is what the tests actually need.
#
# Run as root:
#
#   scripts/install-dummy-audio.sh
#   scripts/install-dummy-audio.sh --remove
#
set -euo pipefail

MODULE="${MODULE:-snd-dummy}"
MODULE_OPTIONS="${MODULE_OPTIONS:-enable=1 index=0}"
SINK="${SINK:-dummy}"
MODULES_FILE="/etc/modules-load.d/${MODULE}.conf"
OPTIONS_FILE="/etc/modprobe.d/${MODULE}.conf"
ASOUND_FILE="/etc/asound.conf"
MARKER="# managed by install-dummy-audio.sh"
PULSE_SOCKET="/run/pulse/native"

# Who needs to reach the sound devices: an explicit TARGET_USER, the user behind
# sudo, or whoever owns this checkout.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_OWNER="$(stat -c %U "${SCRIPT_DIR}/.." 2>/dev/null || true)"
CLIENT_USER="${TARGET_USER:-${SUDO_USER:-${REPO_OWNER}}}"

usage() {
    cat <<'EOF'
Usage: install-dummy-audio.sh [--remove]

  (no options)  dummy ALSA card + system PulseAudio null sink
  --remove      stop them again and drop the added configuration

Environment overrides: MODULE, MODULE_OPTIONS, SINK, TARGET_USER
EOF
}

require_root() {
    if [ "$(id -u)" -ne 0 ]; then
        echo "This script must run as root" >&2
        exit 1
    fi
}

apt_install() {
    if ! command -v apt-get >/dev/null 2>&1; then
        echo "Install $* and run this again" >&2
        exit 1
    fi
    apt-get update -qq
    apt-get install -y "$@"
}

as_user() {
    local user="$1"
    shift
    if command -v runuser >/dev/null 2>&1; then
        runuser -u "$user" -- "$@"
    else
        su -s /bin/sh "$user" -c "$(printf '%q ' "$@")"
    fi
}

load_card() {
    if ! modinfo "$MODULE" >/dev/null 2>&1; then
        # Ubuntu ships the sound drivers in linux-modules-extra-<release>.
        apt_install "linux-modules-extra-$(uname -r)"
    fi
    # shellcheck disable=SC2086
    modprobe "$MODULE" $MODULE_OPTIONS
    printf '%s\n' "$MODULE" > "$MODULES_FILE"
    printf 'options %s %s\n' "$MODULE" "$MODULE_OPTIONS" > "$OPTIONS_FILE"
    echo "Loaded $MODULE, kept across reboots by $MODULES_FILE"
}

start_pulseaudio() {
    if ! command -v pulseaudio >/dev/null 2>&1; then
        apt_install pulseaudio
    fi

    # The daemon needs its own runtime directory in system mode.
    if ! getent passwd pulse >/dev/null 2>&1; then
        echo "The pulseaudio package did not create the 'pulse' user" >&2
        exit 1
    fi
    mkdir -p "$(dirname "$PULSE_SOCKET")"
    chown pulse:pulse "$(dirname "$PULSE_SOCKET")"

    if [ -S "$PULSE_SOCKET" ]; then
        echo "PulseAudio is already listening on $PULSE_SOCKET"
        return
    fi

    pulseaudio --system --daemonize=yes --disallow-exit --exit-idle-time=-1

    local waited=0
    while [ ! -S "$PULSE_SOCKET" ] && [ "$waited" -lt 100 ]; do
        sleep 0.1
        waited=$((waited + 1))
    done
    if [ ! -S "$PULSE_SOCKET" ]; then
        echo "PulseAudio did not start; check /var/log/syslog" >&2
        exit 1
    fi
    echo "PulseAudio is listening on $PULSE_SOCKET"
}

pulse_client() {
    local user="$1"
    shift
    as_user "$user" env PULSE_SERVER="unix:${PULSE_SOCKET}" pactl "$@"
}

pulse_user() {
    local candidate
    for candidate in "${CLIENT_USER:-root}" root; do
        if [ -n "$candidate" ] && pulse_client "$candidate" info >/dev/null 2>&1; then
            echo "$candidate"
            return 0
        fi
    done
    return 1
}

ensure_sink() {
    local user
    if ! user="$(pulse_user)"; then
        echo "Cannot talk to PulseAudio; add a user to the pulse-access group and retry" >&2
        exit 1
    fi

    if pulse_client "$user" list short sinks 2>/dev/null | grep -qw "$SINK"; then
        echo "Sink '$SINK' already present"
        return
    fi

    pulse_client "$user" load-module module-null-sink "sink_name=${SINK}"
    pulse_client "$user" set-default-sink "$SINK"
    echo "Created sink '$SINK'"
}

grant_access() {
    local user="${CLIENT_USER:-root}"

    usermod -aG pulse-access "$user" 2>/dev/null || true
    usermod -aG audio "$user" 2>/dev/null || true
    echo "Added $user to the pulse-access and audio groups"

    if [ "$user" != "root" ]; then
        echo "Existing sessions need a new login, or run the tests with: sg pulse-access -c '<command>'"
    fi
}

report() {
    local user
    echo
    echo "PulseAudio sinks:"
    if user="$(pulse_user)"; then
        pulse_client "$user" list short sinks
    else
        echo "  (none reachable)"
    fi

    echo
    echo "Sound cards:"
    cat /proc/asound/cards || echo "  (none)"

    echo
    echo "Run the suite as a user in the pulse-access group:"
    echo "  npm run test:e2e:firefox"
}

remove_all() {
    if pgrep -f "pulseaudio --system" >/dev/null 2>&1; then
        pulseaudio --kill >/dev/null 2>&1 || pkill -f "pulseaudio --system" || true
        echo "Stopped PulseAudio"
    fi
    if modinfo "$MODULE" >/dev/null 2>&1; then
        rmmod "$MODULE" 2>/dev/null || true
        echo "Unloaded $MODULE"
    fi
    rm -f "$MODULES_FILE" "$OPTIONS_FILE"
    if [ -f "$ASOUND_FILE" ] && grep -q "$MARKER" "$ASOUND_FILE"; then
        rm -f "$ASOUND_FILE"
    fi
    echo "Removed the module configuration"
}

case "${1:-}" in
    --remove)
        require_root
        remove_all
        ;;
    --help|-h)
        usage
        ;;
    "")
        require_root
        load_card
        start_pulseaudio
        grant_access
        ensure_sink
        report
        ;;
    *)
        usage >&2
        exit 2
        ;;
esac