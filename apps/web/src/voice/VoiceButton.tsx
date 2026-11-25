import { LoaderCircle, Mic } from 'lucide-react'
import type { SpeechResult } from '@daymate/shared'
import { cn } from '../ui'
import { useHoldToTalk } from './useHoldToTalk'

/**
 * 按住说话的按钮：按住录音、松开识别、上滑取消；轻点 = 打字。
 * 指针事件写法沿用 online-report 的 HoldToTalk（setPointerCapture + touch-none，避免手机浏览器手势打断）。
 */
export function VoiceButton({
  onText,
  onTap,
  size = 'lg',
  className,
}: {
  onText: (r: SpeechResult) => void
  onTap: () => void
  size?: 'lg' | 'md' | 'sm'
  className?: string
}) {
  const hold = useHoldToTalk(onText, onTap)
  const dim = size === 'lg' ? 'size-16' : size === 'md' ? 'size-12' : 'size-10'
  const icon = size === 'lg' ? 28 : size === 'md' ? 22 : 18
  return (
    <>
      <button
        type="button"
        aria-label="按住说话，轻点打字"
        disabled={hold.phase === 'recognizing'}
        onPointerDown={(e) => {
          if (hold.phase !== 'idle') return
          e.preventDefault()
          e.currentTarget.setPointerCapture(e.pointerId)
          void hold.begin(e.clientY)
        }}
        onPointerMove={(e) => hold.move(e.clientY)}
        onPointerUp={hold.end}
        onPointerCancel={hold.abort}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          // 键盘用户：回车 / 空格打开打字输入
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onTap()
          }
        }}
        className={cn(
          dim,
          'flex touch-none select-none items-center justify-center rounded-full bg-primary text-primary-fg shadow-lg ring-4 ring-bg transition-transform',
          hold.phase === 'recording' ? 'scale-110' : 'active:scale-95',
          className,
        )}
        style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
      >
        {hold.phase === 'recognizing' ? <LoaderCircle size={icon} className="animate-spin" /> : <Mic size={icon} />}
      </button>
      {hold.overlay}
    </>
  )
}
