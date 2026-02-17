import { BrowserWindow } from 'electron'
import { fetchUsage } from './claude-cli'
import { loadSettings, setUsageData, getUsageCache } from './store'
import { UsageData } from './types'
import { log } from './logger'

let schedulerTimeoutId: ReturnType<typeof setTimeout> | null = null
let mainWindow: BrowserWindow | null = null
let notificationCallback:
  | ((accountName: string, usage: number, type: 'session' | 'weekly') => void)
  | null = null

// Track notified thresholds (prevent duplicate notifications)
const notifiedThresholds = new Map<string, { session: number[]; weekly: number[] }>()

// Exponential backoff for retries
const INITIAL_BACKOFF_MS = 5_000
const MAX_BACKOFF_MS = 180_000 // 3 min — matches default refresh interval to avoid hammering during systemic failures
const backoffState = new Map<string, number>() // accountId -> current backoff ms
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>()

// Duplicate fetch guard
let isFetching = false

const ALERT_THRESHOLDS = [80, 90, 100]

export function setMainWindow(window: BrowserWindow): void {
  mainWindow = window
}

export function setNotificationCallback(
  callback: (accountName: string, usage: number, type: 'session' | 'weekly') => void
): void {
  notificationCallback = callback
}

function checkAndNotify(
  accountId: string,
  accountName: string,
  currentSession: number,
  weeklyUsage: number
): void {
  if (!notificationCallback) return

  // Initialize notification record for account
  if (!notifiedThresholds.has(accountId)) {
    notifiedThresholds.set(accountId, { session: [], weekly: [] })
  }

  const record = notifiedThresholds.get(accountId)!

  // Check session thresholds
  for (const threshold of ALERT_THRESHOLDS) {
    if (currentSession >= threshold && !record.session.includes(threshold)) {
      log.info('scheduler', 'Alert threshold reached', {
        accountId,
        type: 'session',
        threshold,
        current: currentSession
      })
      notificationCallback(accountName, threshold, 'session')
      record.session.push(threshold)
    }
  }

  // Check weekly thresholds
  for (const threshold of ALERT_THRESHOLDS) {
    if (weeklyUsage >= threshold && !record.weekly.includes(threshold)) {
      log.info('scheduler', 'Alert threshold reached', {
        accountId,
        type: 'weekly',
        threshold,
        current: weeklyUsage
      })
      notificationCallback(accountName, threshold, 'weekly')
      record.weekly.push(threshold)
    }
  }
}

function getNextBackoff(accountId: string): number {
  const current = backoffState.get(accountId) ?? INITIAL_BACKOFF_MS
  const next = Math.min(current * 2, MAX_BACKOFF_MS)
  backoffState.set(accountId, next)
  return current
}

function resetBackoff(accountId: string): void {
  backoffState.delete(accountId)
}

function cancelRetryTimer(accountId: string): void {
  const timer = retryTimers.get(accountId)
  if (timer) {
    clearTimeout(timer)
    retryTimers.delete(accountId)
  }
}

function cancelAllRetryTimers(): void {
  for (const [id, timer] of retryTimers) {
    clearTimeout(timer)
    retryTimers.delete(id)
  }
  backoffState.clear()
}

function sendUsageUpdate(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    log.warn('scheduler', 'sendUsageUpdate skipped — window invalid')
    return
  }
  const cache = getUsageCache()
  const usageArray = Array.from(cache.entries()).map(([id, data]) => ({
    id,
    ...data
  }))
  mainWindow.webContents.send('usage-updated', usageArray)
}

function scheduleRetry(accountId: string, accountName: string, configDir: string): void {
  cancelRetryTimer(accountId)
  const delay = getNextBackoff(accountId)
  log.info('scheduler', 'Scheduling retry', { accountId, delay })

  const timer = setTimeout(async () => {
    retryTimers.delete(accountId)
    try {
      const usage = await fetchUsage(configDir)
      const data: UsageData = {
        accountId,
        currentSession: usage.currentSession ?? 0,
        sessionResetTime: usage.sessionResetTime ?? '',
        weeklyUsage: usage.weeklyUsage ?? 0,
        weeklyResetTime: usage.weeklyResetTime ?? '',
        lastUpdated: new Date()
      }
      setUsageData(accountId, data)
      resetBackoff(accountId)
      log.info('scheduler', 'Retry succeeded', { accountId })
      checkAndNotify(accountId, accountName, data.currentSession, data.weeklyUsage)
      sendUsageUpdate()
    } catch (err) {
      log.warn('scheduler', 'Retry failed', {
        accountId,
        error: err instanceof Error ? err.message : String(err)
      })
      // Still failing — set retrying state preserving cached data
      const cached = getUsageCache().get(accountId)
      const data: UsageData = {
        accountId,
        currentSession: cached?.currentSession ?? 0,
        sessionResetTime: cached?.sessionResetTime ?? '',
        weeklyUsage: cached?.weeklyUsage ?? 0,
        weeklyResetTime: cached?.weeklyResetTime ?? '',
        lastUpdated: cached?.lastUpdated ?? new Date(),
        retrying: true
      }
      // Keep lastUpdated from cache if we had previous success
      if (!cached?.lastUpdated || cached?.retrying) {
        data.lastUpdated = undefined as unknown as Date
      }
      setUsageData(accountId, data)
      sendUsageUpdate()
      scheduleRetry(accountId, accountName, configDir)
    }
  }, delay)

  retryTimers.set(accountId, timer)
}

