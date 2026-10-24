// Any window can emit events to every other window, so payloads that cross between
// windows are checked here before anything acts on them. Anything malformed is ignored.

import type { Events } from "./ipc";
import type { ReaderDone, Settings, UndoSpec } from "./types";

const MAX_IDS = 200;
const THREAD_ID = /^[A-Za-z0-9]{1,64}$/;
const LABEL_ID = /^[A-Za-z0-9_\-/ .:]{1,128}$/;

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isStringList = (v: unknown, ok: (s: string) => boolean, max = MAX_IDS): v is string[] =>
  Array.isArray(v) && v.length <= max && v.every((x) => typeof x === "string" && ok(x));

export function parseThreadChanged(p: unknown): Events["vela://thread-changed"] | null {
  if (!isObject(p)) return null;
  const { source, accountId, threadIds } = p;
  if (typeof source !== "string" || source.length > 64) return null;
  if (typeof accountId !== "string" || !accountId || accountId.length > 320) return null;
  if (!isStringList(threadIds, (s) => THREAD_ID.test(s))) return null;
  return { source, accountId, threadIds };
}

function parseUndo(p: unknown): UndoSpec | null {
  if (!isObject(p)) return null;
  if (p.kind === "untrash" || p.kind === "unsnooze") return { kind: p.kind };
  if (p.kind === "modify" && isStringList(p.add, (s) => LABEL_ID.test(s), 20) && isStringList(p.remove, (s) => LABEL_ID.test(s), 20)) {
    return { kind: "modify", add: p.add, remove: p.remove };
  }
  return null;
}

export function parseReaderDone(p: unknown): ReaderDone | null {
  if (!isObject(p)) return null;
  const { accountId, threadIds, message } = p;
  if (typeof accountId !== "string" || !accountId || accountId.length > 320) return null;
  if (!isStringList(threadIds, (s) => THREAD_ID.test(s)) || threadIds.length === 0) return null;
  if (typeof message !== "string" || message.length > 200) return null;
  const undo = parseUndo(p.undo);
  return undo ? { accountId, threadIds, message, undo } : null;
}

/** Settings arrive from the backend, but a window could also forge the event: check the shape we rely on. */
export function isSettings(p: unknown): p is Settings {
  return (
    isObject(p) &&
    typeof p.theme === "string" &&
    typeof p.accent === "string" &&
    typeof p.density === "string" &&
    typeof p.readerLayout === "string" &&
    typeof p.markReadOnOpen === "boolean" &&
    typeof p.blockRemoteImages === "boolean" &&
    typeof p.customTitleBar === "boolean" &&
    Array.isArray(p.trustedSenders) &&
    p.trustedSenders.every((s) => typeof s === "string") &&
    isObject(p.shortcuts)
  );
}
