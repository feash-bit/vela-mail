//! Local SQLite cache of thread *summaries* (sender, subject, snippet, labels),
//! sync checkpoints, contacts for autocomplete and local snoozes.
//!
//! Full message bodies are never written to disk; they are fetched on demand
//! and kept in memory. The database lives in ~/.local/share/vela-mail with
//! owner-only permissions.

use crate::config;
use crate::error::AppResult;
use crate::models::{Address, Contact, ThreadSummary};
use rusqlite::{params, Connection, OptionalExtension};
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::sync::Mutex;

pub struct Cache {
    conn: Mutex<Connection>,
}

const SCHEMA: &str = r#"
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS sync_state (
    account TEXT PRIMARY KEY,
    history_id TEXT,
    last_sync INTEGER
);
CREATE TABLE IF NOT EXISTS threads (
    account TEXT NOT NULL,
    id TEXT NOT NULL,
    date INTEGER NOT NULL,
    json TEXT NOT NULL,
    PRIMARY KEY (account, id)
);
CREATE INDEX IF NOT EXISTS threads_date ON threads(account, date DESC);
CREATE TABLE IF NOT EXISTS thread_labels (
    account TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    label_id TEXT NOT NULL,
    PRIMARY KEY (account, thread_id, label_id)
);
CREATE INDEX IF NOT EXISTS thread_labels_label ON thread_labels(account, label_id);
CREATE TABLE IF NOT EXISTS contacts (
    account TEXT NOT NULL,
    email TEXT NOT NULL,
    name TEXT,
    last_seen INTEGER NOT NULL,
    hits INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (account, email)
);
CREATE TABLE IF NOT EXISTS snoozes (
    account TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    until INTEGER NOT NULL,
    PRIMARY KEY (account, thread_id)
);
"#;

impl Cache {
    pub fn open_default() -> AppResult<Self> {
        let dir = config::data_dir();
        config::ensure_private_dir(&dir)?;
        Self::open(&dir.join("cache.sqlite3"))
    }

    pub fn open(path: &Path) -> AppResult<Self> {
        let conn = Connection::open(path)?;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
        conn.execute_batch(SCHEMA)?;
        Ok(Cache { conn: Mutex::new(conn) })
    }

    #[cfg(test)]
    pub fn memory() -> Self {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(SCHEMA).unwrap();
        Cache { conn: Mutex::new(conn) }
    }

    pub fn history_id(&self, account: &str) -> AppResult<Option<String>> {
        let c = self.conn.lock().unwrap();
        Ok(c.query_row("SELECT history_id FROM sync_state WHERE account=?1", [account], |r| r.get(0)).optional()?.flatten())
    }

    pub fn last_sync(&self, account: &str) -> AppResult<Option<i64>> {
        let c = self.conn.lock().unwrap();
        Ok(c.query_row("SELECT last_sync FROM sync_state WHERE account=?1", [account], |r| r.get(0)).optional()?.flatten())
    }

    pub fn set_history_id(&self, account: &str, history_id: &str, now: i64) -> AppResult<()> {
        let c = self.conn.lock().unwrap();
        c.execute(
            "INSERT INTO sync_state(account, history_id, last_sync) VALUES (?1, ?2, ?3)
             ON CONFLICT(account) DO UPDATE SET history_id=excluded.history_id, last_sync=excluded.last_sync",
            params![account, history_id, now],
        )?;
        Ok(())
    }

