import { ExternalLink } from "lucide-react";
import { useCallback, useState } from "react";
import { api, toAppErr } from "../../lib/ipc";
import type { Account } from "../../lib/types";
import { useApp } from "../../state/app";
import { Dialog } from "../ui/Dialog";
import { Button, Spinner } from "../ui/primitives";
import s from "./signin.module.css";

/** Runs Google sign-in in the user's browser and shows a waiting dialog meanwhile. */
export function useSignIn() {
  const [busy, setBusy] = useState(false);
  const start = useCallback(async (loginHint?: string): Promise<Account | null> => {
    setBusy(true);
    try {
      const acct = await api.addAccount(loginHint);
      const app = useApp.getState();
      await app.refreshInfo();
      app.setActiveAccount(acct.id);
      app.toast(`Signed in as ${acct.email}`, { kind: "success" });
      return acct;
    } catch (e) {
      const err = toAppErr(e);
      if (err.code !== "cancelled") useApp.getState().error(err, "Sign-in didn't complete.");
      return null;
    } finally {
      setBusy(false);
    }
  }, []);
  const cancel = useCallback(() => {
    api.cancelSignIn().catch(() => {});
  }, []);
  const dialog = busy ? <SignInWaiting onCancel={cancel} /> : null;
  return { start, busy, dialog };
}

function SignInWaiting({ onCancel }: { onCancel: () => void }) {
  return (
    <Dialog onClose={onCancel} label="Signing in" className={s.wait} dismissible={false}>
      <div className={s.waitIcon}>
        <Spinner size={22} />
      </div>
      <h2 className={s.waitTitle}>Finish signing in with Google</h2>
      <p className={s.waitBody}>
        A Google sign-in page opened in your web browser. Choose your account and allow Vela to manage your mail, then come back here. Keep this window open until you're done — you have 10 minutes.
      </p>
      <p className={s.waitNote}>
        <ExternalLink size={13} /> Vela never sees your password. Your sign-in token is stored in your system keyring.
      </p>
      <Button variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </Dialog>
  );
}
