import type { Address } from "./types";

const DAY = 86_400_000;

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Compact list date: "14:32", "Yesterday", "Tue", "12 Oct", "12 Oct 2024". */
export function listDate(ms: number, now = Date.now()): string {
  if (!ms) return "";
  const d = new Date(ms);
  const today = startOfDay(new Date(now));
  const day = startOfDay(d);
  if (day === today) return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (day === today - DAY) return "Yesterday";
  if (today - day < 6 * DAY) return d.toLocaleDateString(undefined, { weekday: "short" });
  if (d.getFullYear() === new Date(now).getFullYear())
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** Full date for message headers: "Tue 14 Oct 2026, 2:32 pm". */
export function fullDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "2 hours ago" style, for sync status and snooze times. */
export function relative(ms: number, now = Date.now()): string {
  const diff = ms - now;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (abs < 60_000) return diff < 0 ? "just now" : "in a moment";
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), "minute");
  if (abs < DAY) return rtf.format(Math.round(diff / 3_600_000), "hour");
  return rtf.format(Math.round(diff / DAY), "day");
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

export function nameOf(a: Address | null | undefined): string {
  if (!a) return "";
  return a.name?.trim() || a.email.split("@")[0];
}

export function formatAddress(a: Address): string {
  return a.name ? `${a.name} <${a.email}>` : a.email;
}

export function initials(name: string): string {
  const parts = name.replace(/[^\p{L}\p{N} ]/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Stable hue (0–359) from an email address, for avatar colours. */
export function hueFor(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % 360;
}

/** "Ann, Bob, me (4)" */
export function sendersLine(senders: string[], count: number): string {
  const shown = senders.length > 3 ? [senders[0], "…", ...senders.slice(-2)] : senders;
  return shown.join(", ") + (count > 1 ? `  ${count}` : "");
}

/** Toast text after snoozing, e.g. "Snoozed until Tue, 8:00 AM". */
export function snoozedMessage(until: number): string {
  return `Snoozed until ${new Date(until).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}`;
}

export function parseAddressInput(raw: string): Address | null {
  const s = raw.trim().replace(/[,;]$/, "").trim();
  if (!s) return null;
  const m = s.match(/^(.*)<([^<>\s]+@[^<>\s]+)>$/);
  if (m) {
    const name = m[1].trim().replace(/^"|"$/g, "").trim();
    return { name: name || null, email: m[2].trim() };
  }
  return { name: null, email: s };
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@<>,;"\\]+@[^\s@<>,;"\\]+\.[^\s@<>,;"\\.]+$/.test(email.trim());
}

export function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  doc.querySelectorAll("p,div,li,h1,h2,h3,blockquote").forEach((el) => el.append("\n"));
  return (doc.body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
