import { defineStore } from 'pinia'
import { listWorks, createWorkRow, seedWorkDefaults, softDeleteRow } from '../db/repo'
import { db } from '../db/database'
import { autosave } from '../services/autosave'

export const useShelfStore = defineStore('shelf', {
  state: () => ({
    works: [],
    loading: false,
    openStats: {} // { [workId]: { lastOpenedAt, openCount } }，存在 appconfig
  }),
  actions: {
    async refresh() {
      this.loading = true
      try {
        const [works, statsRow] = await Promise.all([
          listWorks(),
          db.appconfig.get('shelf:openStats')
        ])
        this.works = works
        this.openStats = statsRow?.value && typeof statsRow.value === 'object' ? statsRow.value : {}
      } finally {
        this.loading = false
      }
    },
    /** 每次真正打开作品时调用：记录最近打开时间并累加次数（不写 works 表） */
    async recordOpen(workId) {
      if (!workId) return
      try {
        /* 先读最新表再合并：面板独立窗口也会记打开，避免用旧内存覆盖别的窗口的计数 */
        const row = await db.appconfig.get('shelf:openStats')
        const latest = row?.value && typeof row.value === 'object' ? row.value : {}
        const prev = latest[workId] || {}
        const next = {
          ...latest,
          [workId]: {
            lastOpenedAt: Date.now(),
            openCount: (Number(prev.openCount) || 0) + 1
          }
        }
        this.openStats = next
        await db.appconfig.put({ key: 'shelf:openStats', value: next })
      } catch (err) {
        console.warn('[shelf] 记录作品打开信息失败', err)
      }
    },
    async createWork(payload) {
      const work = await createWorkRow(payload)
      await seedWorkDefaults(work.id, { withVolume: payload.withVolume !== false })
      await this.refresh()
      return work
    },
    async updateWork(work, patch) {
      Object.assign(work, patch)
      autosave.mark('works', work)
      /* 防抖写有 1s 延迟：若直接 refresh 会把库里的旧行读回来、覆盖刚做的修改
       * （编辑切换封面/标题不生效的根因）——先flush再refresh */
      await autosave.flushAll()
      await this.refresh()
    },
    async deleteWork(work) {
      await softDeleteRow('works', work)
      await this.refresh()
    }
  }
})
