import {
  Bell,
  Check,
  Columns2,
  KeyRound,
  Keyboard,
  Mail,
  Monitor,
  Moon,
  Palette,
  Plus,
  Power,
  RotateCcw,
  Rows2,
  Shield,
  Sparkles,
  RefreshCw,
  Sun,
  Users,
  X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { nameOf } from "../../lib/format";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api, inTauri } from "../../lib/ipc";
import { alternatives, conflicts, DEFAULT_SHORTCUTS, eventToKey, type ShortcutAction } from "../../lib/shortcuts";
import { FOLDERS } from "../../lib/views";
import { useApp, type SettingsSection } from "../../state/app";
import { useUpdate } from "../../state/update";
import { relative } from "../../lib/format";
import { useSignIn } from "../shell/SignIn";
import { ConfirmDialog, Dialog } from "../ui/Dialog";
import { Avatar, Button, IconButton, Kbd, Segmented, Switch } from "../ui/primitives";
import s from "./settings.module.css";

const ACCENTS = [
  { name: "Violet", value: "#8b7bff" },
  { name: "Indigo", value: "#6e7bff" },
  { name: "Blue", value: "#3f8cff" },
  { name: "Teal", value: "#22b3a6" },
  { name: "Green", value: "#45b36b" },
  { name: "Rose", value: "#ec5f8c" },
  { name: "Amber", value: "#e59a2f" },
];

const SECTIONS: { id: SettingsSection; label: string; icon: ReactNode }[] = [
  { id: "appearance", label: "Appearance", icon: <Palette size={16} /> },
  { id: "accounts", label: "Accounts", icon: <Users size={16} /> },
  { id: "mail", label: "Reading & writing", icon: <Mail size={16} /> },
  { id: "notifications", label: "Notifications & sync", icon: <Bell size={16} /> },
  { id: "privacy", label: "Privacy & security", icon: <Shield size={16} /> },
  { id: "shortcuts", label: "Shortcuts", icon: <Keyboard size={16} /> },
  { id: "startup", label: "Startup", icon: <Power size={16} /> },
  { id: "updates", label: "Updates", icon: <Sparkles size={16} /> },
];

function Row({ label, help, children }: { label: string; help?: ReactNode; children: ReactNode }) {
  return (
    <div className={s.row}>
      <span className={s.rowText}>
        <span className={s.rowLabel}>{label}</span>
        {help && <span className={s.rowHelp}>{help}</span>}
      </span>
      {children}
    </div>
  );
}

function Group({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className={s.group}>
      {title && <h3 className={s.groupTitle}>{title}</h3>}
      <div className={s.card}>{children}</div>
    </section>
  );
}

function Appearance() {
  const st = useApp((a) => a.settings!);
  const up = useApp((a) => a.updateSettings);
  return (
    <>
      <Group title="Theme">
        <Row label="Colour theme" help="System follows your desktop's light or dark setting.">
          <Segmented
            label="Theme"
            value={st.theme}
            onChange={(theme) => up({ theme })}
            options={[
              { value: "dark", label: "Dark", icon: <Moon size={13} /> },
              { value: "light", label: "Light", icon: <Sun size={13} /> },
              { value: "system", label: "System", icon: <Monitor size={13} /> },
            ]}
          />
        </Row>
        <Row label="Accent colour">
          <div className={s.swatches}>
            {ACCENTS.map((a) => (
              <button key={a.value} className={s.swatch} style={{ background: a.value, color: a.value }} aria-label={a.name} aria-pressed={st.accent === a.value} onClick={() => up({ accent: a.value })}>
                {st.accent === a.value && <Check size={13} color="#fff" strokeWidth={3} />}
              </button>
            ))}
            <input className={s.colorInput} type="color" value={st.accent} aria-label="Custom accent colour" onChange={(e) => up({ accent: e.target.value })} />
          </div>
        </Row>
      </Group>
      <Group title="Layout">
        <Row label="Density" help="Compact fits more conversations on screen.">
          <Segmented
            label="Density"
            value={st.density}
            onChange={(density) => up({ density })}
            options={[
              { value: "comfortable", label: "Comfortable" },
              { value: "compact", label: "Compact" },
            ]}
          />
        </Row>
        <Row label="Reading layout" help="Split shows the conversation beside the list. Full width opens it over the list.">
          <Segmented
            label="Reading layout"
            value={st.readerLayout}
            onChange={(readerLayout) => up({ readerLayout })}
            options={[
              { value: "split", label: "Split", icon: <Columns2 size={13} /> },
              { value: "full", label: "Full width", icon: <Rows2 size={13} /> },
            ]}
          />
        </Row>
        <Row label="Compact sidebar" help="Show icons only. Press [ to switch at any time.">
          <Switch label="Compact sidebar" checked={st.sidebarCompact} onChange={(sidebarCompact) => up({ sidebarCompact })} />
        </Row>
        <Row label="Sender pictures">
          <Switch label="Sender pictures" checked={st.showAvatars} onChange={(showAvatars) => up({ showAvatars })} />
        </Row>
        <Row label="Message previews" help="Show the first line of each message in the list.">
          <Switch label="Message previews" checked={st.showSnippets} onChange={(showSnippets) => up({ showSnippets })} />
        </Row>
      </Group>
      <Group title="Window">
        <Row label="Reduce motion" help="System follows your desktop's accessibility setting.">
          <Segmented
            label="Reduce motion"
            value={st.reducedMotion}
            onChange={(reducedMotion) => up({ reducedMotion })}
            options={[
              { value: "system", label: "System" },
              { value: "on", label: "On" },
              { value: "off", label: "Off" },
            ]}
          />
        </Row>
        <Row label="Vela title bar" help="Turn off to use your desktop's own window frame (KDE, GNOME…). Takes effect straight away.">
          <Switch
            label="Vela title bar"
            checked={st.customTitleBar}
            onChange={async (customTitleBar) => {
              up({ customTitleBar });
              if (inTauri()) await getCurrentWindow().setDecorations(!customTitleBar).catch(() => {});
            }}
          />
        </Row>
      </Group>
    </>
  );
}

