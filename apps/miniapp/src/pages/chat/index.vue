<!-- @ts-nocheck towxml is a native WeChat miniprogram component without Vue type declarations -->
<template>
  <view class="chat-page" :style="chatPageStyle">
    <!-- ===== 游戏信息加载中 ===== -->
    <view v-if="gameLoading" class="chat-skeleton-wrap">
      <SkeletonMessage align="assistant" />
      <SkeletonMessage align="assistant" />
      <SkeletonMessage align="user" />
    </view>

    <block v-else>
      <!-- ===== QuickStart 折叠卡片 ===== -->
      <view v-if="game?.quickStart" class="quickstart-card">
        <view class="quickstart-card__header" @tap="toggleQuickStart">
          <view class="quickstart-card__title">
            <!-- book-open SVG -->
            <view class="quickstart-card__icon" aria-hidden="true">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" stroke="#16a34a" stroke-width="1.5" stroke-linejoin="round"/>
                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" stroke="#16a34a" stroke-width="1.5" stroke-linejoin="round"/>
              </svg>
            </view>
            <text>规则导读</text>
          </view>
          <!-- chevron SVG -->
          <view class="quickstart-card__chevron" :class="{ 'is-open': quickStartOpen }" aria-hidden="true">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="m9 18 6-6-6-6" stroke="#64748b" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </view>
        </view>
        <view v-if="quickStartOpen" class="quickstart-card__body">
          <!-- #ifdef MP-WEIXIN -->
          <towxml
            :nodes="quickStartNodes"
            type="markdown"
            :custom-attrs="towxmlAttrs"
          />
          <!-- #endif -->
          <!-- #ifdef H5 -->
          <view class="quickstart-md markdown-body" v-html="quickStartHtml" />
          <!-- #endif -->
        </view>
      </view>

      <!-- ===== 推荐问题 ===== -->
      <view
        v-if="suggestedQuestions.length > 0 && chatStore.messages.length === 0"
        class="chips-bar"
      >
        <view class="chips-wrap">
          <view
            v-for="(q, i) in suggestedQuestions"
            :key="i"
            class="chip"
            hover-class="chip--active"
            :hover-stay-time="80"
            @tap="sendSuggested(q)"
          >
            <!-- message-circle SVG -->
            <view class="chip__icon" aria-hidden="true">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="#16a34a" stroke-width="1.5" stroke-linejoin="round"/>
              </svg>
            </view>
            <text class="chip__text">{{ q }}</text>
          </view>
        </view>
      </view>

      <!-- ===== 消息列表 ===== -->
      <scroll-view
        :scroll-y="true"
        :scroll-top="scrollTop"
        :scroll-with-animation="true"
        class="message-list"
        :style="messageListFlexStyle"
      >
        <!-- 空状态提示 -->
        <view v-if="chatStore.messages.length === 0" class="empty-hint">
          <view class="empty-hint__icon" aria-hidden="true">
            <svg width="56" height="56" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="#94a3b8" stroke-width="1.3" stroke-linejoin="round"/>
            </svg>
          </view>
          <text class="empty-hint__text">向助手提问关于《{{ gameName }}》的规则疑惑</text>
          <text class="empty-hint__disclaimer">
            本工具基于已导入的规则内容进行解读，不提供完整规则原文，答案仅供参考，可能存在理解偏差，请以官方规则书为准
          </text>
        </view>

        <view
          v-for="msg in chatStore.messages"
          :key="msg.id"
          class="msg-row"
          :class="[
            msg.role === 'user' ? 'msg-row--user' : 'msg-row--assistant',
            { 'br-msg-enter': enterAnim[msg.id] },
          ]"
        >
          <!-- 助手头像 -->
          <view v-if="msg.role === 'assistant'" class="avatar avatar--assistant" aria-hidden="true">
            <!-- sparkles / robot SVG -->
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" stroke="#16a34a" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </view>

          <view class="bubble-wrapper">
            <view
              class="bubble"
              :class="msg.role === 'user' ? 'bubble--user' : 'bubble--assistant'"
            >
              <text v-if="msg.role === 'user'" class="bubble__text">{{ msg.content }}</text>
              <!-- #ifdef MP-WEIXIN -->
              <towxml
                v-else
                :nodes="getOrBuildNodes(msg.id, msg.content)"
                type="markdown"
                :custom-attrs="towxmlAttrs"
              />
              <!-- #endif -->
              <!-- #ifdef H5 -->
              <view
                v-else
                class="bubble__md markdown-body"
                v-html="getOrBuildHtml(msg.id, msg.content)"
              />
              <!-- #endif -->
            </view>
          </view>

          <!-- 用户头像 -->
          <view v-if="msg.role === 'user'" class="avatar avatar--user" aria-hidden="true">
            <!-- user SVG -->
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="12" cy="8" r="4" stroke="#16a34a" stroke-width="1.5"/>
              <path d="M4 20c0-4 3.58-7 8-7s8 3 8 7" stroke="#16a34a" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </view>
        </view>

        <!-- 打字 loading -->
        <view v-if="chatStore.isLoading" class="msg-row msg-row--assistant">
          <view class="avatar avatar--assistant" aria-hidden="true">
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" stroke="#16a34a" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </view>
          <view class="bubble bubble--assistant bubble--loading">
            <view class="typing-dots">
              <view class="typing-dots__dot" />
              <view class="typing-dots__dot" />
              <view class="typing-dots__dot" />
            </view>
          </view>
        </view>

        <view id="msg-bottom" style="height: 1px;" />
      </scroll-view>

      <!-- ===== 底部输入栏 ===== -->
      <view
        class="input-bar"
        :style="{ paddingBottom: inputBarPaddingBottom + 'px' }"
      >
        <view class="input-bar__inner">
          <view
            v-if="chatStore.messages.length > 0"
            class="input-bar__clear-icon"
            hover-class="input-bar__clear-icon--active"
            @tap="confirmClear"
          >
            <!-- trash SVG -->
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <polyline points="3 6 5 6 21 6" stroke="#94a3b8" stroke-width="1.5" stroke-linecap="round"/>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" stroke="#94a3b8" stroke-width="1.5" stroke-linejoin="round"/>
              <path d="M10 11v6M14 11v6" stroke="#94a3b8" stroke-width="1.5" stroke-linecap="round"/>
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" stroke="#94a3b8" stroke-width="1.5"/>
            </svg>
          </view>
          <textarea
            v-model="inputText"
            class="input-bar__textarea"
            :class="{ 'input-bar__textarea--focus': inputFocused }"
            placeholder="输入规则问题..."
            :disabled="chatStore.isLoading"
            :maxlength="500"
            auto-height
            :show-confirm-bar="false"
            :adjust-position="false"
            confirm-type="send"
            @confirm="handleSend"
            @focus="inputFocused = true"
            @blur="inputFocused = false"
          />
          <view
            class="input-bar__send"
            :class="{
              'is-active': inputText.trim() && !chatStore.isLoading,
              'br-send-btn--pulse': sendPulse,
            }"
            @animationend="sendPulse = false"
            @tap="onSendTap"
          >
            <!-- send SVG (arrow-up) -->
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 19V5M5 12l7-7 7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </view>
        </view>
      </view>
    </block>
  </view>
