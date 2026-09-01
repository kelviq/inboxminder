import pino from "pino";

// The Vercel AI SDK's APICallError (and similar errors from other libs) carry
// the full request/response bodies as enumerable own properties —
// system prompts, email text, retrieved knowledge chunks. Pino's default
// error serializer spreads all enumerable properties into the log record, so
// without this custom serializer every routine API failure would write
// private email content to disk. Only emit fields known to be safe.
export const safeError = (err: unknown) => {
  if (!(err instanceof Error)) return { message: String(err) };
  return {
    type: err.name,
    message: err.message,
    stack: err.stack,
    // status codes help debugging without carrying request/response content
    statusCode: (err as { statusCode?: number }).statusCode,
    status: (err as { status?: number }).status,
  };
};

export const log = pino({
  level: process.env.LOG_LEVEL ?? "info",
  serializers: { err: safeError, error: safeError },
  transport: process.stdout.isTTY
    ? {
        target: "pino-pretty",
        options: { singleLine: true, translateTime: "HH:MM:ss" },
      }
    : undefined,
});