function Accounts() {
  const accounts = useApp((a) => a.accounts);
  const identities = useApp((a) => a.identities);
  const info = useApp((a) => a.info);
  const { start, dialog } = useSignIn();
  const [removing, setRemoving] = useState<string | null>(null);
  const remove = async (id: string) => {
    setRemoving(null);
    try {
      const list = await api.removeAccount(id);
      useApp.getState().setAccounts(list);
      useApp.getState().toast(`Signed out of ${id}`);
      if (!list.length) useApp.getState().refreshInfo();
    } catch (e) {
      useApp.getState().error(e, "Couldn't remove that account.");
    }
  };
  return (
    <>
      <Group title="Gmail accounts">
        {accounts.map((a) => (
          <div key={a.id} className={s.row}>
            <div className={s.acct} style={{ flex: 1 }}>
              <Avatar name={identities[a.id]?.displayName ?? a.displayName ?? nameOf({ name: null, email: a.email })} email={a.email} size={34} />
              <span className={s.acctText}>
                <span className={s.acctName}>{identities[a.id]?.displayName ?? a.displayName ?? a.email}</span>
                <span className={s.acctEmail}>{a.email}</span>
              </span>
              {a.status === "ok" ? (
                <span className={`${s.badge} ${s.badgeOk}`}>
                  <Check size={12} /> Connected
                </span>
              ) : a.status === "offline" ? (
                <span className={`${s.badge} ${s.badgeWarn}`}>Offline</span>
              ) : (
                <Button size="sm" variant="primary" onClick={() => start(a.email)}>
                  Sign in again
                </Button>
              )}
            </div>
            <Button size="sm" variant="ghost" onClick={() => setRemoving(a.id)}>
              Sign out
            </Button>
          </div>
        ))}
        <div className={s.row}>
          <span className={s.rowText}>
            <span className={s.rowLabel}>Add another Gmail account</span>
            <span className={s.rowHelp}>Switch between accounts from the bottom of the sidebar.</span>
          </span>
          <Button size="sm" icon={<Plus size={14} />} onClick={() => start()}>
            Add account
          </Button>
        </div>
      </Group>
      <Group title="Google connection">
        <Row
          label="OAuth client file"
          help={
            info?.hasClientConfig
              ? "Your Google Cloud “Desktop app” client is set up. Replace it if you move to a different Google Cloud project."
              : "Not set up yet."
          }
        >
          <Button
            size="sm"
            icon={<KeyRound size={14} />}
            onClick={() =>
              api
                .importClientConfig()
                .then((ok) => {
                  if (!ok) return;
                  useApp.getState().toast("Client file imported", { kind: "success" });
                  return useApp.getState().refreshInfo();
                })
                .catch((e) => useApp.getState().error(e))
            }
          >
            {info?.hasClientConfig ? "Replace…" : "Import…"}
          </Button>
        </Row>
      </Group>
      {removing && (
        <ConfirmDialog
          title={`Sign out of ${removing}?`}
          body="Vela revokes its access at Google, deletes the sign-in token from your keyring and clears this account's local cache. Your mail stays in Gmail."
          confirmLabel="Sign out"
          danger
          onCancel={() => setRemoving(null)}
          onConfirm={() => remove(removing)}
        />
      )}
      {dialog}
    </>
  );
}

