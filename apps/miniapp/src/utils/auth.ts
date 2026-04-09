/**
 * WeChat miniapp user identity helper.
 *
 * Exchanges a fresh `uni.login()` code for a stable openid via the BFF
 * `/api/wx-login` endpoint, then caches it in local storage.
 *
 * The cached value is considered valid for the current app session.
 * Call `getOrFetchUserId()` on page `onShow` — it is a no-op when the
 * cached value is already present.
 */
import { BFF_BASE_URL } from './env'

const STORAGE_KEY = 'wx_user_id'
const STORAGE_TOKEN = 'wx_access_token'

/** Cached miniapp JWT from ``/api/wx-login`` (Bearer for BFF APIs). */
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

/** Persist the userId to local storage. */
function cacheAuth(userId: string, accessToken: string): void {
  try {
    uni.setStorageSync(STORAGE_KEY, userId)
    uni.setStorageSync(STORAGE_TOKEN, accessToken)
  } catch {
    // Ignore storage errors — userId will be re-fetched next time
  }
}

/** Clear the cached userId (e.g. on explicit logout). */
export function clearCachedUserId(): void {
  try {
    uni.removeStorageSync(STORAGE_KEY)
    uni.removeStorageSync(STORAGE_TOKEN)
  } catch {
    // Ignore
  }
}

/**
 * Returns the cached userId if available, otherwise fetches a fresh one.
 * Resolves to `null` on any failure (network, WeChat API, BFF not configured).
 * Never throws.
 */
export async function getOrFetchUserId(): Promise<string | null> {
  const cached = getCachedUserId()
  const token = getCachedAccessToken()
  if (cached && token) return cached
  if (cached && !token) {
    clearCachedUserId()
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

type WxLoginOk = { userId: string; accessToken: string }

/** Call BFF to exchange a WeChat login code for openid + miniapp JWT. */
async function exchangeCodeForAuth(code: string): Promise<WxLoginOk | null> {
  return new Promise((resolve) => {
    uni.request({
      url: `${BFF_BASE_URL}/api/wx-login`,
      method: 'POST',
      header: { 'Content-Type': 'application/json' },
      data: { code },
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const data = res.data as Record<string, unknown> | null
          const userId = typeof data?.userId === 'string' ? data.userId.trim() : ''
          const accessToken = typeof data?.accessToken === 'string' ? data.accessToken.trim() : ''
          if (userId && accessToken) {
            resolve({ userId, accessToken })
          } else {
            resolve(null)
          }
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
