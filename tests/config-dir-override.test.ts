import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

// Set BOTH overrides BEFORE the dynamic import — module-level constants.
const configDir = mkdtempSync(join(tmpdir(), "inboxminder-test-cfg-"));
const dataDir = mkdtempSync(join(tmpdir(), "inboxminder-test-data-"));
process.env.INBOXMINDER_CONFIG_DIR = configDir;
process.env.INBOXMINDER_DATA_DIR = dataDir;

let load: typeof import("../src/config/load.js");

beforeAll(async () => {
  load = await import("../src/config/load.js");
});

describe("INBOXMINDER_CONFIG_DIR override", () => {
  it("redirects CONFIG_DIR/CONFIG_PATH like DATA_DIR — smokes can never touch the live config", () => {
    expect(load.CONFIG_DIR).toBe(configDir);
    expect(load.CONFIG_PATH).toBe(join(configDir, "config.toml"));
    expect(load.DATA_DIR).toBe(dataDir);
  });

  it("saveConfigToml writes inside the override", () => {
    load.saveConfigToml('[llm]\nprovider = "anthropic"\n');
    const cfg = load.loadConfig();
    expect(cfg.llm.provider).toBe("anthropic");
  });
});
