// Mirrors src-tauri/src/models.rs. Keep the two in step.

export type AccountStatus = "ok" | "needsReauth" | "offline";

export interface Account {
  id: string;
  email: string;
  displayName: string | null;
  status: AccountStatus;
}

export interface AppInfo {
  version: string;
  hasClientConfig: boolean;
  keyringAvailable: boolean;
  accounts: Account[];
}

export interface Address {
  name: string | null;
  email: string;
}

export interface Label {
  id: string;
  name: string;
  kind: "system" | "user";
  unread: number;
  total: number;
  color: { background: string; text: string } | null;
}

export interface ThreadSummary {
  id: string;
  historyId: string;
  subject: string;
  snippet: string;
  senders: string[];
  from: Address;
  to: Address[];
  date: number;
  unread: boolean;
  starred: boolean;
  important: boolean;
  hasAttachments: boolean;
  hasDraft: boolean;
  messageCount: number;
  labelIds: string[];
  snoozedUntil: number | null;
}

export interface ThreadPage {
  threads: ThreadSummary[];
  nextPageToken: string | null;
  resultSizeEstimate: number;
}

export interface Attachment {
  id: string;
  messageId: string;
  filename: string;
  mimeType: string;
  size: number;
  inline: boolean;
}

export interface Message {
  id: string;
  threadId: string;
  from: Address;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  replyTo: Address[];
  subject: string;
  date: number;
  snippet: string;
  labelIds: string[];
  unread: boolean;
  starred: boolean;
  isDraft: boolean;
  html: string;
  css: string;
  plainText: boolean;
  blockedRemote: number;
  attachments: Attachment[];
  messageIdHeader: string | null;
  references: string | null;
  listUnsubscribe: string | null;
}

export interface ThreadDetail {
  id: string;
  subject: string;
  labelIds: string[];
  messages: Message[];
  remoteAllowed: boolean;
}

export type View =
  | { kind: "label"; labelId: string }
  | { kind: "archive" }
  | { kind: "snoozed" }
  | { kind: "search"; query: string };

export interface ForwardedAttachment {
  messageId: string;
  attachmentId: string;
  filename: string;
  mimeType: string;
}

export interface DraftInput {
  draftId: string | null;
  threadId: string | null;
  inReplyTo: string | null;
  references: string | null;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  subject: string;
  html: string;
  text: string;
  attachmentTokens: string[];
  forwarded: ForwardedAttachment[];
}

export interface SavedDraft {
  draftId: string;
  messageId: string;
  threadId: string;
}

export interface LocalFile {
  token: string;
  filename: string;
  size: number;
  mimeType: string;
}

export interface DraftContent {
  draftId: string;
  threadId: string | null;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  subject: string;
  html: string;
  inReplyTo: string | null;
  references: string | null;
  files: LocalFile[];
}

export interface Contact {
  name: string | null;
  email: string;
}

export interface Identity {
  email: string;
  displayName: string | null;
  signature: string | null;
}

export interface MailChanged {
  accountId: string;
  threadIds: string[];
  labelsChanged: boolean;
  fullRefresh: boolean;
}

export interface SyncState {
  accountId: string;
  syncing: boolean;
  lastSync: number | null;
  error: string | null;
  errorCode: string | null;
}

export interface Settings {
  theme: "dark" | "light" | "system";
  accent: string;
  density: "comfortable" | "compact";
  sidebarCompact: boolean;
  hiddenFolders: string[];
  readerLayout: "split" | "full";
  listWidth: number;
  showSnippets: boolean;
  showAvatars: boolean;
  notifications: boolean;
  notifyInboxOnly: boolean;
  notificationPreview: boolean;
  syncIntervalSecs: number;
  blockRemoteImages: boolean;
  trustedSenders: string[];
  markReadOnOpen: boolean;
  undoSendSeconds: number;
  confirmDiscard: boolean;
  launchAtLogin: boolean;
  startMinimized: boolean;
  startView: "inbox" | "last";
  lastView: string | null;
  activeAccount: string | null;
  customTitleBar: boolean;
  reducedMotion: "system" | "on" | "off";
  shortcuts: Record<string, string>;
  recentSearches: string[];
  autoUpdate: boolean;
}

export type UpdateState = "notConfigured" | "idle" | "checking" | "upToDate" | "available" | "downloading" | "ready" | "error";

export interface UpdateStatus {
  state: UpdateState;
  current: string;
  version: string | null;
  notes: string | null;
  pubDate: string | null;
  progress: number | null;
  installKind: "user" | "system" | "dev";
  canInstall: boolean;
  error: string | null;
  checkedAt: number | null;
}

export interface AppErr {
  code:
    | "offline"
    | "auth_expired"
    | "rate_limited"
    | "no_client_config"
    | "keyring"
    | "cancelled"
    | "not_found"
    | "invalid"
    | "api"
    | "internal";
  message: string;
}