</template>

<script setup lang="ts">
// @ts-nocheck
import { ref, computed, onMounted, nextTick, watch, reactive, onBeforeUnmount } from 'vue'
import { onLoad, onShow, onUnload } from '@dcloudio/uni-app'
import { useChatStore } from '../../store/chat'
import { fetchGame, sendChatMessage } from '../../api/bff'
import { getOrFetchUserId } from '../../utils/auth'
import { hapticLight, hapticMedium } from '../../utils/haptic'
import SkeletonMessage from '../../components/SkeletonMessage.vue'
import type { Game } from '../../types/index'

// #ifdef H5
import { renderMarkdownToHtml } from '../../utils/markdown'
// #endif

// #ifdef MP-WEIXIN
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TowxmlParser = (content: string, type: 'markdown' | 'html', options?: Record<string, unknown>) => any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const towxml = (require as any)('../../wxcomponents/towxml/index.js') as TowxmlParser
// #endif

const gameId = ref('')
const gameName = ref('')

onLoad((options) => {
  gameId.value = options?.gameId ?? ''
  gameName.value = decodeURIComponent(options?.gameName ?? '游戏')
  uni.setNavigationBarTitle({ title: gameName.value })
})

const chatStore = useChatStore()
const game = ref<Game | null>(null)
const gameLoading = ref(true)

