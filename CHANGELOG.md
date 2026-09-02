# Changelog

## 0.9.0 — 2026-09-02

Initial public release — extracted from a private tool running in
production on the author's own inbox since July 2026.

- Resident launchd gatekeeper: polls Gmail every 45s with a durable
  pending queue (a crash or rate limit can never lose an email).
- One classifier call per email → reply-worthiness, triage category, and
  importance in a single verdict; classifier errors always fail open to
  "needs you".
- Category labels: `InboxMinder/Newsletter`, `/Notification`,
  `/Marketing`, `/Cold Outreach`, `/FYI` — every label name is
  configurable (`[triage.labels]`, `[labels]`), from config or the
  Preferences window.
- Thread-state labels: `InboxMinder/Pending` on reply-worthy mail,
  auto-flips to `/Resolved` when your reply is observed.
- Importance tier: `InboxMinder/Important` + a subjects-only macOS
  notification for urgent reply-worthy mail.
- Opt-in per-category archiving (`[triage] archive`) — skip-inbox with an
  atomic audit-trail label; never deletes, never marks spam.
- Cold-outreach guard: a local ledger of everyone you write to, plus
  conversation signals — known correspondents are never labeled cold;
  `coldOutreachHint` teaches your definition of warm.
- Per-sender steering rules matched on the address only (display names
  are spoofable and never match).
- Any LLM via your own key (Anthropic / OpenAI / Google /
  OpenAI-compatible incl. Ollama for fully-local operation); secrets in
  the macOS Keychain only.
- Profiles: fully isolated per-mailbox instances via `--profile`.
- `inboxminder classify <id>` — safe single-message preview that labels
  nothing.
- Menu-bar companion app (build from source: `make install-app`): live
  status, pause/resume, re-auth, the triage activity feed, and a
  Preferences window covering every setting — backed by the
  `config get-settings`/`set-settings` CLI funnel, so the app itself
  never touches config.toml, the Keychain, or the network.
