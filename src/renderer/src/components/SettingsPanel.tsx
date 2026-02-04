interface SettingsPanelProps {
  refreshInterval: number
  onIntervalChange: (interval: number) => void
}

const INTERVAL_OPTIONS = [
  { label: '1 min', value: 1 * 60 * 1000 },
  { label: '2 min', value: 2 * 60 * 1000 },
  { label: '3 min', value: 3 * 60 * 1000 },
  { label: '5 min', value: 5 * 60 * 1000 }
]

export function SettingsPanel({ refreshInterval, onIntervalChange }: SettingsPanelProps): JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-500">Refresh:</span>
      <select
        value={refreshInterval}
        onChange={(e) => onIntervalChange(Number(e.target.value))}
        className="bg-gray-700 text-gray-300 text-xs px-2 py-1 rounded border border-gray-600 focus:outline-none focus:border-primary-500"
      >
        {INTERVAL_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  )
}
