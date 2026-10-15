import { CircleHelp, RefreshCw, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { relative } from "../../lib/format";
import { runAction } from "../../state/actions";
import { useApp } from "../../state/app";
import { useMail } from "../../state/mail";
import { IconButton, Spinner } from "../ui/primitives";
import { SearchBar } from "./SearchBar";
import { UpdatePill } from "./UpdatePill";
import s from "./shell.module.css";
import { WindowControls } from "./WindowControls";

function SyncStatus() {
  const account = useApp((a) => a.activeAccount);
  const sync = useApp((a) => (account ? a.sync[account] : undefined));
  const online = useApp((a) => a.online);
  const refreshing = useMail((m) => m.refreshing);
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  if (!online || sync?.errorCode === "offline")
    return (
      <span className={s.syncPill} data-tone="warn" role="status">
        <WifiOff size={13} /> Offline
      </span>
    );
  if (sync?.errorCode === "rate_limited")
    return (
      <span className={s.syncPill} data-tone="warn" role="status">
        <span className={s.syncDot} /> Slowing down
      </span>
    );
  const busy = sync?.syncing || refreshing;
  const label = sync?.lastSync ? `Check for new mail · updated ${relative(sync.lastSync)}` : "Check for new mail";
  return busy ? (
    <span className={s.syncPill} role="status">
      <Spinner size={13} /> Syncing
    </span>
  ) : (
    <IconButton label={label} keys="shift+r" onClick={() => runAction("refresh")}>
      <RefreshCw size={15} />
    </IconButton>
  );
}

export function TitleBar() {
  const custom = useApp((a) => a.settings?.customTitleBar ?? true);
  return (
    <header className={s.titlebar} data-tauri-drag-region={custom ? "" : undefined}>
      <div className={s.titleLeft} data-tauri-drag-region={custom ? "" : undefined} />
      <SearchBar />
      <div className={s.titleRight} data-tauri-drag-region={custom ? "" : undefined}>
        <UpdatePill />
        <SyncStatus />
        <IconButton label="Keyboard shortcuts" keys="?" onClick={() => runAction("help")}>
          <CircleHelp size={16} />
        </IconButton>
        {custom && <WindowControls />}
      </div>
    </header>
  );
}
