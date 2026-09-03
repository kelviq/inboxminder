# InboxMinder

[![CI](https://github.com/kelviq/inboxminder/actions/workflows/ci.yml/badge.svg)](https://github.com/kelviq/inboxminder/actions/workflows/ci.yml)

**The open-source AI gatekeeper for your inbox.** Every email you receive is read by an agent on your own Mac, scored, and triaged. Reply-worthy mail gets flagged, urgent mail gets marked Important, and newsletters, notifications, marketing, and cold outreach get sorted with Gmail labels. Opt in, and the junk tiers skip your inbox entirely.

No hosted service ever sees your mail. No account with us. Your own LLM key. It never sends and never deletes, and every decision it makes is a visible, reversible Gmail label.

## Download

- **Mac app + gatekeeper**: [Download InboxMinder.dmg](https://github.com/kelviq/inboxminder/releases/latest/download/InboxMinder.dmg) (signed and notarized, auto-updates)
- **CLI**: `npm install -g inboxminder`
- [All releases and changelogs](https://github.com/kelviq/inboxminder/releases)

## What it does

A resident background agent polls your Gmail every 45 seconds. Each new email gets one classifier call to your configured LLM, and the verdict becomes labels:

| Verdict | What happens |
|---|---|
| Needs a reply | `Pending`, flipping to `Resolved` the moment your reply goes out |
| Urgent or blocking | `Important` plus a macOS notification (subject only) |
| Newsletter | `Newsletter` |
| Automated notification | `Notification` |
| Marketing | `Marketing` |
| Cold outreach | `Cold Outreach` |
| Human FYI, no action | `FYI` |

Labels arrive pre-colored (from Gmail's palette; your own recolors are never overwritten), and are searchable, filterable, and pinnable in Gmail's sidebar on web and mobile. Prefer nesting? Rename them with a `/` prefix. Every label name is configurable, from config or the Preferences window.

**Opt-in archiving.** Nothing leaves your inbox by default. When you're ready:

```toml
[triage]
archive = ["newsletter", "marketing"]   # these skip the inbox; the label stays as an audit trail
```

The category label is applied in the same atomic call as the archive, so everything moved is always one label-click away. Never deleted, never marked spam.

**The cold-outreach guard.** Anyone you've written to can never be labeled Cold Outreach. InboxMinder keeps a local ledger of every address you send to, and a reply into an existing conversation is never "cold". You can also teach it your definition of warm:

```toml
[triage]
coldOutreachHint = "founders asking about my product are never cold"
```

**Per-sender rules.** Policy the classifier should know, matched on the sender's address (display names are spoofable and never match):

```toml
[[instructions.rules]]
match = "@bigcustomer.com"
note = "Always important."

[[instructions.rules]]
match = "recruiting@"
note = "Never worth a reply."
```

## Why it's different

- **Local.** The agent runs on your Mac. Your mail is never uploaded to us. There is no "us" server to upload to.
- **Open source.** Don't trust the previous sentence: read the code. It's small on purpose.
- **Any LLM, your own key.** Anthropic, OpenAI, Google, or any OpenAI-compatible endpoint, including Ollama and LM Studio for a fully local setup where mail never leaves your machine at all.
- **Fail-safe by construction.** A classifier error labels nothing and flags the mail as needing you, never the other way. Labels are write-only; InboxMinder never reads them back, so hand-editing them is always safe. Worst-case failure is a wrong label you remove with one click.
- **One LLM call per email.** Roughly a few cents a day on typical volume, on your own key.

## Privacy and data flow

Honesty over marketing: the email being classified (from, subject, the first part of the body) is sent to the LLM provider you configure. That is the one external data flow of your mail, and you choose who it is, including a local model, where there is none. Everything else stays on your Mac: OAuth tokens and API keys in the macOS Keychain, state in a local SQLite file, logs that carry subjects and senders but never bodies.

Two housekeeping flows, both disclosed and controllable: the daemon asks api.github.com once a day whether a newer release exists (no user data attached; `updateCheck = false` disables it), and the app checks its update feed the same way (its consent prompt controls it).

## Requirements

- macOS (Keychain and launchd are load-bearing)
- Node 22+ for the CLI (`npm i -g inboxminder`)
- A Gmail account and an LLM API key

## Quickstart

```bash
npm install -g inboxminder
inboxminder init
```

`init` walks you through picking your LLM, storing keys in the Keychain, and setting up Gmail. It ends by offering to go live: authorize Gmail in your browser and install the background agent, each step narrated. Re-run anytime with `inboxminder up` (idempotent). Check on it with `inboxminder agent status`, pause with `inboxminder agent pause`.

### Gmail setup (one-time, about 5 minutes)

InboxMinder talks to Gmail as your own Google Cloud OAuth app, so there is no middleman that could see your mail. Gmail's scopes are in Google's restricted category, which is also why a shared client isn't offered: it would require annual security audits and cap users. The short version is below; [docs/gmail-setup.md](docs/gmail-setup.md) walks through every click, both account types, and the fixes for every common error.

1. [console.cloud.google.com](https://console.cloud.google.com): create a project
2. **APIs & Services > Library**: enable the **Gmail API**
3. **APIs & Services > OAuth consent screen**:
   - **Google Workspace account** (your own domain): choose **Internal**. No test users needed, no unverified-app screen, and refresh tokens never expire. This is the best setup.
   - **Personal @gmail.com**: choose **External**, add yourself under **Test users**. Caveat: in Testing status Google expires refresh tokens after 7 days (re-run `inboxminder auth` weekly; you'll get a notification). To stop that, publish the app to Production and click through the one-time unverified-app warning. It's your own app.
4. **Credentials > Create credentials > OAuth client ID**: type **Desktop app**
5. Paste the client ID and secret when `init` asks (or later via `inboxminder set-key gmail-client-id` / `gmail-client-secret`), then authorize with `inboxminder auth`

The requested scope is `gmail.modify`: read mail plus write labels. InboxMinder never sends. There is no code path that could: it holds no send scope usage, creates no drafts, and deletes nothing.

Optional but recommended: `brew install terminal-notifier` for reliable macOS notifications (osascript notifications are silently dropped on some systems; InboxMinder auto-detects and prefers terminal-notifier).

### Try it safely

```bash
inboxminder classify <gmail-message-id>   # prints the verdict; labels nothing
```

## Commands

| Command | What it does |
|---|---|
| `inboxminder init` | Interactive setup: LLM provider and model, keys to Keychain, Gmail client |
| `inboxminder up` | Go live: authorize Gmail (if needed), install the background agent |
| `inboxminder auth` | Browser OAuth flow for Gmail |
| `inboxminder set-key <name>` | Store or rotate a secret (`anthropic`, `openai`, `gmail-client-id`, ...) |
| `inboxminder watch` | Run the gatekeeper in the foreground |
| `inboxminder agent install\|uninstall\|status\|pause\|resume` | Manage the launchd background agent |
| `inboxminder classify <messageId>` | Print the verdict for one message; labels nothing |
| `inboxminder config get-settings\|set-settings` | Read or update config through a validated funnel (what the Preferences window uses) |
| `inboxminder profiles` | List configured profiles (`--profile <name>` isolates a second mailbox) |

## Configuration

`~/.config/inboxminder/config.toml` is written by `init` and safe to hand-edit:

```toml
[llm]
provider = "anthropic"        # anthropic | openai | google | openai-compatible
model = "claude-sonnet-5"
# baseUrl = "http://localhost:11434/v1"   # openai-compatible only (Ollama etc.)

[email]
pollIntervalSec = 45
skipSenders = ["mailer-daemon"]   # address substrings never worth classifying
notifications = true              # Important mail and re-auth only, subjects only
updateCheck = true                # daily notify-only "newer release exists?" check

[triage]
enabled = true
archive = []                      # e.g. ["newsletter", "marketing"], opt-in
coldOutreachHint = ""

[triage.labels]                   # every label name is yours to change
newsletter = "Newsletter"
notification = "Notification"
marketing = "Marketing"
"cold-outreach" = "Cold Outreach"
fyi = "FYI"
important = "Important"

[labels]
enabled = true
pending = "Pending"
resolved = "Resolved"
```

Multiple mailboxes: `inboxminder --profile work init` gives each mailbox a fully isolated instance (own config, Keychain entries, agent).

## The menu-bar app

A native SwiftUI companion: status at a glance, pause and resume, a feed of what got triaged, and a Preferences window covering every setting so you never have to touch the TOML. It ships in the DMG above, or build from source with `make install-app`.

The app is a pure shell over the daemon: it renders `~/.inboxminder/status.json` and spawns the CLI for every action. No Keychain reads, no daemon logic of its own; its only network activity is the update feed. Quitting it never stops the gatekeeper.

## Updating

- **App**: updates itself (consent-based, never silent). Or grab the latest DMG above.
- **CLI/daemon**: `npm update -g inboxminder && inboxminder agent install`. The second command restarts the daemon onto the new code. The daemon notifies you when a newer release exists; it never updates itself.

## How it works

About 2,500 lines of TypeScript, no framework:

- **Watcher** (`src/email/watcher.ts`): history-cursor polling with a durable pending queue. A crash, rate limit, or Gmail 5xx can never lose an email; ids retry until handled.
- **Classifier** (`src/engine/classify.ts`): one `generateText` call per email returns reply-worthiness, category, and importance in a single JSON verdict. Malformed output fails open to "needs you".
- **Labels** (`src/email/gmail.ts`): label names resolve to ids (created on first use, pre-colored), applied per-thread via `threads.modify`.
- **State** (`src/db/state.ts`): better-sqlite3 for cursors, dedup, the correspondents ledger, pause and auth flags.
- **Agent** (`src/agent/`): launchd plist render and install, heartbeat staleness detection, `~/.inboxminder/status.json`.

## Roadmap

- Browser extension: reorder the Gmail inbox by importance score in place (the one thing the API can't do)
- Daily digest of what was triaged
- More providers (IMAP, Outlook)
- Universal binary (Intel Macs); the current DMG is Apple Silicon

## License and contributing

AGPL-3.0. Contributions welcome; see [CONTRIBUTING.md](CONTRIBUTING.md). A paid Pro tier (a drafting assistant that writes replies in your voice, grounded in your own docs) is planned; the gatekeeper you see here stays free, and features never move from free to paid.

*Extracted from a private tool that has been running on the author's own inbox since July 2026. Public history starts at 0.9.0.*
