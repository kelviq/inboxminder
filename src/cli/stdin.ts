/**
 * Read stdin to EOF. The headless setup surface moves secrets
 * and answers this way — NEVER via argv, which is world-readable in `ps`.
 */
export async function readStdinText(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}
