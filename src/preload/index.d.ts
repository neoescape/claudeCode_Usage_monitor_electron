import { ElectronAPI } from '@electron-toolkit/preload'

export interface Account {
  id: string
  name: string
  configDir: string
  isActive: boolean
}

export interface UsageData {
  accountId: string
  currentSession: number
  sessionResetTime: string
  weeklyUsage: number
  weeklyResetTime: string
  lastUpdated: string
  error?: string
}

export interface AppSettings {
  refreshInterval: number
  alwaysOnTop: boolean
  accounts: Account[]
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      // Window control
      toggleAlwaysOnTop: () => Promise<boolean>
      getAlwaysOnTop: () => Promise<boolean>

      // Settings
      getSettings: () => Promise<AppSettings>
      saveSettings: (settings: Partial<AppSettings>) => Promise<AppSettings>
      setRefreshInterval: (interval: number) => Promise<AppSettings>

      // Account management
      addAccount: (name: string, useExisting: boolean) => Promise<{ account: Account; settings: AppSettings; needsLogin: boolean }>
      removeAccount: (accountId: string) => Promise<AppSettings>

      // Usage data
      refreshUsage: () => Promise<UsageData[]>
      getUsageData: () => Promise<UsageData[]>

      // Event listeners
      onUsageUpdated: (callback: (data: UsageData[]) => void) => () => void
    }
  }
}
