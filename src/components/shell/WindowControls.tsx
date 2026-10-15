import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
import { inTauri } from "../../lib/ipc";
import s from "./shell.module.css";

// Hand-drawn glyphs at 10px so they sit crisply at any scale factor.
const Min = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
    <path d="M1.5 5h7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);
const Max = ({ restored }: { restored: boolean }) =>
  restored ? (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
      <rect x="1.5" y="3" width="5.5" height="5.5" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.1" />
      <path d="M3.5 1.5h4a1 1 0 0 1 1 1v4" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  ) : (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
      <rect x="1.5" y="1.5" width="7" height="7" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
const Close = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
    <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);

export function WindowControls() {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    if (!inTauri()) return;
    const w = getCurrentWindow();
    w.isMaximized().then(setMaximized).catch(() => {});
    const un = w.onResized(() => w.isMaximized().then(setMaximized).catch(() => {}));
    return () => {
      un.then((f) => f());
    };
  }, []);
  if (!inTauri()) return null;
  const w = getCurrentWindow();
  return (
    <div className={s.winControls}>
      <button className={s.winBtn} aria-label="Minimise" onClick={() => w.minimize()}>
        <Min />
      </button>
      <button className={s.winBtn} aria-label={maximized ? "Restore" : "Maximise"} onClick={() => w.toggleMaximize()}>
        <Max restored={maximized} />
      </button>
      <button className={s.winBtn} data-kind="close" aria-label="Close" onClick={() => w.close()}>
        <Close />
      </button>
    </div>
  );
}

const edges = ["N", "S", "E", "W", "NE", "NW", "SE", "SW"] as const;
const dirMap = { N: "North", S: "South", E: "East", W: "West", NE: "NorthEast", NW: "NorthWest", SE: "SouthEast", SW: "SouthWest" } as const;

/** Invisible resize handles for the frameless window. */
export function ResizeEdges() {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    if (!inTauri()) return;
    const w = getCurrentWindow();
    w.isMaximized().then(setMaximized).catch(() => {});
    const un = w.onResized(() => w.isMaximized().then(setMaximized).catch(() => {}));
    return () => {
      un.then((f) => f());
    };
  }, []);
  if (!inTauri() || maximized) return null;
  return (
    <>
      {edges.map((e) => (
        <div
          key={e}
          className={`${s.edge} ${s[`edge${e}`]}`}
          onMouseDown={(ev) => {
            if (ev.button === 0) getCurrentWindow().startResizeDragging(dirMap[e]).catch(() => {});
          }}
        />
      ))}
    </>
  );
}
