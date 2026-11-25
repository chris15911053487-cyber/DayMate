import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { addDays, addMonths, isDateKey, relativeDayLabel, splitKey, startOfWeek, type Occurrence } from '@daymate/shared'
import { useOccurrences } from '../api/queries'
import { MonthView, monthGridRange } from '../components/calendar/MonthView'
import { OccurrenceList } from '../components/calendar/OccurrenceList'
import { TimeGrid } from '../components/calendar/TimeGrid'
import { EventEditor, type EventDraft } from '../components/EventEditor'
import { Button, Segmented } from '../ui'
import { occursOn, useToday, useTz } from '../utils/datetime'

type View = 'month' | 'week' | 'day'
const VIEWS: { value: View; label: string }[] = [
  { value: 'month', label: '月' },
  { value: 'week', label: '周' },
  { value: 'day', label: '日' },
]

/** 日历：月 / 周 / 日三种视图，视图和日期记在地址里（刷新、返回键都能用） */
export function CalendarPage() {
  const tz = useTz()
  const today = useToday()
  const [params, setParams] = useSearchParams()
  const view: View = (['month', 'week', 'day'] as const).find((v) => v === params.get('view')) ?? 'month'
  const rawDate = params.get('date') ?? ''
  const date = isDateKey(rawDate) ? rawDate : today
  const go = (next: Partial<{ view: View; date: string }>) =>
    setParams({ view: next.view ?? view, date: next.date ?? date }, { replace: true })

  const range = useMemo(() => {
    if (view === 'month') return monthGridRange(date)
    if (view === 'week') {
      const from = startOfWeek(date)
      return { from, to: addDays(from, 6) }
    }
    return { from: date, to: date }
  }, [view, date])
  const { data: occurrences = [], isLoading } = useOccurrences(range.from, range.to)

  const [editor, setEditor] = useState<{ eventId?: string; draft?: EventDraft } | null>(null)
  const openOcc = (o: Occurrence) => setEditor({ eventId: o.eventId })

  const step = (dir: 1 | -1) =>
    go({ date: view === 'month' ? addMonths(date, dir) : addDays(date, view === 'week' ? 7 * dir : dir) })

  const { year, month, day } = splitKey(date)
  const heading =
    view === 'month'
      ? `${year}年${month}月`
      : view === 'week'
        ? `${splitKey(range.from).month}月${splitKey(range.from).day}日 – ${splitKey(range.to).month}月${splitKey(range.to).day}日`
        : `${month}月${day}日 · ${relativeDayLabel(date, today).replace(/^\d+月\d+日 /, '')}`

  const dayItems = occurrences.filter((o) => occursOn(o, date, tz))

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="display min-w-0 flex-1 truncate text-[22px]">{heading}</h1>
        <Segmented label="视图" value={view} options={VIEWS} onChange={(v) => go({ view: v })} />
      </header>
      <div className="flex items-center gap-2">
        <Button variant="secondary" className="px-2.5 py-1.5" onClick={() => step(-1)} aria-label="上一页">
          <ChevronLeft size={18} />
        </Button>
        <Button variant="secondary" className="px-3 py-1.5 text-sm" onClick={() => go({ date: today })} disabled={date === today}>
          今天
        </Button>
        <Button variant="secondary" className="px-2.5 py-1.5" onClick={() => step(1)} aria-label="下一页">
          <ChevronRight size={18} />
        </Button>
        {isLoading && <span className="text-xs text-muted">加载中…</span>}
        <Button className="ml-auto px-3 py-1.5 text-sm" onClick={() => setEditor({ draft: { date } })}>
          <Plus size={16} /> 新建
        </Button>
      </div>

      {view === 'month' && (
        <>
          <MonthView anchor={date} selected={date} today={today} occurrences={occurrences} onSelect={(d) => go({ date: d })} />
          <section className="space-y-2">
            <div className="flex items-baseline justify-between px-1">
              <h2 className="display text-base">{relativeDayLabel(date, today)}</h2>
              <button type="button" className="text-sm text-primary" onClick={() => go({ view: 'day' })}>
                看时间轴
              </button>
            </div>
            <OccurrenceList items={dayItems} day={date} onOpen={openOcc} empty="这天还没有安排，点右上角「新建」或者按住下面的按钮说一句" />
          </section>
        </>
      )}

      {view !== 'month' && (
        <TimeGrid
          days={view === 'week' ? Array.from({ length: 7 }, (_, i) => addDays(range.from, i)) : [date]}
          today={today}
          occurrences={occurrences}
          onSlot={(d, time) => setEditor({ draft: { date: d, time } })}
          onOpen={openOcc}
          onDayClick={view === 'week' ? (d) => go({ view: 'day', date: d }) : undefined}
        />
      )}

      <EventEditor open={!!editor} onClose={() => setEditor(null)} eventId={editor?.eventId} draft={editor?.draft} />
    </div>
  )
}
