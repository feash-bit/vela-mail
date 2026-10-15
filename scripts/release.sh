#!/usr/bin/env bash
# Publishes a new version. GitHub builds, signs and releases it; installed
# copies of Vela then offer "Update ready · Restart".
#
#   ./scripts/release.sh 0.2.0 "Faster search; new snooze presets"
#
# What it does: checks you're ready, runs the tests, bumps the version in all
# four places, commits, tags v0.2.0 (the tag message becomes the release
# notes) and pushes. The GitHub Action does the rest (about 10–15 minutes).
set -euo pipefail

say() { printf '\033[1;35m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mxx\033[0m  %s\n' "$*" >&2; exit 1; }

VERSION="${1:-}"; NOTES="${2:-}"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]] || die "Usage: $0 <version> \"<release notes>\"   e.g. $0 0.2.0 \"Faster search\""
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"

CURRENT="$(node -p "require('./package.json').version")"
python3 - "$VERSION" "$CURRENT" <<'PY' || die "New version must be higher than the current one."
import sys
def key(v):
    main, _, pre = v.partition("-")
    return tuple(int(x) for x in main.split(".")), pre == "", pre
sys.exit(0 if key(sys.argv[1]) > key(sys.argv[2]) else 1)
PY

grep -q '"pubkey": "[^"]' src-tauri/updater.json || die "Updates aren't set up. Run ./scripts/setup-updates.sh <user>/<repo> first."
[[ -z "$(git status --porcelain)" ]] || die "You have uncommitted changes. Commit or stash them first."
git rev-parse "v$VERSION" >/dev/null 2>&1 && die "Tag v$VERSION already exists."
git remote get-url origin >/dev/null 2>&1 || die "No 'origin' remote. Add your GitHub repo: git remote add origin git@github.com:<user>/<repo>.git"

if [[ -z "$NOTES" ]]; then
  read -r -p "Release notes (one line, shown in Vela): " NOTES
fi
[[ -n "$NOTES" ]] || NOTES="Improvements and fixes."

say "Running checks (typecheck, tests, lint)"
npm run check >/dev/null || die "Checks failed. Run 'npm run check' to see why."

say "Bumping $CURRENT → $VERSION"
python3 - "$VERSION" <<'PY'
import json, re, sys
v = sys.argv[1]
for path in ["package.json", "src-tauri/tauri.conf.json"]:
    data = json.load(open(path)); data["version"] = v
    json.dump(data, open(path, "w"), indent=2); open(path, "a").write("\n")
for path, pat, rep in [
    ("src-tauri/Cargo.toml", r'(?m)^version = "[^"]+"', f'version = "{v}"'),
    ("packaging/arch/PKGBUILD", r"(?m)^pkgver=.*$", f"pkgver={v.replace('-', '_')}"),
]:
    s = open(path).read(); s = re.sub(pat, rep, s, count=1); open(path, "w").write(s)
PY
(cd src-tauri && cargo update -p vela-mail --offline >/dev/null 2>&1 || cargo check -q >/dev/null)
npm install --package-lock-only --no-audit --no-fund >/dev/null

git add package.json package-lock.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock packaging/arch/PKGBUILD
git commit -q -m "Release v$VERSION"
git tag -a "v$VERSION" -m "$NOTES"

say "Pushing v$VERSION"
git push -q origin HEAD
git push -q origin "v$VERSION"

REPO="$(git remote get-url origin | sed -E 's#(git@github.com:|https://github.com/)##; s#\.git$##')"
say "Done. GitHub is now building and signing the release:"
echo "    https://github.com/$REPO/actions"
echo "When it finishes, Vela shows 'Update ready · Restart' (within 6 hours, or use Settings → Updates → Check now)."
