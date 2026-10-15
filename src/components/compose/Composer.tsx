import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, Extension, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold,
  Code,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Maximize2,
  Minus,
  Paperclip,
  Quote,
  RemoveFormatting,
  Reply,
  ReplyAll,
  Forward,
  SendHorizontal,
  Strikethrough,
  Trash2,
  Underline,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComposeSeed } from "../../lib/compose";
import { escapeHtml, fileSize, htmlToText, isValidEmail } from "../../lib/format";
import { api, toAppErr } from "../../lib/ipc";
import type { Address, DraftInput, ForwardedAttachment, LocalFile } from "../../lib/types";
import { FILES_EVENT } from "../../hooks/useBackendEvents";
import { useApp } from "../../state/app";
import { useCompose, type ComposerInstance } from "../../state/compose";
import { HtmlFrame } from "../reader/HtmlFrame";
import { fileBadge } from "../reader/Attachments";
import { ConfirmDialog } from "../ui/Dialog";
import { anchorFrom, Popover, type Anchor } from "../ui/Menu";
import { Button, IconButton, TextInput } from "../ui/primitives";
import { RecipientField, type RecipientHandle } from "./RecipientField";
import s from "./compose.module.css";

type SaveState = "idle" | "saving" | "saved" | "error";
const AUTOSAVE_MS = 2000;

function signatureHtml(sig: string | null | undefined) {
  return sig ? `<p></p><p class="vela-signature">-- <br>${sig}</p>` : "";
}

function FormatButton({ editor, label, keys, active, onClick, children }: { editor: Editor; label: string; keys?: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <IconButton
      small
      label={label}
      keys={keys}
      tooltipSide="top"
      className={active ? s.fmtActive : undefined}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        onClick();
        editor.commands.focus();
      }}
    >
      {children}
    </IconButton>
  );
}

