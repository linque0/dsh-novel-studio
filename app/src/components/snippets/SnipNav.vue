<!-- 灵感左栏（设计稿 render.js:7 .sidebar）：当前作品 / 全部 / 未标记 / 有关联 / 标签（可展开）/ 回收站。
     默认 7 条，展开后全部可访问；仅标签列表独立滚动。 -->
<script setup>
import { computed } from 'vue'
import OIcon from '../OIcon.vue'

const props = defineProps({
  workTitle: { type: String, default: '' },
  counts: { type: Object, required: true },
  filter: { type: String, default: 'all' },
  tag: { type: String, default: '' },
  moreTags: Boolean
})
const emit = defineEmits(['filter', 'tag', 'toggle-more'])

const shown = computed(() => (props.moreTags ? props.counts.tags : props.counts.tags.slice(0, 7)))
</script>

<template>
  <nav class="snip-nav" aria-label="灵感导航">
    <div class="snip-nav-work"><div class="work-heading">当前作品</div>
    <h2 :title="workTitle">{{ workTitle }}</h2></div>

    <div class="snip-nav-primary"><button type="button" class="snip-nav-row" :class="{ selected: filter === 'all' && !tag }" data-value="all" :aria-pressed="filter === 'all' && !tag" @click="emit('filter', 'all')">
      <OIcon name="tray" :size="16" /><span>全部灵感</span><b>{{ counts.all }}</b>
    </button>
    <button type="button" class="snip-nav-row" :class="{ selected: filter === 'untagged' && !tag }" data-value="untagged" :aria-pressed="filter === 'untagged' && !tag" @click="emit('filter', 'untagged')">
      <OIcon name="tag" :size="16" /><span>未标记</span><b>{{ counts.untagged }}</b>
    </button>
    <button type="button" class="snip-nav-row" :class="{ selected: filter === 'linked' && !tag }" data-value="linked" :aria-pressed="filter === 'linked' && !tag" @click="emit('filter', 'linked')">
      <OIcon name="link" :size="16" /><span>有关联</span><b>{{ counts.linked }}</b>
    </button>

    </div><div class="snip-nav-tags"><div class="snip-nav-title-line">
      <span>标签</span>
      <button v-if="counts.tags.length > 7" type="button" @click="emit('toggle-more')">{{ moreTags ? '收起' : '全部' }}</button>
    </div>
    <div class="snip-tag-list"><button
      v-for="row in shown"
      :key="row.tag"
      type="button"
      class="snip-nav-row"
      :class="{ selected: tag === row.tag }"
      :data-tag="row.tag"
      :title="row.tag"
      :aria-pressed="tag === row.tag"
      @click="emit('tag', tag === row.tag ? '' : row.tag)"
    >
      <span class="hash">#</span><span>{{ row.tag }}</span><b>{{ row.count }}</b>
    </button>
    <p v-if="!counts.tags.length" class="snip-caption" style="padding: 0 10px">还没有标签。在片段详情里给灵感加标签。</p>

    </div></div><div class="snip-nav-footer"><div class="snip-nav-end">{{ counts.all }} 条灵感 · {{ counts.tags.length }} 个标签</div>
    <div class="snip-trash-nav">
      <button type="button" class="snip-nav-row" :class="{ selected: filter === 'trash' }" data-value="trash" :aria-pressed="filter === 'trash'" @click="emit('filter', 'trash')">
        <OIcon name="trash" :size="16" /><span>回收站</span><b>{{ counts.trash }}</b>
      </button>
    </div>
    </div>
  </nav>
</template>
