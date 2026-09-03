/*
 * Profiles: one fully isolated inboxminder instance per
 * mailbox/product. A profile is a NAME that selects the data dir, config
 * dir, Keychain service, and launchd label. The default profile is the
 * ABSENCE of a name — every derivation must be byte-identical to
 * pre-profile inboxminder when no profile is set (the live daemon depends on
 * that stability).
 *
 * Resolution order: `--profile <name>` argv (normalized into the env by
 * cli.ts's first import, see profile-boot.ts) → INBOXMINDER_PROFILE env (how
 * the launchd plist selects a profile — env, not argv, so every spawned
 * code path inherits it) → default.
 */

/** Lands in paths, launchd labels, and Keychain service names. */
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

/**
 * "default" is reserved: the default profile is the absence of a name, so
 * there is exactly one spelling of the live instance.
 */
export function assertValidProfileName(name: string): void {
  if (name === "default") {
    throw new Error(
      'Profile name "default" is reserved — omit --profile for the default profile.',
    );
  }
  if (!NAME_RE.test(name)) {
    throw new Error(
      `Invalid profile name "${name}"; use 1-32 chars of lowercase letters, digits, and hyphens (must start with a letter or digit).`,
    );
  }
}

/**
 * Scan argv for `--profile <name>` / `--profile=<name>` and normalize it
 * into INBOXMINDER_PROFILE so path/secret/label derivation has one source.
 * Runs as cli.ts's first import (profile-boot.ts) — BEFORE config/load.ts
 * computes its module-level constants. The flag wins over a pre-set env
 * var; an invalid name throws here, loudly, before anything is derived.
 */
export function normalizeProfileArgv(
  argv: readonly string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env,
): void {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    let name: string | undefined;
    if (arg === "--profile") name = argv[i + 1];
    else if (arg.startsWith("--profile="))
      name = arg.slice("--profile=".length);
    else continue;
    if (!name) throw new Error("--profile requires a name");
    assertValidProfileName(name);
    env.INBOXMINDER_PROFILE = name;
    return;
  }
  const fromEnv = env.INBOXMINDER_PROFILE;
  if (fromEnv) assertValidProfileName(fromEnv);
}

/**
 * The active profile, or null for the default. Reads the env on every
 * call (never cached) so tests can toggle profiles without re-importing;
 * validates so a daemon bootstrapped with a mangled plist fails loudly
 * instead of scattering state into a garbage-named directory.
 */
export function profileName(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const name = env.INBOXMINDER_PROFILE;
  if (!name) return null;
  assertValidProfileName(name);
  return name;
}
