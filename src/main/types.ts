export interface Account {
  id: string
  name: string
  configDir: string
  isActive: boolean
}

export interface UsageData {
  accountId: string
  currentSession: number // 0-100 (%)
  sessionResetTime: string // "2am (Asia/Seoul)"
  weeklyUsage: number // 0-100 (%)
  weeklyResetTime: string // "Feb 10 at 8pm (Asia/Seoul)"
  lastUpdated: Date
  error?: string
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
