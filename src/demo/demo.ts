// DEV-ONLY sample mailbox, loaded only when VITE_DEMO=1 (npm run dev:demo).
// It lets the interface be designed and tested without a Google account.
// Production builds never import this file.

import type { Account, Address, Label, Message, Settings, ThreadDetail, ThreadSummary, View } from "../lib/types";

const ME: Address = { name: "Sam Rivera", email: "sam@vela.dev" };
const HOUR = 3_600_000;
const now = Date.now();

const people = {
  maya: { name: "Maya Chen", email: "maya@northwind.studio" },
  theo: { name: "Theo Okafor", email: "theo@fernhill.io" },
  priya: { name: "Priya Raman", email: "priya.raman@kestrel.co" },
  lucas: { name: "Lucas Moreau", email: "lucas@atelier-moreau.fr" },
  ana: { name: "Ana Torres", email: "ana@torres.family" },
  ops: { name: "Fernhill Ops", email: "alerts@fernhill.io" },
  ledger: { name: "Ledgerline", email: "receipts@ledgerline.app" },
  tern: { name: "Tern Air", email: "trips@ternair.com" },
  digest: { name: "The Margin", email: "hello@themargin.news" },
  git: { name: "Forge", email: "notifications@forge.dev" },
  jun: { name: "Jun Park", email: "jun@northwind.studio" },
  noor: { name: "Noor Haddad", email: "noor@kestrel.co" },
} satisfies Record<string, Address>;

const labels: Label[] = [
  { id: "INBOX", name: "INBOX", kind: "system", unread: 6, total: 24, color: null },
  { id: "STARRED", name: "STARRED", kind: "system", unread: 0, total: 3, color: null },
  { id: "SENT", name: "SENT", kind: "system", unread: 0, total: 4, color: null },
  { id: "DRAFT", name: "DRAFT", kind: "system", unread: 0, total: 1, color: null },
  { id: "SPAM", name: "SPAM", kind: "system", unread: 1, total: 1, color: null },
  { id: "TRASH", name: "TRASH", kind: "system", unread: 0, total: 1, color: null },
  { id: "IMPORTANT", name: "IMPORTANT", kind: "system", unread: 2, total: 5, color: null },
  { id: "L_work", name: "Work", kind: "user", unread: 2, total: 9, color: { background: "#7c6cf6", text: "#ffffff" } },
  { id: "L_personal", name: "Personal", kind: "user", unread: 1, total: 4, color: { background: "#2fae8f", text: "#ffffff" } },
  { id: "L_receipts", name: "Receipts", kind: "user", unread: 0, total: 3, color: { background: "#e59a2f", text: "#1b1b1b" } },
  { id: "L_travel", name: "Travel", kind: "user", unread: 1, total: 2, color: { background: "#3f8cff", text: "#ffffff" } },
  { id: "L_proj", name: "Projects", kind: "user", unread: 0, total: 0, color: null },
  { id: "L_proj_vela", name: "Projects/Vela", kind: "user", unread: 1, total: 3, color: { background: "#ec5f8c", text: "#ffffff" } },
  { id: "L_proj_home", name: "Projects/Home reno", kind: "user", unread: 0, total: 2, color: null },
];

const newsletter = (title: string, intro: string) => `
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f2ee;padding:28px 0;font-family:Georgia,serif">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:10px;overflow:hidden">
<tr><td style="background:#1d2b3a;padding:26px 32px;color:#f4f2ee;font-size:13px;letter-spacing:2px">THE MARGIN · WEEKLY</td></tr>
<tr><td style="padding:30px 32px 6px"><h1 style="margin:0;font-size:28px;line-height:1.2;color:#1d2b3a">${title}</h1></td></tr>
<tr><td style="padding:12px 32px 4px;font-size:16px;line-height:1.65;color:#38404a">${intro}</td></tr>
<tr><td style="padding:10px 32px"><img src="https://themargin.news/track/open.gif" width="1" height="1" alt=""><img src="https://themargin.news/img/hero.jpg" alt="Harbour at dusk" width="496" style="border-radius:8px;display:block"></td></tr>
<tr><td style="padding:14px 32px 30px;font-size:16px;line-height:1.65;color:#38404a">
<p style="margin:0 0 14px"><strong>1. Slow software is a design choice.</strong> Teams that set a latency budget early ship tools that feel calm, not busy.</p>
<p style="margin:0 0 14px"><strong>2. The return of the desktop app.</strong> Native-feeling apps built on web tech are finally fast enough to compete.</p>
<p style="margin:0"><a href="https://themargin.news/read/412" style="color:#c2532b">Read the full issue →</a></p>
</td></tr>
<tr><td style="padding:18px 32px;background:#f4f2ee;font-size:12px;color:#7a7f86;font-family:Arial,sans-serif">You're receiving this because you subscribed at themargin.news. <a href="https://themargin.news/unsubscribe" style="color:#7a7f86">Unsubscribe</a></td></tr>
</table></td></tr></table>`;

