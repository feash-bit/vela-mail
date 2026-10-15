import { KeyRound, Paperclip, WifiOff } from "lucide-react";
import { useEffect } from "react";
import { useShortcuts } from "../../hooks/useShortcuts";
import { viewFromKey } from "../../lib/views";
import { openDraft, OPEN_DRAFT } from "../../state/actions";
import { useApp } from "../../state/app";
import { useMail } from "../../state/mail";
import { ComposeLayer } from "../compose/ComposeLayer";
import { MailList } from "../mail/MailList";
import { Reader } from "../reader/Reader";
import { SettingsDialog } from "../settings/SettingsDialog";
import { Button } from "../ui/primitives";
import { Toasts } from "../ui/Toasts";
import { CommandPalette } from "./CommandPalette";
import { Pickers } from "./Pickers";
import { ShortcutsPanel } from "./ShortcutsPanel";
import { Sidebar } from "./Sidebar";
import { useSignIn } from "./SignIn";
import { TitleBar } from "./TitleBar";
import { ResizeEdges } from "./WindowControls";
import s from "./shell.module.css";

function Banners() {
  const account = useApp((a) => a.accounts.find((x) => x.id === a.activeAccount));
  const online = useApp((a) => a.online);
  const { start, dialog } = useSignIn();
  return (
    <>
      {account?.status === "needsReauth" && (
        <div className={s.reauthBanner} role="alert">
          <KeyRound size={15} />
          <span>Google signed Vela out of {account.email}. Sign in again to keep your mail up to date.</span>
          <Button size="sm" variant="primary" onClick={() => start(account.email)}>
            Sign in again
          </Button>
        </div>
      )}
      {!online && (
        <div className={s.offlineBanner} role="status">
          <WifiOff size={14} /> You're offline. Vela shows what it has and catches up when you reconnect.
        </div>
      )}
      {dialog}
    </>
  );
}

export function Shell() {
  useShortcuts();
  const settings = useApp((a) => a.settings!);
  const accountId = useApp((a) => a.activeAccount);
  const dialog = useApp((a) => a.dialog);
  const dropHover = useApp((a) => a.dropHover);
  const openId = useMail((m) => m.openId);
  const full = settings.readerLayout === "full";

  // Load everything for the active account (and on account switch).
  useEffect(() => {
    if (!accountId) return;
    const app = useApp.getState();
    app.loadLabels(accountId);
    app.loadIdentity(accountId);
    const start = settings.startView === "last" ? viewFromKey(settings.lastView) : null;
    useMail.setState({ threads: [], details: {}, selectedId: null, openId: null, checked: new Set() });
    useMail.getState().setView(start ?? { kind: "label", labelId: "INBOX" });
    // Only when the account changes.
  }, [accountId]);

  useEffect(() => {
    const on = (e: Event) => openDraft((e as CustomEvent<string>).detail);
    window.addEventListener(OPEN_DRAFT, on);
    return () => window.removeEventListener(OPEN_DRAFT, on);
  }, []);

  return (
    <div className={s.app} data-chrome={settings.customTitleBar ? "custom" : "native"}>
      <Sidebar />
      <div className={s.main}>
        <TitleBar />
        <main className={s.panel} style={{ flexDirection: "column" }}>
          <Banners />
          <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
            {full ? openId ? <Reader full /> : <MailList full /> : (
              <>
                <MailList full={false} />
                <Reader full={false} />
              </>
            )}
          </div>
        </main>
      </div>
      <ComposeLayer />
      <Pickers />
      {dialog === "settings" && <SettingsDialog />}
      {dialog === "shortcuts" && <ShortcutsPanel />}
      {dialog === "palette" && <CommandPalette />}
      <Toasts />
      {settings.customTitleBar && <ResizeEdges />}
      {dropHover && (
        <div className={s.dropOverlay}>
          <div className={s.dropCard}>
            <Paperclip size={18} /> Drop files to attach them
          </div>
        </div>
      )}
    </div>
  );
}
