<template>
  <view class="page">
    <!-- 头部 -->
    <view class="header">
      <view class="header__title">桌游规则助手</view>
      <view class="header__subtitle">选择游戏，开始问答</view>
    </view>

    <!-- 加载中 -->
    <view v-if="loading" class="state-center">
      <view class="loading-dots">
        <view class="dot" />
        <view class="dot" />
        <view class="dot" />
      </view>
      <text class="state-center__text">加载游戏列表...</text>
    </view>

    <!-- 错误 -->
    <view v-else-if="error" class="state-center">
      <text class="state-center__icon">⚠️</text>
      <text class="state-center__text">{{ error }}</text>
      <button class="btn-retry" @tap="loadGames">重试</button>
    </view>

    <!-- 空状态（无任何已索引游戏） -->
    <view v-else-if="games.length === 0" class="state-center">
      <text class="state-center__icon">🎲</text>
      <text class="state-center__text">暂无可用游戏</text>
      <text class="state-center__hint">请先在管理后台完成规则提取并建立索引</text>
    </view>

    <!-- 有数据：搜索 + 列表 -->
    <view v-else class="list-section">
      <view class="search-bar">
        <text class="search-bar__icon" aria-hidden="true">⌕</text>
        <input
          v-model="searchQuery"
          class="search-bar__input"
          type="text"
          confirm-type="search"
          placeholder="搜索游戏名称"
          placeholder-class="search-bar__placeholder"
        />
        <view v-if="searchQuery" class="search-bar__clear" @tap="searchQuery = ''">
          <text class="search-bar__clear-text">清除</text>
        </view>
      </view>

      <scroll-view v-if="filteredGames.length > 0" scroll-y class="game-list">
        <view
          v-for="game in filteredGames"
          :key="game.id"
          class="game-card"
          @tap="openChat(game)"
        >
          <view class="game-card__cover">
            <image
              v-if="game.coverUrl"
              :src="game.coverUrl"
              class="game-card__cover-img"
              mode="aspectFill"
            />
            <view v-else class="game-card__cover-placeholder">
              <text class="game-card__cover-icon">🎲</text>
            </view>
          </view>

          <view class="game-card__body">
            <view class="game-card__name">{{ game.name }}</view>
          </view>

          <text class="game-card__arrow">›</text>
        </view>
      </scroll-view>

      <view v-else class="state-center state-center--compact">
        <text class="state-center__text">未找到匹配的游戏</text>
        <text class="state-center__hint">试试其它关键词或清除搜索</text>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { fetchGames } from '../../api/bff'
import { getOrFetchUserId } from '../../utils/auth'
import type { GameListItem } from '../../types/index'

const games = ref<GameListItem[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const searchQuery = ref('')

const filteredGames = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return games.value
  return games.value.filter((g) => g.name.toLowerCase().includes(q))
})

