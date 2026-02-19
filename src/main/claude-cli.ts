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

  const sessionMatch = cleaned.match(/Current\s*session[\s\S]*?(\d+)%\s*used/i)
  const sessionResetMatch = cleaned.match(/Rese[ts]+\s*(\d+(?:am|pm)[^)]*\))/i)

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
        join(process.env.LOCALAPPDATA || '', 'Programs', 'claude', 'claude.exe'),
        join(process.env.APPDATA || '', 'npm', 'claude.cmd'),
        join(homedir(), 'AppData', 'Local', 'Programs', 'claude', 'claude.exe'),
        join(homedir(), 'AppData', 'Roaming', 'npm', 'claude.cmd')
      ]
    : [
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

  return isWindows ? 'claude.exe' : 'claude'
}

export async function fetchUsage(configDir?: string): Promise<Partial<UsageData>> {
  const claudePath = getClaudePath()

  return new Promise((resolve, reject) => {
    let output = ''
    let usageSent = false
    let lastAction = ''

    let pendingResult: Partial<UsageData> | null = null
    let pendingError: Error | null = null
    let decided = false
    let exited = false

    function settle(): void {
      if (!decided || !exited) return
      clearTimeout(timeout)
      clearTimeout(killSafety)
      if (pendingResult) {
        resolve(pendingResult)
      } else {
        reject(pendingError || new Error('Unknown error'))
      }
    }

    function finish(result: Partial<UsageData> | null, error?: Error): void {
      if (decided) return
      decided = true
      pendingResult = result
      pendingError = error || null
      try { ptyProcess.kill() } catch { /* already dead */ }
      killSafety = setTimeout(() => {
        if (!exited) {
          exited = true
          settle()
        }
      }, 5000)
      settle()
    }

    const env: Record<string, string> = { ...process.env } as Record<string, string>
    // Remove CLAUDECODE to prevent "nested session" error when launched from Claude Code terminal
    delete env.CLAUDECODE
    if (configDir) {
      env.CLAUDE_CONFIG_DIR = configDir
    }

    const isWindows = process.platform === 'win32'

    const ptyProcess = pty.spawn(claudePath, ['--dangerously-skip-permissions'], {
      name: isWindows ? 'conpty' : 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd: homedir(),
      env,
      ...(isWindows && { useConpty: true })
    })

    let killSafety: ReturnType<typeof setTimeout>

    const timeout = setTimeout(() => {
      const parsed = parseUsageOutput(output)
      if (parsed && (parsed.currentSession !== undefined || parsed.weeklyUsage !== undefined)) {
        finish(parsed)
      } else {
        finish(null, new Error('Timeout waiting for usage data'))
      }
    }, 60000)

    ptyProcess.onData((data) => {
      if (decided) return
      output += data
      const cleaned = stripAnsi(output)

      // 1. Theme selection prompt
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

      // 2. Login method selection prompt
      if (
        (cleaned.includes('Selectloginmethod') || cleaned.includes('Select login method')) &&
        lastAction !== 'login-method'
      ) {
        lastAction = 'login-method'
        setTimeout(() => ptyProcess.write('\r'), 300)
        return
      }

      // 3. After login success
      if (
        (cleaned.includes('Loginsuccessful') || cleaned.includes('Login successful')) &&
        cleaned.includes('continue') &&
        lastAction !== 'login-continue'
      ) {
        lastAction = 'login-continue'
        setTimeout(() => ptyProcess.write('\r'), 300)
        return
      }

      // 4. Security notes
      if (
        (cleaned.includes('Securitynotes') || cleaned.includes('Security notes')) &&
        cleaned.includes('Enter') &&
        lastAction !== 'security'
      ) {
        lastAction = 'security'
        setTimeout(() => ptyProcess.write('\r'), 300)
        return
      }

      // 5. Terminal setup prompt
      if (
        (cleaned.includes('terminalsetup') || cleaned.includes('terminal setup')) &&
        (cleaned.includes('recommendedsettings') || cleaned.includes('recommended settings')) &&
        lastAction !== 'terminal-setup'
      ) {
        lastAction = 'terminal-setup'
        setTimeout(() => ptyProcess.write('\r'), 300)
        return
      }

      // 6. Trust folder prompt
      if (
        (cleaned.includes('trustthisfolder') || cleaned.includes('trust this folder')) &&
        lastAction !== 'trust'
      ) {
        lastAction = 'trust'
        setTimeout(() => ptyProcess.write('1\r'), 300)
        return
      }

      // 7. Bypass Permissions mode warning
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
          ptyProcess.write('\x03') // Ctrl+C
          finish(parsed)
        }
      }
    })

    ptyProcess.onExit(({ exitCode, signal }) => {
      exited = true

      if (!decided) {
        const parsed = parseUsageOutput(output)
        if (parsed) {
          finish(parsed)
        } else {
          finish(null, new Error('Retrying...'))
        }
      }

      settle()
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
