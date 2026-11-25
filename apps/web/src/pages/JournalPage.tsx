import { useSearchParams } from 'react-router'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { addDays, isDateKey, relativeDayLabel } from '@daymate/shared'
import { useEntries, useOccurrences } from '../api/queries'
import { EntryComposer, EntryList } from '../components/Entries'
import { Button, inputCls } from '../ui'
import { useToday } from '../utils/datetime'

/** 记录：按天看当天发生的事，可以补记、挂到当天的日程上 */
export function JournalPage() {
  const today = useToday()
  const [params, setParams] = useSearchParams()
  const raw = params.get('date') ?? ''
  const date = isDateKey(raw) ? raw : today
  const go = (d: string) => setParams(d === today ? {} : { date: d }, { replace: true })
  const { data: entries = [], isLoading } = useEntries(date)
  const { data: events = [] } = useOccurrences(date, date)

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-2">
        <h1 className="display min-w-0 flex-1 truncate text-[22px]">{relativeDayLabel(date, today)}的记录</h1>
        <Button variant="secondary" className="px-2.5 py-1.5" onClick={() => go(addDays(date, -1))} aria-label="前一天">
          <ChevronLeft size={18} />
        </Button>
        <Button variant="secondary" className="px-2.5 py-1.5" onClick={() => go(addDays(date, 1))} aria-label="后一天" disabled={date >= today}>
          <ChevronRight size={18} />
        </Button>
      </header>
      <div className="flex items-center gap-2">
        <input type="date" aria-label="跳到日期" className={`${inputCls} w-auto py-1.5 text-sm`} value={date} max={today} onChange={(e) => e.target.value && go(e.target.value)} />
        {date !== today && (
          <Button variant="ghost" className="px-3 py-1.5 text-sm" onClick={() => go(today)}>
            回到今天
          </Button>
        )}
      </div>
      <EntryComposer date={date} events={events} />
      {isLoading ? (
        <p className="py-6 text-center text-sm text-muted">加载中…</p>
      ) : (
        <EntryList entries={entries} events={events} empty={date === today ? '今天还没有记录。做了什么、想到什么，都可以记一笔' : '这天没有记录'} />
      )}
    </div>
  )
}
