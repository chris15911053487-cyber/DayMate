import { QueryClient, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  BriefKind,
  CalendarInfo,
  DailyBrief,
  NotificationPage,
  SettingsPatch,
  UserSettings,
  Entry,
  EntryInput,
  EventDetail,
  EventInput,
  Occurrence,
  SearchResult,
  Task,
  TaskInput,
  TodayData,
} from '@daymate/shared'
import { api, ApiError } from './client'
import { toast } from '../ui/toast'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: (n, err) => n < 2 && !(err instanceof ApiError && err.status < 500), refetchOnWindowFocus: true },
    mutations: { onError: (err) => toast(err instanceof ApiError ? err.message : '保存失败，请稍后再试') },
  },
})

/** 一类数据变了，哪些列表要重新取 */
const AFFECTS = {
  events: [['events'], ['today'], ['search'], ['event']],
  tasks: [['tasks'], ['today'], ['search']],
  entries: [['entries'], ['today'], ['search']],
  calendars: [['calendars'], ['events'], ['today']],
} as const
function useInvalidate(kind: keyof typeof AFFECTS) {
  const qc = useQueryClient()
  return () => Promise.all(AFFECTS[kind].map((queryKey) => qc.invalidateQueries({ queryKey })))
}

export const useCalendars = () => useQuery({ queryKey: ['calendars'], queryFn: () => api<CalendarInfo[]>('/calendars') })

export const useOccurrences = (from: string, to: string) =>
  useQuery({ queryKey: ['events', from, to], queryFn: () => api<Occurrence[]>(`/events?from=${from}&to=${to}`), placeholderData: (prev) => prev })

export const useEvent = (id: string | null) =>
  useQuery({ queryKey: ['event', id], queryFn: () => api<EventDetail>(`/events/${id}`), enabled: !!id })

export const useTodayData = (date?: string) =>
  useQuery({ queryKey: ['today', date ?? 'now'], queryFn: () => api<TodayData>(date ? `/today?date=${date}` : '/today') })

export const useTasks = (status: 'open' | 'done') =>
  useQuery({ queryKey: ['tasks', status], queryFn: () => api<Task[]>(`/tasks?status=${status}`) })

export const useEntries = (date: string) =>
  useQuery({ queryKey: ['entries', date], queryFn: () => api<Entry[]>(`/entries?date=${date}`) })

export const useSearch = (q: string) =>
  useQuery({ queryKey: ['search', q], queryFn: () => api<SearchResult>(`/search?q=${encodeURIComponent(q)}`), enabled: q.trim().length > 0 })

/** 删除后给一个"撤销"按钮 */
function undoable(kind: 'events' | 'tasks' | 'entries', label: string, id: string, refresh: () => Promise<unknown>) {
  toast(`已删除${label}`, {
    label: '撤销',
    onClick: () => void api(`/${kind}/${id}/restore`, { method: 'POST' }).then(refresh),
  })
}

export function useEventMutations() {
  const refresh = useInvalidate('events')
  return {
    create: useMutation({ mutationFn: (input: EventInput) => api<EventDetail>('/events', { method: 'POST', body: input }), onSuccess: refresh }),
    update: useMutation({
      mutationFn: ({ id, input }: { id: string; input: EventInput }) => api<EventDetail>(`/events/${id}`, { method: 'PUT', body: input }),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api(`/events/${id}`, { method: 'DELETE' }),
      onSuccess: (_d, id) => {
        void refresh()
        undoable('events', '日程', id, refresh)
      },
    }),
  }
}

export function useTaskMutations() {
  const refresh = useInvalidate('tasks')
  return {
    create: useMutation({ mutationFn: (input: TaskInput) => api<Task>('/tasks', { method: 'POST', body: input }), onSuccess: refresh }),
    update: useMutation({
      mutationFn: ({ id, patch }: { id: string; patch: Partial<TaskInput> & { done?: boolean } }) =>
        api<Task>(`/tasks/${id}`, { method: 'PATCH', body: patch }),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api(`/tasks/${id}`, { method: 'DELETE' }),
      onSuccess: (_d, id) => {
        void refresh()
        undoable('tasks', '待办', id, refresh)
      },
    }),
  }
}

export function useEntryMutations() {
  const refresh = useInvalidate('entries')
  return {
    create: useMutation({ mutationFn: (input: EntryInput) => api<Entry>('/entries', { method: 'POST', body: input }), onSuccess: refresh }),
    update: useMutation({
      mutationFn: ({ id, patch }: { id: string; patch: Partial<EntryInput> }) => api<Entry>(`/entries/${id}`, { method: 'PATCH', body: patch }),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api(`/entries/${id}`, { method: 'DELETE' }),
      onSuccess: (_d, id) => {
        void refresh()
        undoable('entries', '记录', id, refresh)
      },
    }),
  }
}

export function useCalendarMutations() {
  const refresh = useInvalidate('calendars')
  return {
    create: useMutation({
      mutationFn: (input: Pick<CalendarInfo, 'name' | 'color'>) => api<CalendarInfo>('/calendars', { method: 'POST', body: input }),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: ({ id, patch }: { id: string; patch: Partial<Pick<CalendarInfo, 'name' | 'color'>> }) =>
        api<CalendarInfo>(`/calendars/${id}`, { method: 'PATCH', body: patch }),
      onSuccess: refresh,
    }),
    remove: useMutation({ mutationFn: (id: string) => api(`/calendars/${id}`, { method: 'DELETE' }), onSuccess: refresh }),
  }
}

// ---- 提醒与推送（M4） ----
export const useSettings = () => useQuery({ queryKey: ['settings'], queryFn: () => api<UserSettings>('/me/settings') })

export function useSaveSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: SettingsPatch) => api<UserSettings>('/me/settings', { method: 'PUT', body: patch }),
    onSuccess: (data) => qc.setQueryData(['settings'], data),
  })
}

/** 未读数：每分钟取一次，切回页面时也取 */
export const useUnread = () =>
  useQuery({ queryKey: ['notifications', 'unread'], queryFn: () => api<{ unread: number }>('/notifications/unread-count'), refetchInterval: 60_000 })

export const useNotifications = () =>
  useInfiniteQuery({
    queryKey: ['notifications', 'list'],
    queryFn: ({ pageParam }) => api<NotificationPage>(pageParam ? `/notifications?before=${encodeURIComponent(pageParam)}` : '/notifications'),
    initialPageParam: '',
    getNextPageParam: (last) => last.next ?? undefined,
  })

export function useNotificationMutations() {
  const qc = useQueryClient()
  const refresh = () => qc.invalidateQueries({ queryKey: ['notifications'] })
  return {
    read: useMutation({ mutationFn: (id: string) => api(`/notifications/${id}/read`, { method: 'POST' }), onSuccess: refresh }),
    readAll: useMutation({ mutationFn: () => api('/notifications/read-all', { method: 'POST' }), onSuccess: refresh }),
  }
}

export function useGenerateBrief() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (kind: BriefKind) => api<DailyBrief>('/briefs/generate', { method: 'POST', body: { kind } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['today'] }),
  })
}
