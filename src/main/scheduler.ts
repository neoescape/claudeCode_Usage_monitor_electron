import { BrowserWindow } from 'electron'
import { fetchUsage } from './claude-cli'
import { loadSettings, setUsageData, getUsageCache } from './store'
import { UsageData } from './types'

let intervalId: NodeJS.Timeout | null = null
let mainWindow: BrowserWindow | null = null
let notificationCallback: ((accountName: string, usage: number, type: 'session' | 'weekly') => void) | null = null

// Track notified thresholds (prevent duplicate notifications)
const notifiedThresholds = new Map<string, { session: number[]; weekly: number[] }>()

// Track retry counts per account
const retryCounts = new Map<string, number>()
const MAX_RETRIES = 3

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
      notificationCallback(accountName, threshold, 'session')
      record.session.push(threshold)
    }
  }

  // Check weekly thresholds
  for (const threshold of ALERT_THRESHOLDS) {
    if (weeklyUsage >= threshold && !record.weekly.includes(threshold)) {
      notificationCallback(accountName, threshold, 'weekly')
      record.weekly.push(threshold)
    }
  }
}

async function fetchAccountUsage(accountId: string, accountName: string, configDir: string): Promise<UsageData> {
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

    // Reset retry count on success
    retryCounts.set(accountId, 0)

    // Check for alerts
    checkAndNotify(accountId, accountName, data.currentSession, data.weeklyUsage)

    return data
  } catch (error) {
    const currentRetry = retryCounts.get(accountId) || 0
    retryCounts.set(accountId, currentRetry + 1)

    // Show "Connecting..." instead of error during retries
    const isRetrying = currentRetry < MAX_RETRIES
    const errorMessage = isRetrying ? undefined : (error instanceof Error ? error.message : 'Connection failed')

    const data: UsageData = {
      accountId,
      currentSession: 0,
      sessionResetTime: '',
      weeklyUsage: 0,
      weeklyResetTime: '',
      lastUpdated: new Date(),
      error: errorMessage
    }
    setUsageData(accountId, data)
    return data
  }
}

export async function fetchAllUsage(): Promise<Map<string, UsageData>> {
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
  if (mainWindow && !mainWindow.isDestroyed()) {
    const usageArray = Array.from(results.entries()).map(([id, data]) => ({
      id,
      ...data
    }))
    mainWindow.webContents.send('usage-updated', usageArray)
  }

  return results
}

export function startScheduler(): void {
  if (intervalId) {
    clearInterval(intervalId)
  }

  const settings = loadSettings()

  // Don't start scheduler if no accounts
  if (settings.accounts.length === 0) {
    return
  }

  // Execute first fetch immediately
  fetchAllUsage()

  // Periodic execution
  intervalId = setInterval(() => {
    fetchAllUsage()
  }, settings.refreshInterval)
}

export function stopScheduler(): void {
  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
  }
}

export function restartScheduler(): void {
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