    pub fn upsert_threads(&self, account: &str, threads: &[ThreadSummary]) -> AppResult<()> {
        let mut c = self.conn.lock().unwrap();
        let tx = c.transaction()?;
        for t in threads {
            tx.execute(
                "INSERT INTO threads(account, id, date, json) VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(account, id) DO UPDATE SET date=excluded.date, json=excluded.json",
                params![account, t.id, t.date, serde_json::to_string(t)?],
            )?;
            tx.execute("DELETE FROM thread_labels WHERE account=?1 AND thread_id=?2", params![account, t.id])?;
            for l in &t.label_ids {
                tx.execute("INSERT OR IGNORE INTO thread_labels(account, thread_id, label_id) VALUES (?1, ?2, ?3)", params![account, t.id, l])?;
            }
            let mut people: Vec<&Address> = vec![&t.from];
            people.extend(t.to.iter());
            for p in people.into_iter().filter(|p| p.email.contains('@')) {
                tx.execute(
                    "INSERT INTO contacts(account, email, name, last_seen) VALUES (?1, lower(?2), ?3, ?4)
                     ON CONFLICT(account, email) DO UPDATE SET
                        name=COALESCE(excluded.name, contacts.name),
                        last_seen=MAX(contacts.last_seen, excluded.last_seen),
                        hits=contacts.hits + 1",
                    params![account, p.email, p.name, t.date],
                )?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    pub fn remove_threads(&self, account: &str, ids: &[String]) -> AppResult<()> {
        let mut c = self.conn.lock().unwrap();
        let tx = c.transaction()?;
        for id in ids {
            tx.execute("DELETE FROM threads WHERE account=?1 AND id=?2", params![account, id])?;
            tx.execute("DELETE FROM thread_labels WHERE account=?1 AND thread_id=?2", params![account, id])?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Cached threads in a label, newest first — used for instant first paint.
    pub fn threads_in_label(&self, account: &str, label: &str, limit: u32) -> AppResult<Vec<ThreadSummary>> {
        let c = self.conn.lock().unwrap();
        let mut st = c.prepare(
            "SELECT t.json FROM threads t JOIN thread_labels l ON l.account=t.account AND l.thread_id=t.id
             WHERE t.account=?1 AND l.label_id=?2 ORDER BY t.date DESC LIMIT ?3",
        )?;
        let rows = st.query_map(params![account, label, limit], |r| r.get::<_, String>(0))?;
        Ok(rows.filter_map(|r| r.ok()).filter_map(|j| serde_json::from_str(&j).ok()).collect())
    }

    pub fn contacts(&self, account: &str, prefix: &str, limit: u32) -> AppResult<Vec<Contact>> {
        let c = self.conn.lock().unwrap();
        let like = format!("%{}%", prefix.to_lowercase().replace(['%', '_'], ""));
        let mut st = c.prepare(
            "SELECT name, email FROM contacts WHERE account=?1 AND (email LIKE ?2 OR lower(COALESCE(name,'')) LIKE ?2)
             ORDER BY hits DESC, last_seen DESC LIMIT ?3",
        )?;
        let rows = st.query_map(params![account, like, limit], |r| Ok(Contact { name: r.get(0)?, email: r.get(1)? }))?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    pub fn set_snooze(&self, account: &str, thread_id: &str, until: i64) -> AppResult<()> {
        let c = self.conn.lock().unwrap();
        c.execute(
            "INSERT INTO snoozes(account, thread_id, until) VALUES (?1, ?2, ?3)
             ON CONFLICT(account, thread_id) DO UPDATE SET until=excluded.until",
            params![account, thread_id, until],
        )?;
        Ok(())
    }

    pub fn clear_snooze(&self, account: &str, thread_id: &str) -> AppResult<()> {
        let c = self.conn.lock().unwrap();
        c.execute("DELETE FROM snoozes WHERE account=?1 AND thread_id=?2", params![account, thread_id])?;
        Ok(())
    }

    pub fn snoozes(&self, account: &str) -> AppResult<Vec<(String, i64)>> {
        let c = self.conn.lock().unwrap();
        let mut st = c.prepare("SELECT thread_id, until FROM snoozes WHERE account=?1 ORDER BY until ASC")?;
        let rows = st.query_map([account], |r| Ok((r.get(0)?, r.get(1)?)))?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    pub fn due_snoozes(&self, now: i64) -> AppResult<Vec<(String, String)>> {
        let c = self.conn.lock().unwrap();
        let mut st = c.prepare("SELECT account, thread_id FROM snoozes WHERE until <= ?1")?;
        let rows = st.query_map([now], |r| Ok((r.get(0)?, r.get(1)?)))?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Remove everything stored for an account (used when it is signed out).
    pub fn purge_account(&self, account: &str) -> AppResult<()> {
        let c = self.conn.lock().unwrap();
        for table in ["sync_state", "threads", "thread_labels", "contacts", "snoozes"] {
            c.execute(&format!("DELETE FROM {table} WHERE account=?1"), [account])?;
        }
        c.execute_batch("VACUUM;")?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t(id: &str, date: i64, labels: &[&str]) -> ThreadSummary {
        ThreadSummary {
            id: id.into(),
            history_id: "1".into(),
            subject: format!("S{id}"),
            snippet: String::new(),
            senders: vec!["Ann".into()],
            from: Address { name: Some("Ann Lee".into()), email: "Ann@Example.com".into() },
            to: vec![],
            date,
            unread: false,
            starred: false,
            important: false,
            has_attachments: false,
            has_draft: false,
            message_count: 1,
            label_ids: labels.iter().map(|s| s.to_string()).collect(),
            snoozed_until: None,
        }
    }

    #[test]
    fn stores_and_queries_by_label() {
        let c = Cache::memory();
        c.upsert_threads("a", &[t("1", 10, &["INBOX"]), t("2", 20, &["INBOX", "STARRED"]), t("3", 30, &["SENT"])]).unwrap();
        let inbox = c.threads_in_label("a", "INBOX", 50).unwrap();
        assert_eq!(inbox.iter().map(|x| x.id.as_str()).collect::<Vec<_>>(), vec!["2", "1"]);
        // Label change replaces the old set.
        c.upsert_threads("a", &[t("2", 20, &["STARRED"])]).unwrap();
        assert_eq!(c.threads_in_label("a", "INBOX", 50).unwrap().len(), 1);
        assert!(c.threads_in_label("b", "INBOX", 50).unwrap().is_empty(), "accounts are isolated");
        assert_eq!(c.contacts("a", "ann", 5).unwrap()[0].email, "ann@example.com");
        c.purge_account("a").unwrap();
        assert!(c.threads_in_label("a", "STARRED", 50).unwrap().is_empty());
    }

    #[test]
    fn snoozes_come_due() {
        let c = Cache::memory();
        c.set_snooze("a", "t1", 100).unwrap();
        c.set_snooze("a", "t2", 500).unwrap();
        assert_eq!(c.due_snoozes(200).unwrap(), vec![("a".to_string(), "t1".to_string())]);
        c.clear_snooze("a", "t1").unwrap();
        assert!(c.due_snoozes(200).unwrap().is_empty());
    }
}
