<template>
  <view class="page">
    <!-- 头部 -->
    <view class="header">
      <view class="header__brand">
        <!-- book-open SVG icon -->
        <view class="header__logo" aria-hidden="true">
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" stroke="rgba(255,255,255,0.9)" stroke-width="1.8" stroke-linejoin="round"/>
            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" stroke="rgba(255,255,255,0.9)" stroke-width="1.8" stroke-linejoin="round"/>
          </svg>
        </view>
        <view class="header__title">规则助手</view>
      </view>
      <view class="header__subtitle">选择规则库，开始解读</view>
      <view class="header__disclaimer">
        仅帮助理解规则内容，回答仅供参考，请以官方规则书为准
      </view>
    </view>

    <!-- 加载中：骨架屏 -->
    <scroll-view v-if="loading" scroll-y class="skeleton-scroll">
      <SkeletonCard v-for="n in 5" :key="n" />
    </scroll-view>

    <!-- 错误 -->
    <view v-else-if="error" class="state-center">
      <view class="state-center__icon-wrap" aria-hidden="true">
        <svg width="56" height="56" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="12" cy="12" r="10" stroke="#ef4444" stroke-width="1.5"/>
          <path d="M12 7v5" stroke="#ef4444" stroke-width="1.5" stroke-linecap="round"/>
          <circle cx="12" cy="16.5" r="0.75" fill="#ef4444"/>
        </svg>
      </view>
      <text class="state-center__text">{{ error }}</text>
      <button class="btn-retry" @tap="loadGames">重试</button>
    </view>

    <!-- 空状态（无任何已索引游戏） -->
    <view v-else-if="games.length === 0" class="state-center">
      <view class="state-center__icon-wrap" aria-hidden="true">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M2 12h4l2 3h8l2-3h4" stroke="#d1c4a8" stroke-width="1.5" stroke-linejoin="round"/>
          <path d="M4.27 5h15.46A2 2 0 0 1 21.73 7.34L21 19a2 2 0 0 1-2 1H5a2 2 0 0 1-2-1L2.27 7.34A2 2 0 0 1 4.27 5Z" stroke="#d1c4a8" stroke-width="1.5"/>
        </svg>
      </view>
      <text class="state-center__text">暂无可用规则库</text>
      <text class="state-center__hint">请先在管理后台完成规则提取并建立索引</text>
    </view>

    <!-- 有数据：搜索 + 列表 -->
    <view v-else class="list-section">
      <view class="search-bar" :class="{ 'search-bar--focus': searchFocused }">
        <view class="search-bar__icon" aria-hidden="true">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="11" cy="11" r="8" stroke="#a8a29e" stroke-width="1.6"/>
            <path d="m21 21-4.35-4.35" stroke="#a8a29e" stroke-width="1.6" stroke-linecap="round"/>
          </svg>
        </view>
        <input
          v-model="searchQuery"
          class="search-bar__input"
          type="text"
          confirm-type="search"
          placeholder="搜索规则库..."
          placeholder-class="search-bar__placeholder"
          @focus="searchFocused = true"
          @blur="searchFocused = false"
        />
        <view v-if="searchQuery" class="search-bar__clear" @tap="searchQuery = ''">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="12" cy="12" r="10" stroke="#a8a29e" stroke-width="1.5"/>
            <path d="m15 9-6 6M9 9l6 6" stroke="#a8a29e" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
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
            <view v-else class="game-card__cover-placeholder" aria-hidden="true">
              <!-- layers SVG -->
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2 2 7l10 5 10-5-10-5Z" stroke="#d97706" stroke-width="1.5" stroke-linejoin="round"/>
                <path d="m2 12 10 5 10-5" stroke="#d97706" stroke-width="1.5" stroke-linejoin="round"/>
                <path d="m2 17 10 5 10-5" stroke="#d97706" stroke-width="1.5" stroke-linejoin="round"/>
              </svg>
            </view>
          </view>

          <view class="game-card__body">
            <view class="game-card__name">{{ game.name }}</view>
            <view class="game-card__label">查看规则解读</view>
          </view>

          <view class="game-card__arrow" aria-hidden="true">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="m9 18 6-6-6-6" stroke="#d1c4a8" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </view>
        </view>
      </scroll-view>

      <view v-else class="state-center state-center--compact">
        <text class="state-center__text">未找到匹配的规则库</text>
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
  padding: calc(32rpx + env(safe-area-inset-top, 0px)) 32rpx 28rpx;
  color: #fff;
  flex-shrink: 0;

  &__brand {
    display: flex;
    align-items: center;
    gap: 14rpx;
    margin-bottom: 8rpx;
  }

  &__logo {
    width: 44rpx;
    height: 44rpx;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  &__title {
    font-size: 40rpx;
    font-weight: 700;
    letter-spacing: 0.5rpx;
    line-height: 1.2;
  }

  &__subtitle {
    font-size: 26rpx;
    color: rgba(255, 255, 255, 0.82);
    line-height: 1.4;
    margin-bottom: 16rpx;
  }

  &__disclaimer {
    font-size: 20rpx;
    color: rgba(255, 255, 255, 0.52);
    line-height: 1.5;
    border-top: 1rpx solid rgba(255, 255, 255, 0.18);
    padding-top: 14rpx;
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

  &__icon-wrap {
    margin-bottom: 8rpx;
    display: flex;
    align-items: center;
    justify-content: center;
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
  gap: 12rpx;
  margin: 20rpx 24rpx 16rpx;
  padding: 16rpx 20rpx;
  background: $br-bg-card;
  border-radius: 999rpx;
  border: 2rpx solid #e7e0d4;
  box-shadow: 0 2rpx 12rpx rgba(0, 0, 0, 0.04);
  flex-shrink: 0;
  transition: border-color $br-duration-fast, box-shadow $br-duration-fast;

  &--focus {
    border-color: rgba(217, 119, 6, 0.5);
    box-shadow: 0 0 0 4rpx rgba(217, 119, 6, 0.1);
  }

  &__icon {
    display: flex;
    align-items: center;
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
    color: #a8a29e;
  }

  &__clear {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    padding: 4rpx;

    /* #ifdef H5 */
    cursor: pointer;
    /* #endif */
  }
}

.game-list {
  flex: 1;
  padding: 8rpx 24rpx calc(32rpx + env(safe-area-inset-bottom, 0px));
  min-height: 200rpx;
}

.game-card {
  display: flex;
  align-items: center;
  background: $br-bg-card;
  border-radius: $br-radius-card;
  margin-bottom: 16rpx;
  padding: 20rpx 18rpx;
  box-shadow: $br-shadow-card;
  gap: 20rpx;
  overflow: hidden;
  min-height: 120rpx;
  border: 1rpx solid #f5ede0;
  transition: transform $br-duration-fast, box-shadow $br-duration-fast;

  /* #ifdef H5 */
  cursor: pointer;

  &:hover {
    box-shadow: 0 8rpx 28rpx rgba(0, 0, 0, 0.1);
    border-color: rgba(217, 119, 6, 0.25);
  }
  /* #endif */

  &--active {
    transform: scale(0.985);
    box-shadow: 0 6rpx 24rpx rgba(180, 83, 9, 0.14);
    border-color: rgba(217, 119, 6, 0.3);
  }

  &__cover {
    width: 108rpx;
    height: 108rpx;
    border-radius: 16rpx;
    overflow: hidden;
    flex-shrink: 0;
    background: #fef9f0;
    border: 1rpx solid #fde8c0;
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

  &__body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 6rpx;
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

  &__label {
    font-size: 22rpx;
    color: $br-color-primary;
    font-weight: 500;
  }

  &__arrow {
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }
}
</style>
