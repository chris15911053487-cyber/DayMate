import { useEffect, useRef, useState } from 'react'
import { splitKey, timeOfMinutes, weekdayLabel, zonedParts, type Occurrence } from '@daymate/shared'
import { cn } from '../../ui'
import { layoutLanes, minutesWithinDay, occursOn, timeIn, useTz } from '../../utils/datetime'
import { CAL_COLOR } from './colors'

const HOUR_PX = 48
const HOURS = Array.from({ length: 24 }, (_, h) => h)

/** 周 / 日视图的时间轴：上面一行放全天日程，下面按分钟定位，重叠的并排 */
export function TimeGrid({
  days,
  today,
  occurrences,
  onSlot,
  onOpen,
  onDayClick,
}: {
  days: string[]
  today: string
  occurrences: Occurrence[]
  onSlot: (day: string, time: string) => void
  onOpen: (o: Occurrence) => void
  onDayClick?: (day: string) => void
}) {
  const tz = useTz()
  const scroller = useRef<HTMLDivElement>(null)
  const [nowMin, setNowMin] = useState(() => {
    const p = zonedParts(Date.now(), tz)
    return p.hour * 60 + p.minute
  })

  useEffect(() => {
    const t = window.setInterval(() => {
      const p = zonedParts(Date.now(), tz)
      setNowMin(p.hour * 60 + p.minute)
    }, 60_000)
    return () => window.clearInterval(t)
  }, [tz])

  // 打开时滚到早上 7 点（今天就滚到现在前一小时）
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const hour = days.includes(today) ? Math.max(0, Math.floor(nowMin / 60) - 1) : 7
    el.scrollTop = hour * HOUR_PX
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days.join()])

  const allDay = days.map((d) => occurrences.filter((o) => o.allDay && occursOn(o, d, tz)))
  const hasAllDay = allDay.some((l) => l.length)

  return (
    <div className="card overflow-hidden">
      <div className="grid border-b border-line" style={{ gridTemplateColumns: `3rem repeat(${days.length}, minmax(0, 1fr))` }}>
        <div />
        {days.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => onDayClick?.(d)}
            className={cn('flex flex-col items-center py-1.5 text-xs', onDayClick ? 'cursor-pointer' : 'cursor-default')}
          >
            <span className="text-muted">{weekdayLabel(d)}</span>
            <span className={cn('mt-0.5 flex size-7 items-center justify-center rounded-full text-sm tabular-nums', d === today && 'bg-primary font-semibold text-primary-fg')}>
              {splitKey(d).day}
            </span>
          </button>
        ))}
        {hasAllDay && (
          <>
            <div className="border-t border-line py-1 pr-1 text-right text-[10px] text-muted">全天</div>
            {allDay.map((list, i) => (
              <div key={days[i]} className="space-y-0.5 border-l border-t border-line p-0.5">
                {list.map((o) => (
                  <button key={o.key} type="button" onClick={() => onOpen(o)} className={cn('block w-full truncate rounded-[4px] px-1 text-left text-[11px]', CAL_COLOR[o.color].soft)}>
                    {o.title}
                  </button>
                ))}
              </div>
            ))}
          </>
        )}
      </div>

      <div ref={scroller} className="relative max-h-[62dvh] overflow-y-auto">
        <div className="grid" style={{ gridTemplateColumns: `3rem repeat(${days.length}, minmax(0, 1fr))`, height: 24 * HOUR_PX }}>
          <div className="relative">
            {HOURS.slice(1).map((h) => (
              <span key={h} className="absolute right-1.5 -translate-y-1/2 text-[10px] tabular-nums text-muted" style={{ top: h * HOUR_PX }}>
                {String(h).padStart(2, '0')}:00
              </span>
            ))}
          </div>
          {days.map((d) => {
            const placed = layoutLanes(
              occurrences.filter((o) => !o.allDay && occursOn(o, d, tz)).map((o) => ({ item: o, ...minutesWithinDay(o, d, tz) })),
              20,
            )
            return (
              <div key={d} className="relative border-l border-line">
                {HOURS.map((h) => (
                  <button
                    key={h}
                    type="button"
                    aria-label={`在 ${splitKey(d).month}月${splitKey(d).day}日 ${h} 点新建日程`}
                    onClick={() => onSlot(d, timeOfMinutes(h * 60))}
                    className="block w-full border-t border-line/60 hover:bg-surface-2"
                    style={{ height: HOUR_PX }}
                  />
                ))}
                {d === today && (
                  <div className="pointer-events-none absolute inset-x-0 z-10 flex items-center" style={{ top: (nowMin / 60) * HOUR_PX }}>
                    <span className="-ml-1 size-2 rounded-full bg-danger" />
                    <span className="h-px flex-1 bg-danger" />
                  </div>
                )}
                {placed.map(({ item: o, top, bottom, lane, lanes }) => {
                  const c = CAL_COLOR[o.color]
                  const height = ((bottom - top) / 60) * HOUR_PX
                  return (
                    <button
                      key={o.key}
                      type="button"
                      onClick={() => onOpen(o)}
                      className={cn('absolute overflow-hidden rounded-[6px] border-l-[3px] px-1 py-0.5 text-left text-[11px] leading-tight', c.soft, c.border)}
                      style={{ top: (top / 60) * HOUR_PX + 1, height: height - 2, left: `calc(${(lane / lanes) * 100}% + 1px)`, width: `calc(${100 / lanes}% - 2px)` }}
                    >
                      <span className="block truncate font-medium text-fg">{o.title}</span>
                      {height > 30 && <span className="block truncate tabular-nums text-fg-2">{timeIn(o.start!, tz)}</span>}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
