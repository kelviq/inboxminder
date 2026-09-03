# Contributing

Thanks for your interest! InboxMinder is a small, focused tool, and
contributions that keep it small and focused are the most welcome.

## Setup

```bash
pnpm install
pnpm verify        # typecheck + lint + tests + build: the full gate
```

Run the gatekeeper from source with `pnpm dev watch`; classify a single
message safely with `pnpm dev classify <gmail-message-id>` (labels
nothing).

## Ground rules

- **`pnpm verify` must pass.** CI runs exactly that on macOS.
- **Privacy budget:** never log email bodies at info level; subjects,
  senders, and counts only. Secrets live in the macOS Keychain, never in
  config files, env files, or logs.
- **Fail-safe direction is load-bearing:** classifier errors must always
  land as "needs you", never as a silent skip, an archive, or a
  mis-file. The archive path must always carry its category label
  atomically.
- **Labels are write-only.** InboxMinder never reads labels back as
  state; don't add code that does.
- **Keep dependencies lean.** No frameworks; every new dependency needs
  a strong reason.
- ESM with NodeNext: relative imports end in `.js` even inside `.ts`
  files.
- CLI output goes through `src/cli/` only; no other layer talks to the
  terminal.

## Pull requests

- Small and reviewable beats big and clever.
- Add or adapt tests for behavior you change; the suite is fast, run it.
- First-time contributors will be asked by the CLA bot to accept the
  [CLA](CLA.md). It's short, and exists so the project can stay open
  source while Kelviq offers a commercial Pro edition.

## Reporting issues

Include macOS + Node versions, your LLM provider (never your key), and
relevant `~/.inboxminder/logs/watch.log` lines. The logs contain no mail
bodies, but skim before pasting anyway.
