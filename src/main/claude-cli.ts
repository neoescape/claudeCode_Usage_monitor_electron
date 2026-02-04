import * as pty from 'node-pty'
import { UsageData } from './types'
import { homedir } from 'os'
import { join } from 'path'

// Strip ANSI escape codes
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
}

// Parse usage output
function parseUsageOutput(output: string): Partial<UsageData> | null {
  const cleaned = stripAnsi(output)

  // Parse current session: "XX% used" (spaces may be removed after ANSI stripping)
  const sessionMatch = cleaned.match(/Current\s*session[\s\S]*?(\d+)%\s*used/i)
  const sessionResetMatch = cleaned.match(/Rese[ts]+\s*(\d+(?:am|pm)[^)]*\))/i)

  // Parse current week
  const weeklyMatch = cleaned.match(/Current\s*week[\s\S]*?(\d+)%\s*used/i)
  const weeklyResetMatch = cleaned.match(
    /Resets?\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[^)]+\))/i
  )

  if (!sessionMatch && !weeklyMatch) {
    return null
  }

  return {
    currentSession: sessionMatch ? parseInt(sessionMatch[1], 10) : 0,
    sessionResetTime: sessionResetMatch ? sessionResetMatch[1] : '',
    weeklyUsage: weeklyMatch ? parseInt(weeklyMatch[1], 10) : 0,
    weeklyResetTime: weeklyResetMatch ? weeklyResetMatch[1] : '',
    lastUpdated: new Date()
  }
}

// Find Claude binary path
function getClaudePath(): string {
  const isWindows = process.platform === 'win32'

  const possiblePaths = isWindows
    ? [
        // Windows paths
        join(process.env.LOCALAPPDATA || '', 'Programs', 'claude', 'claude.exe'),
        join(process.env.APPDATA || '', 'npm', 'claude.cmd'),
        join(homedir(), 'AppData', 'Local', 'Programs', 'claude', 'claude.exe'),
        join(homedir(), 'AppData', 'Roaming', 'npm', 'claude.cmd')
      ]
    : [
        // macOS / Linux paths
        join(homedir(), '.local/bin/claude'),
        '/usr/local/bin/claude',
        '/opt/homebrew/bin/claude',
        '/usr/bin/claude'
      ]

  for (const p of possiblePaths) {
    try {
      require('fs').accessSync(p, isWindows ? require('fs').constants.F_OK : require('fs').constants.X_OK)
      return p
    } catch {
      continue
    }
  }

  // Fallback: try PATH
  return isWindows ? 'claude.exe' : 'claude'
}

