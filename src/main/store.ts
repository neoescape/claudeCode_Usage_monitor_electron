import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { Account, AppSettings, UsageData, DEFAULT_SETTINGS } from './types'

const SETTINGS_FILE = 'settings.json'
const DATA_DIR = join(app.getPath('userData'), 'data')

function getSettingsPath(): string {
  return join(DATA_DIR, SETTINGS_FILE)
}

export function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true })
  }
}

export function loadSettings(): AppSettings {
  ensureDataDir()
  const path = getSettingsPath()

  if (existsSync(path)) {
    try {
      const data = readFileSync(path, 'utf-8')
      return { ...DEFAULT_SETTINGS, ...JSON.parse(data) }
    } catch {
      return DEFAULT_SETTINGS
    }
  }

  return DEFAULT_SETTINGS
}

export function saveSettings(settings: AppSettings): void {
  ensureDataDir()
  const path = getSettingsPath()
  writeFileSync(path, JSON.stringify(settings, null, 2))
}

export function addAccount(account: Account): AppSettings {
  const settings = loadSettings()
  settings.accounts.push(account)
  saveSettings(settings)
  return settings
}

export function removeAccount(accountId: string): AppSettings {
  const settings = loadSettings()
  settings.accounts = settings.accounts.filter((a) => a.id !== accountId)
  saveSettings(settings)
  return settings
}

export function renameAccount(accountId: string, newName: string): AppSettings {
  const settings = loadSettings()
  const account = settings.accounts.find((a) => a.id === accountId)
  if (account) {
    account.name = newName
    saveSettings(settings)
  }
  return settings
}

// Usage data cache (in-memory)
const usageCache = new Map<string, UsageData>()

export function getUsageCache(): Map<string, UsageData> {
  return usageCache
}

export function setUsageData(accountId: string, data: UsageData): void {
  usageCache.set(accountId, data)
}