const suggestedQuestions = computed<string[]>(() => {
  if (game.value?.suggestedQuestions?.length) {
    return game.value.suggestedQuestions
  }
  return ['游戏的基本目标是什么？', '如何设置游戏？', '游戏如何结束？']
})

async function loadGame() {
  if (!gameId.value) return
  try {
    game.value = await fetchGame(gameId.value)
  } catch {
    // 加载失败不影响主功能，静默忽略
  } finally {
    gameLoading.value = false
  }
}

onShow(() => {
  if (gameId.value) {
    chatStore.enterGame(gameId.value)
    loadGame()
  }
  getOrFetchUserId()
})

const quickStartOpen = ref(false)

function toggleQuickStart() {
  quickStartOpen.value = !quickStartOpen.value
}

// #ifdef MP-WEIXIN
const quickStartNodes = computed(() => {
  if (!game.value?.quickStart) return null
  return towxml(game.value.quickStart, 'markdown', { theme: 'light' })
})

const towxmlAttrs = { theme: 'light' }
const nodeCache = new Map<string, unknown>()

function getOrBuildNodes(msgId: string, content: string) {
  if (!nodeCache.has(msgId)) {
    nodeCache.set(msgId, towxml(content, 'markdown', { theme: 'light' }))
  }
  return nodeCache.get(msgId)
}
// #endif

// #ifdef H5
const quickStartHtml = computed(() => {
  if (!game.value?.quickStart) return ''
  return renderMarkdownToHtml(game.value.quickStart)
})

const htmlCache = new Map<string, string>()

function getOrBuildHtml(msgId: string, content: string) {
  if (!htmlCache.has(msgId)) {
    htmlCache.set(msgId, renderMarkdownToHtml(content))
  }
  return htmlCache.get(msgId) ?? ''
}
// #endif

const scrollTop = ref(0)

async function scrollToBottom() {
  await nextTick()
  scrollTop.value = 0
  await nextTick()
  scrollTop.value = 999999
}

watch(() => chatStore.messages.length, scrollToBottom)
watch(
  () => chatStore.isLoading,
  (v) => {
    if (v) scrollToBottom()
  },
)

const safeAreaBottom = ref(0)
const keyboardHeight = ref(0)
const enterAnim = reactive<Record<string, boolean>>({})
const sendPulse = ref(false)
const inputFocused = ref(false)

let keyboardListener: ((res: { height: number }) => void) | null = null

// #ifdef H5
let h5VvResize: (() => void) | null = null
// #endif

function updateH5KeyboardInset() {
  // #ifdef H5
  if (typeof window === 'undefined' || !window.visualViewport) return
  const vv = window.visualViewport
  const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
  keyboardHeight.value = inset
  // #endif
}

onMounted(() => {
  try {
    const info = uni.getSystemInfoSync()
    safeAreaBottom.value = info.safeAreaInsets?.bottom ?? 0
  } catch {
    safeAreaBottom.value = 0
  }

  // #ifdef MP-WEIXIN
  keyboardListener = (res) => {
    keyboardHeight.value = res.height ?? 0
  }
  uni.onKeyboardHeightChange(keyboardListener)
  // #endif

  // #ifdef H5
  if (typeof window !== 'undefined' && window.visualViewport) {
    h5VvResize = () => updateH5KeyboardInset()
    window.visualViewport.addEventListener('resize', h5VvResize)
    window.visualViewport.addEventListener('scroll', h5VvResize)
    updateH5KeyboardInset()
  }
  // #endif
})

