import { app, shell, BrowserWindow, ipcMain, Tray, Menu, nativeImage, Notification, powerMonitor, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { randomUUID } from 'crypto'
import { existsSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import {
  loadSettings,
  saveSettings,
  addAccount,
  removeAccount,
  ensureDataDir
} from './store'
import {
  setMainWindow,
  startScheduler,
  stopScheduler,
  restartScheduler,
  fetchAllUsage,
  getLastUsageData,
  setNotificationCallback,
  handleSystemResume,
  resetRetryStates,
  setPtyExhaustedCallback
} from './scheduler'
import { Account, AppSettings } from './types'
import { log } from './logger'

// Crash logging — capture before process dies
process.on('uncaughtException', (err) => {
  log.error('app', 'UNCAUGHT EXCEPTION', { message: err.message, stack: err.stack })
})
process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? { message: reason.message, stack: reason.stack } : { value: String(reason) }
  log.error('app', 'UNHANDLED REJECTION', msg)
})

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null

function createTray(): void {
  // Create simple icon (16x16 white circle)
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAsTAAALEwEAmpwYAAAA4klEQVQ4jZ2TMQ6CQBBF3yAewB7j3sBbWFhYeARjYqOxsLPSgoOINFRKYUHlDWgJJ7CxYWO/BFiCIPjLzf7Mn9mZXUNVW8B6HYtPYk5IeAk0gGsgDjzPgCFwBIqBJHtVLQMlYBt4D3i3RMJL4AK8ACkgXmYBqOod6ACjZQHfhB+4Ah7AHqiISBU4r/TgE+qqagaYAjVgFngI/m+7OhgDJWAoIrtlIlwZLAE1YCIih2XBMn8FnIAGMBaRzl/iMn8NxIAxcF0ZLPPLFoZAG+iuDL7J/MFHAXF8Am0ROQS6wDz5BZ8rwKsqQXzEAAAAAElFTkSuQmCC'
  )

  tray = new Tray(icon)
  tray.setToolTip('Claude Code Usage Monitor')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open',
      click: (): void => {
        mainWindow?.show()
      }
    },
    {
      label: 'Refresh',
      click: (): void => {
        fetchAllUsage()
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: (): void => {
        app.quit()
      }
    }
  ])

  tray.setContextMenu(contextMenu)

  tray.on('click', () => {
    mainWindow?.show()
  })
}

function showNotification(title: string, body: string): void {
  if (Notification.isSupported()) {
    new Notification({
      title,
      body,
      silent: false
    }).show()
  }
}

