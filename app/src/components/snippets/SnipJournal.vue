<!-- 手札（设计稿 render.js:18-22）：置顶记录卡 + 按日期分组 + 连续段落卡片。 -->
<script setup>
import { computed, nextTick,ref } from 'vue'
import OIcon from '../OIcon.vue'
import SnipCard from './SnipCard.vue'

const props = defineProps({
  notes: { type: Array, required: true },
  selectedId: { type: String, default: '' },
  tag: { type: String, default: '' },
  trash: Boolean,
  busy: Boolean,
  quick: { type: String, default: '' },
  today: { type: String, default: '' },
  error: { type: String, default: '' }
})
const emit = defineEmits(['capture', 'update:quick', 'select', 'edit', 'menu', 'tag', 'compose', 'clear'])

/* 日期分组按可见顺序（排序已经由模型决定，这里只做相邻归并，不重排） */
const groups = computed(() => {
  const out = []
  for (const n of props.notes) {
    const last = out[out.length - 1]
    if (last && last.date === n.date) last.notes.push(n)
    else out.push({ date: n.date, notes: [n] })
  }
  return out
})
function label(date) {
  if (!date) return ''
  if (date === props.today) return '今天'
  const [, m, d] = date.split('-')
  return Number(m) + ' 月 ' + d + ' 日'
}
const composing=ref(false)
function submit(form) {
  if(composing.value||props.busy)return
  form=form?.closest?.('form')||form
  const text = String(props.quick || '')
  emit('capture', text)
  nextTick(() => form?.querySelector('textarea')?.focus())
}
</script>

<template>
  <div class="snippet-surface scroller" style="height: 100%">
    <form
      v-if="!trash"
      class="snip-capture"
      @submit.prevent="submit($event.currentTarget)"
      @compositionstart="composing=true" @compositionend="composing=false"
      @keydown.ctrl.enter.prevent="submit($event.currentTarget)"
      @keydown.meta.enter.prevent="submit($event.currentTarget)"
    >
      <div class="snip-capture-head">
        <span><OIcon name="edit" :size="14" />此刻，想到了什么？</span>
        <span v-if="tag" class="snip-filter-chip">#{{ tag }}</span>
      </div>
      <textarea
        :value="quick"
        rows="2"
        aria-label="随手记录灵感"
        placeholder="一个画面，一句对白，或还没想清楚的念头…"
        @input="emit('update:quick', $event.target.value)"
      ></textarea>
      <div class="snip-capture-foot">
        <span>首行作为标题 · <span class="num">Ctrl ↵</span> 记录</span>
        <button type="submit" class="snip-primary" :disabled="busy">记录 <OIcon name="arrow-right" :size="15" /></button>
      </div>
      <div v-if="error" class="snip-form-error" role="alert">{{ error }}</div>
    </form>

    <template v-if="notes.length">
      <template v-for="g in groups" :key="g.date + '-' + g.notes[0]?.id">
        <div class="snip-date-heading">
          <h2>{{ label(g.date) }}</h2>
          <small>{{ g.date.replaceAll('-', '.') }}</small>
          <span>{{ g.notes.length }} 条灵感</span>
        </div>
        <SnipCard
          v-for="n in g.notes"
          :key="n.id"
          :note="n"
          :selected="n.id === selectedId"
          @select="emit('select', $event)"
          @edit="emit('edit', $event)"
          @menu="emit('menu', $event)"
          @tag="emit('tag', $event)"
        />
      </template>
    </template>
    <div v-else class="snip-empty">
      <OIcon :name="trash ? 'trash' : 'note'" :size="30" />
      <h2>{{ trash ? '回收站是空的' : '从一个念头开始' }}</h2>
      <p>{{ trash ? '删除的灵感会暂存在这里，随时可以恢复。' : '一个画面、一句对白，都可以先记下来。' }}</p>
      <button v-if="trash" type="button" class="snip-primary" @click="emit('clear')">返回全部灵感</button>
      <button v-else type="button" class="snip-primary" @click="emit('compose', '')">记下第一条</button>
    </div>
  </div>
</template>
