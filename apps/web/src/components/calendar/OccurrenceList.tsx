import { MapPin, Repeat } from 'lucide-react'
import type { Occurrence } from '@daymate/shared'
import { cn } from '../../ui'
import { occurrenceTimeLabel, useTz } from '../../utils/datetime'
import { CAL_COLOR } from './colors'

/** 某天的日程列表（月视图下方、今天页、搜索结果共用） */
export function OccurrenceList({ items, day, onOpen, empty }: { items: Occurrence[]; day: string; onOpen: (o: Occurrence) => void; empty?: string }) {
  const tz = useTz()
  if (!items.length) return empty ? <p className="card px-4 py-6 text-center text-sm text-muted">{empty}</p> : null
  return (
    <ul className="space-y-2">
      {items.map((o) => {
        const c = CAL_COLOR[o.color]
        const past = !o.allDay && Date.parse(o.end!) < Date.now()
        return (
          <li key={o.key}>
            <button type="button" onClick={() => onOpen(o)} className={cn('card flex w-full items-stretch gap-3 p-3 text-left', past && 'opacity-60')}>
              <span className={cn('w-1 shrink-0 rounded-full', c.dot)} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate font-medium">{o.title}</span>
                  {o.recurring && <Repeat size={12} className="shrink-0 text-muted" aria-label="重复" />}
                </span>
                <span className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                  <span className="tabular-nums">{occurrenceTimeLabel(o, day, tz)}</span>
                  {o.location && (
                    <span className="flex min-w-0 items-center gap-0.5">
                      <MapPin size={11} className="shrink-0" />
                      <span className="truncate">{o.location}</span>
                    </span>
                  )}
                </span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
