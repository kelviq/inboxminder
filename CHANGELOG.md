# Changelog

## 0.10.3 (2026-09-04)

- You can go back in the setup wizard: completed steps in the left rail
  are clickable, so changing an earlier answer (a different API key or
  model, a fixed Gmail client id) is one click. Continue then returns
  you to where you were; nothing downstream is lost, and an accidental
  overwrite can't happen because a revisited step won't continue
  without a key entered.

## 0.10.2 (2026-09-04)

Fixes from the first outside testers, hours after 0.10.0.

- Reopening the app now always does something visible. A menu-bar app
  has no Dock icon, so double-clicking it in Applications while it was
  already running looked like nothing happened; if you'd closed the
  setup wizard, there was no obvious way back. Now: reopening brings
  the wizard back when setup is unfinished, and otherwise shows a
  balloon pointing at the menu bar icon ("InboxMinder is running here").
- Closing the wizard mid-setup shows the same balloon ("Setup will
  wait"), and the menu bar popover's setup state gained a prominent
  Finish Setting Up button.
- The wizard's model field is a dropdown of current model ids for
  Anthropic, OpenAI, and Google (with notes like "recommended"), plus
  Custom for anything newer.

## 0.10.1 (2026-09-04)

- Fixed: fresh installs could never create the urgency label. Gmail
  reserves label names that collide with its system labels, and our
  default was "Important"; creating it returned an opaque 400 on every
  new mailbox (existing installs with the label already present were
  unaffected). The default is now "Urgent", and config validation
  rejects any reserved name with a clear message. Found by the first
  fresh-Mac install, minutes after 0.10.0 shipped.
- The setup wizard's model field is now a dropdown of current model ids
  per provider (with notes like "recommended" and "fastest, cheapest"),
  plus a Custom option for anything newer. Also fixed a wrong OpenAI
  default id.

## 0.10.0 (2026-09-04)

The self-sufficient release: download the DMG, open the app, and set up
everything with zero terminal.

- The app now bundles its own engine (node + the CLI, signed and
  notarized inside the bundle). No npm install required; npm remains
  fully supported for terminal users, and an existing npm-managed
  install is never hijacked.
- First-run setup wizard: pick your AI (with model-id hints), connect
  your own Gmail app (with an honest explainer of why Google requires
  one, and a link to the click-by-click walkthrough), authorize in the
  browser, go live. Closing mid-way is safe; reopening resumes at the
  right step. Credentials already on your Mac (a second profile, an
  earlier CLI setup) are detected and reused, and the wizard says so.
- No terminal, anywhere: the popover's setup states open the wizard,
  Preferences' Model tab takes the API key directly, and daemon
  notifications tell app users to open the menu bar instead of quoting
  commands (CLI users still get the exact commands).
- After the app updates itself, the popover offers one click to restart
  the background agent onto the new code.
- The update feed moved to inboxminder.com (old feed URLs redirect).
- Honest note: the DMG grew from ~3MB to roughly 75MB; that's the
  bundled engine. Auto-update deltas soften repeat downloads.

## 0.9.3 (2026-09-03)

- New brand icon: refreshed app icon plus a matching menu-bar template
  icon that adapts to light/dark menu bars.
- Menu-bar popover redesigned: status header with a live state dot, a
  recent-activity feed with per-category icons and Gmail deep links, an
  icon footer, and separate "Quit Menu Bar" / "Quit Completely" actions.
- Preferences window polish: clearly editable fields, grouped forms,
  tidier copy throughout.
- Default label names are now short (`Newsletter`, `Pending`, ...) and
  new labels arrive pre-colored from Gmail's palette. Existing labels,
  including your own renames and recolors, are never touched.
- Docs overhaul: a direct download link for the DMG, clearer quickstart,
  and cleaned-up copy across README, app strings, and CLI output.

## 0.9.2 (2026-09-03)

- The app has an icon: the Seal, an envelope under a shield-check.
  (This release is also the first delivered via Sparkle auto-update.)
- Releases now carry a version-less `InboxMinder.dmg` asset, giving the
  website an evergreen download link
  (`releases/latest/download/InboxMinder.dmg`).

## 0.9.1 (2026-09-02)

Auto-update infrastructure.

- Menu-bar app updates itself via Sparkle 2 (signed builds only):
  EdDSA-verified, consent-based checks, "Check for updates…" in the
  menu. Build-from-source installs are unaffected.
- Daemon gains a notify-only daily update check against GitHub releases
  (`[email] updateCheck`, default on, disclosed in the privacy section);
  it never updates itself; npm/brew remain the install channel.
- status.json additively carries `updateAvailable`; the popover shows an
  update row with a Releases link.
- Release pipeline: tag-triggered CI signs (Developer ID, hardened
  runtime), notarizes, staples, packages a DMG, publishes the GitHub
  Release, and refreshes the Sparkle appcast on GitHub Pages.

## 0.9.0 (2026-09-02)

Initial public release, extracted from a private tool running in
production on the author's own inbox since July 2026.

- Resident launchd gatekeeper: polls Gmail every 45s with a durable
  pending queue (a crash or rate limit can never lose an email).
- One classifier call per email → reply-worthiness, triage category, and
  importance in a single verdict; classifier errors always fail open to
  "needs you".
- Category labels: `InboxMinder/Newsletter`, `/Notification`,
  `/Marketing`, `/Cold Outreach`, `/FYI`; every label name is
  configurable (`[triage.labels]`, `[labels]`), from config or the
  Preferences window.
- Thread-state labels: `InboxMinder/Pending` on reply-worthy mail,
  auto-flips to `/Resolved` when your reply is observed.
- Importance tier: `InboxMinder/Important` + a subjects-only macOS
  notification for urgent reply-worthy mail.
- Opt-in per-category archiving (`[triage] archive`): skip-inbox with an
  atomic audit-trail label; never deletes, never marks spam.
- Cold-outreach guard: a local ledger of everyone you write to, plus
  conversation signals; known correspondents are never labeled cold, and
  `coldOutreachHint` teaches your definition of warm.
- Per-sender steering rules matched on the address only (display names
  are spoofable and never match).
- Any LLM via your own key (Anthropic / OpenAI / Google /
  OpenAI-compatible incl. Ollama for fully-local operation); secrets in
  the macOS Keychain only.
- Profiles: fully isolated per-mailbox instances via `--profile`.
- `inboxminder classify <id>`: safe single-message preview that labels
  nothing.
- Menu-bar companion app (build from source: `make install-app`): live
  status, pause/resume, re-auth, the triage activity feed, and a
  Preferences window covering every setting, backed by the
  `config get-settings`/`set-settings` CLI funnel, so the app itself
  never touches config.toml, the Keychain, or the network.
