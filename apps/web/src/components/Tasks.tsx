import { useEffect, useId, useState, type FormEvent } from 'react'
import { Check, Flag, Plus, Trash2 } from 'lucide-react'
import { addDays, diffDays, relativeDayLabel, taskInputSchema, type Task } from '@daymate/shared'
import { useTaskMutations } from '../api/queries'
import { Button, FieldLabel, Modal, TextField, cn, inputCls } from '../ui'
import { timeIn, useToday, useTz } from '../utils/datetime'

function dueLabel(t: Task, today: string, tz: string) {
  if (!t.dueDate) return null
  const late = !t.done && t.dueDate < today
  const text = late ? `逾期 ${diffDays(t.dueDate, today)} 天` : relativeDayLabel(t.dueDate, today)
  return { text: t.dueAt ? `${text} ${timeIn(t.dueAt, tz)}` : text, late }
}

export function TaskList({ tasks, empty }: { tasks: Task[]; empty?: string }) {
  const today = useToday()
  const tz = useTz()
  const { update } = useTaskMutations()
  const [editing, setEditing] = useState<Task | null>(null)
  if (!tasks.length) return empty ? <p className="card px-4 py-6 text-center text-sm text-muted">{empty}</p> : null
  return (
    <>
      <ul className="card divide-y divide-line">
        {tasks.map((t) => {
          const due = dueLabel(t, today, tz)
          return (
            <li key={t.id} className="flex items-center gap-3 px-4 py-3">
              <button
                type="button"
                role="checkbox"
                aria-checked={t.done}
                aria-label={`${t.done ? '取消完成' : '完成'}：${t.title}`}
                onClick={() => update.mutate({ id: t.id, patch: { done: !t.done } })}
                className={cn(
                  'flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition',
                  t.done ? 'border-success bg-success text-primary-fg' : 'border-line hover:border-primary',
                )}
              >
                {t.done && <Check size={12} strokeWidth={3} />}
              </button>
              <button type="button" onClick={() => setEditing(t)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                <span className={cn('min-w-0 flex-1 truncate text-[15px]', t.done && 'text-muted line-through')}>{t.title}</span>
                {t.priority === 'high' && !t.done && <Flag size={13} className="shrink-0 text-danger" aria-label="重要" />}
                {due && <span className={cn('shrink-0 text-xs', due.late ? 'text-danger' : 'text-muted')}>{due.text}</span>}
              </button>
            </li>
          )
        })}
      </ul>
      <TaskEditor task={editing} onClose={() => setEditing(null)} />
    </>
  )
}

/** 一行快速添加：回车保存，可选今天 / 明天 */
export function QuickAddTask({ defaultDue }: { defaultDue?: 'today' | null }) {
  const today = useToday()
  const { create } = useTaskMutations()
  const [title, setTitle] = useState('')
  const [due, setDue] = useState<'today' | 'tomorrow' | null>(defaultDue ?? null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    await create.mutateAsync({ title, dueDate: due === 'today' ? today : due === 'tomorrow' ? addDays(today, 1) : null })
    setTitle('')
  }
  const chip = (v: 'today' | 'tomorrow', label: string) => (
    <button
      type="button"
      onClick={() => setDue(due === v ? null : v)}
      className={cn('shrink-0 rounded-full border px-2 py-0.5 text-xs', due === v ? 'border-primary bg-primary-soft text-primary' : 'border-line text-muted')}
    >
      {label}
    </button>
  )
  return (
    <form onSubmit={onSubmit} className="card flex items-center gap-2 px-3 py-2">
      <Plus size={18} className="shrink-0 text-muted" />
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="添加待办，回车保存"
        aria-label="添加待办"
        maxLength={200}
        className="min-w-0 flex-1 bg-transparent py-1 text-[16px] outline-none placeholder:text-muted"
      />
      {chip('today', '今天')}
      {chip('tomorrow', '明天')}
    </form>
  )
}

export function TaskEditor({ task, onClose }: { task: Task | null; onClose: () => void }) {
  const tz = useTz()
  const { update, remove } = useTaskMutations()
  const [form, setForm] = useState({ title: '', notes: '', dueDate: '', dueTime: '', priority: 'normal' as Task['priority'] })
  const [error, setError] = useState('')
  const ids = { date: useId(), time: useId(), pri: useId(), notes: useId() }

  useEffect(() => {
    if (!task) return
    setError('')
    setForm({
      title: task.title,
      notes: task.notes ?? '',
      dueDate: task.dueDate ?? '',
      dueTime: task.dueAt ? timeIn(task.dueAt, tz) : '',
      priority: task.priority,
    })
  }, [task, tz])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!task) return
    const patch = {
      title: form.title,
      notes: form.notes || null,
      dueDate: form.dueDate || null,
      dueTime: form.dueDate && form.dueTime ? form.dueTime : null,
      priority: form.priority,
    }
    const r = taskInputSchema.safeParse(patch)
    if (!r.success) return setError(r.error.issues[0]!.message)
    await update.mutateAsync({ id: task.id, patch })
    onClose()
  }

  return (
    <Modal open={!!task} title="编辑待办" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <TextField label="内容" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} error={error} />
        <div className="grid grid-cols-2 gap-2">
          <div>
            <FieldLabel htmlFor={ids.date}>截止日期</FieldLabel>
            <input id={ids.date} type="date" className={inputCls} value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
          </div>
          <div>
            <FieldLabel htmlFor={ids.time}>时间（选填）</FieldLabel>
            <input id={ids.time} type="time" className={inputCls} value={form.dueTime} disabled={!form.dueDate} onChange={(e) => setForm({ ...form, dueTime: e.target.value })} />
          </div>
        </div>
        <div>
          <FieldLabel htmlFor={ids.pri}>重要程度</FieldLabel>
          <select id={ids.pri} className={inputCls} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as Task['priority'] })}>
            <option value="high">重要</option>
            <option value="normal">普通</option>
            <option value="low">不急</option>
          </select>
        </div>
        <div>
          <FieldLabel htmlFor={ids.notes}>备注</FieldLabel>
          <textarea id={ids.notes} className={cn(inputCls, 'min-h-20')} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            className="text-danger"
            aria-label="删除待办"
            onClick={async () => {
              if (task) await remove.mutateAsync(task.id)
              onClose()
            }}
          >
            <Trash2 size={18} />
          </Button>
          <Button type="submit" block loading={update.isPending}>
            保存
          </Button>
        </div>
      </form>
    </Modal>
  )
}
