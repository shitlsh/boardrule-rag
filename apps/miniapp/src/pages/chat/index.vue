<!-- @ts-nocheck towxml is a native WeChat miniprogram component without Vue type declarations -->
<template>
  <view class="chat-page">
    <!-- ===== 游戏信息加载中 ===== -->
    <view v-if="gameLoading" class="game-loading">
      <view class="loading-dots">
        <view class="dot" /><view class="dot" /><view class="dot" />
      </view>
    </view>

    <block v-else>
      <!-- ===== QuickStart 折叠卡片 ===== -->
      <view v-if="game?.quickStart" class="quickstart-card">
        <view class="quickstart-card__header" @tap="toggleQuickStart">
          <view class="quickstart-card__title">
            <text class="quickstart-card__icon">📖</text>
            <text>快速开始指南</text>
          </view>
          <text class="quickstart-card__chevron" :class="{ 'is-open': quickStartOpen }">
            ›
          </text>
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

      <!-- ===== 推荐问题 chips ===== -->
      <view
        v-if="suggestedQuestions.length > 0 && chatStore.messages.length === 0"
        class="chips-bar"
      >
        <scroll-view scroll-x class="chips-scroll">
          <view class="chips-inner">
            <view
              v-for="(q, i) in suggestedQuestions"
              :key="i"
              class="chip"
              @tap="sendSuggested(q)"
            >
              <text class="chip__text">{{ q }}</text>
            </view>
          </view>
        </scroll-view>
      </view>

      <!-- ===== 消息列表 ===== -->
      <scroll-view
        :scroll-y="true"
        :scroll-top="scrollTop"
        :scroll-with-animation="true"
        class="message-list"
        :style="{ height: messageListHeight }"
      >
        <!-- 空状态提示 -->
        <view v-if="chatStore.messages.length === 0" class="empty-hint">
          <text class="empty-hint__text">向 AI 提问关于《{{ gameName }}》的规则问题</text>
        </view>

        <view
          v-for="msg in chatStore.messages"
          :key="msg.id"
          class="msg-row"
          :class="msg.role === 'user' ? 'msg-row--user' : 'msg-row--assistant'"
        >
          <!-- 助手头像 -->
          <view v-if="msg.role === 'assistant'" class="avatar avatar--assistant">
            <text>🤖</text>
          </view>

          <view class="bubble-wrapper">
            <!-- 气泡 -->
            <view
              class="bubble"
              :class="msg.role === 'user' ? 'bubble--user' : 'bubble--assistant'"
            >
              <!-- 用户消息：纯文本 -->
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

            <!-- 来源标签 -->
            <view
              v-if="msg.role === 'assistant' && msg.sources && msg.sources.length > 0"
              class="source-tags"
            >
              <view
                v-for="(src, si) in msg.sources"
                :key="si"
                class="source-tag"
              >
                <text class="source-tag__icon">📄</text>
                <text class="source-tag__text">
                  {{ formatSource(src) }}
                </text>
              </view>
            </view>
          </view>

          <!-- 用户头像 -->
          <view v-if="msg.role === 'user'" class="avatar avatar--user">
            <text>👤</text>
          </view>
        </view>

        <!-- 打字 loading -->
        <view v-if="chatStore.isLoading" class="msg-row msg-row--assistant">
          <view class="avatar avatar--assistant"><text>🤖</text></view>
          <view class="bubble bubble--assistant bubble--loading">
            <view class="loading-dots">
              <view class="dot" /><view class="dot" /><view class="dot" />
            </view>
          </view>
        </view>

        <!-- 底部锚点，用于自动滚动 -->
        <view id="msg-bottom" style="height: 1px;" />
      </scroll-view>

      <!-- ===== 底部输入栏 ===== -->
      <view class="input-bar" :style="{ paddingBottom: safeAreaBottom + 'px' }">
        <view class="input-bar__inner">
          <textarea
            v-model="inputText"
            class="input-bar__textarea"
            placeholder="输入规则问题..."
            :disabled="chatStore.isLoading"
            :maxlength="500"
            auto-height
            :show-confirm-bar="false"
            @confirm="handleSend"
          />
          <view
            class="input-bar__send"
            :class="{ 'is-active': inputText.trim() && !chatStore.isLoading }"
            @tap="handleSend"
          >
            <text class="input-bar__send-icon">↑</text>
          </view>
        </view>
        <!-- 清空历史 -->
        <view v-if="chatStore.messages.length > 0" class="input-bar__clear" @tap="confirmClear">
          <text class="input-bar__clear-text">清空对话</text>
        </view>
      </view>
    </block>
  </view>
