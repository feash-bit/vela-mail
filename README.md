# Vela

A fast, keyboard-first Gmail client for the Linux desktop, built for CachyOS
and KDE Plasma (Wayland or X11).

- **Real Gmail**, through Google's official Gmail API and OAuth 2.0 sign-in.
- **Keyboard first**: triage with `j` `k` `e` `#` `r`, everything else with `Ctrl+K`.
- **Safe by default**: emails can't run code, tracking images are blocked, sign-in
  tokens live only in your system keyring.
- **Pop-out windows**: open any email in its own window (see below).
- **Light on resources**: a ~16 MB binary; uses the system WebKitGTK engine.

---

## Quick start on CachyOS

```bash
git clone <your copy of this repo> vela && cd vela
./scripts/setup-cachyos.sh      # installs build tools and libraries (pacman + rustup)
./scripts/install.sh            # builds Vela and adds it to your app menu
```

Then open **Vela** from the application menu and follow the two on-screen steps.
The first step needs a Google OAuth client file — see
**[docs/GOOGLE_SETUP.md](docs/GOOGLE_SETUP.md)** (about 10 minutes, free).

To make Vela open `mailto:` links: `./scripts/install.sh --default`

### Other ways to install

| Method | Command | Notes |
|---|---|---|
| User install (recommended) | `./scripts/install.sh` | No root. Installs to `~/.local`. |
| Native Arch package | `cd packaging/arch && makepkg -si` | Installs to `/usr`, removable with `pacman -R vela-mail`. |
| AppImage | `npm run build:appimage` | Output in `src-tauri/target/release/bundle/appimage/`. |

### Updating

**Automatic (recommended):** after a one-time setup, Vela checks for new versions,
downloads and verifies them in the background, and shows **Update ready ·
Restart** in the title bar. See **[docs/UPDATES.md](docs/UPDATES.md)**.

Publishing a new version is one command:

```bash
./scripts/release.sh 0.2.0 "What changed"
```

**Manual:** `git pull && ./scripts/install.sh` (or `makepkg -si` for the pacman package).
Your settings, accounts and keyring entries are kept either way.

### Uninstalling

```bash
./scripts/install.sh --uninstall
```

---

## Development

```bash
npm run dev          # the real app with hot reload (needs your Google setup)
npm run dev:demo     # the real app with built-in sample mail — no Google account needed
npm run check        # typecheck + frontend tests + clippy + Rust tests
vela-mail --version  # print the installed version
```

`dev:demo` exists so the interface can be worked on without signing in. The
sample data is only bundled when `VITE_DEMO=1`; production builds never include it.

### Project layout

```
src/                      React + TypeScript interface
  components/
    shell/                window chrome, sidebar, search, command menu, pickers
    mail/                 virtualised conversation list
    reader/               conversation view, sandboxed email frame, attachments
    compose/              composer (TipTap editor), recipients, dock
    readerwindow/         pop-out window that shows one email
    settings/             settings dialog
    onboarding/           first-run Google setup and sign-in
    ui/                   design-system primitives (buttons, menus, dialogs, toasts)
  state/                  zustand stores: app, mail, compose, shared actions
  lib/                    IPC bridge, types, shortcuts, formatting, reply/forward logic
  styles/                 design tokens (colour, type, radius, motion)
  demo/                   dev-only sample mailbox
src-tauri/                Rust backend (Tauri 2)
  src/oauth.rs            OAuth 2.0 + PKCE with a loopback redirect
  src/secrets.rs          keyring storage (Secret Service: KWallet / GNOME Keyring)
  src/auth.rs             in-memory access tokens, single-flight refresh
  src/gmail/              Gmail REST client (retries, back-off), parsing, MIME builder
  src/sanitize.rs         email HTML sanitiser
  src/sync.rs             incremental sync via users.history.list + notifications
  src/cache.rs            SQLite cache of thread summaries (no bodies)
  src/reader_window.rs    pop-out email windows (labels, remembered size)
  src/files.rs            attachment handling (pick, open, save)
  src/commands.rs         the commands the interface can call
  src/tests.rs            end-to-end tests against a fake Gmail server
packaging/                desktop entry, PKGBUILD
scripts/                  setup and install scripts
docs/                     Google setup guide
```

### Why Tauri (and not C#/.NET or Electron)

- **Email needs a real browser engine.** HTML email only renders properly in a
  web engine. Tauri uses the system's WebKitGTK; Avalonia (the strongest C#
  option on Linux) has no free, maintained embedded web view.
- **Small and native.** ~16 MB instead of Electron's ~150 MB, native window,
  native file pickers through the desktop portal, native notifications.
- **Security split.** All Google traffic and tokens stay in the Rust backend; the
  interface can only call a fixed list of commands (see `capabilities/default.json`).

---

## Pop-out windows

Open any conversation in its own window that you can move, resize and minimise
independently of the main window:

- click **Open in new window** in the reader toolbar,
- double-click a conversation in the list,
- right-click a conversation and choose **Open in new window**, or
- press `Shift+Enter`.

Opening the same email again brings its existing window forward.

**What stays open and what closes.** Reading, starring, marking important,
labelling, replying and moving the email back to the Inbox keep the window open.
Archive, Move to Trash, Report spam and Snooze take the email out of your inbox, so
they close the window; the main window then offers **Undo**. `Esc` closes a pop-out.

**Closing.** Closing the main window closes every pop-out. A pop-out saves any
draft and sends any message still waiting out its undo delay before it goes away.

