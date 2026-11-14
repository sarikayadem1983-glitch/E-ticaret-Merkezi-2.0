import { ConsoleLogger, type LogLevel } from '@nestjs/common';
import { redact } from './redact.js';
import { RequestContext } from './request-context.js';

type Format = 'json' | 'text';

/** JSON in production (or LOG_FORMAT=json), readable text in development. */
export function logFormat(env: NodeJS.ProcessEnv = process.env): Format {
  if (env.LOG_FORMAT === 'json' || env.LOG_FORMAT === 'text')
    return env.LOG_FORMAT;
  return env.NODE_ENV === 'production' ? 'json' : 'text';
}

const toText = (value: unknown): string => {
  if (value instanceof Error)
    return `${value.message}${value.stack ? `\n${value.stack}` : ''}`;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

/**
 * Application logger (OPS-01). Every message, context and stack trace goes through
 * redact() first, so personal data and secrets never reach the log. In JSON mode each line
 * is one object: { time, level, context, msg, requestId, userId, stack? }.
 */
export class AppLogger extends ConsoleLogger {
  constructor(
    private readonly format: Format = logFormat(),
    private readonly write: (line: string, level: LogLevel) => void = (
      line,
      level,
    ) =>
      (level === 'error' || level === 'fatal'
        ? process.stderr
        : process.stdout
      ).write(`${line}\n`),
  ) {
    super();
  }

  private emit(level: LogLevel, message: unknown, params: unknown[]) {
    // Nest passes (message, context) or (message, stack, context) for errors.
    let context: string | undefined;
    let stack: string | undefined;
    const rest = [...params];
    if (rest.length && typeof rest[rest.length - 1] === 'string')
      context = rest.pop() as string;
    if (level === 'error' && rest.length && typeof rest[0] === 'string')
      stack = rest.shift() as string;
    const extra = rest.map(toText).join(' ');
    const msg = redact(toText(message) + (extra ? ` ${extra}` : ''));
    const safeStack = stack ? redact(stack) : undefined;

    if (this.format === 'json') {
      const ctx = RequestContext.get();
      this.write(
        JSON.stringify({
          time: new Date().toISOString(),
          level,
          context,
          msg,
          ...(ctx.requestId ? { requestId: ctx.requestId } : {}),
          ...(ctx.userId ? { userId: ctx.userId } : {}),
          ...(safeStack ? { stack: safeStack } : {}),
        }),
        level,
      );
      return;
    }
    const args: unknown[] =
      level === 'error' && safeStack ? [msg, safeStack] : [msg];
    if (context) args.push(context);
    const target = super[level as 'log'];
    target.apply(this, args as [unknown, ...unknown[]]);
  }

  override log(message: unknown, ...params: unknown[]) {
    this.emit('log', message, params);
  }
  override error(message: unknown, ...params: unknown[]) {
    this.emit('error', message, params);
  }
  override warn(message: unknown, ...params: unknown[]) {
    this.emit('warn', message, params);
  }
  override debug(message: unknown, ...params: unknown[]) {
    this.emit('debug', message, params);
  }
  override verbose(message: unknown, ...params: unknown[]) {
    this.emit('verbose', message, params);
  }
  override fatal(message: unknown, ...params: unknown[]) {
    this.emit('fatal', message, params);
  }
}
