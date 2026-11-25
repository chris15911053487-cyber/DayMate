import { HttpError } from './http-error.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 路径里的 id 不是 UUID 就当找不到（避免把乱写的 id 交给数据库报类型错误） */
export function assertId(id: string, what = '内容'): string {
  if (!UUID_RE.test(id)) throw new HttpError(404, 'NOT_FOUND', `找不到这条${what}`)
  return id
}
