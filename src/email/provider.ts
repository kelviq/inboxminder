import type { Config } from "../config/schema.js";
import type { InboundMessage, MailHistory } from "./gmail.js";
import * as gmail from "./gmail.js";

/*
 * Mail provider seam. Everything provider-specific lives behind this
 * surface, selected by cfg.email.provider — the watcher and CLI are
 * provider-blind. Gmail is implementation #1; future providers become a
 * second case in the factory and nothing else changes.
 */

export interface MailProvider {
  pollMailHistory(includeSent: boolean): Promise<MailHistory>;
  getMessage(id: string): Promise<InboundMessage | null>;
  /** One-time credential setup — gmail: the OAuth loopback flow. */
  setup(): Promise<void>;
  /**
   * OPTIONAL capability: project triage state onto visible labels, by
   * NAME. Callers must guard on presence — a future provider may not
   * support labels.
   */
  setThreadLabels?(
    threadId: string,
    addNames: string[],
    removeNames: string[],
  ): Promise<void>;
}

/*
 * Delegation goes through the NAMESPACE import (arrow per method), never
 * captured references — the test suite vi.mocks "./gmail.js" and must keep
 * intercepting these calls transparently.
 */
const gmailProvider: MailProvider = {
  pollMailHistory: (includeSent) => gmail.pollMailHistory(includeSent),
  getMessage: (id) => gmail.getMessage(id),
  setup: () => gmail.authorizeGmail(),
  setThreadLabels: (threadId, addNames, removeNames) =>
    gmail.setThreadLabels(threadId, addNames, removeNames),
};

export function mailProvider(cfg: Config): MailProvider {
  switch (cfg.email.provider) {
    case "gmail":
      return gmailProvider;
    default:
      // Unreachable while the schema pins the literal; pinned by test so
      // widening the enum without a factory case fails loudly.
      throw new Error(
        `Unknown mail provider "${cfg.email.provider satisfies never}"`,
      );
  }
}
