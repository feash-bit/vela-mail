import { CircleAlert, CircleCheck, Info } from "lucide-react";
import { useEffect } from "react";
import { useApp, type Toast } from "../../state/app";
import s from "./ui.module.css";

function ToastView({ t }: { t: Toast }) {
  const dismiss = useApp((st) => st.dismissToast);
  useEffect(() => {
    const id = setTimeout(() => dismiss(t.id), t.duration);
    return () => clearTimeout(id);
  }, [t.id, t.duration, dismiss]);
  const Icon = t.kind === "error" ? CircleAlert : t.kind === "success" ? CircleCheck : Info;
  return (
    <div className={s.toast} data-kind={t.kind} role={t.kind === "error" ? "alert" : "status"}>
      <Icon size={16} className={s.toastIcon} />
      <span className={s.toastMsg}>{t.message}</span>
      {t.action && (
        <button
          className={s.toastAction}
          onClick={() => {
            dismiss(t.id);
            t.action!.run();
          }}
        >
          {t.action.label}
        </button>
      )}
    </div>
  );
}

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  return (
    <div className={s.toasts} aria-live="polite">
      {toasts.map((t) => (
        <ToastView key={t.id} t={t} />
      ))}
    </div>
  );
}
