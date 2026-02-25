export interface Account {
  id: string
  name: string
  configDir: string
  isActive: boolean
}

export interface UsageData {
  accountId: string
  currentSession: number // 0-100 (%)
  sessionResetTime: string // ISO 8601: "2026-02-25T19:00:00+00:00"
  weeklyUsage: number // 0-100 (%)
  weeklyResetTime: string // ISO 8601: "2026-03-04T14:00:00+00:00"
  lastUpdated: Date
  error?: string
  retrying?: boolean
  subscriptionType?: string
}

export interface AppSettings {
  refreshInterval: number // milliseconds (1-5 minutes)
  alwaysOnTop: boolean
  accounts: Account[]
}

export const DEFAULT_SETTINGS: AppSettings = {
  refreshInterval: 3 * 60 * 1000, // 3 minutes
  alwaysOnTop: false,
  accounts: []
}
