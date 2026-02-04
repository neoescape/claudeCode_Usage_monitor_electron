interface UsageGaugeProps {
  label: string
  percentage: number
  resetTime: string
}

function getColorClass(percentage: number): string {
  if (percentage >= 90) return 'bg-red-500'
  if (percentage >= 70) return 'bg-yellow-500'
  return 'bg-primary-500'
}

export function UsageGauge({ label, percentage, resetTime }: UsageGaugeProps): JSX.Element {
  const colorClass = getColorClass(percentage)

  return (
    <div className="mb-4">
      <div className="flex justify-between items-center mb-1">
        <span className="text-sm text-gray-300">{label}</span>
        <span className={`text-sm font-semibold ${percentage >= 90 ? 'text-red-400' : 'text-white'}`}>
          {percentage}%
        </span>
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
