<!-- 片段详情 / 整理（设计稿 render.js:28）：编辑表单（显式保存 + 未提交草稿）、标签、关联、转为章节/设定、元信息。
     回收站条目只留「恢复这条灵感」，编辑入口隐藏（设计稿明确）。 -->
<script setup>
import { computed,ref,watch } from 'vue'
import OIcon from '../OIcon.vue'
import { formatWebLinkHost } from './snippet-model.js'

const props = defineProps({
  note: { type: Object, default: null },
  draft: { type: Object, default: null },
  busy: Boolean,
  saveError: Boolean,
  conflict: Boolean,
  workTitle: { type: String, default: '' },
  knownTags: { type: Array, default: () => [] },
  assetUrl: { type: Function, default: () => '' }
})
const emit = defineEmits(['close', 'save', 'update-draft', 'add-tag', 'untag', 'unlink', 'open-link', 'convert', 'remove', 'restore', 'preview', 'cancel-edit', 'retry', 'resolve-conflict', 'open-editor', 'open-url', 'open-lightbox'])

const draft = computed(() => props.draft || { title: props.note?.title || '', body: props.note?.body || '' })
const dirty = computed(() => draft.value.title !== props.note?.title || draft.value.body !== props.note?.body)
const kindLabel = { chapter: '正文', mubu: '设定', character: '人物' }
const kindIcon = { chapter: 'books', mubu: 'note', character: 'user' }

const composing=ref(false),tagText=ref('')
watch(()=>props.note?.id,()=>{composing.value=false;tagText.value=''})
watch(()=>props.note?.tags,()=>{if(props.note?.tags.includes(tagText.value.trim().replace(/^#+/,'')))tagText.value=''})
function update(form){emit('update-draft',{title:form.elements.title.value,body:form.elements.body.value})}
function submit(form) {
  if(composing.value||props.busy||props.conflict||!dirty.value||!form.reportValidity())return
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
  <div class="snip-inspector" aria-label="片段整理">
    <template v-if="note">
      <div class="snip-inspect-head">
        <div>
          <span class="snip-eyebrow">{{ note.deletedAt ? '回收站' : '片段整理' }}</span>
          <span class="snip-inspect-head-actions">
            <button
              v-if="!note.deletedAt"
              type="button"
              class="snip-round"
              title="打开宽幅编辑窗口"
              aria-label="打开宽幅编辑窗口"
              @click="emit('open-editor', note.id)"
            ><OIcon name="fit" :size="14" /></button>
            <button type="button" class="snip-round" aria-label="关闭片段详情" @click="emit('close')">×</button>
          </span>
        </div>
        <h2 v-if="note.deletedAt">{{ note.title }}</h2>
      </div>
      <div class="snip-inspect-body scroller">
        <div v-if="saveError" class="snip-save-error" role="alert"><span>保存未完成，内容已保留。</span><button type="button" :disabled="busy" @click="emit('retry')">重试保存</button></div>
        <div v-if="conflict && !note.deletedAt" class="snip-conflict" role="alert">
          <p>原片段已改变，草稿仍保留。请先核对当前版本。</p>
          <details open><summary>当前已保存版本</summary><strong>{{ note.title }}</strong><pre>{{ note.body }}</pre></details>
          <p>继续编辑后，下次保存将用草稿更新当前版本。</p>
          <button type="button" class="snip-soft" @click="emit('resolve-conflict')">已核对，继续编辑</button>
        </div>
        <form
          v-if="!note.deletedAt"
          class="snip-edit-form"
          :key="note.id"
          @submit.prevent="submit($event.currentTarget)"
          @input="update($event.currentTarget)"
          @compositionstart="composing = true" @compositionend="composing = false"
          @keydown.ctrl.s.prevent="submit($event.currentTarget)"
          @keydown.meta.s.prevent="submit($event.currentTarget)"
        >
          <label>标题<input name="title" :value="draft.title" required></label>
          <label>正文<textarea name="body" :value="draft.body"></textarea></label>
          <div class="snip-edit-controls">
            <span v-if="dirty" class="snip-edit-draft">有未提交修改</span>
            <button type="button" class="snip-soft" :disabled="busy || (!dirty && !conflict)" @click="emit('cancel-edit')">取消</button>
            <button type="submit" class="snip-primary" :disabled="busy || conflict || !dirty">保存修改</button>
          </div>
        </form>

        <template v-else>
          <div class="snip-detail-copy">{{ note.body || '还没有正文。' }}</div>
          <button type="button" class="snip-primary snip-edit-button" @click="emit('restore', note.id)">恢复这条灵感</button>
        </template>

        <template v-if="!note.deletedAt">
          <div v-if="note.images?.length" class="snip-inspector-media">
            <div class="snip-section-title">参考图片 <span>{{ note.images.length }}</span></div>
            <div class="snip-inspector-thumbs">
              <button
                v-for="(img, idx) in note.images"
                :key="img.assetId"
                type="button"
                class="snip-inspector-thumb"
                :aria-label="'查看大图 ' + img.name"
                @click="emit('open-lightbox', { images: note.images, index: idx })"
              >
                <img v-if="assetUrl(img.assetId)" :src="assetUrl(img.assetId)" :alt="img.name">
                <OIcon v-else name="image" :size="14" />
              </button>
            </div>
          </div>

          <div v-if="note.webLinks?.length" class="snip-inspector-media">
            <div class="snip-section-title">网址链接 <span>{{ note.webLinks.length }}</span></div>
            <div class="snip-inspector-weblinks">
              <button
                v-for="link in note.webLinks"
                :key="link.id"
                type="button"
                class="snip-ref snip-inspector-web"
                :title="'在默认浏览器中打开 ' + link.url"
                @click="emit('open-url', link.url)"
              >
                <OIcon name="external" :size="14" />
                <strong>{{ link.title || formatWebLinkHost(link.url) || link.url }}</strong>
                <i class="arrow">↗</i>
              </button>
            </div>
          </div>

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
          <p class="snip-caption">{{ dirty ? '转换使用已保存的内容。' : '转换后保留原灵感。' }}</p>
        </template>

        <div class="snip-meta-lines">
          创建于 <time class="num">{{ (note.date || '').replaceAll('-', '.') }} {{ note.time }}</time><br>
          所属作品　{{ workTitle }}
        </div>
        <button
          v-if="!note.deletedAt"
          type="button"
          class="snip-soft snip-danger snip-delete-button"
          @click="emit('remove', note.id)"
        >移入回收站</button>
      </div>
    </template>
    <div v-else class="snip-inspector-empty">
      <h2>片段整理</h2>
      <p>选择一条灵感，编辑内容、标签和关联。</p>
    </div>
  </div>
</template>
