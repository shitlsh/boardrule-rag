import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ChatMessage } from '../types/index'

const STORAGE_KEY_PREFIX = 'chat_history_'
const MAX_STORED_MESSAGES = 100

// -------------------------------------------------------
// 持久化工具函数
// -------------------------------------------------------

function loadHistory(gameId: string): ChatMessage[] {
  try {
    const raw = uni.getStorageSync(`${STORAGE_KEY_PREFIX}${gameId}`)
    if (raw && typeof raw === 'string') {
      return JSON.parse(raw) as ChatMessage[]
    }
  } catch {
    // storage 读取失败时静默返回空数组
  }
  return []
}

function saveHistory(gameId: string, messages: ChatMessage[]): void {
  try {
    // 只保留最新的 N 条，避免 storage 超限
    const toSave = messages.slice(-MAX_STORED_MESSAGES)
    uni.setStorageSync(`${STORAGE_KEY_PREFIX}${gameId}`, JSON.stringify(toSave))
  } catch {
    // storage 写入失败时静默忽略
  }
}

function clearHistory(gameId: string): void {
  try {
    uni.removeStorageSync(`${STORAGE_KEY_PREFIX}${gameId}`)
  } catch {
    // 忽略
  }
}

// -------------------------------------------------------
// Store
// -------------------------------------------------------

export const useChatStore = defineStore('chat', () => {
  /** 当前游戏 ID */
  const currentGameId = ref<string | null>(null)

  /** 当前游戏的消息列表 */
  const messages = ref<ChatMessage[]>([])

  /** 是否正在等待回复 */
  const isLoading = ref(false)

  /**
   * 切换到指定游戏，从本地存储恢复历史记录
   */
  function enterGame(gameId: string) {
    currentGameId.value = gameId
    messages.value = loadHistory(gameId)
  }

  /**
   * 追加一条消息并持久化
   */
  function addMessage(msg: ChatMessage) {
    messages.value.push(msg)
    if (currentGameId.value) {
      saveHistory(currentGameId.value, messages.value)
    }
  }

  /**
   * 清空当前游戏的对话历史
   */
  function clearMessages() {
    messages.value = []
    if (currentGameId.value) {
      clearHistory(currentGameId.value)
    }
  }

  /**
   * 构建发送给 BFF 的历史消息数组（不含当前正在发送的消息）
   * 只传 role + content，去掉 id / createdAt / sources
   */
  function getHistoryForApi(): { role: 'user' | 'assistant'; content: string }[] {
    return messages.value.map((m) => ({
      role: m.role,
      content: m.content,
    }))
  }

  /** Patch one message (e.g. streaming assistant content). */
  function updateMessage(id: string, patch: Partial<ChatMessage>) {
    const i = messages.value.findIndex((m) => m.id === id)
    if (i < 0) return
    messages.value[i] = { ...messages.value[i], ...patch } as ChatMessage
    if (currentGameId.value) {
      saveHistory(currentGameId.value, messages.value)
    }
  }

  return {
    currentGameId,
    messages,
    isLoading,
    enterGame,
    addMessage,
    updateMessage,
    clearMessages,
    getHistoryForApi,
  }
})
