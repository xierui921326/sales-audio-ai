import { invoke } from '@tauri-apps/api/core';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const PREFIX = '[sales-audio-ai]';

function resolveCallerLocation(): string | undefined {
  const stack = new Error().stack;
  if (!stack) {
    return undefined;
  }

  const lines = stack.split('\n').map(line => line.trim());
  const callerLine = lines.find(
    line =>
      line &&
      !line.includes('resolveCallerLocation') &&
      !line.includes('writeToLocalFile') &&
      !line.includes('log (') &&
      !line.includes('log@') &&
      !line.includes('logger.ts')
  );

  return callerLine;
}

function print(level: LogLevel, scope: string, message: string, payload?: unknown) {
  const timestamp = new Date().toISOString();
  const line = `${PREFIX}[${timestamp}][${level}][${scope}] ${message}`;

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

function stringifyPayload(payload?: unknown): string | undefined {
  if (payload == null) {
    return undefined;
  }

  if (typeof payload === 'string') {
    return payload;
  }

  try {
    return JSON.stringify(payload);
  } catch {
    return String(payload);
  }
}

function writeToLocalFile(level: LogLevel, scope: string, message: string, payload?: unknown) {
  invoke('write_log', {
    input: {
      level,
      scope,
      message,
      payload: stringifyPayload(payload),
      location: resolveCallerLocation(),
    },
  }).catch(error => {
    console.error(`${PREFIX}[logger] 写入本地日志失败`, error);
  });
}

function log(level: LogLevel, scope: string, message: string, payload?: unknown) {
  print(level, scope, message, payload);
  writeToLocalFile(level, scope, message, payload);
}

export const logger = {
  debug(scope: string, message: string, payload?: unknown) {
    log('debug', scope, message, payload);
  },
  info(scope: string, message: string, payload?: unknown) {
    log('info', scope, message, payload);
  },
  warn(scope: string, message: string, payload?: unknown) {
    log('warn', scope, message, payload);
  },
  error(scope: string, message: string, payload?: unknown) {
    log('error', scope, message, payload);
  },
};

