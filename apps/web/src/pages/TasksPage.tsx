import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { useTasks } from '../api/queries'
import { QuickAddTask, TaskList } from '../components/Tasks'
import { cn } from '../ui'

export function TasksPage() {
  const { data: open = [], isLoading } = useTasks('open')
  const [showDone, setShowDone] = useState(false)
  const { data: done = [] } = useTasks('done')
  return (
    <div className="space-y-4">
      <h1 className="display px-1 text-[22px]">全部待办</h1>
      <QuickAddTask />
      {isLoading ? <p className="py-6 text-center text-sm text-muted">加载中…</p> : <TaskList tasks={open} empty="没有未完成的待办，真棒" />}
      {done.length > 0 && (
        <section className="space-y-2">
          <button type="button" onClick={() => setShowDone((v) => !v)} className="flex items-center gap-1 px-1 text-sm text-muted">
            已完成 {done.length}
            <ChevronDown size={16} className={cn('transition', showDone && 'rotate-180')} />
          </button>
          {showDone && <TaskList tasks={done} />}
        </section>
      )}
    </div>
  )
}