async function loadGames() {
  loading.value = true
  error.value = null
  try {
    const userId = await getOrFetchUserId()
    if (!userId) {
      error.value =
        '无法获取访问令牌。请确认 BFF 已启动（apps/web）、已配置 MINIAPP_JWT_SECRET，且 H5 的跨域 MINIAPP_ALLOWED_ORIGIN 与当前页面 origin 一致。'
      return
    }
    games.value = await fetchGames()
    if (games.value.length === 1) {
      openChat(games.value[0])
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败，请重试'
  } finally {
    loading.value = false
  }
}

function openChat(game: GameListItem) {
  uni.navigateTo({
    url: `/pages/chat/index?gameId=${game.id}&gameName=${encodeURIComponent(game.name)}`,
  })
}

onMounted(loadGames)
</script>

<style lang="scss" scoped>
.page {
  min-height: 100vh;
  min-height: 100dvh;
  background: #f4f6f9;
  display: flex;
  flex-direction: column;
}

/* ---- 头部 ---- */
.header {
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
  padding: calc(28rpx + env(safe-area-inset-top, 0px)) 32rpx 36rpx;
  color: #fff;
  flex-shrink: 0;

  &__title {
    font-size: 40rpx;
    font-weight: 700;
    letter-spacing: 1rpx;
  }

  &__subtitle {
    margin-top: 10rpx;
    font-size: 26rpx;
    color: rgba(255, 255, 255, 0.65);
    line-height: 1.4;
  }
}

/* ---- 状态页 ---- */
.state-center {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80rpx 40rpx;
  gap: 20rpx;

  &--compact {
    flex: none;
    padding: 60rpx 32rpx;
    min-height: 200rpx;
  }

  &__icon {
    font-size: 80rpx;
  }

  &__text {
    font-size: 28rpx;
    color: #444;
    text-align: center;
    line-height: 1.5;
    max-width: 560rpx;
  }

  &__hint {
    font-size: 24rpx;
    color: #999;
    text-align: center;
    line-height: 1.6;
    max-width: 520rpx;
  }
}

.loading-dots {
  display: flex;
  gap: 12rpx;
  margin-bottom: 8rpx;

  .dot {
    width: 16rpx;
    height: 16rpx;
    border-radius: 50%;
    background: #4a90d9;
    animation: pulse 1.2s ease-in-out infinite;

    &:nth-child(2) {
      animation-delay: 0.2s;
    }
    &:nth-child(3) {
      animation-delay: 0.4s;
    }
  }
}

@keyframes pulse {
  0%,
  80%,
  100% {
    opacity: 0.3;
    transform: scale(0.8);
  }
  40% {
    opacity: 1;
    transform: scale(1);
  }
}

.btn-retry {
  margin-top: 16rpx;
  padding: 20rpx 48rpx;
  min-height: 88rpx;
  line-height: 1.4;
  background: #4a90d9;
  color: #fff;
  border-radius: 44rpx;
  font-size: 28rpx;
  border: none;
}

/* ---- 搜索 + 列表 ---- */
.list-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.search-bar {
  display: flex;
  align-items: center;
  gap: 16rpx;
  margin: 20rpx 24rpx 16rpx;
  padding: 18rpx 24rpx;
  background: #fff;
  border-radius: 999rpx;
  border: 1rpx solid #e2e8f0;
  box-shadow: 0 2rpx 12rpx rgba(0, 0, 0, 0.04);
  flex-shrink: 0;

  &__icon {
    font-size: 30rpx;
    color: #94a3b8;
    flex-shrink: 0;
  }

  &__input {
    flex: 1;
    font-size: 28rpx;
    color: #1a1a2e;
    height: 44rpx;
    line-height: 44rpx;
  }

  &__placeholder {
    color: #94a3b8;
  }

  &__clear {
    flex-shrink: 0;
    padding: 8rpx 12rpx;
  }

  &__clear-text {
    font-size: 24rpx;
    color: #64748b;
  }
}

.game-list {
  flex: 1;
  padding: 0 24rpx calc(32rpx + env(safe-area-inset-bottom, 0px));
  min-height: 200rpx;
}

.game-card {
  display: flex;
  align-items: center;
  background: #fff;
  border-radius: 20rpx;
  margin-bottom: 16rpx;
  padding: 22rpx 20rpx;
  box-shadow: 0 2rpx 16rpx rgba(0, 0, 0, 0.06);
  gap: 20rpx;
  overflow: hidden;
  min-height: 120rpx;

  &__cover {
    width: 112rpx;
    height: 112rpx;
    border-radius: 16rpx;
    overflow: hidden;
    flex-shrink: 0;
    background: #eef1f8;
  }

  &__cover-img {
    width: 100%;
    height: 100%;
  }

  &__cover-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  &__cover-icon {
    font-size: 48rpx;
  }

  &__body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }

  &__name {
    font-size: 30rpx;
    font-weight: 600;
    color: #1a1a2e;
    line-height: 1.45;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    overflow: hidden;
  }

  &__arrow {
    font-size: 40rpx;
    color: #cbd5e1;
    flex-shrink: 0;
    padding-left: 8rpx;
  }
}
</style>
