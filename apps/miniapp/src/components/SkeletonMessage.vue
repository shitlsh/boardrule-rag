<template>
  <view class="sk-msg" :class="align === 'user' ? 'sk-msg--user' : 'sk-msg--assistant'">
    <view v-if="align === 'assistant'" class="sk-msg__avatar br-skeleton-shimmer" />
    <view class="sk-msg__bubble">
      <view class="sk-msg__line br-skeleton-shimmer" />
      <view class="sk-msg__line sk-msg__line--mid br-skeleton-shimmer" />
      <view class="sk-msg__line sk-msg__line--short br-skeleton-shimmer" />
    </view>
    <view v-if="align === 'user'" class="sk-msg__avatar br-skeleton-shimmer" />
  </view>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    align?: 'assistant' | 'user'
  }>(),
  { align: 'assistant' },
)
</script>

<style lang="scss" scoped>
@import '../uni.scss';

.sk-msg {
  display: flex;
  align-items: flex-end;
  margin-bottom: 28rpx;
  gap: 14rpx;

  &--user {
    flex-direction: row-reverse;
  }

  &--assistant {
    flex-direction: row;
  }
}

.sk-msg__avatar {
  width: 72rpx;
  height: 72rpx;
  border-radius: 50%;
  flex-shrink: 0;
}

.sk-msg__bubble {
  max-width: 85%;
  padding: 22rpx 26rpx;
  border-radius: $br-radius-bubble;
  background: $br-bg-card;
  box-shadow: $br-shadow-card;
  display: flex;
  flex-direction: column;
  gap: 14rpx;
}

.sk-msg__line {
  height: 24rpx;
  border-radius: 8rpx;
  width: 100%;

  &--mid {
    width: 88%;
  }

  &--short {
    width: 52%;
  }
}
</style>
