import { BrowserWindow } from 'electron'
import { fetchUsage } from './claude-cli'
import { loadSettings, setUsageData, getUsageCache } from './store'
import { UsageData } from './types'

let schedulerTimeoutId: ReturnType<typeof setTimeout> | null = null
let mainWindow: BrowserWindow | null = null
let notificationCallback:
  | ((accountName: string, usage: number, type: 'session' | 'weekly') => void)
  | null = null

// Track notified thresholds (prevent duplicate notifications)
const notifiedThresholds = new Map<string, { session: number[]; weekly: number[] }>()

// Exponential backoff for retries
const INITIAL_BACKOFF_MS = 5_000
const MAX_BACKOFF_MS = 180_000 // 3 min
const backoffState = new Map<string, number>()
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

  if (!notifiedThresholds.has(accountId)) {
    notifiedThresholds.set(accountId, { session: [], weekly: [] })
  }

  const record = notifiedThresholds.get(accountId)!

  for (const threshold of ALERT_THRESHOLDS) {
    if (currentSession >= threshold && !record.session.includes(threshold)) {
      notificationCallback(accountName, threshold, 'session')
      record.session.push(threshold)
    }
  }

  for (const threshold of ALERT_THRESHOLDS) {
    if (weeklyUsage >= threshold && !record.weekly.includes(threshold)) {
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
  for (const [, timer] of retryTimers) {
    clearTimeout(timer)
  }
  retryTimers.clear()
  backoffState.clear()
}

function sendUsageUpdate(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
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
      checkAndNotify(accountId, accountName, data.currentSession, data.weeklyUsage)
      sendUsageUpdate()
    } catch (err) {
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
    cancelRetryTimer(accountId)

    checkAndNotify(accountId, accountName, data.currentSession, data.weeklyUsage)

    return data
  } catch (err) {
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

    scheduleRetry(accountId, accountName, configDir)

    return data
  }
}

export async function fetchAllUsage(): Promise<Map<string, UsageData>> {
  if (isFetching) {
    return getUsageCache()
  }
  isFetching = true

  try {
    const settings = loadSettings()
    const results = new Map<string, UsageData>()

    for (const account of settings.accounts) {
      if (account.isActive) {
        const data = await fetchAccountUsage(account.id, account.name, account.configDir)
        results.set(account.id, data)
      }
    }

    sendUsageUpdate()

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

  if (settings.accounts.length === 0) {
    return
  }

  fetchAllUsage().then(() => {
    scheduleNextFetch()
  })
}

export function stopScheduler(): void {
  if (schedulerTimeoutId) {
    clearTimeout(schedulerTimeoutId)
    schedulerTimeoutId = null
  }
  cancelAllRetryTimers()
}

export function restartScheduler(): void {
  stopScheduler()
  startScheduler()
}

export function getLastUsageData(): UsageData[] {
  return Array.from(getUsageCache().values())
}

export function resetNotificationRecord(accountId: string): void {
  notifiedThresholds.delete(accountId)
}

/** Called on system resume / screen unlock — resets all backoff and fetches immediately */
export function handleSystemResume(): void {
  isFetching = false
  cancelAllRetryTimers()
  stopScheduler()
  startScheduler()
}

/** Called on manual refresh — resets retry states so UI updates cleanly */
export function resetRetryStates(): void {
  cancelAllRetryTimers()
}
