import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import * as p from "@clack/prompts";
import { installAgent, resolveCliPath } from "../agent/launchd.js";
import { DATA_DIR, loadConfig } from "../config/load.js";
import { getSecret } from "../secrets/keychain.js";

/**
 * The go-live sequence shared by `inboxminder up` and the end of
 * `inboxminder init`: authorize Gmail (if needed) -> install the daemon.
 * Narrated so users understand what's happening to their machine.
 */
export async function goLive(): Promise<void> {
  const { mailProvider } = await import("../email/provider.js");
  const cfg = loadConfig();

  if (getSecret("gmail-tokens")) {
    p.log.success("Step 1/2 — Gmail: already authorized, skipping.");
  } else {
    p.log.step("Step 1/2 — Gmail authorization");
    p.log.info(
      "InboxMinder talks to Gmail through your own Google OAuth app — no middleman ever sees your mail. Opening a one-time browser consent…",
    );
    await mailProvider(cfg).setup();
    p.log.success("Gmail authorized — tokens stored in your macOS Keychain.");
  }

  p.log.step("Step 2/2 — Installing the background agent");
  p.log.info(
    "Registering with launchd, macOS's service manager: the gatekeeper runs invisibly with no terminal, survives reboots, and reads + triages every new email locally.",
  );
  const cliPath = resolveCliPath();
  if (!existsSync(cliPath)) {
    const root = dirname(dirname(cliPath));
    if (existsSync(join(root, "src", "cli.ts"))) {
      p.log.message("Building dist for the background agent…");
      execFileSync("pnpm", ["build"], { cwd: root, stdio: "inherit" });
    }
  }
  await installAgent();
  const { notify } = await import("../notify.js");
  notify("InboxMinder", "Gatekeeper installed — minding your inbox");
  p.log.success(
    `InboxMinder is live. Every new email gets read locally and triaged: category labels appear in Gmail (InboxMinder/Newsletter, /Cold Outreach, …), urgent mail gets InboxMinder/Important, and nothing is ever sent or deleted. Your data stays on this Mac (${DATA_DIR}).`,
  );
  p.log.message(
    `Check on it: inboxminder agent status  |  tail -f ${DATA_DIR}/logs/watch.log  |  pause: inboxminder agent pause`,
  );
}
