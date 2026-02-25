import { useState, useEffect } from 'react'

interface UsageGaugeProps {
  label: string
  percentage: number
  resetTime: string
  showCountdown?: boolean
}

function getColorClass(percentage: number): string {
  if (percentage >= 90) return 'bg-red-500'
  if (percentage >= 70) return 'bg-yellow-500'
  return 'bg-primary-500'
}

// Parse reset time from ISO 8601 string (e.g. "2026-02-25T19:00:00+00:00")
function parseResetTime(resetTime: string): Date | null {
  if (!resetTime) return null

  try {
    const date = new Date(resetTime)
    if (isNaN(date.getTime())) return null
    return date
  } catch {
    return null
  }
}

// Format ISO 8601 reset time to user-friendly local string (e.g. "3:00 AM" or "Mar 4, 8:00 PM")
function formatResetTimeDisplay(resetTime: string): string {
  const date = parseResetTime(resetTime)
  if (!date) return resetTime

  const now = new Date()
  const isToday = date.toDateString() === now.toDateString()

  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const isTomorrow = date.toDateString() === tomorrow.toDateString()

  const timeStr = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

  if (isToday) return `today ${timeStr}`
  if (isTomorrow) return `tomorrow ${timeStr}`
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + `, ${timeStr}`
}

function formatCountdown(resetDate: Date | null): string {
  if (!resetDate) return ''

  const now = new Date()
  const diffMs = resetDate.getTime() - now.getTime()

  if (diffMs <= 0) return 'Soon'

  const diffMin = Math.floor(diffMs / 60000)
  const hours = Math.floor(diffMin / 60)
  const minutes = diffMin % 60

  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  return `${minutes}m`
}

export function UsageGauge({ label, percentage, resetTime, showCountdown = false }: UsageGaugeProps): JSX.Element {
  const colorClass = getColorClass(percentage)
  const [countdown, setCountdown] = useState('')

  useEffect(() => {
    if (!showCountdown || !resetTime) return

    const updateCountdown = (): void => {
      const resetDate = parseResetTime(resetTime)
      setCountdown(formatCountdown(resetDate))
    }

    updateCountdown()
    const interval = setInterval(updateCountdown, 60000) // Update every minute

    return () => clearInterval(interval)
  }, [resetTime, showCountdown])

  return (
    <div className="mb-4">
      <div className="flex justify-between items-center mb-1">
        <span className="text-sm text-gray-300">{label}</span>
        <div className="flex items-center gap-2">
          {showCountdown && countdown && (
            <span className="text-xs text-gray-500">({countdown})</span>
          )}
          <span className={`text-sm font-semibold ${percentage >= 90 ? 'text-red-400' : 'text-white'}`}>
            {percentage}%
          </span>
        </div>
      </div>
      <div className="h-3 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full ${colorClass} transition-all duration-500 ease-out`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      {resetTime && (
        <div className="text-xs text-gray-500 mt-1">
          Resets {formatResetTimeDisplay(resetTime)}
        </div>
      )}
    </div>
  )
}
