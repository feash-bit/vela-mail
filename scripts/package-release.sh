#!/usr/bin/env bash
# Packages and signs a built release for the self-updater.
# Used by the GitHub release workflow; also handy for local testing.
#
#   ./scripts/package-release.sh <version> <download-base-url> [notes-file]
#
# Needs: src-tauri/target/release/vela-mail (built with `npx tauri build --no-bundle`)
# and the signing key in TAURI_SIGNING_PRIVATE_KEY (contents or path) plus
# TAURI_SIGNING_PRIVATE_KEY_PASSWORD.
#
# Produces in release/:
#   vela-mail-<version>-linux-x86_64.tar.gz      the update
#   vela-mail-<version>-linux-x86_64.tar.gz.sig  its signature
#   latest.json                                  what installed copies read
set -euo pipefail

VERSION="${1:?version, e.g. 0.2.0}"
BASE_URL="${2:?download base URL, e.g. https://github.com/me/vela-mail/releases/download/v0.2.0}"
NOTES_FILE="${3:-}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="${VELA_BINARY:-$ROOT/src-tauri/target/release/vela-mail}"
OUT="$ROOT/release"
NAME="vela-mail-$VERSION-linux-x86_64.tar.gz"

[[ -x "$BIN" ]] || { echo "No release binary at $BIN. Build it first." >&2; exit 1; }
BUILT="$("$BIN" --version | awk '{print $2}')"
[[ "$BUILT" == "$VERSION" ]] || { echo "Binary reports version $BUILT, expected $VERSION." >&2; exit 1; }

rm -rf "$OUT" && mkdir -p "$OUT/stage/vela-mail"
S="$OUT/stage/vela-mail"
echo "$VERSION" > "$S/VERSION"
install -m755 "$BIN" "$S/vela-mail"
install -m644 "$ROOT/packaging/vela-mail.local.desktop" "$S/vela-mail.desktop"
install -m644 "$ROOT/src-tauri/icons/vela.svg" "$S/vela-mail.svg"
printf 'Vela %s\nInstalled automatically by Vela'"'"'s updater, or manually with:\n  install -Dm755 vela-mail ~/.local/bin/vela-mail\n' "$VERSION" > "$S/README.txt"

# Reproducible-ish archive: fixed owner and sorted names.
tar --sort=name --owner=0 --group=0 --numeric-owner -C "$OUT/stage" -czf "$OUT/$NAME" vela-mail
rm -rf "$OUT/stage"

# Sign with Tauri's signer (minisign). The signed comment records the file name.
(cd "$OUT" && npx --prefix "$ROOT" tauri signer sign "$NAME" >/dev/null)
SIG="$(cat "$OUT/$NAME.sig")"
SHA="$(sha256sum "$OUT/$NAME" | cut -d' ' -f1)"
NOTES=""
[[ -n "$NOTES_FILE" && -f "$NOTES_FILE" ]] && NOTES="$(cat "$NOTES_FILE")"

python3 - "$OUT/latest.json" "$VERSION" "$BASE_URL/$NAME" "$SIG" "$SHA" "$NOTES" <<'PY'
import json, sys, datetime
out, version, url, sig, sha, notes = sys.argv[1:7]
json.dump({
    "version": version,
    "notes": notes.strip(),
    "pub_date": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "platforms": {"linux-x86_64": {"url": url, "signature": sig, "sha256": sha}},
}, open(out, "w"), indent=2)
PY

echo "Packaged and signed Vela $VERSION:"
ls -la "$OUT"
