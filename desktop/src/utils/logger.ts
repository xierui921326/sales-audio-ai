import { invoke } from '@tauri-apps/api/core';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const PREFIX = '[sales-audio-ai]';
const FRONTEND_ROOT = 'desktop/src/';
const DEFAULT_FRONTEND_LOCATION = 'desktop/src';

function formatTimestamp(date = new Date()): string {
  const pad = (value: number, size = 2) => String(value).padStart(size, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

function normalizeCallerLocation(stackLine: string): string | undefined {
  const match = stackLine.match(/(https?:\/\/[^)\s]+|\/[^)\s]+):(\d+):(\d+)/);
  if (!match) {
    return undefined;
  }

  const source = match[1];
  const line = match[2];
  const column = match[3];
  const rootIndex = source.indexOf(FRONTEND_ROOT);
  if (rootIndex >= 0) {
    return `${source.slice(rootIndex)}:${line}:${column}`;
  }

  const url = new URL(source);
  const pathname = decodeURIComponent(url.pathname);
  const pathIndex = pathname.indexOf('/src/');
  if (pathIndex >= 0) {
    return `desktop${pathname.slice(pathIndex)}:${line}:${column}`;
  }

  return undefined;
}

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
      !line.includes('normalizeCallerLocation') &&
      !line.includes('writeToLocalFile') &&
      !line.includes('print(') &&
      !line.includes('print@') &&
      !line.includes('log (') &&
      !line.includes('log@') &&
      !line.includes('logger.ts')
  );

  return callerLine ? normalizeCallerLocation(callerLine) : undefined;
}

function print(level: LogLevel, scope: string, location: string, message: string, payload?: unknown) {
  const timestamp = formatTimestamp();
  const line = `${PREFIX}[${timestamp}][${level}][frontend:${scope}][${location}] ${message}`;

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

function writeToLocalFile(level: LogLevel, scope: string, location: string, message: string, payload?: unknown) {
  invoke('write_log', {
    input: {
      level,
      scope: `frontend:${scope}`,
      message,
      payload: stringifyPayload(payload),
      location,
    },
  }).catch(error => {
    console.error(`${PREFIX}[logger] 写入本地日志失败`, error);
  });
}

function log(level: LogLevel, scope: string, message: string, payload?: unknown) {
  const location = resolveCallerLocation() ?? DEFAULT_FRONTEND_LOCATION;
  print(level, scope, location, message, payload);
  writeToLocalFile(level, scope, location, message, payload);
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

