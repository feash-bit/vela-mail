import { useEffect, useState } from "react";
import { Onboarding } from "./components/onboarding/Onboarding";
import { LogoMark } from "./components/shell/LogoMark";
import { Shell } from "./components/shell/Shell";
import s from "./components/shell/shell.module.css";
import { EmptyState, Button } from "./components/ui/primitives";
import { Toasts } from "./components/ui/Toasts";
import { useBackendEvents } from "./hooks/useBackendEvents";
import { useTheme } from "./hooks/useTheme";
import { api, toAppErr } from "./lib/ipc";
import { useApp } from "./state/app";
import { CircleAlert } from "lucide-react";

export function App() {
  const info = useApp((a) => a.info);
  const settings = useApp((a) => a.settings);
  const accounts = useApp((a) => a.accounts);
  const [failed, setFailed] = useState<string | null>(null);
  useTheme(settings);
  useBackendEvents();

  useEffect(() => {
    useApp
      .getState()
      .boot()
      .catch((e) => setFailed(toAppErr(e).message))
      .finally(() => {
        // Show the window only once the first frame is ready (no white flash).
        requestAnimationFrame(() => api.windowReady().catch(() => {}));
      });
  }, []);

  if (failed)
    return (
      <div className={s.splash}>
        <EmptyState
          icon={<CircleAlert size={30} />}
          title="Vela couldn't start"
          body={failed}
          action={<Button onClick={() => location.reload()}>Try again</Button>}
        />
      </div>
    );
  if (!info || !settings)
    return (
      <div className={s.splash}>
        <LogoMark className={s.splashMark} size={56} />
      </div>
    );
  if (!info.hasClientConfig || accounts.length === 0)
    return (
      <>
        <Onboarding />
        <Toasts />
      </>
    );
  return <Shell />;
}
