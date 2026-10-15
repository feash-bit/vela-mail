import { ArrowDownToLine, RotateCw } from "lucide-react";
import { useEffect } from "react";
import { useApp } from "../../state/app";
import { useUpdate } from "../../state/update";
import { ConfirmDialog } from "../ui/Dialog";
import { Tooltip } from "../ui/Tooltip";
import s from "./shell.module.css";

/** Title-bar button that appears only when an update needs the user. */
export function UpdatePill() {
  const status = useUpdate((u) => u.status);
  const confirm = useUpdate((u) => u.confirmRestart);
  const openDialog = useApp((a) => a.openDialog);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    useUpdate
      .getState()
      .init()
      .then((f) => (cleanup = f));
    return () => cleanup?.();
  }, []);

  if (!status) return null;
  const restart = () => useUpdate.getState().restart();

  return (
    <>
      {status.state === "ready" && (
        <Tooltip label={`Install Vela ${status.version} and restart`}>
          <button className={s.updatePill} onClick={restart}>
            <RotateCw size={13} />
            Update ready · Restart
          </button>
        </Tooltip>
      )}
      {status.state === "available" && !status.canInstall && (
        <Tooltip label={`Vela ${status.version} is available`}>
          <button className={`${s.updatePill} ${s.updatePillQuiet}`} onClick={() => openDialog("settings", "updates")}>
            <ArrowDownToLine size={13} />
            Update available
          </button>
        </Tooltip>
      )}
      {confirm && (
        <ConfirmDialog
          title="Restart to install the update?"
          body="Vela will close and reopen in a moment. Your open drafts are saved automatically and will be in Drafts."
          confirmLabel="Restart now"
          onCancel={() => useUpdate.getState().setConfirm(false)}
          onConfirm={() => useUpdate.getState().restart(true)}
        />
      )}
    </>
  );
}
