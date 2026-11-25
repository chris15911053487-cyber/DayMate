import { CalendarDays, CheckSquare, NotebookPen, Repeat, TriangleAlert, X } from 'lucide-react'
import { REMINDER_OPTIONS, describeRepeat, type ConflictInfo, type DraftItem } from '@daymate/shared'
import { Switch, cn, inputCls } from '../ui'

export type CardItem = Exclude<DraftItem, { type: 'query' }> & { conflicts?: ConflictInfo[] }

const TYPES = [
  { type: 'event', label: '日程', Icon: CalendarDays },
  { type: 'task', label: '待办', Icon: CheckSquare },
  { type: 'entry', label: '记录', Icon: NotebookPen },
] as const
const REMIND_LABEL: Record<number, string> = { 0: '准时提醒', 5: '提前 5 分钟', 15: '提前 15 分钟', 30: '提前 30 分钟', 60: '提前 1 小时', 120: '提前 2 小时', 1440: '提前 1 天' }

/** 换类型时尽量保留信息：标题 ⇄ 内容，日期 ⇄ 截止日期，时间 ⇄ 截止时间 */
export function convertCard(item: CardItem, to: CardItem['type'], today: string): CardItem {
  if (item.type === to) return item
  const title = item.type === 'entry' ? item.content.slice(0, 100) : item.title
  const date = item.type === 'event' ? item.date : item.type === 'task' ? item.dueDate : item.date
  const time = item.type === 'event' ? item.startTime : item.type === 'task' ? item.dueTime : item.time
  if (to === 'event') return { type: 'event', title, date: date ?? today, startTime: time ?? null, allDay: !time, remindBeforeMin: time ? [15] : [], repeat: null }
  if (to === 'task') return { type: 'task', title, dueDate: date ?? null, dueTime: date ? (time ?? null) : null, priority: 'normal' }
  return { type: 'entry', content: item.type === 'event' || item.type === 'task' ? item.title : item.content, date: date ?? today, time: time ?? null }
}

export function DraftCard({ item, onChange, onRemove, today }: { item: CardItem; onChange: (next: CardItem) => void; onRemove: () => void; today: string }) {
  const input = cn(inputCls, 'px-2.5 py-1.5 text-[15px]')
  const field = (label: string, el: React.ReactNode, className?: string) => (
    <label className={cn('block', className)}>
      <span className="mb-1 block text-xs text-muted">{label}</span>
      {el}
    </label>
  )

  return (
    <div className="card space-y-3 p-3.5">
      <div className="flex items-center gap-2">
        <div className="flex rounded-control bg-surface-2 p-0.5" role="radiogroup" aria-label="类型">
          {TYPES.map(({ type, label, Icon }) => (
            <button
              key={type}
              type="button"
              role="radio"
              aria-checked={item.type === type}
              onClick={() => onChange(convertCard(item, type, today))}
              className={cn('flex items-center gap-1 rounded-control px-2 py-1 text-xs', item.type === type ? 'bg-surface font-medium text-primary shadow-sm' : 'text-muted')}
            >
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>
        <button type="button" onClick={onRemove} aria-label="不要这一条" className="ml-auto p-1 text-muted hover:text-danger">
          <X size={18} />
        </button>
      </div>

      {item.type === 'event' && (
        <>
          <input aria-label="日程标题" className={cn(input, 'font-medium')} value={item.title} onChange={(e) => onChange({ ...item, title: e.target.value })} />
          <div className="grid grid-cols-2 gap-2">
            {field('日期', <input type="date" className={input} value={item.date} onChange={(e) => e.target.value && onChange({ ...item, date: e.target.value })} />)}
            <div className="flex items-end justify-between gap-2 pb-1.5">
              <span className="text-sm text-fg-2">全天</span>
              <Switch
                label="全天"
                checked={!!item.allDay}
                onChange={(v) => onChange({ ...item, allDay: v, startTime: v ? null : (item.startTime ?? '09:00'), endTime: v ? null : item.endTime, remindBeforeMin: v ? [] : (item.remindBeforeMin?.length ? item.remindBeforeMin : [15]) })}
              />
            </div>
            {!item.allDay && (
              <>
                {field('开始', <input type="time" className={input} value={item.startTime ?? ''} onChange={(e) => onChange({ ...item, startTime: e.target.value || null })} />)}
                {field('结束（选填）', <input type="time" className={input} value={item.endTime ?? ''} onChange={(e) => onChange({ ...item, endTime: e.target.value || null })} />)}
              </>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {field('地点', <input className={input} value={item.location ?? ''} placeholder="选填" onChange={(e) => onChange({ ...item, location: e.target.value || null })} />)}
            {field(
              '提醒',
              <select className={input} value={item.remindBeforeMin?.length ? String(item.remindBeforeMin[0]) : 'none'} onChange={(e) => onChange({ ...item, remindBeforeMin: e.target.value === 'none' ? [] : [Number(e.target.value)] })}>
                <option value="none">不提醒</option>
                {REMINDER_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {REMIND_LABEL[m]}
                  </option>
                ))}
              </select>,
            )}
          </div>
          {item.repeat && (
            <p className="flex items-center gap-1.5 text-sm text-fg-2">
              <Repeat size={14} className="text-muted" />
              {describeRepeat(item.repeat, item.date)}
              <button type="button" className="ml-auto text-xs text-muted underline" onClick={() => onChange({ ...item, repeat: null })}>
                改成不重复
              </button>
            </p>
          )}
          {item.people && item.people.length > 0 && <p className="text-xs text-muted">参与：{item.people.join('、')}</p>}
          {item.conflicts && item.conflicts.length > 0 && (
            <p className="flex items-start gap-1.5 rounded-control bg-warning/10 px-2.5 py-2 text-xs text-warning">
              <TriangleAlert size={14} className="mt-px shrink-0" />和已有的{item.conflicts.map((c) => `「${c.title}」${c.time}`).join('、')}时间冲突
            </p>
          )}
        </>
      )}

      {item.type === 'task' && (
        <>
          <input aria-label="待办内容" className={cn(input, 'font-medium')} value={item.title} onChange={(e) => onChange({ ...item, title: e.target.value })} />
          <div className="grid grid-cols-3 gap-2">
            {field('截止日期', <input type="date" className={input} value={item.dueDate ?? ''} onChange={(e) => onChange({ ...item, dueDate: e.target.value || null, dueTime: e.target.value ? item.dueTime : null })} />, 'col-span-2')}
            {field('时间', <input type="time" className={input} value={item.dueTime ?? ''} disabled={!item.dueDate} onChange={(e) => onChange({ ...item, dueTime: e.target.value || null })} />)}
          </div>
          <label className="flex items-center gap-2 text-sm text-fg-2">
            <input type="checkbox" className="size-4 accent-danger" checked={item.priority === 'high'} onChange={(e) => onChange({ ...item, priority: e.target.checked ? 'high' : 'normal' })} />
            重要
          </label>
        </>
      )}

      {item.type === 'entry' && (
        <>
          <textarea aria-label="记录内容" rows={3} className={cn(input, 'resize-y leading-relaxed')} value={item.content} onChange={(e) => onChange({ ...item, content: e.target.value })} />
          <div className="grid grid-cols-2 gap-2">
            {field('日期', <input type="date" className={input} value={item.date} onChange={(e) => e.target.value && onChange({ ...item, date: e.target.value })} />)}
            {field('时间（选填）', <input type="time" className={input} value={item.time ?? ''} onChange={(e) => onChange({ ...item, time: e.target.value || null })} />)}
          </div>
        </>
      )}
    </div>
  )
}
