import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

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
  retrying?: boolean
}

export interface AppSettings {
  refreshInterval: number
  alwaysOnTop: boolean
  accounts: Account[]
}

const api = {
  // Window control
  toggleAlwaysOnTop: (): Promise<boolean> => ipcRenderer.invoke('toggle-always-on-top'),
  getAlwaysOnTop: (): Promise<boolean> => ipcRenderer.invoke('get-always-on-top'),

  // Settings
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke('save-settings', settings),
  setRefreshInterval: (interval: number): Promise<AppSettings> =>
    ipcRenderer.invoke('set-refresh-interval', interval),

  // Account management
  addAccount: (name: string, useExisting: boolean): Promise<{ account: Account; settings: AppSettings; needsLogin: boolean }> =>
    ipcRenderer.invoke('add-account', name, useExisting),
  removeAccount: (accountId: string): Promise<AppSettings> =>
    ipcRenderer.invoke('remove-account', accountId),

  // Usage data
  refreshUsage: (): Promise<UsageData[]> => ipcRenderer.invoke('refresh-usage'),
  getUsageData: (): Promise<UsageData[]> => ipcRenderer.invoke('get-usage-data'),

  // Event listeners
  onUsageUpdated: (callback: (data: UsageData[]) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, data: UsageData[]): void => callback(data)
    ipcRenderer.on('usage-updated', handler)
    return () => ipcRenderer.removeListener('usage-updated', handler)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.electron = electronAPI
  // @ts-ignore
  window.api = api
}
