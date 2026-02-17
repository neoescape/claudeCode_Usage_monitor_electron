import { appendFileSync, statSync, renameSync, existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'
export type LogTag = 'app' | 'scheduler' | 'cli'

const LOG_LEVELS: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
}

const MAX_LOG_SIZE = 5 * 1024 * 1024 // 5MB
const MAX_BACKUP_FILES = 3

let logFilePath: string | null = null
let minLevel: LogLevel = 'DEBUG'

function getLogPath(): string {
  if (!logFilePath) {
    logFilePath = join(app.getPath('userData'), 'data', 'app.log')
  }
  return logFilePath
}

function rotate(): void {
  const logPath = getLogPath()
  try {
    const stats = statSync(logPath)
    if (stats.size < MAX_LOG_SIZE) return
  } catch {
    return // File doesn't exist yet
  }

  // Roll existing backups: .3 deleted, .2 → .3, .1 → .2, current → .1
  for (let i = MAX_BACKUP_FILES; i >= 1; i--) {
    const from = i === 1 ? logPath : `${logPath}.${i - 1}`
    const to = `${logPath}.${i}`
    try {
      if (existsSync(from)) {
        renameSync(from, to)
      }
    } catch {
      // Ignore rotation errors
    }
  }
}

function formatMessage(
  level: LogLevel,
  tag: LogTag,
  message: string,
  data?: Record<string, unknown>
): string {
  const timestamp = new Date().toISOString()
  const paddedLevel = level.padEnd(5)
  const dataStr = data ? ' ' + JSON.stringify(data) : ''
  return `${timestamp} [${paddedLevel}] [${tag}] ${message}${dataStr}\n`
}

function writeLog(
  level: LogLevel,
  tag: LogTag,
  message: string,
  data?: Record<string, unknown>
): void {
  if (LOG_LEVELS[level] < LOG_LEVELS[minLevel]) return

  try {
    rotate()
    const line = formatMessage(level, tag, message, data)
    appendFileSync(getLogPath(), line, 'utf-8')
  } catch {
    // Silently ignore write errors — logging must never crash the app
  }
}

export function setLogLevel(level: LogLevel): void {
  minLevel = level
}

export const log = {
  debug(tag: LogTag, message: string, data?: Record<string, unknown>): void {
    writeLog('DEBUG', tag, message, data)
  },
  info(tag: LogTag, message: string, data?: Record<string, unknown>): void {
    writeLog('INFO', tag, message, data)
  },
  warn(tag: LogTag, message: string, data?: Record<string, unknown>): void {
    writeLog('WARN', tag, message, data)
  },
  error(tag: LogTag, message: string, data?: Record<string, unknown>): void {
    writeLog('ERROR', tag, message, data)
  }
}
