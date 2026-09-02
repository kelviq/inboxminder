# InboxMinder

[![CI](https://github.com/kelviq/inboxminder/actions/workflows/ci.yml/badge.svg)](https://github.com/kelviq/inboxminder/actions/workflows/ci.yml)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)

**The open-source agent gatekeeper for your inbox.** Every email you receive is read by an AI agent *on your own Mac*, scored, and triaged: reply-worthy mail gets flagged (urgent mail gets **Important**), newsletters, notifications, marketing, and cold outreach get sorted with Gmail labels — and, if you opt in, the junk tiers skip your inbox entirely.

No hosted service ever sees your mail. No account with us. Your own LLM API key. It never sends, never deletes, and every decision it makes is a visible, reversible Gmail label.

> "There is no reason NOT to have every single email you get routed through an agent" — [@levelsio](https://x.com/levelsio). This is that, running locally, open source.

## What it does

A resident background agent (launchd) polls your Gmail every 45 seconds. Each new email gets **one** local classifier call to your configured LLM, and the verdict is projected onto labels:

| Verdict | What happens |
|---|---|
| Needs a reply | `InboxMinder/Pending` — flips to `InboxMinder/Resolved` the moment your reply goes out |
| Urgent / blocking | `InboxMinder/Important` + a macOS notification (subject only) |
| Newsletter | `InboxMinder/Newsletter` |
| Automated notification | `InboxMinder/Notification` |
| Marketing | `InboxMinder/Marketing` |
| Cold outreach | `InboxMinder/Cold Outreach` |
| Human FYI, no action | `InboxMinder/FYI` |

Labels are searchable, filterable, and pinnable in Gmail's sidebar — web and mobile. (Gmail doesn't let any app reorder your inbox; pin the Important label instead.)

**Opt-in archiving.** Nothing leaves your inbox by default. When you're ready:

```toml
[triage]
archive = ["newsletter", "marketing"]   # these skip the inbox; label stays as audit trail
```

The category label is applied in the same atomic call as the archive, so everything moved is always one label-click away. Never deleted, never marked spam.

**The cold-outreach guard.** Anyone you've written to can never be labeled Cold Outreach — InboxMinder keeps a local ledger of every address you send to, and a reply into an existing conversation is never "cold". You can also teach it your definition of warm:

```toml
[triage]
coldOutreachHint = "founders asking about my product are never cold"
```

**Per-sender rules.** Policy the classifier should know, matched on the sender's *address* (display names are spoofable and never match):

```toml
[[instructions.rules]]
match = "@bigcustomer.com"
note = "Always important."

[[instructions.rules]]
match = "recruiting@"
note = "Never worth a reply."
```

## Why it's different

- **Local.** The agent runs on your Mac. Your mail is never uploaded to us — there is no "us" server to upload to.
- **Open source.** Don't trust the previous sentence — read the code. It's small on purpose.
- **Any LLM, your own key.** Anthropic, OpenAI, Google, or any OpenAI-compatible endpoint — including Ollama/LM Studio for a **fully local** setup where mail never leaves your machine at all.
- **Fail-safe by construction.** A classifier error labels nothing and flags the mail as needing you (never the other way). Labels are write-only — InboxMinder never reads them back, so hand-editing them is always safe. Worst-case failure is a wrong label you remove with one click.
- **One LLM call per email.** Roughly a few cents a day on typical volume, on your own key.

## Privacy & data flow — read this

Honesty over marketing: the email being classified (from, subject, first ~2000 chars of body) is sent to **the LLM provider you configure** — that's the one external data flow, and you choose who it is (including a local model, where there is none). Everything else stays on your Mac: OAuth tokens and API keys in the macOS Keychain, state in a local SQLite file, logs carry subjects/senders only — never bodies.

## Requirements

- macOS (Keychain + launchd are load-bearing)
- Node 22+, pnpm 11+ (or `npm i -g inboxminder`)
- A Gmail account and an LLM API key

## Quickstart

```bash
npm install -g inboxminder
inboxminder init          # pick your LLM, store keys in Keychain, set up Gmail
```

`init` ends by offering to go live: authorize Gmail in your browser and install the background agent, each step narrated. Re-run anytime with `inboxminder up` (idempotent). Check on it with `inboxminder agent status`, pause with `inboxminder agent pause`.

### Gmail setup (one-time, ~5 minutes)

InboxMinder talks to Gmail as *your own* Google Cloud OAuth app — there's no shared middleman that could see your mail. Gmail's scopes are in Google's "restricted" category, which is also why a shared client isn't offered: it would require annual security audits and cap users. Battle-tested steps:

1. [console.cloud.google.com](https://console.cloud.google.com) → create a project
2. **APIs & Services → Library** → enable **Gmail API**
3. **APIs & Services → OAuth consent screen**:
   - **Google Workspace account** (your own domain): choose **Internal**. No test users needed, no unverified-app screen, and **refresh tokens never expire**. This is the best setup.
   - **Personal @gmail.com**: choose **External**, add yourself under **Test users**. Caveat: in Testing status Google expires refresh tokens after **7 days** (re-run `inboxminder auth` weekly — you'll get a notification). To stop that, publish the app to Production and click through the one-time "unverified app" warning — it's your own app.
4. **Credentials → Create credentials → OAuth client ID** → type **Desktop app**
5. Paste the client ID and secret when `init` asks (or later via `inboxminder set-key gmail-client-id` / `gmail-client-secret`), then authorize with `inboxminder auth`

The requested scope is `gmail.modify` — read mail + write labels. InboxMinder never sends, and there is no code path that could: it holds no send scope usage, creates no drafts, and deletes nothing.

Optional but recommended: `brew install terminal-notifier` for reliable macOS notifications (osascript notifications are silently dropped on some systems; InboxMinder auto-detects and prefers terminal-notifier).

### Try it safely

```bash
inboxminder classify <gmail-message-id>   # prints the verdict; labels nothing
```

## Commands

| Command | What it does |
|---|---|
| `inboxminder init` | Interactive setup: LLM provider/model, keys → Keychain, Gmail client |
| `inboxminder up` | Go live: authorize Gmail (if needed) → install the background agent |
| `inboxminder auth` | Browser OAuth flow for Gmail |
| `inboxminder set-key <name>` | Store/rotate a secret (`anthropic`, `openai`, `gmail-client-id`, ...) |
| `inboxminder watch` | Run the gatekeeper in the foreground |
| `inboxminder agent install\|uninstall\|status\|pause\|resume` | Manage the launchd background agent |
| `inboxminder classify <messageId>` | Print the verdict for one message — labels nothing |
| `inboxminder config get-settings\|set-settings` | Read/update config through a validated funnel (what the Preferences window uses) |
| `inboxminder profiles` | List configured profiles (`--profile <name>` isolates a second mailbox) |

## Configuration

`~/.config/inboxminder/config.toml` — written by `init`, safe to hand-edit:

```toml
[llm]
provider = "anthropic"        # anthropic | openai | google | openai-compatible
model = "claude-sonnet-5"
# baseUrl = "http://localhost:11434/v1"   # openai-compatible only (Ollama etc.)

[email]
pollIntervalSec = 45
skipSenders = ["mailer-daemon"]   # address substrings never worth classifying
notifications = true              # Important mail + re-auth only, subjects only

[triage]
enabled = true
archive = []                      # e.g. ["newsletter", "marketing"] — opt-in
coldOutreachHint = ""

[triage.labels]                   # every label name is yours to change
newsletter = "InboxMinder/Newsletter"
notification = "InboxMinder/Notification"
marketing = "InboxMinder/Marketing"
"cold-outreach" = "InboxMinder/Cold Outreach"
fyi = "InboxMinder/FYI"
important = "InboxMinder/Important"

[labels]
enabled = true
pending = "InboxMinder/Pending"
resolved = "InboxMinder/Resolved"
```

Multiple mailboxes: `inboxminder --profile work init` gives each mailbox a fully isolated instance (own config, Keychain entries, agent).

## Menu-bar app (optional)

A native SwiftUI companion in `app/` — status at a glance, pause/resume, re-auth, a feed of what got triaged, and a **Preferences window** covering every knob above (triage categories and archiving, per-sender rules, labels, model, daemon) so you never have to touch the TOML:

```bash
make install-app     # builds from source, copies to /Applications
```

The app is a pure shell over the daemon: it renders `~/.inboxminder/status.json` and spawns the CLI for every action — no network calls, no Keychain reads, no daemon logic of its own. Quitting it never stops the gatekeeper.

## How it works

~2,500 lines of TypeScript, no framework:

- **Watcher** (`src/email/watcher.ts`) — history-cursor polling with a durable pending queue: a crash, rate limit, or Gmail 5xx can never lose an email; ids retry until handled.
- **Classifier** (`src/engine/classify.ts`) — one `generateText` call per email returns reply-worthiness, category, and importance in a single JSON verdict. Malformed output fails open to "needs you".
- **Labels** (`src/email/gmail.ts`) — label names resolve to ids (created on first use), applied per-thread via `threads.modify`.
- **State** (`src/db/state.ts`) — better-sqlite3: cursors, dedup, the correspondents ledger, pause/auth flags.
- **Agent** (`src/agent/`) — launchd plist render/install, heartbeat staleness detection, `~/.inboxminder/status.json`.

## Roadmap

- Browser extension: reorder the Gmail inbox by importance score in-place (the one thing the API can't do)
- Daily digest of what was triaged
- More providers (IMAP, Outlook)

## License, contributions, and the Pro plan

InboxMinder is **AGPL-3.0** — free forever, and any fork or hosted derivative must stay open source. Contributions are welcome and require signing a short [CLA](CLA.md) (it lets Kelviq, the company behind InboxMinder, keep dual-licensing rights — see below). The [InboxMinder name and logo are trademarks](TRADEMARK.md); forks must rename.

Full disclosure of the business model, upfront: the gatekeeper you're looking at is free and always will be — features never move from free to paid. [Kelviq](https://kelviq.com) plans a paid **Pro** add-on (a closed plugin the open core loads) that turns the gatekeeper into a full assistant: reply drafts written in your voice, grounded in your own docs. If that interests you, watch this repo.

---

*Extracted from a private tool that has been running on the author's own inbox since July 2026 — public history starts at 0.9.0.*
