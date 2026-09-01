import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

// Set overrides AND the profile BEFORE the dynamic import — the derived
// constants are computed at module load (same pattern as
// config-dir-override.test.ts, which pins the profile-less base case).
const configBase = mkdtempSync(join(tmpdir(), "inboxminder-test-cfg-"));
const dataBase = mkdtempSync(join(tmpdir(), "inboxminder-test-data-"));
process.env.INBOXMINDER_CONFIG_DIR = configBase;
process.env.INBOXMINDER_DATA_DIR = dataBase;
process.env.INBOXMINDER_PROFILE = "acme";

let load: typeof import("../src/config/load.js");

beforeAll(async () => {
  load = await import("../src/config/load.js");
});

describe("profile path derivation", () => {
  it("nests both dirs under <base>/profiles/<name>, composing with overrides", () => {
    expect(load.BASE_DATA_DIR).toBe(dataBase);
    expect(load.BASE_CONFIG_DIR).toBe(configBase);
    expect(load.DATA_DIR).toBe(join(dataBase, "profiles", "acme"));
    expect(load.CONFIG_DIR).toBe(join(configBase, "profiles", "acme"));
    expect(load.CONFIG_PATH).toBe(
      join(configBase, "profiles", "acme", "config.toml"),
    );
  });

  it("ensureDirs creates the profile tree", () => {
    load.ensureDirs();
    load.saveConfigToml('[llm]\nprovider = "anthropic"\n');
    expect(load.loadConfig().llm.provider).toBe("anthropic");
  });
});
