import { useEffect, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'

/** 全局轻提示，可带一个操作按钮（如"撤销"） */
interface ToastItem {
  id: number
  message: string
  action?: { label: string; onClick: () => void }
}
let current: ToastItem | null = null
let seq = 0
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((fn) => fn())

export function toast(message: string, action?: ToastItem['action']) {
  current = { id: ++seq, message, action }
  emit()
}

export function Toaster() {
  const item = useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => current,
  )
  useEffect(() => {
    if (!item) return
    const t = window.setTimeout(() => {
      if (current?.id === item.id) {
        current = null
        emit()
      }
    }, item.action ? 5000 : 2500)
    return () => window.clearTimeout(t)
  }, [item])
  if (!item) return null
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-28 z-[80] flex justify-center px-4 lg:bottom-10">
      <div role="status" className="card pointer-events-auto flex items-center gap-4 px-4 py-2.5 text-sm">
        <span>{item.message}</span>
        {item.action && (
          <button
            type="button"
            className="font-medium text-primary"
            onClick={() => {
              item.action!.onClick()
              current = null
              emit()
            }}
          >
            {item.action.label}
          </button>
        )}
      </div>
    </div>,
    document.body,
  )
}
