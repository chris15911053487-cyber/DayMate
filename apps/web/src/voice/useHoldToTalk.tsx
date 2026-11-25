import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { SpeechResult } from '@daymate/shared'
import { ApiError } from '../api/client'
import { cn } from '../ui'
import { toast } from '../ui/toast'
import {
  MAX_RECORD_MS,
  recognizeSpeech,
  startRecording,
  voiceInputSupported,
  type Recording,
} from './recorder'

/** 短于此时长视为误触 */
const MIN_RECORD_MS = 500
/** 手指上滑超过此距离，松开即取消 */
const CANCEL_DISTANCE = 60

export type HoldPhase = 'idle' | 'recording' | 'recognizing'

/**
 * 「按住说话」的录音流程（移植自 online-report hooks/useHoldToTalk.tsx）：
 * begin 开始录音，move 跟踪上滑取消，end 松开识别，abort 作废。
 * 识别出的文字交给 onText；按得太短算"轻点"，交给 onTap（DayMate 用来打开打字输入）。
 * overlay 是录音时的浮层（音量条 / 计时 / 上滑取消），由调用方渲染。
 */
export function useHoldToTalk(onText: (result: SpeechResult) => void, onTap?: () => void) {
  const showToast = toast
  const [supported] = useState(voiceInputSupported)
  const [phase, setPhase] = useState<HoldPhase>('idle')
  const [cancelArmed, setCancelArmed] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [level, setLevel] = useState(0)
  /** 麦克风已出数据：此前提示「准备中」，避免一按就说、开头被吞 */
  const [ready, setReady] = useState(false)

  const recRef = useRef<Recording | null>(null)
  const holdingRef = useRef(false)
  const startYRef = useRef(0)
  const startAtRef = useRef(0)
  const cancelArmedRef = useRef(false)
  const tickRef = useRef<number | null>(null)
  const maxTimerRef = useRef<number | null>(null)

  const clearTimers = () => {
    if (tickRef.current != null) window.clearInterval(tickRef.current)
    if (maxTimerRef.current != null) window.clearTimeout(maxTimerRef.current)
    tickRef.current = null
    maxTimerRef.current = null
  }

  // 卸载时释放麦克风
  useEffect(() => () => {
    clearTimers()
    recRef.current?.cancel()
    recRef.current = null
  }, [])

  const finish = async (cancel: boolean) => {
    holdingRef.current = false
    clearTimers()
    const rec = recRef.current
    recRef.current = null
    setCancelArmed(false)
    cancelArmedRef.current = false
    if (!rec) {
      setPhase('idle')
      return
    }
    const duration = Date.now() - startAtRef.current
    if (cancel || duration < MIN_RECORD_MS) {
      rec.cancel()
      setPhase('idle')
      if (!cancel) {
        if (onTap) onTap()
        else showToast('说话时间太短')
      }
      return
    }
    setPhase('recognizing')
    try {
      const samples = await rec.stop()
      const result = await recognizeSpeech(samples)
      if (result.text) onText(result)
      else showToast('没听清，请再说一遍')
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : (e as Error).message || '语音识别失败')
    } finally {
      setPhase('idle')
    }
  }

  /** 开始录音；clientY 为按下位置（上滑取消的起点） */
  const begin = async (clientY: number) => {
    if (phase !== 'idle' || holdingRef.current) return
    // 不支持录音（非 HTTPS、浏览器太旧）：直接改成打字
    if (!supported) {
      showToast('这里用不了麦克风（需要 HTTPS），先打字吧')
      onTap?.()
      return
    }
    holdingRef.current = true
    startYRef.current = clientY
    cancelArmedRef.current = false
    setCancelArmed(false)
    setElapsed(0)
    setLevel(0)
    setReady(false)
    setPhase('recording')
    let rec: Recording
    try {
      rec = await startRecording()
    } catch (err) {
      holdingRef.current = false
      setPhase('idle')
      // 没给麦克风权限：提示后改成打字，别让人卡住
      showToast(`${(err as Error).message}，先打字吧`)
      onTap?.()
      return
    }
    // 麦克风还没启动手指就松开了：轻点（或首次授权弹窗期间松手），本次不录，当成轻点
    if (!holdingRef.current) {
      rec.cancel()
      setPhase('idle')
      onTap?.()
      return
    }
    recRef.current = rec
    setReady(true)
    startAtRef.current = Date.now()
    tickRef.current = window.setInterval(() => {
      setElapsed(Date.now() - startAtRef.current)
      setLevel(rec.level())
    }, 100)
    // 松开后还会多录一小段，提前一点结束，保证不超过百度上限
    maxTimerRef.current = window.setTimeout(() => void finish(false), MAX_RECORD_MS - 1000)
  }

  const move = (clientY: number) => {
    if (!holdingRef.current) return
    const armed = startYRef.current - clientY > CANCEL_DISTANCE
    if (armed !== cancelArmedRef.current) {
      cancelArmedRef.current = armed
      setCancelArmed(armed)
    }
  }

  /** 松开：上滑过则取消，否则识别 */
  const end = () => {
    if (!holdingRef.current) return
    void finish(cancelArmedRef.current)
  }

  const abort = () => {
    if (!holdingRef.current) return
    void finish(true)
  }

  const secondsLeft = Math.ceil((MAX_RECORD_MS - 1000 - elapsed) / 1000)
  const bars = [0.5, 0.8, 1, 0.8, 0.5]

  const overlay =
    phase === 'recording'
      ? createPortal(
          <div className="fixed inset-x-0 bottom-36 z-[60] flex justify-center pointer-events-none px-4 lg:bottom-1/3">
            <div
              className={cn(
                'rounded-2xl px-6 py-4 shadow-lg flex flex-col items-center gap-2 min-w-[180px] transition-colors',
                cancelArmed ? 'bg-danger text-primary-fg' : 'bg-inverse text-inverse-fg',
              )}
            >
              <div className="flex items-end gap-1 h-8">
                {bars.map((w, i) => (
                  <span
                    key={i}
                    className="w-1.5 rounded-full bg-current transition-all duration-100"
                    style={{ height: `${Math.max(15, Math.min(100, level * 260 * w))}%`, opacity: cancelArmed ? 0.6 : 0.9 }}
                  />
                ))}
              </div>
              <div className="text-sm font-medium">
                {cancelArmed ? '松开 取消' : ready ? '请说话' : '准备中…'}
              </div>
              <div className="text-xs opacity-75 num">
                {!ready
                  ? '稍等，提示「请说话」再开口'
                  : secondsLeft <= 5
                    ? `${secondsLeft} 秒后自动结束`
                    : `${Math.floor(elapsed / 1000)}″ · 松开结束 · 上滑取消`}
              </div>
            </div>
          </div>,
          document.body,
        )
      : null

  return { supported, phase, cancelArmed, ready, begin, move, end, abort, overlay }
}