const receipt = (item: string, amount: string) => `
<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:520px;margin:0 auto;color:#1f2328">
<div style="padding:24px 0 8px;font-size:20px;font-weight:600">Ledgerline</div>
<div style="border:1px solid #e5e7eb;border-radius:12px;padding:22px">
<div style="font-size:13px;color:#6b7280">Receipt #LL-20419</div>
<div style="font-size:32px;font-weight:700;margin:6px 0 18px">${amount}</div>
<table width="100%" style="font-size:14px;border-collapse:collapse">
<tr><td style="padding:8px 0;color:#6b7280">Item</td><td style="padding:8px 0;text-align:right">${item}</td></tr>
<tr><td style="padding:8px 0;color:#6b7280;border-top:1px solid #f0f0f0">Paid with</td><td style="padding:8px 0;text-align:right;border-top:1px solid #f0f0f0">Visa ending 4417</td></tr>
<tr><td style="padding:8px 0;color:#6b7280;border-top:1px solid #f0f0f0">Date</td><td style="padding:8px 0;text-align:right;border-top:1px solid #f0f0f0">14 Oct 2026</td></tr>
</table></div>
<p style="font-size:12px;color:#9ca3af;margin-top:16px">Questions? Reply to this email and a human will help.</p></div>`;

const p = (...paras: string[]) => paras.map((x) => `<p>${x}</p>`).join("");

interface Seed {
  id: string;
  subject: string;
  labels: string[];
  msgs: { from: Address; to?: Address[]; cc?: Address[]; ago: number; html?: string; text?: string; unread?: boolean; attachments?: { name: string; mime: string; size: number }[] }[];
  starred?: boolean;
  important?: boolean;
}

