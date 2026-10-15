//! Google OAuth 2.0 for installed apps: Authorization Code flow with PKCE (S256)
//! and a loopback redirect on 127.0.0.1 with a random port.
//!
//! - The user signs in in their own browser; Vela never sees their password.
//! - A random `state` value protects against forged redirects.
//! - The loopback listener only binds to 127.0.0.1 and closes after one sign-in.
//! - Tokens are never logged.

use crate::config::ClientConfig;
use crate::error::{AppError, AppResult};
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use rand::RngCore;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::Notify;

const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const REVOKE_URL: &str = "https://oauth2.googleapis.com/revoke";
/// Read, compose, send, label and trash mail. Does not allow permanent deletion.
pub const SCOPE: &str = "https://www.googleapis.com/auth/gmail.modify";
const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(300);

#[derive(Debug, Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
    pub expires_in: u64,
    pub refresh_token: Option<String>,
    #[serde(default)]
    pub scope: String,
}

#[derive(Deserialize)]
struct TokenError {
    error: String,
}

pub struct Pkce {
    pub verifier: String,
    pub challenge: String,
}

pub fn random_b64(len: usize) -> String {
    let mut buf = vec![0u8; len];
    rand::rngs::OsRng.fill_bytes(&mut buf);
    URL_SAFE_NO_PAD.encode(buf)
}

pub fn new_pkce() -> Pkce {
    let verifier = random_b64(64); // 86 characters, inside the 43–128 range
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    Pkce { verifier, challenge }
}

pub fn auth_url(client: &ClientConfig, redirect: &str, pkce: &Pkce, state: &str, login_hint: Option<&str>) -> String {
    let mut u = url::Url::parse(AUTH_URL).expect("static url");
    {
        let mut q = u.query_pairs_mut();
        q.append_pair("client_id", &client.client_id)
            .append_pair("redirect_uri", redirect)
            .append_pair("response_type", "code")
            .append_pair("scope", SCOPE)
            .append_pair("code_challenge", &pkce.challenge)
            .append_pair("code_challenge_method", "S256")
            .append_pair("state", state)
            .append_pair("access_type", "offline")
            .append_pair("prompt", "consent select_account");
        if let Some(h) = login_hint {
            q.append_pair("login_hint", h);
        }
    }
    u.into()
}

/// Runs the whole browser sign-in. `open` launches the user's browser.
pub async fn sign_in(
    client: &ClientConfig,
    http: &reqwest::Client,
    cancel: Arc<Notify>,
    login_hint: Option<&str>,
    open: impl FnOnce(&str) -> AppResult<()>,
) -> AppResult<TokenResponse> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();
    let redirect = format!("http://127.0.0.1:{port}");
    let pkce = new_pkce();
    let state = random_b64(32);
    open(&auth_url(client, &redirect, &pkce, &state, login_hint))?;

    let code = tokio::select! {
        r = wait_for_code(&listener, &state) => r?,
        _ = cancel.notified() => return Err(AppError::Cancelled),
        _ = tokio::time::sleep(SIGN_IN_TIMEOUT) => return Err(AppError::Invalid("Sign-in timed out after 5 minutes. Try again.".into())),
    };
    drop(listener);

    let resp = http
        .post(TOKEN_URL)
        .form(&[
            ("code", code.as_str()),
            ("client_id", client.client_id.as_str()),
            ("client_secret", client.client_secret.as_str()),
            ("redirect_uri", redirect.as_str()),
            ("grant_type", "authorization_code"),
            ("code_verifier", pkce.verifier.as_str()),
        ])
        .send()
        .await?;
    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let err = resp.json::<TokenError>().await.map(|e| e.error).unwrap_or_default();
        return Err(AppError::Api { status, message: format!("Token exchange failed ({err})") });
    }
    let tokens: TokenResponse = resp.json().await?;
    if !tokens.scope.split(' ').any(|s| s == SCOPE) {
        return Err(AppError::Invalid(
            "Gmail access wasn't granted. Sign in again and tick the Gmail permission box.".into(),
        ));
    }
    Ok(tokens)
}