onBeforeUnmount(() => {
  // #ifdef H5
  if (typeof window !== 'undefined' && window.visualViewport && h5VvResize) {
    window.visualViewport.removeEventListener('resize', h5VvResize)
    window.visualViewport.removeEventListener('scroll', h5VvResize)
  }
  // #endif
})

onUnload(() => {
  // #ifdef MP-WEIXIN
  if (keyboardListener) {
    uni.offKeyboardHeightChange(keyboardListener)
    keyboardListener = null
  }
  // #endif
})

const chatPageStyle = computed(() => {
  const kb = keyboardHeight.value
  if (kb > 0) {
    return {
      height: `calc(100dvh - ${kb}px)`,
    }
  }
  return { height: '100dvh' }
})

const messageListFlexStyle = computed(() => ({
  flex: '1',
  minHeight: '0',
  height: '0',
}))

const inputBarPaddingBottom = computed(() => {
  return safeAreaBottom.value + keyboardHeight.value
})

function markMsgEnter(id: string) {
  enterAnim[id] = true
  setTimeout(() => {
    delete enterAnim[id]
  }, 450)
}

const inputText = ref('')

async function handleSend() {
  const text = inputText.value.trim()
  if (!text || chatStore.isLoading || !gameId.value) return

  inputText.value = ''

  const userMsg = {
    id: `user_${Date.now()}`,
    role: 'user' as const,
    content: text,
    createdAt: new Date().toISOString(),
  }
  chatStore.addMessage(userMsg)
  await nextTick()
  markMsgEnter(userMsg.id)
  hapticLight()

  const history = chatStore.getHistoryForApi()
  const historyWithoutCurrent = history.slice(0, -1)

  chatStore.isLoading = true
  try {
    const resp = await sendChatMessage({
      gameId: gameId.value,
      message: text,
      messages: historyWithoutCurrent,
    })

    const assistantMsg = {
      id: resp.message?.id ?? `ast_${Date.now()}`,
      role: 'assistant' as const,
      content: resp.message?.content ?? resp.answer ?? '抱歉，无法生成回复',
      createdAt: resp.message?.createdAt ?? new Date().toISOString(),
      sources: resp.sources ?? [],
    }
    chatStore.addMessage(assistantMsg)
    await nextTick()
    markMsgEnter(assistantMsg.id)
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : '请求失败，请重试'
    const isRateLimit = /今日提问次数/.test(errMsg) || /429/.test(errMsg)
    const errId = `err_${Date.now()}`
    chatStore.addMessage({
      id: errId,
      role: 'assistant',
      content: isRateLimit ? `今日提问次数已达上限，请明日再试。` : `请求出错，请稍后重试。`,
      createdAt: new Date().toISOString(),
      sources: [],
    })
    await nextTick()
    markMsgEnter(errId)
  } finally {
    chatStore.isLoading = false
  }
}

function onSendTap() {
  const text = inputText.value.trim()
  if (!text || chatStore.isLoading || !gameId.value) return
  sendPulse.value = true
  handleSend()
}

function sendSuggested(q: string) {
  inputText.value = q
  handleSend()
}

function confirmClear() {
  uni.showModal({
    title: '清空对话',
    content: '确定要清空当前所有对话记录吗？',
    confirmText: '清空',
    confirmColor: '#e53e3e',
    success: (res) => {
      if (res.confirm) {
        hapticMedium()
        chatStore.clearMessages()
        // #ifdef MP-WEIXIN
        nodeCache.clear()
        // #endif
        // #ifdef H5
        htmlCache.clear()
        // #endif
      }
    },
  })
}
</script>

<style lang="scss" scoped>
@import '../../uni.scss';

.chat-page {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 100%;
  background: $br-bg-page;
  overflow: hidden;
}

.chat-skeleton-wrap {
  flex: 1;
  padding: 24rpx 24rpx 32rpx;
  min-height: 0;
  overflow-y: auto;
}

