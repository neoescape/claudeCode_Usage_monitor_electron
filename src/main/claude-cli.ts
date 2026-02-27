import { execSync, execFileSync } from 'child_process'
import { createHash } from 'crypto'
import https from 'https'
import { UsageData } from './types'

const API_URL = 'https://api.anthropic.com/api/oauth/usage'
const ANTHROPIC_BETA = 'oauth-2025-04-20'
const TOKEN_REFRESH_URL = 'https://console.anthropic.com/v1/oauth/token'
const OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'

interface OAuthCredentials {
  accessToken: string
  refreshToken: string
  expiresAt: number
  scopes: string[]
  subscriptionType?: string
  rateLimitTier?: string
}

interface KeychainData {
  claudeAiOauth: OAuthCredentials
}

/**
 * Compute the legacy Keychain service name (with configDir hash).
 * Used by Claude Code < 2.1.60.
 */
function getHashedKeychainServiceName(configDir: string): string {
  const hash = createHash('sha256').update(configDir).digest('hex').substring(0, 8)
  return `Claude Code-credentials-${hash}`
}

/**
 * Try to read a keychain entry by service name. Returns null on failure.
 */
function tryReadKeychain(serviceName: string): KeychainData | null {
  try {
    const raw = execSync(
      `security find-generic-password -s "${serviceName}" -w`,
      { encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim()

    const creds = JSON.parse(raw) as KeychainData
    if (creds?.claudeAiOauth?.accessToken) {
      return creds
    }
    return null
  } catch {
    return null
  }
}

/**
 * Read credentials from macOS Keychain.
 * For multi-account support, tries account-specific hashed entry first,
 * then falls back to the shared unhashed entry (Claude Code >= 2.1.60).
 * Returns { serviceName, creds } so callers know which entry to update.
 */
function getCredentialsFromKeychain(configDir: string): { serviceName: string; creds: KeychainData } {
  // 1. Account-specific entry (hashed) — unique per configDir
  const hashedServiceName = getHashedKeychainServiceName(configDir)
  const hashedCreds = tryReadKeychain(hashedServiceName)
  if (hashedCreds) {
    return { serviceName: hashedServiceName, creds: hashedCreds }
  }

  // 2. Shared entry (no hash) — Claude Code >= 2.1.60 default
  const sharedServiceName = 'Claude Code-credentials'
  const sharedCreds = tryReadKeychain(sharedServiceName)
  if (sharedCreds) {
    return { serviceName: sharedServiceName, creds: sharedCreds }
  }

  throw new Error(
    `No Claude Code credentials found in Keychain. Tried "${hashedServiceName}" and "${sharedServiceName}".`
  )
}

/**
 * Save updated credentials back to macOS Keychain.
 * Uses execFileSync to pass arguments directly (avoids shell escaping issues with JSON).
 */
function saveCredentialsToKeychain(serviceName: string, creds: KeychainData): void {
  const account = process.env.USER || 'unknown'
  const jsonStr = JSON.stringify(creds)

  try {
    // Delete existing entry first
    try {
      execFileSync('security', ['delete-generic-password', '-s', serviceName],
        { timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] })
    } catch {
      // Ignore if entry doesn't exist
    }

    // Add new entry with updated credentials
    execFileSync('security', [
      'add-generic-password', '-s', serviceName, '-a', account, '-w', jsonStr
    ], { timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] })
  } catch (err) {
    console.error('Failed to save credentials to Keychain:', err)
  }
}

/**
 * Refresh OAuth token using the refresh token.
 */
function refreshAccessToken(refreshToken: string): Promise<{
  accessToken: string
  refreshToken: string
  expiresIn: number
  scope: string
}> {
  return new Promise((resolve, reject) => {
    const url = new URL(TOKEN_REFRESH_URL)
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: OAUTH_CLIENT_ID
    }).toString()

    const options: https.RequestOptions = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body)
      }
    }

    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`Token refresh failed (${res.statusCode}): ${data}`))
          return
        }

        try {
          const json = JSON.parse(data)
          resolve({
            accessToken: json.access_token,
            refreshToken: json.refresh_token,
            expiresIn: json.expires_in,
            scope: json.scope
          })
        } catch (parseErr) {
          reject(new Error(`Failed to parse token refresh response: ${parseErr}`))
        }
      })
    })

    req.on('error', (err) => reject(new Error(`Token refresh network error: ${err.message}`)))
    req.setTimeout(10000, () => {
      req.destroy()
      reject(new Error('Token refresh request timeout'))
    })
    req.write(body)
    req.end()
  })
}

/**
 * Get a valid access token, refreshing if expired.
 */
async function getValidAccessToken(configDir: string): Promise<string> {
  const { serviceName, creds } = getCredentialsFromKeychain(configDir)
  const oauth = creds.claudeAiOauth

  // Check if token is expired or about to expire (5 min buffer)
  const now = Date.now()
  const bufferMs = 5 * 60 * 1000
  const isExpired = oauth.expiresAt && now >= oauth.expiresAt - bufferMs

  if (!isExpired) {
    return oauth.accessToken
  }

  // Token expired — refresh it
  if (!oauth.refreshToken) {
    throw new Error('Token expired and no refresh token available. Please re-login with Claude Code CLI.')
  }

  const refreshed = await refreshAccessToken(oauth.refreshToken)

  // Update credentials in keychain
  creds.claudeAiOauth = {
    ...oauth,
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    expiresAt: now + refreshed.expiresIn * 1000
  }
  saveCredentialsToKeychain(serviceName, creds)

  return refreshed.accessToken
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
 * Reads OAuth token from macOS Keychain, refreshes if expired, and calls the Anthropic Usage API.
 */
export async function fetchUsage(configDir?: string): Promise<Partial<UsageData>> {
  const resolvedConfigDir = configDir || `${process.env.HOME}/.claude`
  const token = await getValidAccessToken(resolvedConfigDir)
  return callUsageApi(token)
}

/**
 * Check if Claude credentials exist in Keychain for the given configDir.
 */
export async function checkClaudeInstalled(): Promise<boolean> {
  try {
    const configDir = `${process.env.HOME}/.claude`
    getCredentialsFromKeychain(configDir)
    return true
  } catch {
    return false
  }
}
