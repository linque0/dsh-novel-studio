/* 开发调试版专用：把 tools/verify-seeds.mjs 注册的验证书种入书架。
 * 仅在 import.meta.env.DEV 下被动态加载（见 App.vue boot）——正式版以 app:// 加载构建产物，
 * DEV 恒为 false，本模块连同注册表都不会进入运行时，保证正式版绝不写入测试数据。 */
import { db, uid, now } from '../db/database'

export async function seedVerifyBooks(opts = {}) {
  const mod = await import('../../tools/verify-seeds.mjs')
  return mod.seedBooks(
    mod.VERIFY_BOOKS.map((b) => ({ title: b.title, create: b.create })),
    { db, uid, now },
    { reset: opts.reset === true }
  )
}
