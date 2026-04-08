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
function cacheUserId(userId: string): void {
  try {
    uni.setStorageSync(STORAGE_KEY, userId)
  } catch {
    // Ignore storage errors — userId will be re-fetched next time
  }
}

/** Clear the cached userId (e.g. on explicit logout). */
export function clearCachedUserId(): void {
  try {
    uni.removeStorageSync(STORAGE_KEY)
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
  if (cached) return cached

  return new Promise((resolve) => {
    uni.login({
      success: async (loginRes) => {
        const code = loginRes.code
        if (!code) {
          resolve(null)
          return
        }

        try {
          const userId = await exchangeCodeForUserId(code)
          if (userId) {
            cacheUserId(userId)
          }
          resolve(userId)
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

/** Call BFF to exchange a WeChat login code for an openid. */
async function exchangeCodeForUserId(code: string): Promise<string | null> {
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
          resolve(userId || null)
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
