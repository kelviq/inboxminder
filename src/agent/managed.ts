/**
 * Is this daemon running on the runtime bundled inside InboxMinder.app
 * (plan 053), rather than an npm/manual install? Decides how user-facing
 * notifications phrase their call to action: an app-managed user has
 * never seen a terminal, so telling them to run a command is a dead end;
 * an npm user chose the terminal and gets the exact command.
 *
 * Pure on execPath so tests cover both shapes; the daemon's own execPath
 * is the ground truth (the launchd plist records whichever node ran
 * `agent install`, so a bundled install necessarily runs from inside the
 * app bundle).
 */
export function isAppManaged(execPath: string = process.execPath): boolean {
  return execPath.includes("InboxMinder.app/Contents/Resources/runtime/");
}

/** Re-auth call to action, phrased for the install channel. */
export function reauthActionText(appManaged: boolean = isAppManaged()): string {
  return appManaged
    ? "Gmail authorization expired; open InboxMinder in the menu bar to re-authorize"
    : "Gmail authorization expired; run: inboxminder auth";
}

/** Update-available call to action, phrased for the install channel. */
export function updateActionText(
  version: string,
  appManaged: boolean = isAppManaged(),
): string {
  return appManaged
    ? `Update available (${version}); update from the InboxMinder menu bar app`
    : `Update available (${version}); npm update -g inboxminder`;
}
