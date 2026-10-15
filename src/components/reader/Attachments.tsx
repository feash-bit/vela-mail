import { Download, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { fileSize } from "../../lib/format";
import { api } from "../../lib/ipc";
import type { Attachment } from "../../lib/types";
import { useApp } from "../../state/app";
import { IconButton } from "../ui/primitives";
import s from "./reader.module.css";

const PREVIEWABLE = ["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp"];

export function fileBadge(name: string, mime: string): { label: string; color: string } {
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  if (mime.startsWith("image/")) return { label: ext.slice(0, 4).toUpperCase() || "IMG", color: "#2f9e8f" };
  if (ext === "pdf") return { label: "PDF", color: "#e5484d" };
  if (["doc", "docx", "odt", "rtf"].includes(ext)) return { label: "DOC", color: "#3b6fe0" };
  if (["xls", "xlsx", "ods", "csv"].includes(ext)) return { label: ext === "csv" ? "CSV" : "XLS", color: "#2f9a5a" };
  if (["ppt", "pptx", "odp", "key"].includes(ext)) return { label: "PPT", color: "#e07b22" };
  if (["zip", "gz", "tar", "7z", "rar", "zst", "xz"].includes(ext)) return { label: "ZIP", color: "#8a6d3b" };
  if (mime.startsWith("audio/")) return { label: "AUD", color: "#b04fd1" };
  if (mime.startsWith("video/")) return { label: "VID", color: "#7a5af8" };
  if (["ics"].includes(ext)) return { label: "CAL", color: "#d6457a" };
  return { label: (ext || "FILE").slice(0, 4).toUpperCase(), color: "#6b6b78" };
}

function Thumb({ a }: { a: Attachment }) {
  const accountId = useApp((x) => x.activeAccount);
  const [src, setSrc] = useState<string | null>(null);
  const canPreview = PREVIEWABLE.includes(a.mimeType.toLowerCase()) && a.size <= 8 * 1024 * 1024;
  useEffect(() => {
    if (!canPreview || !accountId) return;
    let alive = true;
    api
      .attachmentPreview(accountId, a.messageId, a.id, a.mimeType)
      .then((u) => alive && setSrc(u))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [canPreview, accountId, a.messageId, a.id, a.mimeType]);
  const badge = fileBadge(a.filename, a.mimeType);
  return (
    <span className={s.attIcon} style={{ background: src ? "var(--bg-active)" : badge.color }}>
      {src ? <img src={src} alt="" /> : badge.label}
    </span>
  );
}

export function Attachments({ items }: { items: Attachment[] }) {
  const accountId = useApp((a) => a.activeAccount);
  const toast = useApp((a) => a.toast);
  const error = useApp((a) => a.error);
  if (!items.length || !accountId) return null;

  const open = (a: Attachment) => api.openAttachment(accountId, a.messageId, a.id, a.filename).catch((e) => error(e, "Couldn't open that file."));
  const save = (a: Attachment) =>
    api
      .saveAttachment(accountId, a.messageId, a.id, a.filename)
      .then((ok) => ok && toast(`Saved ${a.filename}`, { kind: "success" }))
      .catch((e) => error(e, "Couldn't save that file."));

  return (
    <div className={s.attachments}>
      {items.map((a) => (
        <div key={`${a.messageId}:${a.id}`} className={s.att} onDoubleClick={() => open(a)} title={a.filename}>
          <Thumb a={a} />
          <span className={s.attText}>
            <span className={s.attName}>{a.filename}</span>
            <span className={s.attSize}>{fileSize(a.size)}</span>
          </span>
          <span className={s.attActions}>
            <IconButton small label="Open" onClick={() => open(a)}>
              <ExternalLink size={14} />
            </IconButton>
            <IconButton small label="Save as…" onClick={() => save(a)}>
              <Download size={14} />
            </IconButton>
          </span>
        </div>
      ))}
    </div>
  );
}
