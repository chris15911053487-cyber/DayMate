import { createHash, randomBytes } from 'node:crypto'
import { hash, verify } from '@node-rs/argon2'

/** Argon2id；@node-rs/argon2 默认参数即 OWASP 推荐值（19 MiB、2 次迭代、并行 1） */
export const hashPassword = (password: string) => hash(password)

export async function verifyPassword(stored: string, password: string) {
  try {
    return await verify(stored, password)
  } catch {
    return false
  }
}

/** 账号不存在时也算一次哈希，避免靠响应时间判断账号是否存在 */
let dummy: Promise<string> | null = null
export async function burnPasswordCheck(password: string) {
  dummy ??= hashPassword('daymate-dummy-password')
  await verifyPassword(await dummy, password)
}

export const randomToken = () => randomBytes(32).toString('base64url')
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
