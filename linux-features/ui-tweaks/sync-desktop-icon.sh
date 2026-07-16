#!/usr/bin/env bash
set -Eeuo pipefail

icon_source="${1:-}"
[ -n "$icon_source" ] && [ -f "$icon_source" ] && [ ! -L "$icon_source" ] || exit 0

home_dir="${HOME:-}"
[ -n "$home_dir" ] || exit 0

app_id="${CODEX_LINUX_APP_ID:-${CODEX_APP_ID:-codex-desktop}}"
case "$app_id" in
    *[!A-Za-z0-9._-]*|'') exit 0 ;;
esac

data_home="${XDG_DATA_HOME:-$home_dir/.local/share}"
applications_dir="$data_home/applications"
icons_dir="$data_home/icons/hicolor/256x256/apps"
desktop_target="$applications_dir/$app_id.desktop"
icon_target="$icons_dir/$app_id-dock-selection.png"
marker="X-Codex-Linux-Dock-Icon=1"

if [ -e "$desktop_target" ] || [ -L "$desktop_target" ]; then
    [ -f "$desktop_target" ] && [ ! -L "$desktop_target" ] || exit 0
    grep -qxF "$marker" "$desktop_target" || exit 0
fi

desktop_source="${CODEX_LINUX_DESKTOP_FILE_SOURCE:-}"
if [ -z "$desktop_source" ]; then
    for candidate in "/usr/share/applications/$app_id.desktop" "/usr/local/share/applications/$app_id.desktop" "${BAMF_DESKTOP_FILE_HINT:-}"; do
        if [ -n "$candidate" ] && [ "$candidate" != "$desktop_target" ] && [ -f "$candidate" ] && [ ! -L "$candidate" ]; then
            desktop_source="$candidate"
            break
        fi
    done
fi
[ -n "$desktop_source" ] && [ -f "$desktop_source" ] && [ ! -L "$desktop_source" ] || exit 0
grep -q '^Icon=' "$desktop_source" || exit 0

mkdir -p "$applications_dir" "$icons_dir"
desktop_tmp="$(mktemp "$applications_dir/.$app_id.desktop.XXXXXX")"
icon_tmp="$(mktemp "$icons_dir/.$app_id-dock-selection.XXXXXX")"
trap 'rm -f -- "$desktop_tmp" "$icon_tmp"' EXIT

install -m 0644 "$icon_source" "$icon_tmp"
awk -v icon="$icon_target" -v marker="$marker" '
    $0 == marker { next }
    /^Icon=/ && !icon_written { print "Icon=" icon; icon_written=1; next }
    { print }
    END { if (icon_written) print marker }
' "$desktop_source" > "$desktop_tmp"
chmod 0644 "$desktop_tmp"

changed=0
if [ ! -f "$icon_target" ] || ! cmp -s "$icon_tmp" "$icon_target"; then
    mv -f -- "$icon_tmp" "$icon_target"
    changed=1
fi
if [ ! -f "$desktop_target" ] || ! cmp -s "$desktop_tmp" "$desktop_target"; then
    mv -f -- "$desktop_tmp" "$desktop_target"
    changed=1
fi

if [ "$changed" -eq 1 ] && [[ "${XDG_CURRENT_DESKTOP:-}" == *KDE* ]]; then
    command -v kbuildsycoca6 >/dev/null 2>&1 && kbuildsycoca6 --noincremental >/dev/null 2>&1 || true
    command -v qdbus6 >/dev/null 2>&1 && qdbus6 org.kde.plasmashell /PlasmaShell org.kde.PlasmaShell.refreshCurrentShell >/dev/null 2>&1 || true
fi