async function fetchAccountUsage(
  accountId: string,
  accountName: string,
  configDir: string
): Promise<UsageData> {
  log.info('scheduler', 'fetchAccountUsage started', { accountId, accountName })
  try {
    const usage = await fetchUsage(configDir)
    const data: UsageData = {
      accountId,
      currentSession: usage.currentSession ?? 0,
      sessionResetTime: usage.sessionResetTime ?? '',
      weeklyUsage: usage.weeklyUsage ?? 0,
      weeklyResetTime: usage.weeklyResetTime ?? '',
      lastUpdated: new Date()
    }
    setUsageData(accountId, data)

    // Reset backoff on success + cancel any pending retry
    resetBackoff(accountId)
    cancelRetryTimer(accountId)

    // Check for alerts
    checkAndNotify(accountId, accountName, data.currentSession, data.weeklyUsage)

    log.info('scheduler', 'fetchAccountUsage success', {
      accountId,
      session: data.currentSession,
      weekly: data.weeklyUsage
    })
    return data
  } catch (err) {
    log.error('scheduler', 'fetchAccountUsage failed', {
      accountId,
      error: err instanceof Error ? err.message : String(err)
    })
    // Preserve previous cached data if available
    const cached = getUsageCache().get(accountId)
    const data: UsageData = {
      accountId,
      currentSession: cached?.currentSession ?? 0,
      sessionResetTime: cached?.sessionResetTime ?? '',
      weeklyUsage: cached?.weeklyUsage ?? 0,
      weeklyResetTime: cached?.weeklyResetTime ?? '',
      lastUpdated: cached?.lastUpdated ?? (undefined as unknown as Date),
      retrying: true
    }
    setUsageData(accountId, data)

    // Schedule individual retry for this account
    scheduleRetry(accountId, accountName, configDir)

    return data
  }
}

export async function fetchAllUsage(): Promise<Map<string, UsageData>> {
  // Duplicate execution guard
  if (isFetching) {
    log.warn('scheduler', 'fetchAllUsage skipped — isFetching is true')
    return getUsageCache()
  }
  isFetching = true
  log.info('scheduler', 'fetchAllUsage started')

  try {
    const settings = loadSettings()
    const results = new Map<string, UsageData>()

    // Execute sequentially (prevent multiple claude instances running simultaneously)
    for (const account of settings.accounts) {
      if (account.isActive) {
        const data = await fetchAccountUsage(account.id, account.name, account.configDir)
        results.set(account.id, data)
      }
    }

    // Send update to renderer
    sendUsageUpdate()

    log.info('scheduler', 'fetchAllUsage completed', { accountCount: results.size })
    return results
  } finally {
    isFetching = false
  }
}

function scheduleNextFetch(): void {
  const settings = loadSettings()
  schedulerTimeoutId = setTimeout(async () => {
    await fetchAllUsage()
    scheduleNextFetch()
  }, settings.refreshInterval)
}

export function startScheduler(): void {
  stopScheduler()

  const settings = loadSettings()

  // Don't start scheduler if no accounts
  if (settings.accounts.length === 0) {
    log.info('scheduler', 'startScheduler skipped — no accounts')
    return
  }

  log.info('scheduler', 'startScheduler', {
    accountCount: settings.accounts.length,
    refreshInterval: settings.refreshInterval
  })

  // Execute first fetch immediately, then chain via setTimeout
  fetchAllUsage().then(() => {
    scheduleNextFetch()
  })
}

export function stopScheduler(): void {
  if (schedulerTimeoutId) {
    clearTimeout(schedulerTimeoutId)
    schedulerTimeoutId = null
    log.info('scheduler', 'stopScheduler — cleared timeout')
  }
  cancelAllRetryTimers()
}

export function restartScheduler(): void {
  log.info('scheduler', 'restartScheduler')
  stopScheduler()
  startScheduler()
}

export function getLastUsageData(): UsageData[] {
  return Array.from(getUsageCache().values())
}

// Reset notification record (used when reset time has passed)
export function resetNotificationRecord(accountId: string): void {
  notifiedThresholds.delete(accountId)
}

/** Called on system resume / screen unlock — resets all backoff and fetches immediately */
export function handleSystemResume(): void {
  log.info('scheduler', 'handleSystemResume — resetting isFetching and restarting')

  // Fix: clear stuck isFetching flag from interrupted fetch
  isFetching = false

  // Cancel all pending retry timers and reset backoff
  cancelAllRetryTimers()

  // Restart the scheduler (cancels current timeout + immediate fetch + re-chain)
  stopScheduler()
  startScheduler()
}

/** Called on manual refresh — resets retry states so UI updates cleanly */
export function resetRetryStates(): void {
  log.info('scheduler', 'resetRetryStates')
  cancelAllRetryTimers()
}