function MailSection() {
  const st = useApp((a) => a.settings!);
  const up = useApp((a) => a.updateSettings);
  return (
    <>
      <Group title="Reading">
        <Row label="Mark as read when opened">
          <Switch label="Mark as read when opened" checked={st.markReadOnOpen} onChange={(markReadOnOpen) => up({ markReadOnOpen })} />
        </Row>
      </Group>
      <Group title="Writing">
        <Row label="Undo send" help="Hold sent messages for a few seconds so you can take them back.">
          <select className={s.select} value={st.undoSendSeconds} onChange={(e) => up({ undoSendSeconds: Number(e.target.value) })} aria-label="Undo send delay">
            <option value={0}>Off</option>
            <option value={5}>5 seconds</option>
            <option value={10}>10 seconds</option>
            <option value={20}>20 seconds</option>
            <option value={30}>30 seconds</option>
          </select>
        </Row>
        <Row label="Ask before discarding drafts">
          <Switch label="Ask before discarding drafts" checked={st.confirmDiscard} onChange={(confirmDiscard) => up({ confirmDiscard })} />
        </Row>
      </Group>
      <section className={s.group}>
        <h3 className={s.groupTitle}>Sidebar folders</h3>
        <div className={s.card}>
          <div className={s.checks}>
            {FOLDERS.map((f) => (
              <label key={f.id} className={s.check}>
                <input
                  type="checkbox"
                  checked={!st.hiddenFolders.includes(f.id)}
                  disabled={f.id === "inbox"}
                  onChange={(e) => up({ hiddenFolders: e.target.checked ? st.hiddenFolders.filter((x) => x !== f.id) : [...st.hiddenFolders, f.id] })}
                />
                {f.name}
              </label>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

function Notifications() {
  const st = useApp((a) => a.settings!);
  const up = useApp((a) => a.updateSettings);
  return (
    <>
      <Group title="Desktop notifications">
        <Row label="Notify me about new mail" help="Shown by your desktop (KDE Plasma, GNOME…) when Vela isn't the active window.">
          <Switch label="Notify me about new mail" checked={st.notifications} onChange={(notifications) => up({ notifications })} />
        </Row>
        <Row label="Only for the Inbox" help="Skip mail that Gmail filters away from your inbox.">
          <Switch label="Only for the Inbox" checked={st.notifyInboxOnly} onChange={(notifyInboxOnly) => up({ notifyInboxOnly })} />
        </Row>
        <Row label="Show message preview" help="Off by default so message text doesn't appear on a shared or locked screen.">
          <Switch label="Show message preview" checked={st.notificationPreview} onChange={(notificationPreview) => up({ notificationPreview })} />
        </Row>
      </Group>
      <Group title="Sync">
        <Row label="Check for new mail" help="Vela only downloads what changed since the last check.">
          <select className={s.select} value={st.syncIntervalSecs} onChange={(e) => up({ syncIntervalSecs: Number(e.target.value) })} aria-label="Sync interval">
            <option value={30}>Every 30 seconds</option>
            <option value={60}>Every minute</option>
            <option value={120}>Every 2 minutes</option>
            <option value={300}>Every 5 minutes</option>
            <option value={900}>Every 15 minutes</option>
          </select>
        </Row>
      </Group>
    </>
  );
}

function Privacy() {
  const st = useApp((a) => a.settings!);
  const up = useApp((a) => a.updateSettings);
  return (
    <>
      <Group title="Images">
        <Row label="Block remote images" help="Remote images can tell senders when and where you opened their email. Vela hides them until you choose to show them.">
          <Switch label="Block remote images" checked={st.blockRemoteImages} onChange={(blockRemoteImages) => up({ blockRemoteImages })} />
        </Row>
        <Row label="Senders you trust" help="Images from these senders always load.">
          <span />
        </Row>
        <div className={s.trusted}>
          {st.trustedSenders.length === 0 && <span className={s.rowHelp}>None yet. Choose “Always show from sender” on a message to add one.</span>}
          {st.trustedSenders.map((e) => (
            <span key={e} className={s.trustedChip}>
              {e}
              <IconButton small label={`Remove ${e}`} onClick={() => up({ trustedSenders: st.trustedSenders.filter((x) => x !== e) })}>
                <X size={12} />
              </IconButton>
            </span>
          ))}
        </div>
      </Group>
      <Group title="How Vela protects your account">
        <ul className={s.secList}>
          <li>Sign-in happens in your own browser with Google's OAuth and PKCE. Vela never sees your password.</li>
          <li>Your long-term sign-in token is kept only in the system keyring (KWallet or GNOME Keyring), never in a file.</li>
          <li>All Gmail requests run in Vela's native backend. The interface never handles your tokens.</li>
          <li>Emails are cleaned before display and shown in a locked-down frame where scripts can't run.</li>
          <li>Links whose text points somewhere other than their real destination ask before opening.</li>
          <li>Files that could run code (scripts, .desktop files, AppImages) can be saved but won't be opened directly.</li>
          <li>The local cache keeps only message lists, never full messages, in a folder only you can read.</li>
        </ul>
      </Group>
    </>
  );
}

function Shortcuts() {
  const st = useApp((a) => a.settings!);
  const up = useApp((a) => a.updateSettings);
  const [recording, setRecording] = useState<ShortcutAction | null>(null);
  const clash = conflicts(st.shortcuts);

  useEffect(() => {
    if (!recording) return;
    let first: string | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = (keys: string) => {
      up({ shortcuts: { ...st.shortcuts, [recording]: keys } });
      setRecording(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape" && !first) return setRecording(null);
      const k = eventToKey(e);
      // A single letter may be the start of a sequence like "g i".
      if (!first && k.length === 1 && /[a-z]/.test(k)) {
        first = k;
        timer = setTimeout(() => finish(k), 700);
        return;
      }
      if (timer) clearTimeout(timer);
      finish(first ? `${first} ${k}` : k);
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      if (timer) clearTimeout(timer);
    };
  }, [recording, st.shortcuts, up]);

  const groups = ["General", "Navigation", "Message actions", "Go to"] as const;
  return (
    <>
      {groups.map((g) => (
        <Group key={g} title={g}>
          {DEFAULT_SHORTCUTS.filter((d) => d.group === g).map((d) => {
            const binding = st.shortcuts[d.action] ?? d.keys;
            const hasClash = alternatives(binding).some((k) => clash.has(k));
            const custom = d.action in st.shortcuts;
            return (
              <div key={d.action} className={s.scRow}>
                <span>
                  {d.label} {hasClash && <span className={s.conflict}>· used twice</span>}
                </span>
                <span className={s.scKeys}>
                  {recording === d.action ? (
                    <span className={s.recording}>Press keys…</span>
                  ) : (
                    alternatives(binding).map((k) => <Kbd key={k} keys={k} />)
                  )}
                </span>
                <Button size="sm" variant="ghost" onClick={() => setRecording(recording === d.action ? null : d.action)}>
                  {recording === d.action ? "Cancel" : "Change"}
                </Button>
                <IconButton
                  small
                  label="Reset to default"
                  disabled={!custom}
                  onClick={() => {
                    const next = { ...st.shortcuts };
                    delete next[d.action];
                    up({ shortcuts: next });
                  }}
                >
                  <RotateCcw size={13} />
                </IconButton>
              </div>
            );
          })}
        </Group>
      ))}
      <Button variant="ghost" size="sm" icon={<RotateCcw size={13} />} onClick={() => up({ shortcuts: {} })}>
        Reset all shortcuts
      </Button>
    </>
  );
}

function Startup() {
  const st = useApp((a) => a.settings!);
  const up = useApp((a) => a.updateSettings);
  return (
    <Group title="When you log in">
      <Row label="Open Vela when I log in" help="Adds Vela to your desktop's autostart list.">
        <Switch label="Open Vela when I log in" checked={st.launchAtLogin} onChange={(launchAtLogin) => up({ launchAtLogin })} />
      </Row>
      <Row label="Start minimised">
        <Switch label="Start minimised" checked={st.startMinimized} onChange={(startMinimized) => up({ startMinimized })} />
      </Row>
      <Row label="Open to">
        <Segmented
          label="Open to"
          value={st.startView}
          onChange={(startView) => up({ startView })}
          options={[
            { value: "inbox", label: "Inbox" },
            { value: "last", label: "Last folder" },
          ]}
        />
      </Row>
    </Group>
  );
}

function Updates() {
  const st = useApp((a) => a.settings!);
  const up = useApp((a) => a.updateSettings);
  const u = useUpdate((x) => x.status);
  if (!u) return null;
  const busy = u.state === "checking" || u.state === "downloading";
  const line = {
    notConfigured: "Updates aren't set up for this copy of Vela yet.",
    idle: "Vela checks for updates shortly after it starts, then every 6 hours.",
    checking: "Checking for updates…",
    upToDate: "You have the latest version.",
    available: `Vela ${u.version} is available.`,
    downloading: `Downloading Vela ${u.version}… ${Math.round((u.progress ?? 0) * 100)}%`,
    ready: `Vela ${u.version} is downloaded and verified. Restart to install it.`,
    error: u.error ?? "The last check didn't work.",
  }[u.state];

  return (
    <>
      <Group title="Vela">
        <div className={s.row}>
          <span className={s.rowText}>
            <span className={s.rowLabel}>Version {u.current}</span>
            <span className={s.rowHelp} aria-live="polite">
              {line}
              {u.checkedAt && u.state !== "checking" ? ` Last checked ${relative(u.checkedAt)}.` : ""}
            </span>
          </span>
          {u.state === "ready" ? (
            <Button size="sm" variant="primary" icon={<RefreshCw size={14} />} onClick={() => useUpdate.getState().restart()}>
              Restart to install
            </Button>
          ) : u.state === "available" && u.canInstall ? (
            <Button size="sm" variant="primary" onClick={() => useUpdate.getState().download()}>
              Download update
            </Button>
          ) : u.state !== "notConfigured" ? (
            <Button size="sm" loading={busy} onClick={() => useUpdate.getState().check()}>
              Check now
            </Button>
          ) : null}
        </div>
        {u.notes && (u.state === "available" || u.state === "ready" || u.state === "downloading") && (
          <div className={s.row}>
            <span className={s.rowText}>
              <span className={s.rowLabel}>What's new in {u.version}</span>
              <span className={s.rowHelp} style={{ whiteSpace: "pre-wrap" }} data-selectable>
                {u.notes}
              </span>
            </span>
          </div>
        )}
      </Group>
      {u.state !== "notConfigured" && (
        <Group title="Automatic updates">
          <Row
            label="Download updates automatically"
            help={u.canInstall ? "New versions download in the background. Nothing changes until you choose Restart." : "Vela will tell you when a new version is out."}
          >
            <Switch label="Download updates automatically" checked={st.autoUpdate} onChange={(autoUpdate) => up({ autoUpdate })} />
          </Row>
        </Group>
      )}
      <Group title="How updates are protected">
        <ul className={s.secList}>
          <li>Every release is signed with a private key only you hold. Vela checks that signature against the public key built into it, and refuses anything that doesn't match.</li>
          <li>Vela only installs versions newer than the one you have, and checks the version inside the download, so an old release can't be passed off as new.</li>
          <li>Downloads come only over HTTPS from the address built into Vela.</li>
          {u.installKind === "system" && <li>This copy was installed with pacman, so Vela can tell you about updates but you install them with makepkg (README → Updating).</li>}
          {u.installKind === "dev" && <li>This is a development build, so it won't replace itself.</li>}
          {u.state === "notConfigured" && <li>To turn updates on, run scripts/setup-updates.sh once, then reinstall (see docs/UPDATES.md).</li>}
        </ul>
      </Group>
    </>
  );
}

export function SettingsDialog() {
  const section = useApp((a) => a.settingsSection);
  const version = useApp((a) => a.info?.version);
  const openDialog = useApp((a) => a.openDialog);
  const current = SECTIONS.find((x) => x.id === section) ?? SECTIONS[0];
  const body = {
    appearance: <Appearance />,
    accounts: <Accounts />,
    mail: <MailSection />,
    notifications: <Notifications />,
    privacy: <Privacy />,
    shortcuts: <Shortcuts />,
    startup: <Startup />,
    updates: <Updates />,
  }[current.id];
  return (
    <Dialog onClose={() => openDialog(null)} label="Settings" className={s.dialog}>
      <nav className={s.nav} aria-label="Settings sections">
        <div className={s.navTitle}>Settings</div>
        {SECTIONS.map((x) => (
          <button key={x.id} className={s.navItem} aria-current={x.id === current.id ? "page" : undefined} onClick={() => openDialog("settings", x.id)}>
            {x.icon}
            {x.label}
          </button>
        ))}
        <span className={s.version}>Vela {version}</span>
      </nav>
      <div className={s.content}>
        <div className={s.contentHead}>
          <h2>{current.label}</h2>
          <IconButton label="Close" keys="escape" onClick={() => openDialog(null)}>
            <X size={16} />
          </IconButton>
        </div>
        <div className={s.scroll}>{body}</div>
      </div>
    </Dialog>
  );
}
