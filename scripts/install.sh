#!/usr/bin/env bash
# Builds Vela in release mode and installs it for the current user only
# (no root needed). Run it again after `git pull` to update.
#
#   ./scripts/install.sh               build + install
#   ./scripts/install.sh --default     also make Vela your default mailto: handler
#   ./scripts/install.sh --uninstall   remove Vela (keeps your settings and keyring)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="$HOME/.local/bin"
APPS="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
ICONS="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor"
say() { printf '\033[1;35m==>\033[0m %s\n' "$*"; }

if [[ "${1:-}" == "--uninstall" ]]; then
  rm -f "$BIN/vela-mail" "$APPS/vela-mail.desktop"
  find "$ICONS" -name 'vela-mail.png' -delete 2>/dev/null || true
  update-desktop-database "$APPS" 2>/dev/null || true
  say "Vela removed. Your settings (~/.config/vela-mail), cache (~/.local/share/vela-mail) and keyring entries were left in place."
  exit 0
fi

cd "$ROOT"
say "Installing JavaScript packages"
npm ci --no-audit --no-fund >/dev/null

say "Building Vela (release). The first build takes a few minutes."
# --no-bundle: we only need the binary for a local install.
npx tauri build --no-bundle

say "Installing to ~/.local"
install -Dm755 "src-tauri/target/release/vela-mail" "$BIN/vela-mail"
install -Dm644 "packaging/vela-mail.local.desktop" "$APPS/vela-mail.desktop"
for size in 32 64 128 256 512; do
  mkdir -p "$ICONS/${size}x${size}/apps"
  if command -v rsvg-convert >/dev/null; then
    rsvg-convert -w "$size" -h "$size" src-tauri/icons/vela.svg -o "$ICONS/${size}x${size}/apps/vela-mail.png"
  else
    install -Dm644 src-tauri/icons/icon.png "$ICONS/${size}x${size}/apps/vela-mail.png"
  fi
done
update-desktop-database "$APPS" 2>/dev/null || true
gtk-update-icon-cache -q "$ICONS" 2>/dev/null || true
kbuildsycoca6 >/dev/null 2>&1 || true  # refresh KDE's menu cache if present

if [[ "${1:-}" == "--default" ]]; then
  xdg-mime default vela-mail.desktop x-scheme-handler/mailto
  say "Vela is now your default app for mailto: links"
fi

case ":$PATH:" in *":$BIN:"*) ;; *) echo "Note: add ~/.local/bin to your PATH to run 'vela-mail' from a terminal." ;; esac
say "Installed. Open Vela from your application menu."
