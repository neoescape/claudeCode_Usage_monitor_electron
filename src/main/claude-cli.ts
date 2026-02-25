import { execSync } from 'child_process'
import { createHash } from 'crypto'
import https from 'https'
import { UsageData } from './types'

const API_URL = 'https://api.anthropic.com/api/oauth/usage'
const ANTHROPIC_BETA = 'oauth-2025-04-20'

/**
 * Compute the Keychain service name for Claude Code credentials.
 * Format: "Claude Code-credentials-{sha256(configDir)[:8]}"
 */
function getKeychainServiceName(configDir: string): string {
  const hash = createHash('sha256').update(configDir).digest('hex').substring(0, 8)
  return `Claude Code-credentials-${hash}`
}

/**
 * Extract OAuth access token from macOS Keychain.
 */
function getAccessTokenFromKeychain(configDir: string): string {
  const serviceName = getKeychainServiceName(configDir)

  try {
    const raw = execSync(
      `security find-generic-password -s "${serviceName}" -w`,
      { encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim()

    const creds = JSON.parse(raw)
    const token = creds?.claudeAiOauth?.accessToken
    if (!token) {
      throw new Error('accessToken not found in credentials')
    }
    return token
  } catch (err) {
    throw new Error(
      `Failed to read token from Keychain (service: ${serviceName}): ${err instanceof Error ? err.message : err}`
    )
  }
}

/**
 * Call Anthropic OAuth Usage API and return parsed UsageData.
 */
function callUsageApi(token: string): Promise<Partial<UsageData>> {
  return new Promise((resolve, reject) => {
    const url = new URL(API_URL)
    const options: https.RequestOptions = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'anthropic-beta': ANTHROPIC_BETA
      }
    }

    const req = https.request(options, (res) => {
      let body = ''
      res.on('data', (chunk) => (body += chunk))
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`API returned ${res.statusCode}: ${body}`))
          return
        }

        try {
          const json = JSON.parse(body)

          const fiveHour = json.five_hour ?? {}
          const sevenDay = json.seven_day ?? {}

          const result: Partial<UsageData> = {
            currentSession: Math.round(fiveHour.utilization ?? 0),
            sessionResetTime: fiveHour.resets_at ?? '',
            weeklyUsage: Math.round(sevenDay.utilization ?? 0),
            weeklyResetTime: sevenDay.resets_at ?? '',
            lastUpdated: new Date()
          }

          resolve(result)
        } catch (parseErr) {
          reject(new Error(`Failed to parse API response: ${parseErr}`))
        }
      })
    })

    req.on('error', (err) => reject(new Error(`Network error: ${err.message}`)))
    req.setTimeout(10000, () => {
      req.destroy()
      reject(new Error('API request timeout'))
    })
    req.end()
  })
}

/**
 * Fetch usage data for a given configDir.
 * Reads OAuth token from macOS Keychain and calls the Anthropic Usage API.
 */
export async function fetchUsage(configDir?: string): Promise<Partial<UsageData>> {
  const resolvedConfigDir = configDir || `${process.env.HOME}/.claude`
  const token = getAccessTokenFromKeychain(resolvedConfigDir)
  return callUsageApi(token)
}

/**
 * Check if Claude credentials exist in Keychain for the given configDir.
 */
export async function checkClaudeInstalled(): Promise<boolean> {
  try {
    const configDir = `${process.env.HOME}/.claude`
    getAccessTokenFromKeychain(configDir)
    return true
  } catch {
    return false
  }
}
