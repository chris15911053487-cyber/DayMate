import { useState, type FormEvent } from 'react'
import { CalendarClock, Mic, Pencil, Trash2 } from 'lucide-react'
import { zonedParts, type Entry, type Occurrence } from '@daymate/shared'
import { useEntryMutations } from '../api/queries'
import { Button, cn, inputCls } from '../ui'
import { timeIn, useToday, useTz } from '../utils/datetime'

/** 把正文里的 #标签 高亮 */
function Highlighted({ text }: { text: string }) {
  const parts = text.split(/(#[\p{L}\p{N}_]{1,20})/u)
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('#') ? (
          <span key={i} className="text-accent">
            {p}
          </span>
        ) : (
          p
        ),
      )}
    </>
  )
}

/** 写记录：今天默认填上现在的时间；可以挂到当天的某个日程 */
export function EntryComposer({ date, events = [] }: { date: string; events?: Occurrence[] }) {
  const tz = useTz()
  const today = useToday()
  const { create } = useEntryMutations()
  const [content, setContent] = useState('')
  const [eventId, setEventId] = useState('')

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!content.trim()) return
    const time = date === today ? zonedParts(Date.now(), tz).time : null
    await create.mutateAsync({ date, time, content, eventId: eventId || null })
    setContent('')
    setEventId('')
  }

  return (
    <form onSubmit={onSubmit} className="card space-y-2 p-3">
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void onSubmit(e)
        }}
        placeholder={date === today ? '今天做了什么？可以用 #标签 分类' : '补记这一天的事'}
        aria-label="写记录"
        maxLength={5000}
        rows={2}
        className="w-full resize-none bg-transparent text-[16px] leading-relaxed outline-none placeholder:text-muted"
      />
      <div className="flex items-center gap-2">
        {events.length > 0 && (
          <select value={eventId} onChange={(e) => setEventId(e.target.value)} aria-label="关联日程" className={cn(inputCls, 'w-auto min-w-0 flex-1 py-1.5 text-sm')}>
            <option value="">不关联日程</option>
            {events.map((o) => (
              <option key={o.key} value={o.eventId}>
                {o.allDay ? '全天' : timeIn(o.start!, tz)} {o.title}
              </option>
            ))}
          </select>
        )}
        <Button type="submit" className="ml-auto px-4 py-1.5 text-sm" loading={create.isPending} disabled={!content.trim()}>
          记下
        </Button>
      </div>
    </form>
  )
}

export function EntryList({ entries, events = [], empty }: { entries: Entry[]; events?: Occurrence[]; empty?: string }) {
  const tz = useTz()
  const { update, remove } = useEntryMutations()
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const titleOf = (id: string | null) => events.find((o) => o.eventId === id)?.title
  if (!entries.length) return empty ? <p className="card px-4 py-6 text-center text-sm text-muted">{empty}</p> : null

  return (
    <ul className="space-y-2">
      {entries.map((r) => (
        <li key={r.id} className="card p-3">
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <span className="tabular-nums">{r.occurredAt ? timeIn(r.occurredAt, tz) : '这天'}</span>
            {r.source === 'voice' && (
              <span className="flex items-center gap-0.5 text-accent">
                <Mic size={11} /> 语音
              </span>
            )}
            {r.eventId && titleOf(r.eventId) && (
              <span className="flex min-w-0 items-center gap-0.5">
                <CalendarClock size={11} className="shrink-0" />
                <span className="truncate">{titleOf(r.eventId)}</span>
              </span>
            )}
            <span className="ml-auto flex gap-1">
              <button type="button" aria-label="编辑记录" className="p-1 hover:text-fg" onClick={() => (setEditing(r.id), setDraft(r.content))}>
                <Pencil size={13} />
              </button>
              <button type="button" aria-label="删除记录" className="p-1 hover:text-danger" onClick={() => remove.mutate(r.id)}>
                <Trash2 size={13} />
              </button>
            </span>
          </div>
          {editing === r.id ? (
            <form
              className="mt-1 space-y-2"
              onSubmit={async (e) => {
                e.preventDefault()
                if (!draft.trim()) return
                await update.mutateAsync({ id: r.id, patch: { content: draft } })
                setEditing(null)
              }}
            >
              <textarea value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="修改记录" rows={3} className={cn(inputCls, 'resize-y')} autoFocus />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" className="px-3 py-1 text-sm" onClick={() => setEditing(null)}>
                  取消
                </Button>
                <Button type="submit" className="px-3 py-1 text-sm" loading={update.isPending}>
                  保存
                </Button>
              </div>
            </form>
          ) : (
            <p className="mt-1 whitespace-pre-wrap break-words text-[15px] leading-relaxed">
              <Highlighted text={r.content} />
            </p>
          )}
        </li>
      ))}
    </ul>
  )
}
