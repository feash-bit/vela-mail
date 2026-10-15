import { X } from "lucide-react";
import { alternatives, DEFAULT_SHORTCUTS } from "../../lib/shortcuts";
import { useApp } from "../../state/app";
import { Dialog } from "../ui/Dialog";
import { Kbd } from "../ui/Kbd";
import { IconButton } from "../ui/primitives";
import o from "./overlays.module.css";

export function ShortcutsPanel() {
  const overrides = useApp((a) => a.settings?.shortcuts ?? {});
  const openDialog = useApp((a) => a.openDialog);
  const groups = ["General", "Navigation", "Message actions", "Go to"] as const;
  return (
    <Dialog onClose={() => openDialog(null)} label="Keyboard shortcuts" className={o.shortcuts}>
      <div className={o.shortcutsHead}>
        <h2>Keyboard shortcuts</h2>
        <IconButton label="Close" keys="escape" onClick={() => openDialog(null)}>
          <X size={16} />
        </IconButton>
      </div>
      <div className={o.shortcutsBody}>
        {groups.map((g) => (
          <section key={g} className={o.group}>
            <h3>{g}</h3>
            {DEFAULT_SHORTCUTS.filter((d) => d.group === g).map((d) => (
              <div key={d.action} className={o.sc}>
                <span>{d.label}</span>
                <span style={{ display: "inline-flex", gap: 6 }}>
                  {alternatives(overrides[d.action] ?? d.keys).map((k) => (
                    <Kbd key={k} keys={k} />
                  ))}
                </span>
              </div>
            ))}
          </section>
        ))}
        <section className={o.group}>
          <h3>While writing</h3>
          <div className={o.sc}>
            <span>Send</span>
            <Kbd keys="mod+enter" />
          </div>
          <div className={o.sc}>
            <span>Insert link</span>
            <Kbd keys="mod+k" />
          </div>
          <div className={o.sc}>
            <span>Bold / italic / underline</span>
            <span style={{ display: "inline-flex", gap: 6 }}>
              <Kbd keys="mod+b" />
              <Kbd keys="mod+i" />
              <Kbd keys="mod+u" />
            </span>
          </div>
          <div className={o.sc}>
            <span>Close and save draft</span>
            <Kbd keys="escape" />
          </div>
        </section>
      </div>
      <div className={o.shortcutsFoot}>
        Want different keys?{" "}
        <button onClick={() => openDialog("settings", "shortcuts")}>Change shortcuts in Settings</button>
      </div>
    </Dialog>
  );
}
