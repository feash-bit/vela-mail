import { keyCaps } from "../../lib/shortcuts";
import s from "./ui.module.css";

export function Kbd({ keys }: { keys: string }) {
  const chords = keyCaps(keys);
  return (
    <span className={s.kbdGroup}>
      {chords.map((chord, i) => (
        <span key={i} className={s.kbdGroup}>
          {i > 0 && <span className={s.kbdThen}>then</span>}
          {chord.map((k) => (
            <kbd key={k} className={s.kbd}>
              {k}
            </kbd>
          ))}
        </span>
      ))}
    </span>
  );
}
