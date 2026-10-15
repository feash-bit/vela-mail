import { useEffect } from "react";
import type { Settings } from "../lib/types";

/** Applies theme, accent, density and motion settings to <html>. */
export function useTheme(settings: Settings | null) {
  useEffect(() => {
    const root = document.documentElement;
    const dark = window.matchMedia("(prefers-color-scheme: dark)");
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      const theme = settings?.theme ?? "dark";
      root.dataset.theme = theme === "system" ? (dark.matches ? "dark" : "light") : theme;
      root.dataset.density = settings?.density ?? "comfortable";
      const rm = settings?.reducedMotion ?? "system";
      root.dataset.motion = rm === "on" || (rm === "system" && motion.matches) ? "reduce" : "full";
      root.style.setProperty("--accent", settings?.accent ?? "#8b7bff");
    };
    apply();
    dark.addEventListener("change", apply);
    motion.addEventListener("change", apply);
    return () => {
      dark.removeEventListener("change", apply);
      motion.removeEventListener("change", apply);
    };
  }, [settings?.theme, settings?.accent, settings?.density, settings?.reducedMotion]);
}
