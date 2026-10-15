#!/usr/bin/env bash
# One-time setup for automatic updates.
#
#   ./scripts/setup-updates.sh <github-user>/<repo>
#
# 1. Creates your release signing key (private key stays on this computer).
# 2. Writes src-tauri/updater.json (update address + PUBLIC key, safe to commit).
# 3. Tells you the two GitHub secrets to add so GitHub can sign releases.
set -euo pipefail

say()  { printf '\033[1;35m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m  %s\n' "$*"; }

REPO="${1:-}"
if [[ ! "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
  echo "Usage: $0 <github-user>/<repo>     e.g. $0 stuartc/vela-mail" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
KEY_DIR="$HOME/.tauri"
KEY="$KEY_DIR/vela-mail.key"
cd "$ROOT"

if [[ -f "$KEY" ]]; then
  say "Using your existing signing key: $KEY"
else
  say "Creating your release signing key"
  echo "    Choose a strong password and store it in your password manager."
  echo "    You'll need it once more, for the GitHub secret."
  mkdir -p "$KEY_DIR" && chmod 700 "$KEY_DIR"
  npx tauri signer generate -w "$KEY"
  chmod 600 "$KEY"
fi

PUB="$(cat "$KEY.pub")"
ENDPOINT="https://github.com/$REPO/releases/latest/download/latest.json"
cat > src-tauri/updater.json <<EOF
{
  "endpoint": "$ENDPOINT",
  "pubkey": "$PUB"
}
EOF
say "Wrote src-tauri/updater.json (public information only)"

echo
say "Add these two secrets to GitHub (repo → Settings → Secrets and variables → Actions):"
echo "    TAURI_SIGNING_PRIVATE_KEY           = the contents of $KEY"
echo "    TAURI_SIGNING_PRIVATE_KEY_PASSWORD  = the password you just chose"
if command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then
  echo
  read -r -p "    gh is signed in. Add them now with gh? [y/N] " yn
  if [[ "${yn,,}" == "y" ]]; then
    gh secret set TAURI_SIGNING_PRIVATE_KEY --repo "$REPO" < "$KEY"
    gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo "$REPO"
    say "Secrets added"
  fi
fi

echo
warn "Back up $KEY and its password (e.g. in your password manager)."
warn "If you lose either, installed copies of Vela can't accept new updates and you'd reinstall once."
warn "Never commit the .key file. (.gitignore already blocks it.)"
echo
say "Next:"
echo "    git add src-tauri/updater.json && git commit -m 'Enable signed updates' && git push"
echo "    ./scripts/install.sh            # reinstall so your copy knows where to look"
echo "    ./scripts/release.sh 0.1.1      # publish your first update when ready"