export function Composer({ instance }: { instance: ComposerInstance }) {
  const { key, accountId, seed, placement } = instance;
  const settings = useApp((a) => a.settings!);
  const identity = useApp((a) => a.identities[accountId]);
  const toast = useApp((a) => a.toast);
  const [to, setTo] = useState<Address[]>(seed.to);
  const [cc, setCc] = useState<Address[]>(seed.cc);
  const [bcc, setBcc] = useState<Address[]>(seed.bcc);
  const [showCc, setShowCc] = useState(seed.cc.length > 0);
  const [showBcc, setShowBcc] = useState(seed.bcc.length > 0);
  const [subject, setSubject] = useState(seed.subject);
  const [files, setFiles] = useState<LocalFile[]>(seed.files);
  const [forwarded, setForwarded] = useState<ForwardedAttachment[]>(seed.forwarded);
  const [draftId, setDraftId] = useState<string | null>(seed.draftId);
  const [saveState, setSaveState] = useState<SaveState>(seed.draftId ? "saved" : "idle");
  const [showQuote, setShowQuote] = useState(seed.mode === "forward");
  const [confirm, setConfirm] = useState<null | "discard" | "nosubject">(null);
  const [linkAnchor, setLinkAnchor] = useState<Anchor | null>(null);
  const [linkUrl, setLinkUrl] = useState("");
  const [version, setVersion] = useState(0);
  const toRef = useRef<RecipientHandle>(null);
  const ccRef = useRef<RecipientHandle>(null);
  const bccRef = useRef<RecipientHandle>(null);
  const linkBtn = useRef<HTMLSpanElement>(null);
  const draftIdRef = useRef<string | null>(seed.draftId);
  const saving = useRef<Promise<void> | null>(null);
  const lastSaved = useRef<string>("");
  const sendRef = useRef<() => void>(() => {});
  const openLinkRef = useRef<() => void>(() => {});

  const initialBody = useMemo(() => {
    if (seed.body) return seed.body;
    if (seed.mode === "draft") return "";
    return signatureHtml(identity?.signature);
    // Only on first render: the editor owns the content afterwards.
  }, []);

  const keys = useMemo(
    () =>
      Extension.create({
        name: "velaKeys",
        addKeyboardShortcuts: () => ({
          "Mod-Enter": () => (sendRef.current(), true),
          "Mod-k": () => (openLinkRef.current(), true),
        }),
      }),
    [],
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        link: { openOnClick: false, autolink: true, defaultProtocol: "https", HTMLAttributes: { rel: "noopener noreferrer", target: null } },
      }),
      Placeholder.configure({ placeholder: seed.mode === "forward" ? "Add a note (optional)" : placement === "inline" ? "Write your reply…" : "Write your message…" }),
      keys,
    ],
    content: initialBody,
    autofocus: placement === "inline" && seed.mode !== "forward" ? "start" : false,
    onUpdate: () => setVersion((v) => v + 1),
    // Start typing above the signature, not after it.
    onCreate: ({ editor: e }) => e.commands.setTextSelection(1),
    editorProps: { attributes: { "aria-label": "Message body", spellcheck: "true" } },
  });

  const fmt = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e?.isActive("bold") ?? false,
      italic: e?.isActive("italic") ?? false,
      underline: e?.isActive("underline") ?? false,
      strike: e?.isActive("strike") ?? false,
      link: e?.isActive("link") ?? false,
      bullet: e?.isActive("bulletList") ?? false,
      ordered: e?.isActive("orderedList") ?? false,
      quote: e?.isActive("blockquote") ?? false,
      code: e?.isActive("code") ?? false,
    }),
  });

  // Signature arrives after the identity loads: add it if the editor is still untouched.
  useEffect(() => {
    if (!editor || !identity?.signature || seed.body || seed.mode === "draft" || version > 0) return;
    if (!editor.getHTML().includes("vela-signature")) {
      editor.commands.setContent(signatureHtml(identity.signature));
      editor.commands.setTextSelection(1);
    }
  }, [identity?.signature, editor, seed.body, seed.mode, version]);

  const bodyHtml = useCallback(() => {
    const html = editor?.isEmpty ? "" : (editor?.getHTML() ?? "");
    return seed.quote ? `${html}<br>${seed.quote}` : html;
  }, [editor, seed.quote]);

  const snapshot = useCallback(
    (): ComposeSeed => ({ ...seed, to, cc, bcc, subject, body: editor?.isEmpty ? "" : (editor?.getHTML() ?? seed.body), draftId, files, forwarded }),
    [seed, to, cc, bcc, subject, editor, draftId, files, forwarded],
  );

  const buildDraft = useCallback(
    (recipients?: { to: Address[]; cc: Address[]; bcc: Address[] }): DraftInput => {
      const html = bodyHtml();
      return {
        draftId,
        threadId: seed.threadId,
        inReplyTo: seed.inReplyTo,
        references: seed.references,
        to: recipients?.to ?? to,
        cc: recipients?.cc ?? cc,
        bcc: recipients?.bcc ?? bcc,
        subject: subject.trim(),
        html,
        text: htmlToText(html),
        attachmentTokens: files.map((f) => f.token),
        forwarded,
      };
    },
    [bodyHtml, draftId, seed.threadId, seed.inReplyTo, seed.references, to, cc, bcc, subject, files, forwarded],
  );

  const hasContent = () => !!(to.length || cc.length || bcc.length || (subject.trim() && subject !== seed.subject) || !(editor?.isEmpty ?? true) || files.length);
  const userTyped = () => {
    const text = editor?.getText().replace(/--\s[\s\S]*$/, "").trim() ?? "";
    return !!(text || files.length || (seed.mode === "new" && (to.length || subject.trim())));
  };

  // ---- Autosave to Gmail Drafts --------------------------------------------
  const save = useCallback(async () => {
    if (!userTyped() && !draftId) return;
    const draft = buildDraft();
    const fingerprint = JSON.stringify(draft);
    if (fingerprint === lastSaved.current) return;
    if (saving.current) await saving.current;
    setSaveState("saving");
    const p = api
      .saveDraft(accountId, { ...draft, draftId: draftIdRef.current })
      .then((r) => {
        draftIdRef.current = r.draftId;
        setDraftId(r.draftId);
        lastSaved.current = fingerprint;
        setSaveState("saved");
      })
      .catch((e) => {
        setSaveState("error");
        const err = toAppErr(e);
        if (err.code !== "offline") useApp.getState().error(err, "Couldn't save the draft.");
      })
      .finally(() => (saving.current = null));
    saving.current = p;
    await p;
    // userTyped reads current editor state; it doesn't need to be a dependency.
  }, [buildDraft, accountId, draftId]);

  useEffect(() => {
    if (instance.sending) return;
    const t = setTimeout(() => save(), AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [version, to, cc, bcc, subject, files, forwarded, save, instance.sending]);

  // Keep the store's copy current so the draft survives being hidden or moved.
  const snapRef = useRef(snapshot);
  snapRef.current = snapshot;
  useEffect(() => () => useCompose.getState().update(key, snapRef.current()), [key]);

  // Files dropped onto the window.
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ key: string; files: LocalFile[] }>).detail;
      if (d.key === key) setFiles((f) => [...f, ...d.files]);
    };
    window.addEventListener(FILES_EVENT, on);
    return () => window.removeEventListener(FILES_EVENT, on);
  }, [key]);

  // ---- Actions ----------------------------------------------------------------
  const send = useCallback(
    (skipSubjectCheck = false) => {
      const recipients = {
        to: toRef.current?.commit() ?? to,
        cc: ccRef.current?.commit() ?? cc,
        bcc: bccRef.current?.commit() ?? bcc,
      };
      const all = [...recipients.to, ...recipients.cc, ...recipients.bcc];
      if (!all.length) {
        toast("Add at least one recipient.", { kind: "error" });
        toRef.current?.focus();
        return;
      }
      const bad = all.find((a) => !isValidEmail(a.email));
      if (bad) {
        toast(`"${bad.email}" isn't a valid email address.`, { kind: "error" });
        return;
      }
      if (!subject.trim() && !skipSubjectCheck) {
        setConfirm("nosubject");
        return;
      }
      const totalSize = files.reduce((n, f) => n + f.size, 0);
      if (totalSize > 25 * 1024 * 1024) {
        toast("Attachments are larger than Gmail's 25 MB limit.", { kind: "error" });
        return;
      }
      const draft = { ...buildDraft(recipients), draftId: draftIdRef.current };
      useCompose.getState().send(key, { ...snapshot(), ...recipients, draftId: draftIdRef.current }, draft);
    },
    [to, cc, bcc, subject, files, buildDraft, key, snapshot, toast],
  );
  sendRef.current = () => send();

  const close = async () => {
    if (userTyped() || draftIdRef.current) {
      await save();
      if (draftIdRef.current) toast("Draft saved");
    }
    useCompose.getState().close(key);
  };

  const discard = async () => {
    setConfirm(null);
    useCompose.getState().close(key);
    files.forEach((f) => api.releaseAttachment(f.token).catch(() => {}));
    if (draftIdRef.current) {
      await saving.current;
      api.deleteDraft(accountId, draftIdRef.current).catch(() => {});
    }
    toast("Draft discarded");
  };

  const askDiscard = () => {
    if (settings.confirmDiscard && hasContent()) setConfirm("discard");
    else discard();
  };

  const attach = async () => {
    try {
      const picked = await api.pickAttachments();
      if (picked.length) setFiles((f) => [...f, ...picked]);
    } catch (e) {
      useApp.getState().error(e, "Couldn't attach that file.");
    }
  };

  const openLink = () => {
    if (!editor) return;
    setLinkUrl(editor.getAttributes("link").href ?? "");
    const el = linkBtn.current;
    if (el) setLinkAnchor(anchorFrom(el));
  };
  openLinkRef.current = openLink;
  const applyLink = () => {
    if (!editor) return;
    const url = linkUrl.trim();
    if (!url) editor.chain().focus().extendMarkRange("link").unsetLink().run();
    else {
      const href = /^(https?:|mailto:)/i.test(url) ? url : `https://${url}`;
      if (editor.state.selection.empty && !editor.isActive("link"))
        editor.chain().focus().insertContent(`<a href="${escapeHtml(href)}">${escapeHtml(url)}</a> `).run();
      else editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    }
    setLinkAnchor(null);
  };

  const onRootKey = (e: React.KeyboardEvent) => {
    if (e.defaultPrevented) return;
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      send();
    } else if (e.key === "Escape" && placement === "sheet" && !linkAnchor && !confirm) {
      e.preventDefault();
      close();
    }
  };

  if (instance.sending) return null;

  const modeIcon = seed.mode === "replyAll" ? <ReplyAll size={14} /> : seed.mode === "forward" ? <Forward size={14} /> : <Reply size={14} />;
  const modeLabel = seed.mode === "replyAll" ? "Reply all" : seed.mode === "forward" ? "Forward" : "Reply";
  const saveText = saveState === "saving" ? "Saving…" : saveState === "saved" ? "Draft saved" : saveState === "error" ? "Not saved" : "";
  const isSheet = placement === "sheet";
  const showSubject = isSheet || seed.mode === "forward" || seed.mode === "new" || seed.mode === "draft";

  const body = (
    <div className={isSheet ? s.sheet : s.inline} onKeyDown={onRootKey} role="form" aria-label={isSheet ? "New message" : modeLabel}>
      <div className={s.head}>
        <span className={s.headTitle}>
          {isSheet ? (subject.trim() || (seed.mode === "new" ? "New message" : modeLabel)) : (
            <>
              {modeIcon} {modeLabel}
            </>
          )}
        </span>
        <span className={s.saveState} aria-live="polite">
          {saveText}
        </span>
        {isSheet ? (
          <IconButton small label="Minimise" onClick={() => useCompose.getState().setMinimized(key, true)}>
            <Minus size={15} />
          </IconButton>
        ) : (
          <IconButton
            small
            label="Open in focused window"
            onClick={() => {
              useCompose.getState().update(key, snapshot());
              useCompose.getState().toSheet(key);
            }}
          >
            <Maximize2 size={14} />
          </IconButton>
        )}
        <IconButton small label={isSheet ? "Close and save draft" : "Close"} keys={isSheet ? "escape" : undefined} onClick={close}>
          <X size={15} />
        </IconButton>
      </div>

      <div className={s.field}>
        <span className={s.fieldLabel}>To</span>
        <RecipientField ref={toRef} label="To" accountId={accountId} value={to} onChange={setTo} placeholder="Name or email" autoFocus={isSheet && !to.length} />
        <span className={s.fieldExtras}>
          {!showCc && (
            <button className={s.ccToggle} tabIndex={-1} onClick={() => setShowCc(true)}>
              Cc
            </button>
          )}
          {!showBcc && (
            <button className={s.ccToggle} tabIndex={-1} onClick={() => setShowBcc(true)}>
              Bcc
            </button>
          )}
        </span>
      </div>
      {showCc && (
        <div className={s.field}>
          <span className={s.fieldLabel}>Cc</span>
          <RecipientField ref={ccRef} label="Cc" accountId={accountId} value={cc} onChange={setCc} autoFocus={!cc.length} />
        </div>
      )}
      {showBcc && (
        <div className={s.field}>
          <span className={s.fieldLabel}>Bcc</span>
          <RecipientField ref={bccRef} label="Bcc" accountId={accountId} value={bcc} onChange={setBcc} autoFocus={!bcc.length} />
        </div>
      )}
      {showSubject && (
        <div className={s.field}>
          <span className={s.fieldLabel}>Subject</span>
          <input
            className={s.subjectInput}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            aria-label="Subject"
            placeholder="What's this about?"
            autoFocus={isSheet && to.length > 0 && !subject}
            onKeyDown={(e) => {
              if ((e.key === "Enter" && !e.ctrlKey) || (e.key === "Tab" && !e.shiftKey)) {
                e.preventDefault();
                editor?.commands.focus("start");
              }
            }}
          />
        </div>
      )}

      <div className={s.editorWrap} onMouseDown={(e) => e.target === e.currentTarget && (e.preventDefault(), editor?.commands.focus("end"))}>
        <EditorContent editor={editor} className={s.editor} />
        {seed.quote && (
          <>
            <button className={s.quoteToggle} onClick={() => setShowQuote((v) => !v)} aria-label={showQuote ? "Hide quoted text" : "Show quoted text"} title={showQuote ? "Hide quoted text" : "Show quoted text"}>
              •••
            </button>
            {showQuote && (
              <div className={s.quoteBox}>
                <HtmlFrame html={seed.quote} css="" plain={false} allowRemote={false} />
              </div>
            )}
          </>
        )}
      </div>

      {(files.length > 0 || forwarded.length > 0) && (
        <div className={s.files}>
          {forwarded.map((f) => {
            const b = fileBadge(f.filename, f.mimeType);
            return (
              <span key={`${f.messageId}:${f.attachmentId}`} className={s.file}>
                <span className={s.fileBadge} style={{ background: b.color }}>
                  {b.label}
                </span>
                <span className={s.fileName}>{f.filename}</span>
                <IconButton small label="Remove" onClick={() => setForwarded((x) => x.filter((y) => y !== f))}>
                  <X size={12} />
                </IconButton>
              </span>
            );
          })}
          {files.map((f) => {
            const b = fileBadge(f.filename, f.mimeType);
            return (
              <span key={f.token} className={s.file}>
                <span className={s.fileBadge} style={{ background: b.color }}>
                  {b.label}
                </span>
                <span className={s.fileName}>{f.filename}</span>
                <span className={s.fileSize}>{fileSize(f.size)}</span>
                <IconButton
                  small
                  label="Remove"
                  onClick={() => {
                    setFiles((x) => x.filter((y) => y.token !== f.token));
                    api.releaseAttachment(f.token).catch(() => {});
                  }}
                >
                  <X size={12} />
                </IconButton>
              </span>
            );
          })}
        </div>
      )}

      <div className={s.foot}>
        <button className={s.send} onClick={() => send()} disabled={!editor}>
          Send <SendHorizontal size={15} />
          <kbd>Ctrl ↵</kbd>
        </button>
        {editor && (
          <>
            <FormatButton editor={editor} label="Bold" keys="mod+b" active={fmt?.bold} onClick={() => editor.chain().toggleBold().run()}>
              <Bold size={15} />
            </FormatButton>
            <FormatButton editor={editor} label="Italic" keys="mod+i" active={fmt?.italic} onClick={() => editor.chain().toggleItalic().run()}>
              <Italic size={15} />
            </FormatButton>
            <FormatButton editor={editor} label="Underline" keys="mod+u" active={fmt?.underline} onClick={() => editor.chain().toggleUnderline().run()}>
              <Underline size={15} />
            </FormatButton>
            <FormatButton editor={editor} label="Strikethrough" keys="mod+shift+s" active={fmt?.strike} onClick={() => editor.chain().toggleStrike().run()}>
              <Strikethrough size={15} />
            </FormatButton>
            <span ref={linkBtn} style={{ display: "inline-flex" }}>
              <FormatButton editor={editor} label="Link" keys="mod+k" active={fmt?.link} onClick={openLink}>
                <LinkIcon size={15} />
              </FormatButton>
            </span>
            <span className={s.toolSep} />
            <FormatButton editor={editor} label="Bulleted list" keys="mod+shift+8" active={fmt?.bullet} onClick={() => editor.chain().toggleBulletList().run()}>
              <List size={15} />
            </FormatButton>
            <FormatButton editor={editor} label="Numbered list" keys="mod+shift+7" active={fmt?.ordered} onClick={() => editor.chain().toggleOrderedList().run()}>
              <ListOrdered size={15} />
            </FormatButton>
            <FormatButton editor={editor} label="Quote" keys="mod+shift+b" active={fmt?.quote} onClick={() => editor.chain().toggleBlockquote().run()}>
              <Quote size={15} />
            </FormatButton>
            <FormatButton editor={editor} label="Code" keys="mod+e" active={fmt?.code} onClick={() => editor.chain().toggleCode().run()}>
              <Code size={15} />
            </FormatButton>
            <FormatButton editor={editor} label="Clear formatting" onClick={() => editor.chain().unsetAllMarks().clearNodes().run()}>
              <RemoveFormatting size={15} />
            </FormatButton>
          </>
        )}
        <span className={s.spacer} />
        <IconButton label="Attach files" tooltipSide="top" onClick={attach}>
          <Paperclip size={16} />
        </IconButton>
        <IconButton label="Discard draft" tooltipSide="top" onClick={askDiscard}>
          <Trash2 size={16} />
        </IconButton>
      </div>

      {linkAnchor && (
        <Popover anchor={linkAnchor} onClose={() => setLinkAnchor(null)} width={320} label="Insert link">
          <form
            className={s.linkForm}
            onSubmit={(e) => {
              e.preventDefault();
              applyLink();
            }}
          >
            <TextInput autoFocus value={linkUrl} placeholder="https://example.com" onChange={(e) => setLinkUrl(e.target.value)} aria-label="Link address" />
            <div className={s.linkRow}>
              {fmt?.link && (
                <Button size="sm" variant="ghost" type="button" onClick={() => (setLinkUrl(""), editor?.chain().focus().extendMarkRange("link").unsetLink().run(), setLinkAnchor(null))}>
                  Remove link
                </Button>
              )}
              <Button size="sm" variant="primary" type="submit">
                Apply
              </Button>
            </div>
          </form>
        </Popover>
      )}
      {confirm === "discard" && (
        <ConfirmDialog
          title="Discard this draft?"
          body="The message and its attachments will be deleted. You can't undo this."
          confirmLabel="Discard"
          danger
          onCancel={() => setConfirm(null)}
          onConfirm={discard}
        />
      )}
      {confirm === "nosubject" && (
        <ConfirmDialog
          title="Send without a subject?"
          body="Messages without a subject are easy to miss."
          confirmLabel="Send anyway"
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            send(true);
          }}
        />
      )}
    </div>
  );

  if (!isSheet) return body;
  return (
    <div className={s.sheetScrim} onMouseDown={(e) => e.target === e.currentTarget && useCompose.getState().setMinimized(key, true)}>
      {body}
    </div>
  );
}
