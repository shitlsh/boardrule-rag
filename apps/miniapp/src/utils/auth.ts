/**
 * User identity for BFF APIs: WeChat miniapp openid (mp-weixin) or anonymous H5 id (H5).
 * Caches userId + miniapp JWT from `/api/wx-login` or `/api/h5-auth`.
 *
 * Call `getOrFetchUserId()` on page `onShow` — no-op when cache is valid.
 *
 * Platform is detected at runtime (`uniPlatform === 'web'` for H5) so `vue-tsc` can
 * typecheck; tree-shaking still applies per uni-app target where unused paths drop.
 */
import { BFF_BASE_URL } from './env'

const STORAGE_KEY = 'wx_user_id'
const STORAGE_TOKEN = 'wx_access_token'

/** Cached miniapp JWT (Bearer for BFF APIs). */
export function getCachedAccessToken(): string | null {
  try {
    const v = uni.getStorageSync(STORAGE_TOKEN)
    return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
  } catch {
    return null
  }
}

/** Returns the cached userId, or null if not yet obtained. */
export function getCachedUserId(): string | null {
  try {
    const v = uni.getStorageSync(STORAGE_KEY)
    return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
  } catch {
    return null
  }
}

/** Persist userId + token to storage. */
function cacheAuth(userId: string, accessToken: string): void {
  try {
    uni.setStorageSync(STORAGE_KEY, userId)
    uni.setStorageSync(STORAGE_TOKEN, accessToken)
  } catch {
    // Ignore storage errors — userId will be re-fetched next time
  }
}

/** Clear cached auth (e.g. logout). */
export function clearCachedUserId(): void {
  try {
    uni.removeStorageSync(STORAGE_KEY)
    uni.removeStorageSync(STORAGE_TOKEN)
  } catch {
    // Ignore
  }
}

type AuthOk = { userId: string; accessToken: string }

function parseAuthResponse(data: Record<string, unknown> | null): AuthOk | null {
  const userId = typeof data?.userId === 'string' ? data.userId.trim() : ''
  const accessToken = typeof data?.accessToken === 'string' ? data.accessToken.trim() : ''
  if (userId && accessToken) return { userId, accessToken }
  return null
}

function getUniPlatform(): string {
  try {
    return uni.getSystemInfoSync().uniPlatform ?? ''
  } catch {
    return ''
  }
}

/** WeChat `code` → openid + JWT via BFF. */
async function exchangeCodeForAuth(code: string): Promise<AuthOk | null> {
  return new Promise((resolve) => {
    uni.request({
      url: `${BFF_BASE_URL}/api/wx-login`,
      method: 'POST',
      header: { 'Content-Type': 'application/json' },
      data: { code },
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const data = res.data as Record<string, unknown> | null
          resolve(parseAuthResponse(data))
        } else {
          resolve(null)
        }
      },
      fail: () => {
        resolve(null)
      },
    })
  })
}

/** Anonymous browser session → userId + JWT via BFF. */
async function exchangeH5Auth(): Promise<AuthOk | null> {
  return new Promise((resolve) => {
    uni.request({
      url: `${BFF_BASE_URL}/api/h5-auth`,
      method: 'POST',
      header: { 'Content-Type': 'application/json' },
      data: {},
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const data = res.data as Record<string, unknown> | null
          resolve(parseAuthResponse(data))
        } else {
          resolve(null)
        }
      },
      fail: () => {
        resolve(null)
      },
    })
  })
}

/**
 * Returns the cached userId if available, otherwise obtains one from the BFF.
 * Resolves to `null` on failure. Never throws.
 */
export async function getOrFetchUserId(): Promise<string | null> {
  const cached = getCachedUserId()
  const token = getCachedAccessToken()
  if (cached && token) return cached
  if (cached && !token) {
    clearCachedUserId()
  }

  if (getUniPlatform() === 'web') {
    try {
      const session = await exchangeH5Auth()
      if (session == null) return null
      cacheAuth(session.userId, session.accessToken)
      return session.userId
    } catch {
      return null
    }
  }

  return new Promise((resolve) => {
    uni.login({
      success: async (loginRes) => {
        const code = loginRes.code
        if (!code) {
          resolve(null)
          return
        }
        try {
          const auth = await exchangeCodeForAuth(code)
          if (auth) {
            cacheAuth(auth.userId, auth.accessToken)
          }
          resolve(auth?.userId ?? null)
        } catch {
          resolve(null)
        }
      },
      fail: () => {
        resolve(null)
      },
    })
  })
}
