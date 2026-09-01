import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { profileName } from "./config/profile.js";

/*
 * macOS notifications — zero npm deps, fire-and-forget, never throws.
 * Privacy: callers must pass subjects/status only, never email body content.
 *
 * osascript's `display notification` is attributed to Script Editor and gets
 * silently dropped when that permission is off (or was never granted — common
 * on Sequoia for faceless processes). If the user has terminal-notifier
 * installed (brew install terminal-notifier), prefer it: it's a real app that
 * registers properly in Notification Center.
 */

const TERMINAL_NOTIFIER = [
  "/opt/homebrew/bin/terminal-notifier",
  "/usr/local/bin/terminal-notifier",
].find((p) => existsSync(p));

/**
 * Single line, 120 chars max — guards an osascript argument (composed via
 * JSON.stringify below), pinned by test.
 */
export function sanitizeNotification(message: string): string {
  return message.replace(/\s+/g, " ").trim().slice(0, 120);
}

/**
 * Named profiles get a title suffix and their own notifier group so
 * per-product notifications neither mislabel nor coalesce.
 * Default profile: byte-identical to pre-profile behavior.
 */
export function profiledTitle(
  title: string,
  profile: string | null = profileName(),
): string {
  return profile ? `${title} (${profile})` : title;
}

export function notify(title: string, message: string): void {
  const clean = sanitizeNotification(message);
  const profile = profileName();
  const shown = profiledTitle(title, profile);
  const group = profile ? `inboxminder-${profile}` : "inboxminder";
  try {
    if (TERMINAL_NOTIFIER) {
      execFile(
        TERMINAL_NOTIFIER,
        ["-title", shown, "-message", clean, "-group", group],
        () => {},
      );
    } else {
      execFile(
        "osascript",
        [
          "-e",
          `display notification ${JSON.stringify(clean)} with title ${JSON.stringify(shown)}`,
        ],
        () => {},
      );
    }
  } catch {
    // Notifications are best-effort.
  }
}
