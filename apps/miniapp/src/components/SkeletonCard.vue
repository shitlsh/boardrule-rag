<template>
  <view class="sk-card">
    <view class="sk-card__cover br-skeleton-shimmer" />
    <view class="sk-card__body">
      <view class="sk-card__line sk-card__line--lg br-skeleton-shimmer" />
      <view class="sk-card__line sk-card__line--sm br-skeleton-shimmer" />
    </view>
  </view>
</template>

<script setup lang="ts"></script>

<style lang="scss" scoped>
@import '../uni.scss';

.sk-card {
  display: flex;
  align-items: center;
  gap: 20rpx;
  padding: 22rpx 20rpx;
  margin-bottom: 16rpx;
  background: $br-bg-card;
  border-radius: $br-radius-card;
  box-shadow: $br-shadow-card;
  min-height: 120rpx;
}

.sk-card__cover {
  width: 112rpx;
  height: 112rpx;
  border-radius: 16rpx;
  flex-shrink: 0;
}

.sk-card__body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 16rpx;
  min-width: 0;
}

.sk-card__line {
  height: 28rpx;
  border-radius: 8rpx;

  &--lg {
    width: 72%;
  }

  &--sm {
    width: 44%;
  }
}
</style>
