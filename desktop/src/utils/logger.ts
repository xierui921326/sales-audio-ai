import { invoke } from '@tauri-apps/api/core';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const PREFIX = '[sales-audio-ai]';
const DEFAULT_FRONTEND_LOCATION = 'desktop/src';
const LEVEL_ORDER: LogLevel[] = ['debug', 'info', 'warn', 'error'];
const ENV = (import.meta as unknown as { env?: { DEV?: boolean; VITE_LOG_LEVEL?: string } }).env;
const DEFAULT_LEVEL: LogLevel = ENV?.DEV ? 'debug' : 'info';
const ENV_LEVEL = ENV?.VITE_LOG_LEVEL;
const MIN_LEVEL: LogLevel = ENV_LEVEL === 'debug' || ENV_LEVEL === 'info' || ENV_LEVEL === 'warn' || ENV_LEVEL === 'error' ? (ENV_LEVEL as LogLevel) : DEFAULT_LEVEL;

// 根据环境或显式配置控制前端日志最低输出级别。
function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER.indexOf(level) >= LEVEL_ORDER.indexOf(MIN_LEVEL);
}

function formatTimestamp(date = new Date()): string {
  const pad = (value: number, size = 2) => String(value).padStart(size, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
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
  if (!shouldLog(level)) {
    return;
  }
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
  if (!shouldLog(level)) {
    return;
  }
  const location = DEFAULT_FRONTEND_LOCATION;
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

