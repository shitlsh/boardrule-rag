/**
 * Haptic feedback — WeChat mini program only (uni.vibrateShort).
 * Other platforms: no-op.
 */
export function hapticLight(): void {
  // #ifdef MP-WEIXIN
  uni.vibrateShort({ type: 'light' })
  // #endif
}

export function hapticMedium(): void {
  // #ifdef MP-WEIXIN
  uni.vibrateShort({ type: 'medium' })
  // #endif
}
