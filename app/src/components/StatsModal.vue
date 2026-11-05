<script setup>
import { ref, watch, onBeforeUnmount, nextTick } from 'vue'
import { NModal } from 'naive-ui'
import * as echarts from 'echarts'
import { useUiStore } from '../stores/ui'
import { useWorkStore } from '../stores/work'
import { useShelfStore } from '../stores/shelf'
import { getWordLogs } from '../db/repo'

const ui = useUiStore()
const work = useWorkStore()
const shelf = useShelfStore()

const barEl = ref(null)
const heatEl = ref(null)
let barChart = null
let heatChart = null
const cards = ref({ total: 0, chapters: 0, week: 0, days: 0 })

const dateStr = (d) => {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function cssVar(name, fallback) {
  const v = getComputedStyle(document.querySelector('.app-root') || document.body).getPropertyValue(name).trim()
  return v || fallback
}

async function render() {
  const workId = work.loaded ? work.work?.id : null
  const logs = await getWordLogs(workId)
  const daily = new Map()
  for (const l of logs) daily.set(l.date, (daily.get(l.date) || 0) + l.delta)

  const today = new Date()
  const days = []
  for (let i = 89; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const ds = dateStr(d)
    days.push({ date: ds, v: Math.max(0, daily.get(ds) || 0) })
  }
  const week = days.slice(-7).reduce((s, d) => s + d.v, 0)
  const totalWords = workId
    ? work.totalWords
    : shelf.works.reduce((s, w) => s + (w.totalWords || 0), 0)
  const chapterCount = workId ? work.chapterCount : shelf.works.reduce((s, w) => s + (w.chapterCount || 0), 0)
  cards.value = {
    total: totalWords,
    chapters: chapterCount,
    week,
    days: [...daily.values()].filter((v) => v > 0).length
  }

  const textColor = cssVar('--text', '#3c3427')
  const dimColor = cssVar('--text-dim', '#8d8271')
  const accent = cssVar('--accent', '#8c6f4e')
  const splitColor = cssVar('--border', '#e0d6bf')

  if (barEl.value) {
    barChart?.dispose()
    barChart = echarts.init(barEl.value)
    barChart.setOption({
      grid: { left: 42, right: 16, top: 26, bottom: 24 },
      tooltip: { trigger: 'axis' },
      xAxis: {
        type: 'category',
        data: days.map((d) => d.date.slice(5)),
        axisLine: { lineStyle: { color: splitColor } },
        axisLabel: { color: dimColor, interval: 13 }
      },
      yAxis: { type: 'value', axisLabel: { color: dimColor }, splitLine: { lineStyle: { color: splitColor } } },
      series: [{ type: 'bar', data: days.map((d) => d.v), itemStyle: { color: accent, borderRadius: [3, 3, 0, 0] } }]
    })
  }
  if (heatEl.value) {
    heatChart?.dispose()
    heatChart = echarts.init(heatEl.value)
    const heat = []
    for (let i = 179; i >= 0; i--) {
      const d = new Date(today)
      d.setDate(d.getDate() - i)
      const ds = dateStr(d)
      heat.push([ds, Math.max(0, daily.get(ds) || 0)])
    }
    heatChart.setOption({
      tooltip: { formatter: (p) => `${p.value[0]}<br/>新增 ${p.value[1]} 字` },
      visualMap: { show: false, min: 0, max: Math.max(500, ...heat.map((h) => h[1])), inRange: { color: [splitColor, accent] } },
      calendar: {
        range: [heat[0][0], heat[heat.length - 1][0]],
        cellSize: ['auto', 14],
        itemStyle: { color: 'transparent', borderColor: splitColor, borderWidth: 1 },
        splitLine: { show: false },
        yearLabel: { show: false },
        monthLabel: { color: dimColor, fontSize: 10 },
        dayLabel: { color: dimColor, fontSize: 9, nameMap: ['日', '一', '二', '三', '四', '五', '六'] }
      },
      series: [{ type: 'heatmap', coordinateSystem: 'calendar', data: heat }]
    })
  }
}

function onResize() {
  barChart?.resize()
  heatChart?.resize()
}

watch(
  () => ui.statsOpen,
  async (open) => {
    if (open) {
      await nextTick()
      await render()
      window.addEventListener('resize', onResize)
    } else {
      window.removeEventListener('resize', onResize)
    }
  }
)
onBeforeUnmount(() => {
  barChart?.dispose()
  heatChart?.dispose()
  window.removeEventListener('resize', onResize)
})
</script>

<template>
  <NModal v-model:show="ui.statsOpen" preset="card" :title="work.loaded ? `写作统计 · ${work.work?.title}` : '写作统计（全部作品）'" style="width: 860px">
    <div class="stat-cards">
      <div class="stat-card">
        <div class="num">{{ cards.total.toLocaleString() }}</div>
        <div class="lbl">总字数</div>
      </div>
      <div class="stat-card">
        <div class="num">{{ cards.chapters }}</div>
        <div class="lbl">章节数</div>
      </div>
      <div class="stat-card">
        <div class="num">{{ cards.week.toLocaleString() }}</div>
        <div class="lbl">近 7 日新增</div>
      </div>
      <div class="stat-card">
        <div class="num">{{ cards.days }}</div>
        <div class="lbl">累计写作天数</div>
      </div>
    </div>
    <div style="font-size: 12px; color: var(--text-dim); margin-bottom: 4px">近 90 天每日新增字数</div>
    <div ref="barEl" style="height: 240px"></div>
    <div style="font-size: 12px; color: var(--text-dim); margin: 8px 0 4px">近 180 天写作热力图</div>
    <div ref="heatEl" style="height: 190px"></div>
    <p v-if="!cards.days" style="font-size: 12px; color: var(--text-dim)">
      还没有码字记录 —— 在正文里写点什么，统计会在自动保存后出现。
    </p>
  </NModal>
</template>
