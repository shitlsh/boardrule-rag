<template>
  <view class="page">
    <!-- 头部 -->
    <view class="header">
      <view class="header__title">桌游规则助手</view>
      <view class="header__subtitle">选择游戏，开始问答</view>
    </view>

    <!-- 加载中：骨架屏 -->
    <scroll-view v-if="loading" scroll-y class="skeleton-scroll">
      <SkeletonCard v-for="n in 5" :key="n" />
    </scroll-view>

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
      <view class="search-bar" :class="{ 'search-bar--focus': searchFocused }">
        <text class="search-bar__icon" aria-hidden="true">⌕</text>
        <input
          v-model="searchQuery"
          class="search-bar__input"
          type="text"
          confirm-type="search"
          placeholder="搜索游戏名称"
          placeholder-class="search-bar__placeholder"
          @focus="searchFocused = true"
          @blur="searchFocused = false"
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
          hover-class="game-card--active"
          :hover-stay-time="80"
          @tap="onGameTap(game)"
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
import { hapticLight } from '../../utils/haptic'
import SkeletonCard from '../../components/SkeletonCard.vue'
import type { GameListItem } from '../../types/index'

const games = ref<GameListItem[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const searchQuery = ref('')
const searchFocused = ref(false)

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

function onGameTap(game: GameListItem) {
  hapticLight()
  openChat(game)
}

function openChat(game: GameListItem) {
  uni.navigateTo({
    url: `/pages/chat/index?gameId=${game.id}&gameName=${encodeURIComponent(game.name)}`,
  })
}

onMounted(loadGames)
</script>

<style lang="scss" scoped>
@import '../../uni.scss';

.page {
  min-height: 100vh;
  min-height: 100dvh;
  background: $br-bg-page;
  display: flex;
  flex-direction: column;
}

.skeleton-scroll {
  flex: 1;
  padding: 0 24rpx;
  padding-bottom: calc(32rpx + env(safe-area-inset-bottom, 0px));
  min-height: 200rpx;
}

/* ---- 头部 ---- */
.header {
  background: $br-gradient-header;
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
    color: rgba(255, 255, 255, 0.75);
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
    color: $br-text-primary;
    text-align: center;
    line-height: 1.5;
    max-width: 560rpx;
  }

  &__hint {
    font-size: 24rpx;
    color: $br-text-secondary;
    text-align: center;
    line-height: 1.6;
    max-width: 520rpx;
  }
}

.btn-retry {
  margin-top: 16rpx;
  padding: 20rpx 48rpx;
  min-height: 88rpx;
  line-height: 1.4;
  background: $br-color-primary;
  color: #fff;
  border-radius: $br-radius-button;
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
  background: $br-bg-card;
  border-radius: 999rpx;
  border: 2rpx solid #e2e8f0;
  box-shadow: 0 2rpx 12rpx rgba(0, 0, 0, 0.04);
  flex-shrink: 0;
  transition: border-color $br-duration-fast, box-shadow $br-duration-fast;

  &--focus {
    border-color: rgba(37, 99, 235, 0.55);
    box-shadow: 0 0 0 4rpx rgba(37, 99, 235, 0.12);
  }

  &__icon {
    font-size: 30rpx;
    color: #94a3b8;
    flex-shrink: 0;
  }

  &__input {
    flex: 1;
    font-size: 28rpx;
    color: $br-text-primary;
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
    color: $br-text-secondary;
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
  background: $br-bg-card;
  border-radius: $br-radius-card;
  margin-bottom: 16rpx;
  padding: 22rpx 20rpx;
  box-shadow: $br-shadow-card;
  gap: 20rpx;
  overflow: hidden;
  min-height: 120rpx;
  transition: transform $br-duration-fast, box-shadow $br-duration-fast;

  /* #ifdef H5 */
  &:hover {
    box-shadow: 0 8rpx 28rpx rgba(0, 0, 0, 0.1);
  }
  /* #endif */

  &--active {
    transform: scale(0.98);
    box-shadow: 0 6rpx 24rpx rgba(37, 99, 235, 0.15);
  }

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
    color: $br-text-primary;
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