const seeds: Seed[] = [
  {
    id: "t1",
    subject: "Q4 roadmap review — notes and next steps",
    labels: ["INBOX", "L_work", "IMPORTANT"],
    important: true,
    msgs: [
      {
        from: people.maya,
        to: [ME, people.jun],
        cc: [people.priya],
        ago: 26,
        html: p("Hi both,", "Thanks for a sharp session yesterday. I've pulled the notes together and attached the deck we walked through.", "<strong>Decisions</strong>", "<ul><li>Ship offline mode before the November freeze</li><li>Move search indexing to the background worker</li><li>Pause the theming work until January</li></ul>", "Jun — could you confirm the estimate for the worker migration by Friday?", "Maya"),
        attachments: [
          { name: "Q4 roadmap review.pdf", mime: "application/pdf", size: 2_480_000 },
          { name: "capacity-model.xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", size: 184_000 },
        ],
      },
      {
        from: people.jun,
        to: [people.maya, ME],
        ago: 7,
        html: p("Confirmed: two sprints for the worker migration, assuming we keep the current queue library.", "I'll write up the risks in the doc today.", "Jun"),
      },
      {
        from: people.priya,
        to: [people.maya, ME, people.jun],
        ago: 1.2,
        unread: true,
        html: p("Looks good from the platform side. One flag: the November freeze moved to the 18th, so offline mode needs to be feature-complete a week earlier than planned.", "Happy to pair on the sync layer if that helps.", "— Priya"),
      },
    ],
  },
  {
    id: "t2",
    subject: "Photos from Saturday 🌿",
    labels: ["INBOX", "L_personal"],
    msgs: [
      {
        from: people.ana,
        to: [ME],
        ago: 3.5,
        unread: true,
        text: "Hey!\n\nFinally sorted the photos from the garden day. A few of them came out really well — the one of the lemon tree is my favourite.\n\nAre you around next weekend? Mum wants to try the new place on Ponsonby Road.\n\nAna x",
        attachments: [
          { name: "garden-01.jpg", mime: "image/jpeg", size: 3_200_000 },
          { name: "lemon-tree.jpg", mime: "image/jpeg", size: 2_900_000 },
        ],
      },
    ],
  },
  {
    id: "t3",
    subject: "[fernhill/api] Deploy failed on main (#4821)",
    labels: ["INBOX", "L_work"],
    msgs: [
      {
        from: people.git,
        to: [ME],
        ago: 5,
        unread: true,
        html: `<div style="font-family:ui-monospace,Menlo,monospace;font-size:13px;color:#24292f"><p style="font-family:-apple-system,Arial,sans-serif;font-size:14px">The <strong>deploy-production</strong> workflow failed for commit <code>a1c9e2f</code>.</p><pre style="background:#f6f8fa;border-radius:6px;padding:12px">error: migration 0042_add_sync_cursor failed
  relation "sync_cursor" already exists
exit code 1</pre><p style="font-family:-apple-system,Arial,sans-serif;font-size:14px"><a href="https://forge.dev/fernhill/api/actions/runs/4821">View workflow run</a></p></div>`,
      },
    ],
  },
  {
    id: "t4",
    subject: "Your flight to Wellington is confirmed",
    labels: ["INBOX", "L_travel"],
    starred: true,
    msgs: [
      {
        from: people.tern,
        to: [ME],
        ago: 20,
        html: `<div style="font-family:Arial,sans-serif;max-width:540px;margin:0 auto"><div style="background:linear-gradient(135deg,#0f4c81,#1e88a8);color:#fff;border-radius:12px;padding:26px"><div style="font-size:12px;opacity:.8;letter-spacing:1px">BOOKING REF · XK7P2Q</div><div style="font-size:30px;font-weight:700;margin:10px 0">AKL → WLG</div><div style="font-size:15px">Thu 23 Oct · 07:40 – 08:45 · Seat 4A</div></div><p style="font-size:14px;color:#444;line-height:1.6">Check-in opens 24 hours before departure. Bring photo ID that matches your booking.</p></div>`,
        attachments: [{ name: "boarding-pass.pdf", mime: "application/pdf", size: 96_000 }],
      },
    ],
  },
  {
    id: "t5",
    subject: "Issue 412: Slow software is a design choice",
    labels: ["INBOX"],
    msgs: [{ from: people.digest, to: [ME], ago: 30, html: newsletter("Slow software is a design choice", "This week: why the calmest tools set a latency budget on day one, and the quiet comeback of desktop apps."), unread: true }],
  },
  {
    id: "t6",
    subject: "Contract for the studio fit-out",
    labels: ["INBOX", "L_proj_home"],
    msgs: [
      { from: people.lucas, to: [ME], ago: 50, html: p("Bonjour Sam,", "Please find the revised contract attached. I've updated the timeline so joinery starts on 3 November.", "If everything looks right, sign page 4 and send it back whenever you're ready.", "Bien à vous,<br>Lucas"), attachments: [{ name: "Contract - Studio fit-out v3.pdf", mime: "application/pdf", size: 1_120_000 }] },
      { from: ME, to: [people.lucas], ago: 46, html: p("Thanks Lucas — reading it tonight. One question: does the quote include the oak shelving or is that separate?", "Sam") },
      { from: people.lucas, to: [ME], ago: 40, html: p("It's included — line 14. I've highlighted it for you.", "Lucas") },
    ],
  },
  {
    id: "t7",
    subject: "Receipt for your Ledgerline Pro subscription",
    labels: ["INBOX", "L_receipts"],
    msgs: [{ from: people.ledger, to: [ME], ago: 28, html: receipt("Ledgerline Pro — monthly", "$12.00") }],
  },
  {
    id: "t8",
    subject: "Coffee next week?",
    labels: ["INBOX"],
    msgs: [
      { from: people.noor, to: [ME], ago: 72, text: "Hi Sam,\n\nIt's been ages! I'm in town Tuesday to Thursday next week — free for a coffee?\n\nNoor" },
      { from: ME, to: [people.noor], ago: 70, text: "Noor! Yes please. Wednesday 10am at the usual place?\n\n> It's been ages! I'm in town Tuesday to Thursday next week — free for a coffee?" },
    ],
  },
  {
    id: "t9",
    subject: "Alert: p95 latency above 800 ms on search-api",
    labels: ["INBOX", "L_work"],
    important: true,
    msgs: [{ from: people.ops, to: [ME], ago: 0.4, unread: true, text: "search-api p95 latency has been above 800 ms for 10 minutes.\n\nRegion: ap-southeast-2\nStarted: 16:51 NZDT\nRunbook: https://runbooks.fernhill.io/search-latency" }],
  },
  {
    id: "t10",
    subject: "Design review: Vela reading pane",
    labels: ["INBOX", "L_proj_vela"],
    msgs: [
      { from: people.jun, to: [ME], ago: 2.5, unread: true, html: p("Pushed a new build of the reading pane — the subject is bigger and the message cards finally breathe.", "Can you take a look before stand-up? Mostly interested in whether the remote-image banner feels too loud.", "Jun") },
    ],
  },
  {
    id: "t11",
    subject: "Weekend plans",
    labels: ["L_personal"],
    msgs: [{ from: people.ana, to: [ME], ago: 140, text: "Mum says Sunday lunch works. 12:30?" }],
  },
  {
    id: "t12",
    subject: "Invoice INV-2026-118",
    labels: ["L_receipts"],
    msgs: [{ from: people.lucas, to: [ME], ago: 300, html: p("Invoice attached for the design phase. Due in 14 days.", "Lucas"), attachments: [{ name: "INV-2026-118.pdf", mime: "application/pdf", size: 210_000 }] }],
  },
  {
    id: "t13",
    subject: "Re: Offline mode spec",
    labels: ["SENT", "L_proj_vela"],
    msgs: [{ from: ME, to: [people.jun, people.maya], ago: 9, html: p("Updated the spec with the conflict-resolution rules. Last-writer-wins for flags, merge for labels.", "Sam") }],
  },
  {
    id: "t14",
    subject: "You've won a free cruise!!!",
    labels: ["SPAM"],
    msgs: [{ from: { name: "Prize Desk", email: "win@prize-desk.biz" }, to: [ME], ago: 12, unread: true, html: `<p>Click <a href="https://prize-desk.biz/claim">www.your-bank.com/claim</a> to claim your prize today.</p>` }],
  },
];

