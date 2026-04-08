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

    <!-- 空状态 -->
    <view v-else-if="games.length === 0" class="state-center">
      <text class="state-center__icon">🎲</text>
      <text class="state-center__text">暂无可用游戏</text>
      <text class="state-center__hint">请先在管理后台完成规则提取并建立索引</text>
    </view>

    <!-- 游戏列表 -->
    <scroll-view v-else scroll-y class="game-list">
      <view
        v-for="game in games"
        :key="game.id"
        class="game-card"
        @tap="openChat(game)"
      >
        <!-- 封面图 -->
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

        <!-- 信息 -->
        <view class="game-card__body">
          <text class="game-card__name">{{ game.name }}</text>
          <view class="game-card__badge">
            <text class="badge-dot" />
            <text class="badge-text">规则已就绪</text>
          </view>
        </view>

        <!-- 箭头 -->
        <text class="game-card__arrow">›</text>
      </view>
    </scroll-view>
  </view>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { fetchGames } from '../../api/bff'
import type { GameListItem } from '../../types/index'

const games = ref<GameListItem[]>([])
const loading = ref(true)
const error = ref<string | null>(null)

async function loadGames() {
  loading.value = true
  error.value = null
  try {
    games.value = await fetchGames()
    // 如果只有一个游戏，直接跳转
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
  background: #f4f6f9;
  display: flex;
  flex-direction: column;
}

/* ---- 头部 ---- */
.header {
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
  padding: 48rpx 40rpx 40rpx;
  color: #fff;

  &__title {
    font-size: 44rpx;
    font-weight: 700;
    letter-spacing: 2rpx;
  }

  &__subtitle {
    margin-top: 8rpx;
    font-size: 26rpx;
    color: rgba(255, 255, 255, 0.6);
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

  &__icon {
    font-size: 80rpx;
  }

  &__text {
    font-size: 30rpx;
    color: #555;
    text-align: center;
  }

  &__hint {
    font-size: 24rpx;
    color: #999;
    text-align: center;
    line-height: 1.6;
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

    &:nth-child(2) { animation-delay: 0.2s; }
    &:nth-child(3) { animation-delay: 0.4s; }
  }
}

@keyframes pulse {
  0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
  40% { opacity: 1; transform: scale(1); }
}

.btn-retry {
  margin-top: 16rpx;
  padding: 16rpx 48rpx;
  background: #4a90d9;
  color: #fff;
  border-radius: 40rpx;
  font-size: 28rpx;
  border: none;
  line-height: 1.5;
}

/* ---- 游戏列表 ---- */
.game-list {
  flex: 1;
  padding: 24rpx 24rpx 40rpx;
}

.game-card {
  display: flex;
  align-items: center;
  background: #fff;
  border-radius: 20rpx;
  margin-bottom: 20rpx;
  padding: 20rpx;
  box-shadow: 0 2rpx 16rpx rgba(0, 0, 0, 0.06);
  gap: 20rpx;
  overflow: hidden;

  &__cover {
    width: 110rpx;
    height: 110rpx;
    border-radius: 14rpx;
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
    font-size: 52rpx;
  }

  &__body {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 12rpx;
    overflow: hidden;
  }

  &__name {
    font-size: 32rpx;
    font-weight: 600;
    color: #1a1a2e;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  &__badge {
    display: flex;
    align-items: center;
    gap: 8rpx;
  }

  &__arrow {
    font-size: 48rpx;
    color: #bbb;
    flex-shrink: 0;
    padding-right: 4rpx;
  }
}

.badge-dot {
  width: 12rpx;
  height: 12rpx;
  border-radius: 50%;
  background: #34c759;
  flex-shrink: 0;
}

.badge-text {
  font-size: 22rpx;
  color: #34c759;
  font-weight: 500;
}
</style>