export async function fetchUsage(configDir?: string): Promise<Partial<UsageData>> {
  return new Promise((resolve, reject) => {
    let output = ''
    let resolved = false
    let usageSent = false
    let lastAction = ''

    const env: Record<string, string> = { ...process.env } as Record<string, string>
    if (configDir) {
      env.CLAUDE_CONFIG_DIR = configDir
    }

    const claudePath = getClaudePath()
    const isWindows = process.platform === 'win32'

    // Spawn claude process
    const ptyProcess = pty.spawn(claudePath, ['--dangerously-skip-permissions'], {
      name: isWindows ? 'conpty' : 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd: homedir(),
      env,
      ...(isWindows && { useConpty: true })
    })

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true
        ptyProcess.kill()
        const parsed = parseUsageOutput(output)
        if (parsed && (parsed.currentSession !== undefined || parsed.weeklyUsage !== undefined)) {
          resolve(parsed)
        } else {
          reject(new Error('Timeout waiting for usage data'))
        }
      }
    }, 60000) // 60 second timeout

    ptyProcess.onData((data) => {
      output += data
      const cleaned = stripAnsi(output)

      // 1. Theme selection prompt - Enter (no spaces after ANSI strip: "Darkmode")
      if (
        (cleaned.includes('Darkmode') || cleaned.includes('Dark mode')) &&
        (cleaned.includes('Lightmode') || cleaned.includes('Light mode')) &&
        !cleaned.includes('Logged') &&
        lastAction !== 'theme'
      ) {
        lastAction = 'theme'
        setTimeout(() => ptyProcess.write('\r'), 300)
        return
      }

      // 2. Login method selection prompt - Enter (first option: Claude subscription)
      if (
        (cleaned.includes('Selectloginmethod') || cleaned.includes('Select login method')) &&
        lastAction !== 'login-method'
      ) {
        lastAction = 'login-method'
        setTimeout(() => ptyProcess.write('\r'), 300)
        return
      }

      // 3. After login success - Enter to continue
      if (
        (cleaned.includes('Loginsuccessful') || cleaned.includes('Login successful')) &&
        cleaned.includes('continue') &&
        lastAction !== 'login-continue'
      ) {
        lastAction = 'login-continue'
        setTimeout(() => ptyProcess.write('\r'), 300)
        return
      }

      // 4. Security notes - Press Enter to continue
      if (
        (cleaned.includes('Securitynotes') || cleaned.includes('Security notes')) &&
        cleaned.includes('Enter') &&
        lastAction !== 'security'
      ) {
        lastAction = 'security'
        setTimeout(() => ptyProcess.write('\r'), 300)
        return
      }

      // 5. Terminal setup prompt - Enter
      if (
        (cleaned.includes('terminalsetup') || cleaned.includes('terminal setup')) &&
        (cleaned.includes('recommendedsettings') || cleaned.includes('recommended settings')) &&
        lastAction !== 'terminal-setup'
      ) {
        lastAction = 'terminal-setup'
        setTimeout(() => ptyProcess.write('\r'), 300)
        return
      }

      // 6. Trust folder prompt - select 1
      if (
        (cleaned.includes('trustthisfolder') || cleaned.includes('trust this folder')) &&
        lastAction !== 'trust'
      ) {
        lastAction = 'trust'
        setTimeout(() => ptyProcess.write('1\r'), 300)
        return
      }

      // 7. Bypass Permissions mode warning - arrow down + Enter (select Yes, I accept)
      if (
        (cleaned.includes('BypassPermissionsmode') || cleaned.includes('Bypass Permissions mode')) &&
        (cleaned.includes('Yes,Iaccept') || cleaned.includes('Yes, I accept')) &&
        lastAction !== 'bypass'
      ) {
        lastAction = 'bypass'
        setTimeout(() => {
          ptyProcess.write('\x1b[B') // Arrow down
          setTimeout(() => ptyProcess.write('\r'), 200)
        }, 300)
        return
      }

      // 8. Send /usage when prompt is ready
      const hasMainPrompt =
        cleaned.includes('Welcomeback') ||
        cleaned.includes('Welcome back') ||
        cleaned.includes('bypasspermissionson') ||
        cleaned.includes('bypass permissions on')

      if (hasMainPrompt && !usageSent) {
        usageSent = true
        setTimeout(() => {
          ptyProcess.write('/usage')
          setTimeout(() => ptyProcess.write('\r'), 500)
        }, 1000)
        return
      }

      // 9. Press Enter when autocomplete menu appears
      if (
        usageSent &&
        (cleaned.includes('Showplanusagelimits') || cleaned.includes('Show plan usage limits')) &&
        lastAction !== 'usage-enter'
      ) {
        lastAction = 'usage-enter'
        setTimeout(() => ptyProcess.write('\r'), 300)
        return
      }

      // Check usage data
      const usedMatches = cleaned.match(/(\d+)%\s*used/gi)
      if (usedMatches && usedMatches.length >= 2 && usageSent) {
        const parsed = parseUsageOutput(output)
        if (parsed && parsed.currentSession !== undefined && parsed.weeklyUsage !== undefined) {
          if (!resolved) {
            resolved = true
            clearTimeout(timeout)
            ptyProcess.write('\x03') // Ctrl+C
            setTimeout(() => {
              ptyProcess.kill()
              resolve(parsed)
            }, 500)
          }
        }
      }
    })

    ptyProcess.onExit(() => {
      clearTimeout(timeout)
      if (!resolved) {
        resolved = true
        const parsed = parseUsageOutput(output)
        if (parsed) {
          resolve(parsed)
        } else {
          reject(new Error('Retrying...'))
        }
      }
    })
  })
}

export async function checkClaudeInstalled(): Promise<boolean> {
  try {
    const claudePath = getClaudePath()
    const isWindows = process.platform === 'win32'
    require('fs').accessSync(claudePath, isWindows ? require('fs').constants.F_OK : require('fs').constants.X_OK)
    return true
  } catch {
    return false
  }
}