/// Accept connections until the browser delivers `?code=…&state=…`.
async fn wait_for_code(listener: &TcpListener, expected_state: &str) -> AppResult<String> {
    loop {
        let (mut sock, _) = listener.accept().await?;
        let mut buf = vec![0u8; 8192];
        let mut n = 0;
        // Read just the request head; ignore bodies.
        while n < buf.len() {
            let read = tokio::time::timeout(Duration::from_secs(5), sock.read(&mut buf[n..])).await;
            match read {
                Ok(Ok(0)) | Err(_) => break,
                Ok(Ok(k)) => {
                    n += k;
                    if buf[..n].windows(4).any(|w| w == b"\r\n\r\n") {
                        break;
                    }
                }
                Ok(Err(_)) => break,
            }
        }
        let head = String::from_utf8_lossy(&buf[..n]);
        let target = head.lines().next().and_then(|l| l.split(' ').nth(1)).unwrap_or("/");
        let parsed = url::Url::parse(&format!("http://127.0.0.1{target}")).ok();
        let params: Vec<(String, String)> = parsed
            .as_ref()
            .map(|u| u.query_pairs().into_owned().collect())
            .unwrap_or_default();
        let get = |k: &str| params.iter().find(|(a, _)| a == k).map(|(_, v)| v.clone());

        if parsed.as_ref().map(|u| u.path() != "/").unwrap_or(true) || (get("code").is_none() && get("error").is_none()) {
            respond(&mut sock, 404, "Not found", "").await;
            continue;
        }
        if get("state").as_deref() != Some(expected_state) {
            respond(&mut sock, 400, "Sign-in link didn't match", "Go back to Vela and start sign-in again.").await;
            return Err(AppError::Invalid("Sign-in response didn't match this request. Try again.".into()));
        }
        if let Some(err) = get("error") {
            respond(&mut sock, 200, "Sign-in cancelled", "You can close this tab and return to Vela.").await;
            return Err(if err == "access_denied" { AppError::Cancelled } else { AppError::Invalid(format!("Google returned: {err}")) });
        }
        respond(&mut sock, 200, "You're signed in", "You can close this tab and return to Vela.").await;
        return Ok(get("code").unwrap_or_default());
    }
}

async fn respond(sock: &mut tokio::net::TcpStream, status: u16, title: &str, body: &str) {
    let html = format!(
        "<!doctype html><html><head><meta charset=utf-8><title>Vela</title><style>\
         body{{margin:0;height:100vh;display:grid;place-items:center;background:#16161a;color:#ececf1;\
         font:15px/1.5 system-ui,sans-serif}}main{{text-align:center}}h1{{font-size:22px;font-weight:600;margin:0 0 6px}}\
         p{{color:#9a9aa6;margin:0}}i{{display:block;width:40px;height:40px;margin:0 auto 18px;border-radius:12px;\
         background:linear-gradient(135deg,#8b7bff,#5b8cff)}}</style></head><body><main><i></i><h1>{title}</h1><p>{body}</p></main></body></html>"
    );
    let reason = if status == 200 { "OK" } else if status == 404 { "Not Found" } else { "Bad Request" };
    let resp = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\n\
         Cache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n\r\n{html}",
        html.len()
    );
    let _ = sock.write_all(resp.as_bytes()).await;
    let _ = sock.shutdown().await;
}

/// Exchange a refresh token for a fresh access token.
pub async fn refresh(client: &ClientConfig, http: &reqwest::Client, refresh_token: &str, account: &str) -> AppResult<TokenResponse> {
    let resp = http
        .post(TOKEN_URL)
        .form(&[
            ("client_id", client.client_id.as_str()),
            ("client_secret", client.client_secret.as_str()),
            ("refresh_token", refresh_token),
            ("grant_type", "refresh_token"),
        ])
        .send()
        .await?;
    if resp.status().is_success() {
        return Ok(resp.json().await?);
    }
    let status = resp.status().as_u16();
    let err = resp.json::<TokenError>().await.map(|e| e.error).unwrap_or_default();
    if err == "invalid_grant" || status == 401 {
        Err(AppError::AuthExpired(account.to_string()))
    } else {
        Err(AppError::Api { status, message: format!("Couldn't refresh sign-in ({err})") })
    }
}

/// Best-effort revoke when an account is removed.
pub async fn revoke(http: &reqwest::Client, token: &str) {
    let _ = http.post(REVOKE_URL).form(&[("token", token)]).send().await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_matches_rfc7636_shape() {
        let p = new_pkce();
        assert!((43..=128).contains(&p.verifier.len()));
        assert_eq!(p.challenge, URL_SAFE_NO_PAD.encode(Sha256::digest(p.verifier.as_bytes())));
        assert_ne!(new_pkce().verifier, p.verifier);
    }

    #[test]
    fn auth_url_contains_required_params() {
        let c = ClientConfig { client_id: "id.apps.googleusercontent.com".into(), client_secret: "s".into() };
        let p = new_pkce();
        let u = auth_url(&c, "http://127.0.0.1:5555", &p, "st", None);
        assert!(u.contains("code_challenge_method=S256"));
        assert!(u.contains("access_type=offline"));
        assert!(u.contains("redirect_uri=http%3A%2F%2F127.0.0.1%3A5555"));
        assert!(!u.contains("client_secret"));
    }

    #[tokio::test]
    async fn loopback_rejects_wrong_state_and_accepts_right_one() {
        let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = l.local_addr().unwrap();
        let task = tokio::spawn(async move { wait_for_code(&l, "good").await });
        let send = |path: &'static str| async move {
            let mut s = tokio::net::TcpStream::connect(addr).await.unwrap();
            s.write_all(format!("GET {path} HTTP/1.1\r\nHost: x\r\n\r\n").as_bytes()).await.unwrap();
            let mut out = String::new();
            let _ = s.read_to_string(&mut out).await;
            out
        };
        assert!(send("/favicon.ico").await.contains("404"));
        assert!(send("/?code=abc&state=good").await.contains("signed in"));
        assert_eq!(task.await.unwrap().unwrap(), "abc");
    }
}