/* ---- QuickStart 卡片 ---- */
.quickstart-card {
  background: $br-bg-card;
  border-bottom: 1rpx solid #e8ecf1;
  border-left: 6rpx solid $br-color-primary;
  flex-shrink: 0;

  &__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 24rpx 28rpx;
    min-height: 88rpx;

    /* #ifdef H5 */
    cursor: pointer;
    /* #endif */
  }

  &__title {
    display: flex;
    align-items: center;
    gap: 12rpx;
    font-size: 28rpx;
    font-weight: 600;
    color: $br-text-primary;
  }

  &__icon {
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  &__chevron {
    display: flex;
    align-items: center;
    transition: transform $br-duration-normal;

    &.is-open {
      transform: rotate(90deg);
    }
  }

  &__body {
    padding: 0 24rpx 20rpx;
    max-height: 500rpx;
    overflow-y: auto;
    font-size: 26rpx;
    line-height: 1.7;
    color: #333;
  }
}

/* ---- 推荐问题 ---- */
.chips-bar {
  background: $br-bg-card;
  border-bottom: 1rpx solid #e8ecf1;
  padding: 18rpx 24rpx 22rpx;
  flex-shrink: 0;
}

.chips-wrap {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 14rpx 10rpx;
  align-items: flex-start;
}

