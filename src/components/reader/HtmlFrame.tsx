import { useEffect, useMemo, useRef, useState } from "react";
import { mailtoSeed } from "../../lib/compose";
import { collapseQuotes, frameDocument, isDesignedEmail, type FrameTheme } from "../../lib/frame";
import { api } from "../../lib/ipc";
import { useApp } from "../../state/app";
import { useCompose } from "../../state/compose";
import { ConfirmDialog } from "../ui/Dialog";
import s from "./reader.module.css";

/**
 * Colours for the frame, derived from settings rather than computed styles,
 * so a theme switch never renders with stale colours.
 */
function themeFor(mode: "paper" | "app", dark: boolean, accent: string): FrameTheme {
  if (mode === "paper")
    return { mode, text: "#1f1f25", muted: "#6b6b76", link: "#4f46e5", background: "transparent", quoteBorder: "#d4d4dc" };
  return dark
    ? { mode, text: "#ececf1", muted: "#8b8b98", link: `color-mix(in oklab, ${accent} 72%, white)`, background: "transparent", quoteBorder: "rgba(255,255,255,.14)" }
    : { mode, text: "#17171c", muted: "#6f6f7c", link: `color-mix(in oklab, ${accent} 82%, black)`, background: "transparent", quoteBorder: "rgba(20,20,45,.16)" };
}

function useDark(theme: string | undefined) {
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => setSystemDark(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return theme === "system" ? systemDark : theme !== "light";
}

/** Does the link text claim a different site than the real destination? */
function looksDeceptive(text: string, href: string): boolean {
  const m = text.trim().match(/^(?:https?:\/\/)?([a-z0-9.-]+\.[a-z]{2,})(?:[/?#].*)?$/i);
  if (!m) return false;
  try {
    const shown = m[1].toLowerCase().replace(/^www\./, "");
    const real = new URL(href).hostname.toLowerCase().replace(/^www\./, "");
    return shown !== real && !real.endsWith(`.${shown}`);
  } catch {
    return false;
  }
}

/**
 * Renders sanitised email HTML in a sandboxed iframe: no scripts, no forms,
 * strict CSP. The parent sizes it to fit and intercepts every link click.
 */
export function HtmlFrame({ html, css, plain, allowRemote }: { html: string; css: string; plain: boolean; allowRemote: boolean }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(plain ? 40 : 120);
  const [confirm, setConfirm] = useState<{ href: string; text: string } | null>(null);
  const theme = useApp((a) => a.settings?.theme);
  const accent = useApp((a) => a.settings?.accent);
  const mode = plain || !isDesignedEmail(html, css) ? "app" : "paper";
  const dark = useDark(theme);
  const doc = useMemo(() => frameDocument(html, css, allowRemote, themeFor(mode, dark, accent ?? "#8b7bff")), [html, css, allowRemote, mode, dark, accent]);

  const ro = useRef<ResizeObserver | null>(null);
  useEffect(() => () => ro.current?.disconnect(), []);

  // Runs on every (re)load of the srcdoc. React's onLoad is attached before the
  // frame is inserted, so the event can't be missed.
  const onLoad = () => {
    const d = ref.current?.contentDocument;
    if (!d) return;
    collapseQuotes(d);
    // Measure the body, not the document: the document is never shorter than
    // the frame itself, which would stop the frame from ever shrinking.
    const fit = () => setHeight(Math.max(Math.ceil(d.body?.scrollHeight ?? 0), 24));
    fit();
    ro.current?.disconnect();
    ro.current = new ResizeObserver(fit);
    ro.current.observe(d.documentElement);
    if (d.body) ro.current.observe(d.body);
    d.querySelectorAll("img").forEach((img) => img.addEventListener("load", fit, { once: true }));
    d.querySelectorAll("details").forEach((el) => el.addEventListener("toggle", fit));
    d.addEventListener(
      "click",
      (e) => {
        const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
        if (!a) return;
        e.preventDefault();
        const href = a.getAttribute("href") ?? "";
        if (/^mailto:/i.test(href)) {
          const acct = useApp.getState().activeAccount;
          if (acct) useCompose.getState().open(acct, mailtoSeed(href));
        } else if (/^https?:\/\//i.test(href)) {
          if (looksDeceptive(a.textContent ?? "", href)) setConfirm({ href, text: a.textContent ?? "" });
          else api.openExternal(href).catch((err) => useApp.getState().error(err));
        }
      },
      true,
    );
    // Show the real destination on hover.
    d.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((a) => {
      if (!a.title) a.title = a.getAttribute("href") ?? "";
    });
  };

  return (
    <>
      <div className={mode === "paper" ? s.paper : undefined}>
        <iframe
          ref={ref}
          className={s.frame}
          title="Message content"
          // No allow-scripts: email can never run code. allow-same-origin lets
          // Vela measure the height and handle links from outside.
          sandbox="allow-same-origin"
          srcDoc={doc}
          onLoad={onLoad}
          style={{ height }}
          referrerPolicy="no-referrer"
        />
      </div>
      {confirm && (
        <ConfirmDialog
          title="This link goes somewhere else"
          body={
            <>
              The link text shows <strong>{confirm.text.trim()}</strong>, but it actually opens <strong>{new URL(confirm.href).hostname}</strong>. Only continue if you
              trust the sender.
            </>
          }
          confirmLabel="Open anyway"
          danger
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            api.openExternal(confirm.href).catch((err) => useApp.getState().error(err));
            setConfirm(null);
          }}
        />
      )}
    </>
  );
}