</template>

<script setup lang="ts">
// @ts-nocheck
// towxml is a native WeChat miniprogram component (usingComponents). Its props
// are typed as `string & Record<string,unknown>` by @dcloudio/types, which
// conflicts with the object nodes towxml expects. Suppressing template TS checks
// for this file is the accepted workaround in the UniApp community.
import { ref, computed, onMounted, nextTick, watch } from 'vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import { useChatStore } from '../../store/chat'
import { fetchGame, sendChatMessage } from '../../api/bff'
import { getOrFetchUserId } from '../../utils/auth'
import type { Game, SourceRef } from '../../types/index'

// #ifdef H5
import { renderMarkdownToHtml } from '../../utils/markdown'
// #endif

// #ifdef MP-WEIXIN
// towxml 解析器（原生小程序 CommonJS 模块，通过 require 加载）
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TowxmlParser = (content: string, type: 'markdown' | 'html', options?: Record<string, unknown>) => any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const towxml = (require as any)('../../wxcomponents/towxml/index.js') as TowxmlParser
// #endif

// -------------------------------------------------------
// 路由参数
// -------------------------------------------------------
const gameId = ref('')
const gameName = ref('')

onLoad((options) => {
  gameId.value = options?.gameId ?? ''
  gameName.value = decodeURIComponent(options?.gameName ?? '游戏')
  uni.setNavigationBarTitle({ title: gameName.value })
})

// -------------------------------------------------------
// User identity (Bearer JWT for BFF; chat rate limit is by IP on server)
// -------------------------------------------------------
const userId = ref<string | null>(null)

// -------------------------------------------------------
// Store
// -------------------------------------------------------
const chatStore = useChatStore()

// -------------------------------------------------------
// 游戏详情
// -------------------------------------------------------
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
  // Ensure we have a userId for rate-limit header (no-op if already cached)
  getOrFetchUserId().then((id) => {
    if (id) userId.value = id
  })
})

// -------------------------------------------------------
// QuickStart 折叠
// -------------------------------------------------------
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

// -------------------------------------------------------
// 来源标签格式化
// -------------------------------------------------------
function formatSource(src: SourceRef): string {
  if (src.pages) return `来源：第 ${src.pages} 页`
  if (src.page_start != null && src.page_end != null) {
    return src.page_start === src.page_end
      ? `来源：第 ${src.page_start} 页`
      : `来源：第 ${src.page_start}–${src.page_end} 页`
  }
  return '查看来源'
}

// -------------------------------------------------------
// 滚动控制
// -------------------------------------------------------
const scrollTop = ref(0)

async function scrollToBottom() {
  await nextTick()
  // 通过更新 scrollTop 到极大值触发滚动
  scrollTop.value = 0
  await nextTick()
  scrollTop.value = 999999
}

watch(() => chatStore.messages.length, scrollToBottom)
watch(() => chatStore.isLoading, (v) => { if (v) scrollToBottom() })

// -------------------------------------------------------
// 键盘安全区
// -------------------------------------------------------
const safeAreaBottom = ref(0)

