<!-- 片段详情 / 整理（设计稿 render.js:28）：编辑表单（显式保存 + 未提交草稿）、标签、关联、转为章节/设定、元信息。
     回收站条目只留「恢复这条灵感」，编辑入口隐藏（设计稿明确）。 -->
<script setup>
import { computed,ref,watch } from 'vue'
import OIcon from '../OIcon.vue'

const props = defineProps({
  note: { type: Object, default: null },
  draft: { type: Object, default: null },
  wide: Boolean,
  busy: Boolean,
  saveError: Boolean,
  conflict: Boolean,
  board: Boolean,
  workTitle: { type: String, default: '' },
  knownTags: { type: Array, default: () => [] },
  linkCount: { type: Number, default: 0 }
})
const emit = defineEmits(['close', 'edit', 'save', 'update-draft', 'add-tag', 'untag', 'unlink', 'open-link', 'convert', 'remove', 'restore', 'preview', 'cancel-edit', 'retry', 'resolve-conflict'])

// 只有带 editing 标记的草稿才算在编辑：残留草稿（点过编辑但没改）Open 后仍停在阅读态。
const editing = computed(() => !!props.draft?.editing && !props.note?.deletedAt)
const draft = computed(() => props.draft || { title: props.note?.title || '', body: props.note?.body || '' })
const showCopy = computed(() => !!props.note && !editing.value && (!props.wide || props.board))
const kindLabel = { chapter: '正文', mubu: '设定', character: '人物' }
const kindIcon = { chapter: 'books', mubu: 'note', character: 'user' }

const composing=ref(false),tagText=ref('')
watch(()=>props.note?.tags,()=>{if(props.note?.tags.includes(tagText.value.trim().replace(/^#+/,'')))tagText.value=''})
function update(form){emit('update-draft',{title:form.elements.title.value,body:form.elements.body.value})}
function submit(form) {
  if(composing.value||props.busy)return
  form=form?.closest?.('form')||form
  const fd = new FormData(form)
  const title = String(fd.get('title') || '')
  const body = String(fd.get('body') || '')
  emit('save', { title, body })
}
function onTag(form) {
  emit('add-tag', String(new FormData(form).get('tag') || ''))

}
</script>

<template>
  <div class="snip-inspector scroller" aria-label="片段整理">
    <template v-if="note">
      <div class="snip-inspect-head">
        <div>
          <span class="snip-eyebrow">{{ note.deletedAt ? '回收站' : '片段整理' }}</span>
          <button type="button" class="snip-round" aria-label="关闭片段详情" @click="emit('close')">×</button>
        </div>
        <h2>{{ note.title }}</h2>
      </div>
      <div class="snip-inspect-body">
        <div v-if="saveError" class="snip-save-error" role="alert"><span>保存未完成，内容已保留。</span><button type="button" :disabled="busy" @click="emit('retry')">重试保存</button></div>
        <div v-if="conflict && !note.deletedAt" class="snip-conflict" role="alert">
          <p>原片段已改变，草稿仍保留。请先核对当前版本。</p>
          <details open><summary>当前已保存版本</summary><strong>{{ note.title }}</strong><pre>{{ note.body }}</pre></details>
          <p>继续编辑后，下次保存将用草稿更新当前版本。</p>
          <button type="button" class="snip-soft" @click="emit('resolve-conflict')">已核对，继续编辑</button>
        </div>
        <!-- 编辑态：显式保存 + 未提交草稿（切视图/关面板/刷新都不丢） -->
        <form
          v-if="editing"
          class="snip-edit-form"
          @submit.prevent="submit($event.currentTarget)"
          @input="update($event.currentTarget)"
          @compositionstart="composing = true" @compositionend="composing = false"
          @keydown.ctrl.s.prevent="submit($event.currentTarget)"
          @keydown.meta.s.prevent="submit($event.currentTarget)"
        >
          <label>标题<input name="title" :value="draft.title" required></label>
          <label>正文<textarea name="body" :value="draft.body"></textarea></label>
          <div class="snip-edit-controls">
            <span class="snip-edit-draft">有未提交修改</span>
            <button type="button" class="snip-soft" @click="emit('cancel-edit')">取消</button>
            <button type="submit" class="snip-primary" :disabled="busy">保存修改</button>
          </div>
        </form>

        <template v-else>
          <div v-if="showCopy" class="snip-detail-copy">{{ note.body || '还没有正文。' }}</div>
          <button v-if="!note.deletedAt" type="button" class="snip-soft snip-edit-button" @click="emit('edit', note.id)">
            <OIcon name="edit" :size="15" />编辑片段
          </button>
          <button v-else type="button" class="snip-primary snip-edit-button" @click="emit('restore', note.id)">恢复这条灵感</button>
        </template>

        <template v-if="!note.deletedAt && !editing">
          <div class="snip-section-title">标签<span>{{ note.tags.length }}</span></div>
          <div class="snip-tags">
            <span v-for="t in note.tags" :key="t" class="snip-edit-tag"># {{ t }}<button type="button" :aria-label="'移除标签' + t" @click="emit('untag', t)">×</button></span>
            <span v-if="!note.tags.length" class="snip-tag-empty">尚未标记</span>
          </div>
          <form class="snip-tag-form" @submit.prevent="onTag($event.target)">
            <input v-model="tagText" name="tag" aria-label="添加标签" placeholder="添加标签…" maxlength="31" list="snip-known-tags">
            <datalist id="snip-known-tags">
              <option v-for="t in knownTags" :key="t" :value="t"></option>
            </datalist>
            <button type="submit" aria-label="添加标签">＋</button>
          </form>

          <div class="snip-section-title">已有关联 <span>{{ note.links.length }}</span></div>
          <div v-for="l in note.links" :key="l.kind + ':' + l.id" class="snip-link-row">
            <button
              type="button"
              class="snip-ref"
              :data-target="l.kind + ':' + l.id"
              @click="emit('preview', l)"
            >
              <OIcon :name="kindIcon[l.kind] || 'note'" :size="15" />
              <span>{{ kindLabel[l.kind] || l.kind }}</span>
              <strong>{{ l.missing ? '目标已不可用' : l.name }}</strong>
              <i class="arrow">→</i>
            </button>
            <button type="button" class="snip-unlink" :aria-label="'移除关联' + (l.name || '')" @click="emit('unlink', l.kind + ':' + l.id)">×</button>
          </div>
          <p v-if="!note.links.length" class="snip-caption">尚未关联其他内容。</p>
          <button type="button" class="snip-soft snip-edit-button" style="margin-top: 8px" @click="emit('open-link')">＋ 添加关联</button>

          <div class="snip-convert">
            <button type="button" class="snip-soft" @click="emit('convert', 'chapter')"><OIcon name="books" :size="15" />转为章节</button>
            <button type="button" class="snip-soft" @click="emit('convert', 'mubu')"><OIcon name="note" :size="15" />转为设定</button>
          </div>
          <p class="snip-caption">转换后保留原灵感。</p>
        </template>

        <div class="snip-meta-lines">
          创建于 <time class="num">{{ (note.date || '').replaceAll('-', '.') }} {{ note.time }}</time><br>
          所属作品　{{ workTitle }}
        </div>
        <button
          v-if="!note.deletedAt && !editing"
          type="button"
          class="snip-soft snip-danger snip-delete-button"
          @click="emit('remove', note.id)"
        >移入回收站</button>
      </div>
    </template>
    <div v-else class="snip-inspector-empty">
      <h2>片段整理</h2>
      <p>选择一条灵感，查看内容、标签和关联。</p>
    </div>
  </div>
</template>
