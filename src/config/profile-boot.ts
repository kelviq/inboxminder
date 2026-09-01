import { normalizeProfileArgv } from "./profile.js";

/*
 * Side-effect module — MUST stay cli.ts's first import. ESM evaluates
 * imports in order, so this runs before any other module computes
 * profile-dependent constants (config/load.ts's DATA_DIR/CONFIG_DIR).
 */
normalizeProfileArgv();
