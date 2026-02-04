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

// Parse reset time like "11pm(Asia/Seoul)" or "2am (Asia/Seoul)"
function parseResetTime(resetTime: string): Date | null {
  if (!resetTime) return null

  try {
    // Extract hour and am/pm
    const match = resetTime.match(/(\d{1,2})(am|pm)/i)
    if (!match) return null

    let hour = parseInt(match[1], 10)
    const isPM = match[2].toLowerCase() === 'pm'

    // Convert to 24-hour format
    if (isPM && hour !== 12) hour += 12
    if (!isPM && hour === 12) hour = 0

    const now = new Date()
    const resetDate = new Date(now)
    resetDate.setHours(hour, 0, 0, 0)

    // If reset time is in the past, add a day
    if (resetDate <= now) {
      resetDate.setDate(resetDate.getDate() + 1)
    }

    return resetDate
  } catch {
    return null
  }
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
          Resets {resetTime}
        </div>
      )}
    </div>
  )
}
