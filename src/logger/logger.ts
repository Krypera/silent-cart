type LogLevel = "info" | "warn" | "error";

function log(level: LogLevel, message: string, meta?: Record<string, unknown>) {
  const line = {
    level,
    message,
    ...(meta ?? {}),
    timestamp: new Date().toISOString()
  };

  const method = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  method(JSON.stringify(line));
}

export const logger = {
  info(message: string, meta?: Record<string, unknown>) {
    log("info", message, meta);
  },
  warn(message: string, meta?: Record<string, unknown>) {
    log("warn", message, meta);
  },
  error(message: string, meta?: Record<string, unknown>) {
    log("error", message, meta);
  }
};
