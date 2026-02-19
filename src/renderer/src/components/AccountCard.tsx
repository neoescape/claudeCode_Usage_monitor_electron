import { useState, useRef, useEffect } from 'react'
import { UsageGauge } from './UsageGauge'

interface AccountCardProps {
  name: string
  currentSession: number
  sessionResetTime: string
  weeklyUsage: number
  weeklyResetTime: string
  lastUpdated: string
  error?: string
  retrying?: boolean
  isLoading?: boolean
  onRemove: () => void
  onRename: (newName: string) => void
}

export function AccountCard({
  name,
  currentSession,
  sessionResetTime,
  weeklyUsage,
  weeklyResetTime,
  lastUpdated,
  error,
  retrying,
  isLoading,
  onRemove,
  onRename
}: AccountCardProps): JSX.Element {
  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState(name)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const handleSubmitRename = (): void => {
    const trimmed = editName.trim()
    if (trimmed && trimmed !== name) {
      onRename(trimmed)
    } else {
      setEditName(name)
    }
    setIsEditing(false)
  }
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

  // Initial loading: no data yet and no error
  const showLoading = isLoading || (!lastUpdated && !error && !retrying)

  // Retrying with previous data available
  const retryingWithData = retrying && !!lastUpdated

  // Retrying with no previous data
  const retryingNoData = retrying && !lastUpdated

  return (
    <div className="bg-gray-800 rounded-lg p-4 mb-3">
      <div className="flex justify-between items-center mb-3">
        <div className="flex items-center gap-2">
          {isEditing ? (
            <input
              ref={inputRef}
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={handleSubmitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSubmitRename()
                if (e.key === 'Escape') { setEditName(name); setIsEditing(false) }
              }}
              className="bg-gray-700 text-white font-semibold px-1 py-0 rounded border border-primary-500 outline-none text-sm w-32"
            />
          ) : (
            <h3
              className="text-white font-semibold cursor-pointer hover:text-primary-400 transition-colors"
              onClick={() => { setEditName(name); setIsEditing(true) }}
              title="클릭하여 이름 변경"
            >
              {name}
            </h3>
          )}
          {(showLoading || retryingNoData) && (
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 bg-primary-500 rounded-full animate-pulse"></div>
              <span className="text-xs text-primary-400">Connecting</span>
            </div>
          )}
          {retryingWithData && (
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse"></div>
              <span className="text-xs text-yellow-400">Reconnecting...</span>
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

      {showLoading || retryingNoData ? (
        <div className="py-6">
          <div className="flex flex-col items-center justify-center gap-3">
            <div className="flex gap-1">
              <div className="w-2 h-2 bg-primary-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
              <div className="w-2 h-2 bg-primary-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
              <div className="w-2 h-2 bg-primary-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
            </div>
            <div className="text-sm text-gray-400">
              {retryingNoData ? 'Connecting to Claude CLI...' : 'Fetching usage data...'}
            </div>
            <div className="text-xs text-gray-500">This may take up to 30 seconds</div>
          </div>
        </div>
      ) : error ? (
        <div className="text-red-400 text-sm py-2">
          Error: {error}
        </div>
      ) : (
        <div className={retryingWithData ? 'opacity-70' : ''}>
          <UsageGauge
            label="Current Session"
            percentage={currentSession}
            resetTime={sessionResetTime}
            showCountdown={true}
          />
          <UsageGauge
            label="Weekly Usage"
            percentage={weeklyUsage}
            resetTime={weeklyResetTime}
          />
        </div>
      )}

      {!showLoading && !retryingNoData && (
        <div className="text-xs text-gray-500 mt-2">
          Last updated: {formatTime(lastUpdated)}
        </div>
      )}
    </div>
  )
}
