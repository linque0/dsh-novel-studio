<!-- 关系链接选择面板：关键词全局搜索（标题或正文命中，附选段）/ 反向链接（正文、幕布、纯文本右键菜单共用） -->
<script setup>
import { ref, computed } from 'vue'
import { searchTargets, findBacklinks, jumpTo, highlightExcerpt, KIND_LABEL } from '../services/doublelinks'

const props = defineProps({ initialQuery: { type: String, default: '' } })
const emit = defineEmits(['pick'])

const q = ref(props.initialQuery || '')
const mode = ref('link') // link 链接到 | back 反向链接

const results = computed(() => (mode.value === 'back' ? findBacklinks(q.value.trim()) : searchTargets(q.value, 40)))
</script>

<template>
  <div class="dl-picker">
    <div class="dl-picker-tabs">
      <button class="dl-tab" :class="{ on: mode === 'link' }" type="button" @click="mode = 'link'">链接到…</button>
      <button class="dl-tab" :class="{ on: mode === 'back' }" type="button" @click="mode = 'back'">反向链接</button>
    </div>
    <input v-model="q" class="rp-input" :placeholder="mode === 'link' ? '关键词搜索全书：标题或正文均可…' : '输入标题，查询哪些内容引用了它'" />
    <div class="dl-picker-list">
      <div
        v-for="t in results"
        :key="t.kind + ':' + t.id"
        class="picker-item"
        :class="{ 'has-excerpt': t.excerpt }"
        @click="mode === 'link' ? emit('pick', t) : jumpTo(t)"
      >
        <span class="dl-kind">{{ KIND_LABEL[t.kind] }}</span>
        <span class="picker-main">
          <span class="picker-title">{{ t.title }}</span>
          <span v-if="t.excerpt" class="picker-excerpt" v-html="highlightExcerpt(t.excerpt, q.trim())" />
        </span>
        <span v-if="t.extra" class="picker-extra">{{ t.extra }}</span>
      </div>
      <div v-if="!results.length" class="dl-picker-empty">{{ mode === 'link' ? '没有匹配的内容——试试更短的关键词' : '暂无反向链接' }}</div>
    </div>
    <div class="dl-picker-tip">{{ mode === 'link' ? '标题或正文命中皆可选为链接目标；选中的文字已作为关键词填入。' : '点击结果可跳转到引用位置。' }}</div>
  </div>
</template>
