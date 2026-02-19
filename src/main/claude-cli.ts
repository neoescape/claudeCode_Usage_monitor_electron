import * as pty from 'node-pty'
import { UsageData } from './types'
import { homedir } from 'os'
import { join } from 'path'
import { log } from './logger'

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
  const claudePath = getClaudePath()
  log.info('cli', 'fetchUsage started', { configDir, claudePath })

  return new Promise((resolve, reject) => {
    let output = ''
    let usageSent = false
    let lastAction = ''

    // Result storage — resolve/reject only happens via settle() after onExit
    let pendingResult: Partial<UsageData> | null = null
    let pendingError: Error | null = null
    let decided = false // outcome determined (but may still await exit)
    let exited = false  // onExit fired (FDs cleaned up)

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

    // Mark outcome and initiate kill — actual resolve/reject deferred to settle()
    function finish(result: Partial<UsageData> | null, error?: Error): void {
      if (decided) return
      decided = true
      pendingResult = result
      pendingError = error || null
      try { ptyProcess.kill() } catch { /* already dead */ }
      // Safety: if onExit doesn't fire within 5s, force settle
      killSafety = setTimeout(() => {
        if (!exited) {
          log.warn('cli', 'onExit did not fire within 5s, force settling')
          exited = true
          settle()
        }
      }, 5000)
      settle() // in case onExit already fired
    }

    const env: Record<string, string> = { ...process.env } as Record<string, string>
    // Remove CLAUDECODE to prevent "nested session" error when launched from Claude Code terminal
    delete env.CLAUDECODE
    if (configDir) {
      env.CLAUDE_CONFIG_DIR = configDir
    }

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

    log.info('cli', 'PTY spawned', { pid: ptyProcess.pid })

    let killSafety: ReturnType<typeof setTimeout>

    const timeout = setTimeout(() => {
      const outputTail = stripAnsi(output).slice(-500)
      log.warn('cli', 'Timeout reached (60s)', { outputTail })
      const parsed = parseUsageOutput(output)
      if (parsed && (parsed.currentSession !== undefined || parsed.weeklyUsage !== undefined)) {
        log.info('cli', 'Timeout but parsed partial data', {
          session: parsed.currentSession,
          weekly: parsed.weeklyUsage
        })
        finish(parsed)
      } else {
        log.error('cli', 'Timeout with no parseable data')
        finish(null, new Error('Timeout waiting for usage data'))
      }
    }, 60000) // 60 second timeout

    ptyProcess.onData((data) => {
      if (decided) return
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
        log.debug('cli', 'Prompt detected: theme selection')
        setTimeout(() => ptyProcess.write('\r'), 300)
        return
      }

      // 2. Login method selection prompt - Enter (first option: Claude subscription)
      if (
        (cleaned.includes('Selectloginmethod') || cleaned.includes('Select login method')) &&
        lastAction !== 'login-method'
      ) {
        lastAction = 'login-method'
        log.debug('cli', 'Prompt detected: login method')
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
        log.debug('cli', 'Prompt detected: login successful')
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
        log.debug('cli', 'Prompt detected: security notes')
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
        log.debug('cli', 'Prompt detected: terminal setup')
        setTimeout(() => ptyProcess.write('\r'), 300)
        return
      }

      // 6. Trust folder prompt - select 1
      if (
        (cleaned.includes('trustthisfolder') || cleaned.includes('trust this folder')) &&
        lastAction !== 'trust'
      ) {
        lastAction = 'trust'
        log.debug('cli', 'Prompt detected: trust folder')
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
        log.debug('cli', 'Prompt detected: bypass permissions')
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
        log.info('cli', 'Main prompt ready, sending /usage')
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
        log.debug('cli', 'Prompt detected: usage autocomplete menu')
        setTimeout(() => ptyProcess.write('\r'), 300)
        return
      }

      // Check usage data
      const usedMatches = cleaned.match(/(\d+)%\s*used/gi)
      if (usedMatches && usedMatches.length >= 2 && usageSent) {
        const parsed = parseUsageOutput(output)
        if (parsed && parsed.currentSession !== undefined && parsed.weeklyUsage !== undefined) {
          log.info('cli', 'Parse success', {
            session: parsed.currentSession,
            sessionReset: parsed.sessionResetTime,
            weekly: parsed.weeklyUsage,
            weeklyReset: parsed.weeklyResetTime
          })
          ptyProcess.write('\x03') // Ctrl+C
          finish(parsed)
        }
      }
    })

    ptyProcess.onExit(({ exitCode, signal }) => {
      log.info('cli', 'PTY exited', { exitCode, signal })
      exited = true

      if (!decided) {
        // Process exited before we got a result
        const parsed = parseUsageOutput(output)
        if (parsed) {
          log.info('cli', 'Parsed data on exit', {
            session: parsed.currentSession,
            weekly: parsed.weeklyUsage
          })
          finish(parsed)
        } else {
          const outputTail = stripAnsi(output).slice(-500)
          log.error('cli', 'No parseable data on exit', { exitCode, signal, outputTail })
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
