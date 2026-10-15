# Connecting Vela to Google (one-time setup)

Vela talks to Gmail through **your own** Google Cloud project. That means no
third-party server ever sees your mail: Vela on your computer talks straight to
Google. Setting this up takes about 10 minutes and is free.

You'll end up with one small file, the **OAuth client file**
(`client_secret_….json`). Vela imports it into `~/.config/vela-mail/` with
owner-only permissions.

> **Never** put this file in the source code or commit it to Git. The project's
> `.gitignore` already blocks `client_secret*.json` and `google-client.json`.

---

## 1. Create a project and turn on the Gmail API

1. Open **https://console.cloud.google.com/** and sign in with the Google
   account you want to use for Vela.
2. In the project picker at the top, choose **New project**. Name it something
   like `Vela Mail` and click **Create**. Make sure the new project is selected.
3. Go to **APIs & Services → Library**, search for **Gmail API**, open it and
   click **Enable**.

## 2. Set up the consent screen (Google Auth Platform)

Open **APIs & Services → OAuth consent screen**. Google now calls this area
**Google Auth Platform**. If it asks you to get started, click **Get started**.

1. **Branding** – App name: `Vela`. User support email: your address.
   Developer contact: your address. Save.
2. **Audience**
   - User type: **External** (needed for ordinary @gmail.com accounts; choose
     *Internal* only if you're on a Google Workspace domain and only want
     accounts from that domain).
   - Under **Test users**, click **+ Add users** and add every Gmail address
     you'll sign in with. Save.
3. **Data Access** – click **Add or remove scopes**, tick
   `https://www.googleapis.com/auth/gmail.modify` (search for "gmail.modify"),
   click **Update**, then **Save**.

   This one permission lets Vela read, send, label, archive and trash mail. It
   cannot permanently delete mail or change account settings.

## 3. Create the OAuth client

1. Go to **Clients** (or **APIs & Services → Credentials → Create credentials →
   OAuth client ID**).
2. Application type: **Desktop app**. Name: `Vela on CachyOS`. Click **Create**.
   (A "Web application" client won't work — Vela checks and tells you.)
3. Click **Download JSON**. You'll get a file named like
   `client_secret_1234-abc.apps.googleusercontent.com.json`.

## 4. Import it into Vela

Start Vela and click **Import client file**, then choose the JSON file.

Or do it by hand:

```bash
install -Dm600 ~/Downloads/client_secret_*.json ~/.config/vela-mail/google-client.json
```

You can delete the downloaded copy afterwards.

## 5. Sign in

Click **Sign in with Google**. Your normal browser opens Google's sign-in page.

Because the app is your own and unverified, Google shows **"Google hasn't
verified this app"**. That's expected: click **Continue** (or **Advanced → Go to
Vela**). Tick the Gmail permission box and click **Continue**. The browser tab
then says "You're signed in" and Vela takes over.

---

## The 7-day sign-in limit (important)

While your project's publishing status is **Testing**, Google makes sign-ins
expire after **7 days**. Vela will show a "Sign in again" banner when that
happens — nothing breaks, but it's a weekly chore.

To remove the limit:

1. Go to **Google Auth Platform → Audience**.
2. Click **Publish app** and confirm. Status becomes **In production**.

For an app only you use, you don't need Google's verification. You'll keep
seeing the "unverified app" warning when you sign in, and unverified apps are
limited to 100 users — neither matters for personal use.

## Removing access

- In Vela: **Settings → Accounts → Sign out**. Vela revokes its token at Google,
  deletes it from your keyring and clears that account's local cache.
- At Google: **https://myaccount.google.com/permissions** → Vela → Remove access.

## Where things are stored

| What | Where | Protection |
|---|---|---|
| OAuth client file | `~/.config/vela-mail/google-client.json` | file mode 600, folder 700 |
| Refresh token (long-term sign-in) | System keyring (KWallet / GNOME Keyring) | encrypted by your keyring |
| Access token (1 hour) | Memory only | never written anywhere |
| Settings, account list | `~/.config/vela-mail/` | mode 600 |
| Message list cache (no message bodies) | `~/.local/share/vela-mail/cache.sqlite3` | mode 600 |
| Attachments you open | `~/.cache/vela-mail/attachments/` | mode 600, cleared at each start |
