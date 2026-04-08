export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const PREFIX = '[sales-audio-ai]';

function print(level: LogLevel, scope: string, message: string, payload?: unknown) {
  const timestamp = new Date().toISOString();
  const line = `${PREFIX}[${timestamp}][${scope}] ${message}`;

  if (level === 'error') {
    console.error(line, payload ?? '');
    return;
  }

  if (level === 'warn') {
    console.warn(line, payload ?? '');
    return;
  }

  if (level === 'info') {
    console.info(line, payload ?? '');
    return;
  }

  console.debug(line, payload ?? '');
}

export const logger = {
  debug(scope: string, message: string, payload?: unknown) {
    print('debug', scope, message, payload);
  },
  info(scope: string, message: string, payload?: unknown) {
    print('info', scope, message, payload);
  },
  warn(scope: string, message: string, payload?: unknown) {
    print('warn', scope, message, payload);
  },
  error(scope: string, message: string, payload?: unknown) {
    print('error', scope, message, payload);
  },
};