**Size and position.** Vela remembers the size of your last pop-out for the next
one. Position is chosen by KDE Plasma (Wayland doesn't let apps place their own
windows).

**Security.** A pop-out can read and act on its one email only. Account, settings and
update commands are refused from it, it can't open further windows, and it has no
file, shell or network access beyond Vela's own commands.

## Security model

| Risk | What Vela does |
|---|---|
| Password theft | Never sees it. Sign-in happens in your browser via Google OAuth 2.0 with PKCE (S256) and a random `state`, redirecting to `127.0.0.1` on a random port. |
| Token theft from disk | Refresh tokens are stored only in the system keyring. If no keyring is available, Vela refuses to sign in rather than fall back to a file. Access tokens stay in memory. |
| Token exposure to the UI | The web view never receives tokens. All Gmail requests run in Rust. |
| Malicious email HTML | 3 layers: Rust allow-list sanitiser (ammonia) → `<iframe sandbox>` with scripts disabled → per-frame Content-Security-Policy `default-src 'none'`. |
| Tracking pixels | Remote images and remote CSS are stripped until you click **Show images** (or trust the sender). |
| Phishing links | Links open in your browser only after a click. If the visible text names a different site than the real target, Vela asks first. |
| Dangerous attachments | Scripts, `.desktop` files, AppImages and similar can be saved but are never opened directly. |
| A compromised web view reading files | The UI can't read paths. It only gets opaque tokens for files you picked or dropped. |
| Header injection | Recipient names and subjects are stripped of control characters; addresses are validated. |
| Local data | Only thread summaries are cached (in an owner-only SQLite file); message bodies stay in memory. Signing out removes the account's cache and revokes its token. |

The OAuth permission requested is `gmail.modify`: read, compose, send, label and
trash. It can't permanently delete mail or change Gmail settings.

---

## Keyboard shortcuts

Press `?` in the app for the full list, or change any of them in
**Settings → Shortcuts**.

| Keys | Action | Keys | Action |
|---|---|---|---|
| `c` | New message | `e` | Archive |
| `/` | Search | `#` / `Delete` | Move to Trash |
| `Ctrl+K` | Command menu | `s` | Star |
| `j` / `k` | Next / previous | `u` | Read / unread |
| `Enter` | Open | `h` | Snooze |
| `Shift+Enter` | Open in new window | | |
| `Esc` | Back / close | `l` | Labels |
| `r` / `a` / `f` | Reply / all / forward | `!` | Report spam |
| `x` | Select | `z` | Undo |
| `g` then `i` `s` `t` `d` `a` | Go to Inbox, Starred, Sent, Drafts, Archive | `Ctrl+Enter` | Send |

---

## How syncing works

- On first sign-in Vela records Gmail's current `historyId`.
- Every minute (configurable) it asks Gmail only for what changed since then
  (`users.history.list`) and refetches just those conversations.
- If the checkpoint is too old, it takes a fresh one and reloads the open folder.
- Requests are limited to 6 at a time per account and back off automatically on
  rate limits (429 / quota errors), honouring `Retry-After`.
- Lists appear instantly from the local cache, then refresh from Gmail.

## Known limitations

- **Snooze** is done by Vela: it archives the conversation and returns it to the
  inbox at the chosen time while Vela is running (Gmail's API has no snooze).
  Conversations snoozed in Gmail's web app are listed in Snoozed too.
- **Delete forever** isn't available; the `gmail.modify` permission can't do it
  (by design). Gmail empties Trash after 30 days.
- Sorting re-orders the conversations already loaded (Gmail's API only returns
  newest first).
- Push notifications would need Google Cloud Pub/Sub; Vela polls instead.

---

## Troubleshooting

**Blank or white window (often NVIDIA).** Vela already sets
`WEBKIT_DISABLE_DMABUF_RENDERER=1` when it detects the NVIDIA driver. If it still
happens, try: `WEBKIT_DISABLE_COMPOSITING_MODE=1 vela-mail`.

**"No system keyring is available."** On KDE Plasma open **System Settings → KDE
Wallet**, enable it, and make sure `kwallet` (KF6) is installed — it provides the
Secret Service API Vela uses. Elsewhere: `sudo pacman -S gnome-keyring` and log
out and back in.

**"Sign in again" every week.** Your Google project is in Testing mode. See
*The 7-day sign-in limit* in [docs/GOOGLE_SETUP.md](docs/GOOGLE_SETUP.md).

**"access_denied" or "This app is blocked".** Add your address under
**Audience → Test users**. Google Workspace admins can block unverified apps.

**Window frame looks wrong under a tiling WM.** Settings → Appearance → turn off
**Vela title bar** to use your desktop's own frame.

**Blurry on HiDPI.** Vela follows your desktop's scale. On X11 set
`GDK_SCALE=2`; on Wayland use KDE's display scaling.

**File picker looks like GTK instead of KDE.** Install `xdg-desktop-portal-kde`.
On KDE Plasma Vela asks GTK to use the desktop portal (`GTK_USE_PORTAL=1`), so
you get Plasma's own file dialogs.

**Logs.** Run `RUST_LOG=info vela-mail` from a terminal. Logs never contain
tokens or message content.

## Files Vela creates

| Path | Contents |
|---|---|
| `~/.config/vela-mail/` | settings, account list, OAuth client file, pop-out window size |
| `~/.local/share/vela-mail/` | message-list cache |
| `~/.cache/vela-mail/` | temporary attachment copies (cleared at start) |
| System keyring, service `vela-mail` | refresh tokens |

## Licence

MIT
