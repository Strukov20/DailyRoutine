/**
 * Structured logging abstraction.
 *
 * Screens and services must call `logger.*` instead of `console.*` so:
 *  - log shape (level, scope, message, context) stays consistent;
 *  - a real sink (Sentry, Supabase log table, etc.) can be swapped in later
 *    by changing only this file;
 *  - it is one place to enforce the privacy rule that private-item details
 *    (title, description, notes) never get logged — pass ids, not content.
 */
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

type LogContext = Record<string, unknown>;

interface LogEntry {
  level: LogLevel;
  scope: string;
  message: string;
  context?: LogContext;
  timestamp: string;
}

const consoleByLevel: Record<LogLevel, (...args: unknown[]) => void> = {
  // eslint-disable-next-line no-console
  debug: console.debug,
  // eslint-disable-next-line no-console
  info: console.info,
  warn: console.warn,
  error: console.error,
};

function write(entry: LogEntry): void {
  const sink = consoleByLevel[entry.level];
  sink(`[${entry.scope}] ${entry.message}`, entry.context ?? {});
}

export function createLogger(scope: string) {
  const log = (level: LogLevel, message: string, context?: LogContext) =>
    write({ level, scope, message, context, timestamp: new Date().toISOString() });

  return {
    debug: (message: string, context?: LogContext) => log('debug', message, context),
    info: (message: string, context?: LogContext) => log('info', message, context),
    warn: (message: string, context?: LogContext) => log('warn', message, context),
    error: (message: string, context?: LogContext) => log('error', message, context),
  };
}

export const logger = createLogger('app');