onMounted(() => {
  try {
    const info = uni.getSystemInfoSync()
    safeAreaBottom.value = info.safeAreaInsets?.bottom ?? 0
  } catch {
    safeAreaBottom.value = 0
  }
})

// 消息列表高度：撑满除 quickstart / chips / inputbar 之外的空间
const messageListHeight = computed(() => {
  return 'calc(100vh - 44px - var(--quickstart-h, 0px) - var(--chips-h, 0px) - 120rpx)'
})

// -------------------------------------------------------
// 发送消息
// -------------------------------------------------------
const inputText = ref('')

async function handleSend() {
  const text = inputText.value.trim()
  if (!text || chatStore.isLoading || !gameId.value) return

  inputText.value = ''

  // 先追加用户消息
  const userMsg = {
    id: `user_${Date.now()}`,
    role: 'user' as const,
    content: text,
    createdAt: new Date().toISOString(),
  }
  chatStore.addMessage(userMsg)

  // 获取当前历史（不含刚加的用户消息，BFF 会把 message 字段作为当前消息）
  const history = chatStore.getHistoryForApi()
  // getHistoryForApi 已包含刚加的用户消息，需要去掉最后一条
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
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : '请求失败，请重试'
    // 429 rate-limit error — the BFF message is already user-friendly
    const isRateLimit = /今日提问次数/.test(errMsg) || /429/.test(errMsg)
    chatStore.addMessage({
      id: `err_${Date.now()}`,
      role: 'assistant',
      content: isRateLimit ? `⏰ ${errMsg}` : `⚠️ ${errMsg}`,
      createdAt: new Date().toISOString(),
      sources: [],
    })
  } finally {
    chatStore.isLoading = false
  }
}

function sendSuggested(q: string) {
  inputText.value = q
  handleSend()
}

