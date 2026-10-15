import { PenLine, X } from "lucide-react";
import { useCompose } from "../../state/compose";
import { IconButton } from "../ui/primitives";
import { Composer } from "./Composer";
import s from "./compose.module.css";

/** Renders the expanded composer sheet and a dock of minimised drafts. */
export function ComposeLayer() {
  const composers = useCompose((c) => c.composers);
  const sheets = composers.filter((c) => c.placement === "sheet" && !c.sending);
  const expanded = sheets.find((c) => !c.minimized);
  const docked = sheets.filter((c) => c.minimized);
  return (
    <>
      {expanded && <Composer key={expanded.key} instance={expanded} />}
      {docked.length > 0 && (
        <div className={s.dock}>
          {docked.map((c) => (
            <div key={c.key} className={s.dockItem}>
              <button onClick={() => useCompose.getState().setMinimized(c.key, false)} aria-label="Open draft">
                <PenLine size={14} />
                <span className={s.dockLabel}>{c.seed.subject || (c.seed.to[0] ? `To ${c.seed.to[0].name ?? c.seed.to[0].email}` : "New message")}</span>
              </button>
              <IconButton small label="Close draft" onClick={() => useCompose.getState().close(c.key)}>
                <X size={13} />
              </IconButton>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
