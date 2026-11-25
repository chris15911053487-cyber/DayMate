import { addDays, splitKey, startOfMonth, startOfWeek, type Occurrence } from '@daymate/shared'
import { cn } from '../../ui'
import { occursOn, useTz } from '../../utils/datetime'
import { CAL_COLOR } from './colors'

export const WEEK_HEAD = ['一', '二', '三', '四', '五', '六', '日']

/** 月视图要显示的 6 周（周一开始） */
export function monthGridRange(anchor: string) {
  const first = startOfWeek(startOfMonth(anchor))
  return { from: first, to: addDays(first, 41) }
}

export function MonthView({
  anchor,
  selected,
  today,
  occurrences,
  onSelect,
}: {
  anchor: string
  selected: string
  today: string
  occurrences: Occurrence[]
  onSelect: (day: string) => void
}) {
  const tz = useTz()
  const { from } = monthGridRange(anchor)
  const month = splitKey(anchor).month
  const days = Array.from({ length: 42 }, (_, i) => addDays(from, i))

  return (
    <div className="card overflow-hidden">
      <div className="grid grid-cols-7 border-b border-line text-center text-xs text-muted">
        {WEEK_HEAD.map((d) => (
          <div key={d} className="py-2">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7" role="grid" aria-label="月视图">
        {days.map((d, i) => {
          const items = occurrences.filter((o) => occursOn(o, d, tz))
          const inMonth = splitKey(d).month === month
          const isSel = d === selected
          return (
            <button
              key={d}
              type="button"
              role="gridcell"
              aria-selected={isSel}
              aria-label={`${splitKey(d).month}月${splitKey(d).day}日，${items.length} 个日程`}
              onClick={() => onSelect(d)}
              className={cn(
                'flex min-h-14 flex-col items-center gap-1 border-line px-0.5 pb-1.5 pt-1 text-left lg:min-h-24 lg:items-stretch lg:px-1',
                i % 7 !== 6 && 'border-r',
                i < 35 && 'border-b',
                isSel && 'bg-primary-soft',
              )}
            >
              <span
                className={cn(
                  'flex size-7 items-center justify-center rounded-full text-sm tabular-nums lg:self-start',
                  !inMonth && 'text-muted opacity-50',
                  d === today && 'bg-primary font-semibold text-primary-fg',
                )}
              >
                {splitKey(d).day}
              </span>
              {/* 手机：彩色小点；电脑：标题条 */}
              <span className="flex gap-0.5 lg:hidden">
                {items.slice(0, 3).map((o) => (
                  <span key={o.key} className={cn('size-1.5 rounded-full', CAL_COLOR[o.color].dot)} />
                ))}
              </span>
              <span className="hidden w-full space-y-0.5 lg:block">
                {items.slice(0, 3).map((o) => (
                  <span key={o.key} className={cn('block truncate rounded-[4px] px-1 py-px text-[11px]', CAL_COLOR[o.color].soft)}>
                    {o.title}
                  </span>
                ))}
                {items.length > 3 && <span className="block px-1 text-[11px] text-muted">还有 {items.length - 3} 个</span>}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
