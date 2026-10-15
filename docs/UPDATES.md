# Automatic updates

Once set up, Vela keeps itself up to date:

1. Shortly after it starts, and every 6 hours, Vela checks your GitHub repo for a
   newer release.
2. If there is one, it downloads it in the background and checks its signature.
3. A button appears in the title bar: **Update ready · Restart**. Nothing changes
   until you click it (or **Settings → Updates → Restart to install**).
4. Vela swaps in the new version and reopens. Your accounts, settings and
   sign-in are untouched.

You can turn off automatic downloads in **Settings → Updates**. Vela then just
tells you when a new version is out.

---

## One-time setup (about 15 minutes)

You need: a GitHub account, and Vela's code in a GitHub repository.

### 1. Put the code on GitHub

Create a new repository on GitHub (for example `vela-mail`). Then:

```bash
cd ~/vela
git remote add origin git@github.com:<your-github-user>/vela-mail.git
git push -u origin master
```

**Public or private?** Vela downloads updates without signing in to GitHub, so
the repository (or at least its releases) must be **public**. That's safe: the
code contains no secrets. Your Google client file, your sign-in tokens and your
signing key are all kept out of Git.

### 2. Create your signing key and point Vela at your repo

```bash
./scripts/setup-updates.sh <your-github-user>/vela-mail
```

This:
- creates your **private signing key** at `~/.tauri/vela-mail.key` (it asks you
  to choose a password);
- writes `src-tauri/updater.json` with your repo's address and the **public** key;
- tells you exactly which two GitHub secrets to add (and can add them for you if
  the `gh` command is signed in).

> **Back up `~/.tauri/vela-mail.key` and its password** (a password manager is
> ideal). If you lose them you can still make a new key, but every installed copy
> would need one manual reinstall to accept it.

### 3. Add the two secrets on GitHub

Repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Name | Value |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | the whole contents of `~/.tauri/vela-mail.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | the password you chose |

GitHub encrypts secrets and never shows them in logs.

### 4. Commit and reinstall

```bash
git add src-tauri/updater.json
git commit -m "Enable signed updates"
git push
./scripts/install.sh
```

Reinstalling builds the public key and your repo address into your copy of Vela.
From now on, updates arrive by themselves.

---

## Publishing an update

```bash
cd ~/vela
git pull                                   # if changes were pushed from elsewhere
./scripts/release.sh 0.2.0 "Faster search; new snooze presets"
```

The script runs the tests, bumps the version everywhere, tags the release and
pushes it. GitHub then builds Vela on Arch Linux (to match CachyOS), signs it,
double-checks the signature with the key built into Vela, and publishes it.
That takes about 10–15 minutes; you can watch it under your repo's **Actions** tab.

Your running Vela picks it up within 6 hours, or straight away with
**Settings → Updates → Check now**.

Version numbers go up: `0.1.1` for small fixes, `0.2.0` for new features.

---

## How it stays safe

| Threat | Protection |
|---|---|
| Someone uploads a fake release | Each release is signed with your private key. Vela checks the signature against the public key built into it and refuses anything else. GitHub never holds a key that Vela trusts except the one you gave it. |
| A download is corrupted or altered | The signature covers every byte, and a SHA-256 checksum is checked as well. |
| An old release is re-published as "new" to downgrade you | The signature records the exact file name (which includes the version), and the archive's `VERSION` file must match. Vela only ever installs a higher version. |
| A malicious archive tries to write elsewhere | Vela unpacks only an allow-list of 5 files, with size limits, into a private folder. |
| Network tampering | Downloads use HTTPS only and refuse to be redirected to plain HTTP. |
| A half-finished install | The new program is written beside the old one, then swapped in a single rename. |

The signing format and verification library are the same ones Tauri's official
updater uses (minisign / Ed25519).

## If you installed with pacman (makepkg)

Vela can't replace files under `/usr`, so it shows **Update available** instead
of installing. Update with:

```bash
cd ~/vela && git pull && cd packaging/arch && makepkg -si
```

## Troubleshooting

- **"Updates aren't set up for this copy of Vela yet."** Run steps 2–4 above,
  then reinstall.
- **Check fails with a 404.** No release has been published yet, or the
  repository is private.
- **"Update rejected: its signature doesn't match…"** The release was signed with
  a different key than the one in your installed Vela. Make sure the GitHub
  secret holds the same key that `setup-updates.sh` created. Vela will not
  install it, by design.
- **The GitHub Action failed.** Open the run under **Actions**; the failing step
  explains the problem (usually a missing secret or a failing test).
- **"GLIBC_2.xx not found" after an update.** Your system is older than the build
  machine. Update CachyOS (`sudo pacman -Syu`) and restart Vela.
