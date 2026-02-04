import { useState } from 'react'

interface AddAccountModalProps {
  isOpen: boolean
  onClose: () => void
  onAdd: (name: string, useExisting: boolean) => void
}

export function AddAccountModal({ isOpen, onClose, onAdd }: AddAccountModalProps): JSX.Element | null {
  const [name, setName] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [mode, setMode] = useState<'existing' | 'new'>('existing')

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!name.trim()) return

    setIsLoading(true)
    try {
      await onAdd(name.trim(), mode === 'existing')
      setName('')
      setMode('existing')
      onClose()
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg p-6 w-80 shadow-xl">
        <h2 className="text-white font-semibold text-lg mb-4">Add Account</h2>

        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-gray-400 text-sm mb-2">Account Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Work, Personal"
              className="w-full bg-gray-700 text-white px-3 py-2 rounded border border-gray-600 focus:border-primary-500 focus:outline-none"
              autoFocus
            />
          </div>

          <div className="mb-4">
            <label className="block text-gray-400 text-sm mb-2">Account Type</label>
            <div className="space-y-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="mode"
                  checked={mode === 'existing'}
                  onChange={() => setMode('existing')}
                  className="text-primary-500"
                />
                <span className="text-gray-300 text-sm">Use existing account (~/.claude)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="mode"
                  checked={mode === 'new'}
                  onChange={() => setMode('new')}
                  className="text-primary-500"
                />
                <span className="text-gray-300 text-sm">Add new account (login required)</span>
              </label>
            </div>
          </div>

          {mode === 'existing' ? (
            <p className="text-xs text-gray-500 mb-4">
              Uses the currently logged-in Claude account.
            </p>
          ) : (
            <p className="text-xs text-yellow-500 mb-4">
              Login required in terminal after adding.
              <br />
              A new config directory will be created.
            </p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-gray-700 text-gray-300 rounded hover:bg-gray-600 transition-colors"
              disabled={isLoading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2 bg-primary-600 text-white rounded hover:bg-primary-500 transition-colors disabled:opacity-50"
              disabled={!name.trim() || isLoading}
            >
              {isLoading ? 'Adding...' : 'Add'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
