import { useSyncExternalStore } from 'react'

/** 全局助手面板的开关：按住说话识别完、或轻点语音按钮（打字）时打开 */
export interface AssistantState {
  open: boolean
  text: string
  voiceLogId: string | null
  inputMode: 'voice' | 'text'
  /** 每次打开加一，面板据此决定是否重新解析 */
  seq: number
}

let state: AssistantState = { open: false, text: '', voiceLogId: null, inputMode: 'text', seq: 0 }
const listeners = new Set<() => void>()
const set = (next: AssistantState) => {
  state = next
  listeners.forEach((fn) => fn())
}

export function openAssistant(opts: { text?: string; voiceLogId?: string | null; inputMode: 'voice' | 'text' }) {
  set({ open: true, text: opts.text ?? '', voiceLogId: opts.voiceLogId ?? null, inputMode: opts.inputMode, seq: state.seq + 1 })
}

export function closeAssistant() {
  set({ ...state, open: false })
}

export function useAssistant() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => state,
  )
}