function createWindow(): void {
  const settings = loadSettings()
  const isMac = process.platform === 'darwin'

  mainWindow = new BrowserWindow({
    width: 400,
    height: 500,
    minWidth: 350,
    minHeight: 400,
    show: false,
    autoHideMenuBar: true,
    ...(isMac
      ? {
          titleBarStyle: 'hiddenInset',
          trafficLightPosition: { x: 15, y: 15 }
        }
      : {
          frame: true
        }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false
    }
  })

  // Apply saved always on top setting
  if (settings.alwaysOnTop) {
    mainWindow.setAlwaysOnTop(true, 'floating')
  }

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    // Open DevTools in development mode
    if (is.dev) {
      mainWindow?.webContents.openDevTools({ mode: 'detach' })
    }
  })

  // Minimize to tray on close (macOS)
  mainWindow.on('close', (event) => {
    if (process.platform === 'darwin' && !app.isQuitting) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Pass window reference to scheduler
  setMainWindow(mainWindow)
}

// Register IPC handlers
function registerIpcHandlers(): void {
  // Toggle always on top
  ipcMain.handle('toggle-always-on-top', () => {
    if (mainWindow) {
      const isOnTop = mainWindow.isAlwaysOnTop()
      // On macOS, level must be set to 'floating' to work properly
      mainWindow.setAlwaysOnTop(!isOnTop, 'floating')
      const settings = loadSettings()
      settings.alwaysOnTop = !isOnTop
      saveSettings(settings)
      return !isOnTop
    }
    return false
  })

  // Get always on top state
  ipcMain.handle('get-always-on-top', () => {
    return mainWindow?.isAlwaysOnTop() ?? false
  })

  // Get settings
  ipcMain.handle('get-settings', (): AppSettings => {
    return loadSettings()
  })

  // Save settings
  ipcMain.handle('save-settings', (_, settings: Partial<AppSettings>) => {
    const current = loadSettings()
    const updated = { ...current, ...settings }
    saveSettings(updated)
    restartScheduler()
    return updated
  })

  // Add account
  ipcMain.handle('add-account', (_, name: string, useExisting: boolean) => {
    log.info('app', 'IPC: add-account', { name, useExisting })
    const id = randomUUID()
    let configDir: string

    if (useExisting) {
      // Use existing ~/.claude
      configDir = join(homedir(), '.claude')
    } else {
      // Create new directory
      configDir = join(homedir(), `.claude-${id.slice(0, 8)}`)
      if (!existsSync(configDir)) {
        mkdirSync(configDir, { recursive: true })
      }
    }

    const account: Account = {
      id,
      name,
      configDir,
      isActive: true
    }

    const settings = addAccount(account)
    restartScheduler()
    return { account, settings, needsLogin: !useExisting }
  })

  // Remove account
  ipcMain.handle('remove-account', (_, accountId: string) => {
    log.info('app', 'IPC: remove-account', { accountId })
    const settings = removeAccount(accountId)
    restartScheduler()
    return settings
  })

  // Manual refresh
  ipcMain.handle('refresh-usage', async () => {
    log.info('app', 'IPC: refresh-usage')
    resetRetryStates()
    const results = await fetchAllUsage()
    return Array.from(results.entries()).map(([id, data]) => ({ id, ...data }))
  })

  // Get last usage data
  ipcMain.handle('get-usage-data', () => {
    return getLastUsageData()
  })

  // Set refresh interval
  ipcMain.handle('set-refresh-interval', (_, interval: number) => {
    const settings = loadSettings()
    settings.refreshInterval = interval
    saveSettings(settings)
    restartScheduler()
    return settings
  })
}

// App quit flag
declare module 'electron' {
  interface App {
    isQuitting?: boolean
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.claude-code-usage-monitor')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Initialize data directory
  ensureDataDir()

  log.info('app', 'App ready', {
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron
  })

  // Register IPC handlers
  registerIpcHandlers()

  // Set notification callback
  setNotificationCallback((accountName, usage, type) => {
    if (type === 'session') {
      showNotification(
        `${accountName} - Session Usage Alert`,
        `Current session usage has reached ${usage}%.`
      )
    } else {
      showNotification(
        `${accountName} - Weekly Usage Alert`,
        `Weekly usage has reached ${usage}%.`
      )
    }
  })

  // Set PTY exhaustion callback — prompt user to restart
  let restartPending = false
  setPtyExhaustedCallback(() => {
    if (restartPending) return
    restartPending = true
    log.error('app', 'PTY exhaustion detected — prompting user to restart')
    stopScheduler()
    dialog
      .showMessageBox({
        type: 'warning',
        title: 'System PTY Exhausted',
        message: '시스템 PTY 디바이스가 고갈되어 데이터를 수집할 수 없습니다.',
        detail: is.dev
          ? '앱을 종료합니다. npm run dev로 다시 시작하세요.'
          : '앱을 재시작하면 복구될 수 있습니다. 재시작하시겠습니까?',
        buttons: [is.dev ? '종료' : '재시작', '나중에'],
        defaultId: 0
      })
      .then(({ response }) => {
        if (response === 0) {
          log.info('app', 'User requested restart due to PTY exhaustion')
          if (is.dev) {
            // Dev mode: app.relaunch() won't restart Vite dev server, so just exit
            log.info('app', 'Dev mode — exiting (user must restart manually with npm run dev)')
            app.exit(0)
          } else {
            app.relaunch()
            app.exit(0)
          }
        } else {
          log.info('app', 'User deferred restart')
          restartPending = false
          startScheduler()
        }
      })
  })

  // Create tray
  createTray()

  // Create window
  createWindow()

  // Start scheduler
  startScheduler()

  // Refresh immediately on system resume / screen unlock
  powerMonitor.on('resume', () => {
    log.info('app', 'powerMonitor: resume')
    handleSystemResume()
  })
  powerMonitor.on('unlock-screen', () => {
    log.info('app', 'powerMonitor: unlock-screen')
    handleSystemResume()
  })

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    } else {
      mainWindow?.show()
    }
  })
})

app.on('before-quit', () => {
  log.info('app', 'before-quit')
  app.isQuitting = true
})

app.on('window-all-closed', () => {
  log.info('app', 'window-all-closed')
  stopScheduler()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
