import { Entry } from "@napi-rs/keyring";
import { profileName } from "../config/profile.js";

const BASE_SERVICE = "inboxminder";

/*
 * Profiles: each profile gets its own Keychain service
 * ("inboxminder.<name>"); the default profile keeps "inboxminder" untouched.
 *
 * SHARED_SECRETS is the ONLY set of names whose reads fall back to the
 * base service when the profile's own service misses: the GCP OAuth
 * client (an app credential — one client serves any number of accounts,
 * it is not an identity) and the LLM/embedding API keys. Everything else
 * — gmail-tokens, notion, linear, slack, mcp-* — is STRICTLY
 * per-profile: a fallback there would silently bind a new product to the
 * wrong mailbox or workspace, the exact contamination profiles exist to
 * prevent. Writes ALWAYS go to the current profile's service, so a
 * profile can override a shared key by setting its own.
 */
export const SHARED_SECRETS: ReadonlySet<string> = new Set([
  "gmail-client-id",
  "gmail-client-secret",
  "anthropic",
  "openai",
  "google",
  "custom",
]);

function service(): string {
  const profile = profileName();
  return profile ? `${BASE_SERVICE}.${profile}` : BASE_SERVICE;
}

export function setSecret(name: string, value: string): void {
  new Entry(service(), name).setPassword(value);
}

function read(svc: string, name: string): string | null {
  try {
    return new Entry(svc, name).getPassword();
  } catch {
    return null;
  }
}

export function getSecret(name: string): string | null {
  const svc = service();
  const own = read(svc, name);
  if (own !== null) return own;
  if (svc !== BASE_SERVICE && SHARED_SECRETS.has(name)) {
    return read(BASE_SERVICE, name);
  }
  return null;
}

export function requireSecret(name: string): string {
  const v = getSecret(name);
  if (!v)
    throw new Error(
      `Missing secret "${name}". Run: inboxminder set-key ${name}`,
    );
  return v;
}
