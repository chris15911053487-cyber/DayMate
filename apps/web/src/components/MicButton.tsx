import { Mic } from 'lucide-react'

/** 底部中间的"按住说话"大按钮。M3 接入 online-report 移植来的 useHoldToTalk，现在只给提示。 */
export function MicButton({ onPress, size = 'lg' }: { onPress?: () => void; size?: 'lg' | 'md' }) {
  const dim = size === 'lg' ? 'size-16' : 'size-12'
  return (
    <button
      type="button"
      aria-label="按住说话"
      onClick={onPress}
      className={`${dim} flex items-center justify-center rounded-full bg-primary text-primary-fg shadow-lg ring-4 ring-bg transition-transform active:scale-95`}
    >
      <Mic size={size === 'lg' ? 28 : 22} />
    </button>
  )
}
