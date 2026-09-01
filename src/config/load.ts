import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse } from "smol-toml";
import { profileName } from "./profile.js";
import { type Config, ConfigSchema } from "./schema.js";

// Both base dirs overridable so tests/smokes can isolate everything in
// temp dirs. A named profile nests under the BASE dir — after the
// override applies — so isolation composes with profiles for free.
export const BASE_CONFIG_DIR =
  process.env.INBOXMINDER_CONFIG_DIR ??
  join(homedir(), ".config", "inboxminder");
export const BASE_DATA_DIR =
  process.env.INBOXMINDER_DATA_DIR ?? join(homedir(), ".inboxminder");
const PROFILE = profileName();
export const CONFIG_DIR = PROFILE
  ? join(BASE_CONFIG_DIR, "profiles", PROFILE)
  : BASE_CONFIG_DIR;
export const DATA_DIR = PROFILE
  ? join(BASE_DATA_DIR, "profiles", PROFILE)
  : BASE_DATA_DIR;
export const CONFIG_PATH = join(CONFIG_DIR, "config.toml");

export function ensureDirs(): void {
  for (const d of [CONFIG_DIR, DATA_DIR, join(DATA_DIR, "logs")]) {
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
  }
}

export function loadConfig(): Config {
  ensureDirs();
  if (!existsSync(CONFIG_PATH)) return ConfigSchema.parse({});
  return ConfigSchema.parse(parse(readFileSync(CONFIG_PATH, "utf8")));
}

export function saveConfigToml(raw: string): void {
  ensureDirs();
  writeFileSync(CONFIG_PATH, raw);
}