// -------------------------------------------------------
// 清空历史
// -------------------------------------------------------
function confirmClear() {
  uni.showModal({
    title: '清空对话',
    content: '确定要清空当前所有对话记录吗？',
    confirmText: '清空',
    confirmColor: '#e53e3e',
    success: (res) => {
      if (res.confirm) {
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
.chat-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #f4f6f9;
  overflow: hidden;
}

/* ---- 游戏加载 ---- */
.game-loading {
  display: flex;
  justify-content: center;
  padding: 40rpx;
}

/* ---- QuickStart 卡片 ---- */
.quickstart-card {
  background: #fff;
  border-bottom: 1rpx solid #eee;

  &__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 24rpx 32rpx;
  }

  &__title {
    display: flex;
    align-items: center;
    gap: 12rpx;
    font-size: 28rpx;
    font-weight: 600;
    color: #1a1a2e;
  }

  &__icon {
    font-size: 32rpx;
  }

  &__chevron {
    font-size: 36rpx;
    color: #999;
    transform: rotate(90deg);
    transition: transform 0.2s;
    display: inline-block;

    &.is-open {
      transform: rotate(270deg);
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
  background: #fff;
  border-bottom: 1rpx solid #eee;
  padding: 16rpx 0;
}

.chips-scroll {
  width: 100%;
  white-space: nowrap;
}

.chips-inner {
  display: flex;
  flex-direction: row;
  padding: 0 24rpx;
  gap: 16rpx;
}

.chip {
  display: inline-flex;
  align-items: center;
  padding: 12rpx 24rpx;
  background: #eef4ff;
  border: 1rpx solid #b8d0f5;
  border-radius: 40rpx;
  flex-shrink: 0;

  &__text {
    font-size: 24rpx;
    color: #2a6dd9;
    white-space: nowrap;
  }
}

/* ---- 消息列表 ---- */
.message-list {
  flex: 1;
  padding: 20rpx 20rpx 0;
}

.empty-hint {
  display: flex;
  justify-content: center;
  padding: 60rpx 40rpx;

  &__text {
    font-size: 26rpx;
    color: #aaa;
    text-align: center;
    line-height: 1.6;
  }
}

/* ---- 消息行 ---- */
.msg-row {
  display: flex;
  align-items: flex-end;
  margin-bottom: 24rpx;
  gap: 12rpx;

  &--user {
    flex-direction: row-reverse;
  }

  &--assistant {
    flex-direction: row;
  }
}

/* ---- 头像 ---- */
.avatar {
  width: 64rpx;
  height: 64rpx;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 36rpx;
  flex-shrink: 0;

  &--assistant {
    background: #e8f0fe;
  }

  &--user {
    background: #e6f4ea;
  }
}

/* ---- 气泡 ---- */
.bubble-wrapper {
  display: flex;
  flex-direction: column;
  max-width: 74%;
  gap: 8rpx;
}

.bubble {
  padding: 20rpx 24rpx;
  border-radius: 20rpx;
  word-break: break-word;

  &--user {
    background: #1a6dd9;
    border-bottom-right-radius: 6rpx;
    align-self: flex-end;
  }

  &--assistant {
    background: #fff;
    border-bottom-left-radius: 6rpx;
    box-shadow: 0 2rpx 12rpx rgba(0, 0, 0, 0.06);
  }

  &--loading {
    padding: 20rpx 28rpx;
  }
}

.bubble__text {
  font-size: 28rpx;
  line-height: 1.65;
  color: #fff;
}

/* ---- 来源标签 ---- */
.source-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8rpx;
  padding-left: 4rpx;
}

.source-tag {
  display: flex;
  align-items: center;
  gap: 6rpx;
  padding: 6rpx 16rpx;
  background: #f0f4ff;
  border: 1rpx solid #d0deff;
  border-radius: 24rpx;

  &__icon {
    font-size: 20rpx;
  }

  &__text {
    font-size: 20rpx;
    color: #4a6fa5;
  }
}

/* ---- Loading dots ---- */
.loading-dots {
  display: flex;
  gap: 10rpx;
  align-items: center;

  .dot {
    width: 14rpx;
    height: 14rpx;
    border-radius: 50%;
    background: #aaa;
    animation: pulse 1.2s ease-in-out infinite;

    &:nth-child(2) { animation-delay: 0.2s; }
    &:nth-child(3) { animation-delay: 0.4s; }
  }
}

@keyframes pulse {
  0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
  40% { opacity: 1; transform: scale(1); }
}

/* ---- 输入栏 ---- */
.input-bar {
  background: #fff;
  border-top: 1rpx solid #eee;
  padding-top: 16rpx;
  padding-left: 20rpx;
  padding-right: 20rpx;

  &__inner {
    display: flex;
    align-items: flex-end;
    gap: 16rpx;
    min-height: 80rpx;
  }

  &__textarea {
    flex: 1;
    background: #f4f6f9;
    border-radius: 20rpx;
    padding: 16rpx 20rpx;
    font-size: 28rpx;
    line-height: 1.5;
    max-height: 200rpx;
    color: #1a1a2e;
  }

  &__send {
    width: 72rpx;
    height: 72rpx;
    border-radius: 50%;
    background: #ddd;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: background 0.15s;

    &.is-active {
      background: #1a6dd9;
    }
  }

  &__send-icon {
    font-size: 36rpx;
    color: #fff;
    font-weight: 700;
  }

  &__clear {
    display: flex;
    justify-content: center;
    padding: 12rpx 0 4rpx;
  }

  &__clear-text {
    font-size: 22rpx;
    color: #bbb;
  }
}

/* #ifdef H5 */
/* markdown-it 输出 */
.markdown-body {
  font-size: 28rpx;
  line-height: 1.65;
  color: #1a1a2e;
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
/* v-html 内部节点（H5 专用；无 scoped 以便选子元素） */
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
  color: #1a6dd9;
}
.chat-page .bubble--assistant .markdown-body {
  color: #1a1a2e;
}
</style>
<!-- #endif -->
