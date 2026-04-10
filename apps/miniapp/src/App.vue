<script setup lang="ts">
import { onLaunch } from '@dcloudio/uni-app'

onLaunch(() => {
  // App launched
})
</script>

<style lang="scss">
@import './uni.scss';

page {
  font-family:
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    'PingFang SC',
    'Hiragino Sans GB',
    'Microsoft YaHei',
    sans-serif;
  background-color: $br-bg-page;
  box-sizing: border-box;
  -webkit-font-smoothing: antialiased;
}

* {
  box-sizing: border-box;
}

/* 移动端点击高亮减弱 */
view,
button,
text {
  -webkit-tap-highlight-color: rgba(0, 0, 0, 0.06);
}

@keyframes br-msg-enter {
  from {
    opacity: 0;
    transform: translate3d(0, 16rpx, 0);
  }
  to {
    opacity: 1;
    transform: translate3d(0, 0, 0);
  }
}

@keyframes br-skeleton-shimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}

@keyframes br-send-pulse {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(0.94);
  }
}

.br-msg-enter {
  animation: br-msg-enter $br-duration-normal ease-out both;
  will-change: transform, opacity;
}

.br-skeleton-shimmer {
  background: linear-gradient(
    90deg,
    #e2e8f0 0%,
    #f1f5f9 40%,
    #e2e8f0 80%
  );
  background-size: 200% 100%;
  animation: br-skeleton-shimmer 1.2s ease-in-out infinite;
}

.br-send-btn--pulse {
  animation: br-send-pulse 0.35s ease-out;
}

@media (prefers-reduced-motion: reduce) {
  .br-msg-enter {
    animation: none;
    opacity: 1;
    transform: none;
  }

  .br-skeleton-shimmer {
    animation: none;
    background: #e2e8f0;
  }

  .br-send-btn--pulse {
    animation: none;
  }
}
</style>
