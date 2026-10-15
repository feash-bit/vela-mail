import { ExternalLink, KeyRound, Lock, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { api } from "../../lib/ipc";
import { useApp } from "../../state/app";
import { LogoMark } from "../shell/LogoMark";
import { useSignIn } from "../shell/SignIn";
import { WindowControls } from "../shell/WindowControls";
import { Button } from "../ui/primitives";
import s from "./onboarding.module.css";

const GUIDE = "https://console.cloud.google.com/apis/library/gmail.googleapis.com";

export function Onboarding() {
  const info = useApp((a) => a.info!);
  const custom = useApp((a) => a.settings?.customTitleBar ?? true);
  const [importing, setImporting] = useState(false);
  const { start, busy, dialog } = useSignIn();
  const step = info.hasClientConfig ? 2 : 1;

  const importFile = async () => {
    setImporting(true);
    try {
      if (await api.importClientConfig()) {
        await useApp.getState().refreshInfo();
        useApp.getState().toast("Google client file imported", { kind: "success" });
      }
    } catch (e) {
      useApp.getState().error(e, "That file couldn't be used.");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className={s.wrap}>
      <div className={s.drag} data-tauri-drag-region={custom ? "" : undefined}>
        {custom && <WindowControls />}
      </div>
      <main className={s.card}>
        <LogoMark size={52} className={s.mark} />
        <div className={s.progress} aria-label={`Step ${step} of 2`}>
          <span data-on="true" />
          <span data-on={step === 2} />
        </div>
        {!info.keyringAvailable && (
          <div className={s.warn} role="alert">
            <TriangleAlert size={16} style={{ flex: "none", marginTop: 2 }} />
            <span>
              No system keyring was found. Vela stores your sign-in only in the keyring. On KDE Plasma, enable KDE Wallet in System Settings. On other desktops, install{" "}
              <code>gnome-keyring</code>.
            </span>
          </div>
        )}
        {step === 1 ? (
          <>
            <h1 className={s.title}>Connect Vela to Google</h1>
            <p className={s.lead}>Vela talks to Gmail through your own Google Cloud project, so your mail goes straight between you and Google.</p>
            <ol className={s.steps}>
              <li>
                <span>
                  In Google Cloud Console, create a project and enable the <strong>Gmail API</strong>.
                </span>
              </li>
              <li>
                <span>
                  Set up the OAuth consent screen and add your Gmail address as a <strong>test user</strong>.
                </span>
              </li>
              <li>
                <span>
                  Create an OAuth client of type <strong>Desktop app</strong> and download its JSON file.
                </span>
              </li>
            </ol>
            <div className={s.actions}>
              <Button variant="primary" size="lg" icon={<KeyRound size={16} />} loading={importing} onClick={importFile}>
                Import client file
              </Button>
              <Button variant="ghost" size="lg" icon={<ExternalLink size={15} />} onClick={() => api.openExternal(GUIDE).catch(() => {})}>
                Open Google Cloud
              </Button>
            </div>
            <p className={s.note}>
              <Lock size={13} />
              The full walkthrough is in docs/GOOGLE_SETUP.md. Vela copies the file to ~/.config/vela-mail with owner-only permissions. Never commit it to Git.
            </p>
          </>
        ) : (
          <>
            <h1 className={s.title}>Sign in to Gmail</h1>
            <p className={s.lead}>Your browser will open Google's sign-in page. Choose your account and allow Vela to read, send and organise your mail.</p>
            <div className={s.actions}>
              <Button variant="primary" size="lg" loading={busy} disabled={!info.keyringAvailable} onClick={() => start()}>
                Sign in with Google
              </Button>
              <Button variant="ghost" size="lg" onClick={importFile}>
                Use a different client file
              </Button>
            </div>
            <p className={s.note}>
              <Lock size={13} />
              Vela never sees your password. It asks for the Gmail "modify" permission, which can't permanently delete mail. Revoke access any time at myaccount.google.com/permissions.
            </p>
          </>
        )}
      </main>
      {dialog}
    </div>
  );
}
