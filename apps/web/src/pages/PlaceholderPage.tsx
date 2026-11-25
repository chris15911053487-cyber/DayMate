import type { LucideIcon } from 'lucide-react'

export function PlaceholderPage({ icon: Icon, title, desc }: { icon: LucideIcon; title: string; desc: string }) {
  return (
    <div className="card mt-6 flex flex-col items-center px-6 py-14 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-primary-soft text-primary">
        <Icon size={26} />
      </span>
      <h1 className="display mt-4 text-xl">{title}</h1>
      <p className="mt-2 max-w-xs text-sm leading-relaxed text-muted">{desc}</p>
    </div>
  )
}
