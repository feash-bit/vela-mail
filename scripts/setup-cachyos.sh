#!/usr/bin/env bash
# Installs everything needed to build Vela on CachyOS / Arch Linux.
# Safe to run more than once.
set -euo pipefail

say() { printf '\033[1;35m==>\033[0m %s\n' "$*"; }

if ! command -v pacman >/dev/null; then
  echo "This script is for Arch-based systems (CachyOS, EndeavourOS, Arch)." >&2
  exit 1
fi

say "Installing system packages (needs sudo)"
# webkit2gtk-4.1: the web engine Tauri uses on Linux
# libsecret / gnome-keyring are only needed if you don't use KDE Wallet
sudo pacman -S --needed --noconfirm \
  base-devel git curl wget file openssl \
  webkit2gtk-4.1 gtk3 librsvg libappindicator-gtk3 xdotool \
  nodejs npm github-cli \
  xdg-utils xdg-desktop-portal

if command -v rustup >/dev/null; then
  say "Making sure a stable Rust toolchain is active"
  rustup default stable >/dev/null
  rustup update stable >/dev/null
elif command -v cargo >/dev/null; then
  # Rust installed from pacman ('rust' package) works fine; don't fight it.
  say "Using the Rust already installed ($(cargo --version))"
else
  say "Installing rustup (Rust toolchain manager)"
  sudo pacman -S --needed --noconfirm rustup
  rustup default stable >/dev/null
fi

say "Installing JavaScript packages"
cd "$(dirname "$0")/.."
npm ci --no-audit --no-fund

say "Done. Next:"
echo "  • Development (hot reload):   npm run dev"
echo "  • Install to your user menu:  ./scripts/install.sh"
echo "  • Google setup guide:         docs/GOOGLE_SETUP.md"