.chip {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8rpx;
  max-width: 100%;
  padding: 12rpx 20rpx;
  min-height: 60rpx;
  background: #f0fdf4;
  border: 1rpx solid rgba(22, 163, 74, 0.22);
  border-radius: 999rpx;
  box-sizing: border-box;
  transition: background $br-duration-fast, border-color $br-duration-fast;

  /* #ifdef H5 */
  cursor: pointer;

  &:hover {
    background: #dcfce7;
    border-color: rgba(22, 163, 74, 0.4);
  }
  /* #endif */

  &--active {
    background: #dcfce7;
    border-color: rgba(22, 163, 74, 0.4);
  }

  &__icon {
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  &__text {
    font-size: 26rpx;
    color: #15803d;
    line-height: 1.45;
    white-space: normal;
    word-break: break-word;
  }
}

/* ---- 消息列表 ---- */
.message-list {
  flex: 1;
  padding: 16rpx 24rpx 12rpx;
  min-height: 0;
  width: 100%;
  box-sizing: border-box;
}

.empty-hint {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 56rpx 32rpx 40rpx;
  gap: 18rpx;

  &__icon {
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 4rpx;
  }

  &__text {
    font-size: 28rpx;
    color: $br-text-secondary;
    text-align: center;
    line-height: 1.55;
    max-width: 92%;
  }

  &__disclaimer {
    font-size: 22rpx;
    color: #94a3b8;
    text-align: center;
    line-height: 1.65;
    max-width: 88%;
    padding: 16rpx 20rpx;
    background: #f8fafc;
    border-radius: 16rpx;
    border: 1rpx solid #e2e8f0;
  }
}

.msg-row {
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

.avatar {
  width: 72rpx;
  height: 72rpx;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;

  &--assistant {
    background: linear-gradient(145deg, #dcfce7 0%, #bbf7d0 100%);
    box-shadow: 0 2rpx 8rpx rgba(22, 163, 74, 0.14);
  }

  &--user {
    background: linear-gradient(145deg, #d1fae5 0%, #a7f3d0 100%);
    box-shadow: 0 2rpx 8rpx rgba(16, 185, 129, 0.12);
  }
}

.bubble-wrapper {
  display: flex;
  flex-direction: column;
  max-width: 85%;
  gap: 0;
}

.bubble {
  padding: 22rpx 26rpx;
  border-radius: $br-radius-bubble;
  word-break: break-word;

  &--user {
    background: $br-gradient-user-bubble;
    border-bottom-right-radius: 8rpx;
    align-self: flex-end;
    box-shadow: 0 4rpx 16rpx rgba(22, 163, 74, 0.28);
  }

  &--assistant {
    background: $br-bg-card;
    border-bottom-left-radius: 8rpx;
    box-shadow: $br-shadow-card;
  }

  &--loading {
    padding: 20rpx 28rpx;
  }
}

.bubble__text {
  font-size: 30rpx;
  line-height: 1.55;
  color: #fff;
}

.typing-dots {
  display: flex;
  gap: 12rpx;
  align-items: center;

  &__dot {
    width: 14rpx;
    height: 14rpx;
    border-radius: 50%;
    background: #86efac;
    animation: typing-wave 1.1s ease-in-out infinite;

    &:nth-child(2) {
      animation-delay: 0.15s;
    }
    &:nth-child(3) {
      animation-delay: 0.3s;
    }
  }
}

@keyframes typing-wave {
  0%,
  60%,
  100% {
    opacity: 0.35;
    transform: translate3d(0, 0, 0) scale(0.85);
  }
  30% {
    opacity: 1;
    transform: translate3d(0, -6rpx, 0) scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .typing-dots__dot {
    animation: none;
    opacity: 0.7;
  }
}

/* ---- 输入栏 ---- */
.input-bar {
  background: $br-bg-card;
  border-top: 1rpx solid #e8ecf1;
  padding: 16rpx 24rpx 12rpx;
  flex-shrink: 0;
  box-shadow: 0 -4rpx 24rpx rgba(0, 0, 0, 0.04);

  &__inner {
    display: flex;
    align-items: flex-end;
    gap: 12rpx;
    min-height: 88rpx;
  }

  &__clear-icon {
    width: 72rpx;
    height: 72rpx;
    border-radius: 50%;
    background: #f1f5f9;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: background $br-duration-fast, transform $br-duration-fast;

    /* #ifdef H5 */
    cursor: pointer;
    /* #endif */

    &--active {
      background: #e2e8f0;
      transform: scale(0.95);
    }
  }

  &__textarea {
    flex: 1;
    background: #f1f5f9;
    border-radius: 22rpx;
    padding: 18rpx 22rpx;
    font-size: 30rpx;
    line-height: 1.45;
    max-height: 220rpx;
    min-height: 80rpx;
    color: $br-text-primary;
    border: 2rpx solid transparent;
    transition: border-color $br-duration-fast, box-shadow $br-duration-fast;

    &--focus {
      border-color: rgba(22, 163, 74, 0.45);
      box-shadow: 0 0 0 4rpx rgba(22, 163, 74, 0.1);
    }
  }

  &__send {
    width: 80rpx;
    height: 80rpx;
    border-radius: 50%;
    background: #e2e8f0;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: background $br-duration-fast, box-shadow $br-duration-fast;
    color: #94a3b8;

    /* #ifdef H5 */
    cursor: pointer;
    /* #endif */

    &.is-active {
      background: $br-gradient-send-active;
      box-shadow: 0 4rpx 14rpx rgba(22, 163, 74, 0.38);
      color: #fff;
    }

    &:active.is-active {
      transform: scale(0.94);
    }
  }
}

/* #ifdef H5 */
.markdown-body {
  font-size: 30rpx;
  line-height: 1.55;
  color: $br-text-primary;
  word-break: break-word;
}

.bubble__md {
  width: 100%;
}

.quickstart-md {
  font-size: 26rpx;
  line-height: 1.7;
  color: #333;
}
/* #endif */
</style>

<!-- #ifdef H5 -->
<style lang="scss">
@import '../../uni.scss';

.chat-page .markdown-body p {
  margin: 0 0 0.5em;
}
.chat-page .markdown-body p:last-child {
  margin-bottom: 0;
}
.chat-page .markdown-body ul,
.chat-page .markdown-body ol {
  margin: 0.4em 0;
  padding-left: 1.2em;
}
.chat-page .markdown-body pre {
  margin: 0.5em 0;
  padding: 12rpx 16rpx;
  background: #f4f6f9;
  border-radius: 8rpx;
  overflow-x: auto;
  font-size: 24rpx;
}
.chat-page .markdown-body code {
  font-family: ui-monospace, monospace;
  font-size: 0.92em;
}
.chat-page .markdown-body pre code {
  background: transparent;
  padding: 0;
}
.chat-page .markdown-body a {
  color: $br-color-primary;
}
.chat-page .bubble--assistant .markdown-body {
  color: $br-text-primary;
}
</style>
<!-- #endif -->
