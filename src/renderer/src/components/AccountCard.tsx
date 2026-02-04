import { UsageGauge } from './UsageGauge'

interface AccountCardProps {
  name: string
  currentSession: number
  sessionResetTime: string
  weeklyUsage: number
  weeklyResetTime: string
  lastUpdated: string
  error?: string
  isLoading?: boolean
  onRemove: () => void
}

export function AccountCard({
  name,
  currentSession,
  sessionResetTime,
  weeklyUsage,
  weeklyResetTime,
  lastUpdated,
  error,
  isLoading,
  onRemove
}: AccountCardProps): JSX.Element {
  const formatTime = (dateStr: string): string => {
    if (!dateStr) return '-'
    try {
      const date = new Date(dateStr)
      const now = new Date()
      const diffMs = now.getTime() - date.getTime()
      const diffMin = Math.floor(diffMs / 60000)

      if (diffMin < 1) return 'Just now'
      if (diffMin < 60) return `${diffMin}m ago`
      const diffHour = Math.floor(diffMin / 60)
      if (diffHour < 24) return `${diffHour}h ago`
      return `${Math.floor(diffHour / 24)}d ago`
    } catch {
      return '-'
    }
  }

  // Loading state (no data and no error)
  const showLoading = isLoading || (!lastUpdated && !error)

  return (
    <div className="bg-gray-800 rounded-lg p-4 mb-3">
      <div className="flex justify-between items-center mb-3">
        <div className="flex items-center gap-2">
          <h3 className="text-white font-semibold">{name}</h3>
          {showLoading && (
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 bg-primary-500 rounded-full animate-pulse"></div>
              <span className="text-xs text-primary-400">Connecting</span>
            </div>
          )}
        </div>
        <button
          onClick={onRemove}
          className="text-gray-500 hover:text-red-400 transition-colors text-sm"
          title="Remove account"
        >
          ✕
        </button>
      </div>

      {showLoading ? (
        <div className="py-6">
          <div className="flex flex-col items-center justify-center gap-3">
            <div className="flex gap-1">
              <div className="w-2 h-2 bg-primary-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
              <div className="w-2 h-2 bg-primary-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
              <div className="w-2 h-2 bg-primary-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
            </div>
            <div className="text-sm text-gray-400">Fetching usage data...</div>
            <div className="text-xs text-gray-500">This may take up to 30 seconds</div>
          </div>
        </div>
      ) : error ? (
        <div className="text-red-400 text-sm py-2">
          Error: {error}
        </div>
      ) : (
        <>
          <UsageGauge
            label="Current Session"
            percentage={currentSession}
            resetTime={sessionResetTime}
          />
          <UsageGauge
            label="Weekly Usage"
            percentage={weeklyUsage}
            resetTime={weeklyResetTime}
          />
        </>
      )}

      {!showLoading && (
        <div className="text-xs text-gray-500 mt-2">
          Last updated: {formatTime(lastUpdated)}
        </div>
      )}
    </div>
  )
}