// Pad the inbox so scrolling and virtualisation are exercised.
const fillerFrom = [people.digest, people.git, people.ledger, people.priya, people.theo, people.maya, people.noor];
const fillerSubjects = [
  "Weekly sync agenda",
  "[fernhill/web] New comment on #1203",
  "Your statement is ready",
  "Re: Hiring plan for Q1",
  "Lunch & learn: Rust in production",
  "Updated: on-call rota for November",
  "Quick question about the export format",
  "Notes from the customer call",
  "Reminder: expense reports due Friday",
  "Shared a document with you: Launch checklist",
];
for (let i = 0; i < 26; i++) {
  const from = fillerFrom[i % fillerFrom.length];
  seeds.push({
    id: `f${i}`,
    subject: fillerSubjects[i % fillerSubjects.length],
    labels: i % 3 === 0 ? ["L_work"] : ["INBOX"],
    msgs: [{ from, to: [ME], ago: 80 + i * 19, text: `Hi Sam,\n\nA quick note about "${fillerSubjects[i % fillerSubjects.length].toLowerCase()}". Details below — nothing urgent.\n\nThanks,\n${from.name}` }],
  });
}

interface DemoThread {
  summary: ThreadSummary;
  detail: ThreadDetail;
}

const store = new Map<string, DemoThread>();
for (const sd of seeds) {
  const messages: Message[] = sd.msgs.map((m, i) => {
    const id = `${sd.id}-m${i}`;
    const html = m.html ?? `<div class="vela-plain">${(m.text ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/https?:\/\/\S+/g, (u) => `<a href="${u}">${u}</a>`)}</div>`;
    const remote = (html.match(/src="https?:/g) ?? []).length;
    return {
      id,
      threadId: sd.id,
      from: m.from,
      to: m.to ?? [ME],
      cc: m.cc ?? [],
      bcc: [],
      replyTo: [],
      subject: i ? `Re: ${sd.subject}` : sd.subject,
      date: now - m.ago * HOUR,
      snippet: (m.text ?? html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().slice(0, 140),
      labelIds: [...sd.labels, ...(m.unread ? ["UNREAD"] : [])],
      unread: !!m.unread,
      starred: !!sd.starred,
      isDraft: false,
      html: html.replace(/<img[^>]+src="https?:[^"]*"[^>]*>/g, ""),
      css: "",
      plainText: !m.html,
      blockedRemote: remote,
      attachments: (m.attachments ?? []).map((a, j) => ({ id: `${id}-a${j}`, messageId: id, filename: a.name, mimeType: a.mime, size: a.size, inline: false })),
      messageIdHeader: `<${id}@vela.dev>`,
      references: null,
      listUnsubscribe: m.from === people.digest ? "<https://themargin.news/unsubscribe>" : null,
    };
  });
  const last = messages[messages.length - 1];
  const labelIds = [...new Set([...sd.labels, ...(sd.starred ? ["STARRED"] : []), ...(sd.important ? ["IMPORTANT"] : []), ...(messages.some((m) => m.unread) ? ["UNREAD"] : [])])];
  const names = [...new Set(messages.map((m) => (m.from.email === ME.email ? "me" : (m.from.name ?? m.from.email))))];
  // Like Gmail: full name for one sender, first names for a group.
  const senders = names.length > 1 ? names.map((n) => (n === "me" ? n : n.split(" ")[0])) : names;
  store.set(sd.id, {
    summary: {
      id: sd.id,
      historyId: "1",
      subject: sd.subject,
      snippet: last.snippet,
      senders,
      from: [...messages].reverse().find((m) => m.from.email !== ME.email)?.from ?? last.from,
      to: last.to,
      date: last.date,
      unread: messages.some((m) => m.unread),
      starred: !!sd.starred,
      important: !!sd.important,
      hasAttachments: messages.some((m) => m.attachments.length),
      hasDraft: false,
      messageCount: messages.length,
      labelIds,
      snoozedUntil: null,
    },
    detail: { id: sd.id, subject: sd.subject, labelIds, messages, remoteAllowed: false },
  });
}
// One draft and one snoozed conversation
store.get("t8")!.summary.hasDraft = true;
store.get("t11")!.summary.snoozedUntil = now + 20 * HOUR;

let settings: Settings = {
  theme: "dark",
  accent: "#8b7bff",
  density: "comfortable",
  sidebarCompact: false,
  hiddenFolders: [],
  readerLayout: "split",
  listWidth: 420,
  showSnippets: true,
  showAvatars: true,
  notifications: true,
  notifyInboxOnly: true,
  notificationPreview: false,
  syncIntervalSecs: 60,
  blockRemoteImages: true,
  trustedSenders: [],
  markReadOnOpen: true,
  undoSendSeconds: 5,
  confirmDiscard: true,
  launchAtLogin: false,
  startMinimized: false,
  startView: "inbox",
  lastView: null,
  activeAccount: ME.email,
  customTitleBar: true,
  reducedMotion: "system",
  shortcuts: {},
  recentSearches: ["from:maya", "has:attachment invoice"],
};

const account: Account = { id: ME.email, email: ME.email, displayName: ME.name, status: "ok" };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function matches(t: DemoThread, view: View, filter: string | null): boolean {
  const l = t.summary.labelIds;
  let ok: boolean;
  switch (view.kind) {
    case "label":
      ok = view.labelId === "STARRED" ? t.summary.starred : view.labelId === "DRAFT" ? t.summary.hasDraft : l.includes(view.labelId);
      break;
    case "archive":
      ok = !l.includes("INBOX") && !l.includes("SPAM") && !l.includes("TRASH");
      break;
    case "snoozed":
      ok = !!t.summary.snoozedUntil;
      break;
    case "search": {
      const q = view.query.toLowerCase().replace(/\b(from|to|subject):/g, "");
      const hay = `${t.summary.subject} ${t.summary.snippet} ${t.summary.from.name} ${t.summary.from.email}`.toLowerCase();
      ok = q.split(/\s+/).filter((w) => !w.includes(":")).every((w) => hay.includes(w)) && !l.includes("SPAM") && !l.includes("TRASH");
      break;
    }
  }
  if (filter?.includes("is:unread")) ok &&= t.summary.unread;
  if (filter?.includes("is:starred")) ok &&= t.summary.starred;
  if (filter?.includes("has:attachment")) ok &&= t.summary.hasAttachments;
  return ok;
}

function applyLabels(id: string, add: string[], remove: string[]) {
  const t = store.get(id);
  if (!t) return;
  const set = new Set(t.summary.labelIds);
  remove.forEach((x) => set.delete(x));
  add.forEach((x) => set.add(x));
  t.summary.labelIds = [...set];
  t.summary.unread = set.has("UNREAD");
  t.summary.starred = set.has("STARRED");
  t.summary.important = set.has("IMPORTANT");
  t.detail.labelIds = t.summary.labelIds;
  if (!set.has("UNREAD")) t.detail.messages.forEach((m) => (m.unread = false));
}

const tinyImage = (hue: number) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},55%,62%)"/><stop offset="1" stop-color="hsl(${hue + 40},50%,38%)"/></linearGradient></defs><rect width="80" height="80" fill="url(#g)"/><circle cx="58" cy="22" r="9" fill="rgba(255,255,255,.7)"/><path d="M0 64 L26 40 L46 58 L60 46 L80 64 V80 H0Z" fill="rgba(0,0,0,.25)"/></svg>`)}`;

export async function handle(cmd: string, args: Record<string, unknown>): Promise<unknown> {
  await wait(cmd === "list_threads" ? 380 : cmd === "get_thread" ? 220 : 40);
  const a = args as Record<string, never>;
  switch (cmd) {
    case "app_info":
      return { version: "0.1.0 (demo)", hasClientConfig: true, keyringAvailable: true, accounts: [account] };
    case "get_settings":
      return settings;
    case "save_settings":
      settings = { ...(a.settings as Settings) };
      return settings;
    case "take_pending_mailto":
      return null;
    case "get_identity":
      return { email: ME.email, displayName: ME.name, signature: "Sam Rivera<br>Product · Vela" };
    case "list_labels":
      return labels.map((l) => ({ ...l, unread: [...store.values()].filter((t) => t.summary.unread && t.summary.labelIds.includes(l.id)).length }));
    case "cached_threads":
      return [];
    case "list_threads": {
      const list = [...store.values()]
        .filter((t) => matches(t, a.view as View, a.filter as string | null))
        .map((t) => ({ ...t.summary }))
        .sort((x, y) => y.date - x.date);
      return { threads: list, nextPageToken: null, resultSizeEstimate: list.length };
    }
    case "get_thread": {
      const t = store.get(a.threadId as string);
      if (!t) throw { code: "not_found", message: "That conversation no longer exists." };
      const allow = !!a.allowRemote;
      return {
        ...t.detail,
        remoteAllowed: allow,
        messages: t.detail.messages.map((m) => ({ ...m, html: allow ? seeds.find((x) => x.id === t.summary.id)?.msgs[Number(m.id.split("-m")[1])].html ?? m.html : m.html })),
      };
    }
    case "modify_threads":
      (a.threadIds as string[]).forEach((id) => applyLabels(id, a.add as string[], a.remove as string[]));
      return null;
    case "trash_threads":
      (a.threadIds as string[]).forEach((id) => (a.restore ? applyLabels(id, ["INBOX"], ["TRASH"]) : applyLabels(id, ["TRASH"], ["INBOX"])));
      return null;
    case "snooze_threads":
      (a.threadIds as string[]).forEach((id) => {
        const t = store.get(id);
        if (!t) return;
        t.summary.snoozedUntil = (a.until as number | null) ?? null;
        applyLabels(id, a.until ? [] : ["INBOX"], a.until ? ["INBOX"] : []);
      });
      return null;
    case "suggest_contacts": {
      const q = String(a.query).toLowerCase();
      return Object.values(people).filter((x) => `${x.name} ${x.email}`.toLowerCase().includes(q)).slice(0, 6);
    }
    case "save_draft":
      return { draftId: (a.draft as { draftId: string | null }).draftId ?? `d${Date.now()}`, messageId: "m", threadId: "t" };
    case "send_message":
      await wait(400);
      return "sent";
    case "delete_draft":
    case "sync_now":
    case "release_attachment":
    case "cancel_sign_in":
      return null;
    case "open_draft":
      return { draftId: "d-demo", threadId: "t8", to: [people.noor], cc: [], bcc: [], subject: "Re: Coffee next week?", html: "<p>Perfect — see you then. I'll bring the sketches.</p>", inReplyTo: "<t8-m1@vela.dev>", references: null, files: [] };
    case "pick_attachments":
      return [{ token: `tok${Date.now()}`, filename: "site-plan-v2.pdf", size: 842_000, mimeType: "application/pdf" }];
    case "attachment_preview":
      return tinyImage((String(a.attachmentId).length * 47) % 360);
    case "open_attachment":
    case "open_external":
      return null;
    case "save_attachment":
      return true;
    case "import_client_config":
      return true;
    case "add_account":
      return account;
    case "remove_account":
      return [account];
    default:
      throw { code: "internal", message: `Demo mode doesn't support ${cmd}.` };
  }
}
