import { useState, useEffect, useCallback } from 'react'
import { AccountCard } from './components/AccountCard'
import { AddAccountModal } from './components/AddAccountModal'
import { SettingsPanel } from './components/SettingsPanel'

interface Account {
  id: string
  name: string
  configDir: string
  isActive: boolean
}

interface UsageData {
  accountId: string
  currentSession: number
  sessionResetTime: string
  weeklyUsage: number
  weeklyResetTime: string
  lastUpdated: string
  error?: string
  retrying?: boolean
}

interface AppSettings {
  refreshInterval: number
  alwaysOnTop: boolean
  accounts: Account[]
}

const DEFAULT_SETTINGS: AppSettings = {
  refreshInterval: 3 * 60 * 1000,
  alwaysOnTop: false,
  accounts: []
}

function App(): JSX.Element {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [usageData, setUsageData] = useState<Map<string, UsageData>>(new Map())
  const [alwaysOnTop, setAlwaysOnTop] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loadingAccounts, setLoadingAccounts] = useState<Set<string>>(new Set())

  // Load initial data
  useEffect(() => {
    const loadData = async (): Promise<void> => {
      try {
        // Check if window.api exists
        if (!window.api) {
          throw new Error('API not available. Running outside Electron?')
        }

        const [loadedSettings, onTop, usage] = await Promise.all([
          window.api.getSettings(),
          window.api.getAlwaysOnTop(),
          window.api.getUsageData()
        ])

        setSettings(loadedSettings || DEFAULT_SETTINGS)
        setAlwaysOnTop(onTop)

        const usageMap = new Map<string, UsageData>()
        if (usage && Array.isArray(usage)) {
          usage.forEach((u) => usageMap.set(u.accountId, u))
        }
        setUsageData(usageMap)
        setError(null)
      } catch (err) {
        console.error('Failed to load data:', err)
        setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        setIsLoading(false)
      }
    }

    loadData()
  }, [])

  // Usage update event listener
  useEffect(() => {
    if (!window.api?.onUsageUpdated) return

    const unsubscribe = window.api.onUsageUpdated((data) => {
      const usageMap = new Map<string, UsageData>()
      if (data && Array.isArray(data)) {
        data.forEach((u) => usageMap.set(u.accountId, u))
        // Remove accounts with data from loading state (keep retrying accounts in loading)
        setLoadingAccounts((prev) => {
          const next = new Set(prev)
          data.forEach((u) => {
            if ((u.lastUpdated || u.error) && !u.retrying) {
              next.delete(u.accountId)
            }
          })
          return next
        })
      }
      setUsageData(usageMap)
    })

    return () => unsubscribe()
  }, [])

  const handleToggleOnTop = async (): Promise<void> => {
    if (!window.api) return
    const result = await window.api.toggleAlwaysOnTop()
    setAlwaysOnTop(result)
  }

  const handleAddAccount = useCallback(async (name: string, useExisting: boolean): Promise<void> => {
    if (!window.api) return
    const result = await window.api.addAccount(name, useExisting)
    setSettings(result.settings)

    // Add new account to loading state
    setLoadingAccounts((prev) => new Set(prev).add(result.account.id))

    if (result.needsLogin) {
      alert(`New account added.\n\nPlease login via terminal:\n\nCLAUDE_CONFIG_DIR=${result.account.configDir} claude`)
    }
  }, [])

  const handleRemoveAccount = useCallback(async (accountId: string): Promise<void> => {
    if (!window.api) return
    const confirmed = confirm('Are you sure you want to remove this account?')
    if (confirmed) {
      const result = await window.api.removeAccount(accountId)
      setSettings(result)
      setUsageData((prev) => {
        const next = new Map(prev)
        next.delete(accountId)
        return next
      })
    }
  }, [])

  const handleRefresh = async (): Promise<void> => {
    if (!window.api) return
    setIsRefreshing(true)
    try {
      const data = await window.api.refreshUsage()
      const usageMap = new Map<string, UsageData>()
      if (data && Array.isArray(data)) {
        data.forEach((u) => usageMap.set(u.accountId, u))
      }
      setUsageData(usageMap)
    } finally {
      setIsRefreshing(false)
    }
  }

  const handleIntervalChange = async (interval: number): Promise<void> => {
    if (!window.api) return
    const result = await window.api.setRefreshInterval(interval)
    setSettings(result)
  }

  // Loading
  if (isLoading) {
    return (
      <div className="h-screen bg-gray-900 text-white flex items-center justify-center">
        <div className="text-gray-400">Loading...</div>
      </div>
    )
  }

  // Error
  if (error) {
    return (
      <div className="h-screen bg-gray-900 text-white flex flex-col items-center justify-center p-4">
        <div className="text-red-400 mb-4">Error</div>
        <div className="text-gray-400 text-sm text-center">{error}</div>
      </div>
    )
  }

  return (
    <div className="h-screen bg-gray-900 text-white flex flex-col">
      {/* Title bar */}
      <div className="drag-region h-12 bg-gray-800 flex items-center justify-between px-4 border-b border-gray-700">
        <div className="flex items-center gap-2 pl-16">
          <span className="text-sm font-semibold">Claude Code Usage Monitor</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="no-drag px-2 py-1 rounded text-xs bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors disabled:opacity-50"
            title="Refresh"
          >
            {isRefreshing ? '⏳' : '🔄'}
          </button>
          <button
            onClick={handleToggleOnTop}
            className={`no-drag px-2 py-1 rounded text-xs transition-colors ${
              alwaysOnTop
                ? 'bg-primary-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            📌
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 p-4 overflow-y-auto">
        {settings.accounts.length === 0 ? (
          <div className="text-center text-gray-400 py-8">
            <p className="text-lg mb-2">Please add an account</p>
            <p className="text-sm">Monitor Claude Code account usage</p>
          </div>
        ) : (
          settings.accounts.map((account) => {
            const usage = usageData.get(account.id)
            return (
              <AccountCard
                key={account.id}
                name={account.name}
                currentSession={usage?.currentSession ?? 0}
                sessionResetTime={usage?.sessionResetTime ?? ''}
                weeklyUsage={usage?.weeklyUsage ?? 0}
                weeklyResetTime={usage?.weeklyResetTime ?? ''}
                lastUpdated={usage?.lastUpdated ?? ''}
                error={usage?.error}
                retrying={usage?.retrying}
                isLoading={loadingAccounts.has(account.id)}
                onRemove={() => handleRemoveAccount(account.id)}
              />
            )
          })
        )}

        {/* Add account button */}
        <button
          onClick={() => setIsModalOpen(true)}
          className="w-full py-3 border-2 border-dashed border-gray-600 rounded-lg text-gray-400 hover:border-primary-500 hover:text-primary-400 transition-colors"
        >
          + Add Account
        </button>
      </div>

      {/* Footer */}
      <div className="h-10 bg-gray-800 flex items-center justify-between px-4 text-xs text-gray-500 border-t border-gray-700">
        <SettingsPanel
          refreshInterval={settings.refreshInterval}
          onIntervalChange={handleIntervalChange}
        />
        <span>Accounts: {settings.accounts.length}</span>
      </div>

      {/* Add account modal */}
      <AddAccountModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onAdd={handleAddAccount}
      />
    </div>
  )
}

export default App
