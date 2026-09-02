/**
 * Structured logger — silences debug/info in production.
 */

type LogFn = (...args: unknown[]) => void;

export interface Logger {
  debug: LogFn;
  info: LogFn;
  warn: LogFn;
  error: LogFn;
}

const isProd = typeof process !== "undefined" && process.env.NODE_ENV === "production";

function noop() {}

export function createLogger(tag: string): Logger {
  const prefix = `[${tag}]`;
  if (isProd) {
    return {
      debug: noop,
      info: noop,
      warn: console.warn.bind(console, prefix),
      error: console.error.bind(console, prefix),
    };
  }
  return {
    debug: console.debug.bind(console, prefix),
    info: console.info.bind(console, prefix),
    warn: console.warn.bind(console, prefix),
    error: console.error.bind(console, prefix),
  };
}
