import type { CalendarColor } from '@daymate/shared'

/** 日历本颜色 → 语义色类名（写全，Tailwind 才扫描得到） */
export const CAL_COLOR: Record<CalendarColor, { dot: string; soft: string; text: string; border: string; label: string }> = {
  primary: { dot: 'bg-primary', soft: 'bg-primary/15', text: 'text-primary', border: 'border-primary', label: '主色' },
  accent: { dot: 'bg-accent', soft: 'bg-accent/15', text: 'text-accent', border: 'border-accent', label: '点缀色' },
  success: { dot: 'bg-success', soft: 'bg-success/15', text: 'text-success', border: 'border-success', label: '绿' },
  warning: { dot: 'bg-warning', soft: 'bg-warning/15', text: 'text-warning', border: 'border-warning', label: '橙' },
  danger: { dot: 'bg-danger', soft: 'bg-danger/15', text: 'text-danger', border: 'border-danger', label: '红' },
}
