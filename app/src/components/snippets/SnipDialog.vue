<!-- 灵感弹窗（设计稿 render.js:35 一套 #action-dialog 按类型换内容）：
     记一条 / 关联 / 转换 / 目标预览 / 键盘快捷键。 -->
<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import OIcon from '../OIcon.vue'
import SnipModal from './SnipModal.vue'

const props = defineProps({
  type: { type: String, required: true },
  note: { type: Object, default: null },
  tag: { type: String, default: '' },
  payload: { type: Object, default: () => ({}) },
  linkOptions: { type: Array, default: () => [] },
  convertOptions: { type: Array, default: () => [] },
  quick: { type: String, default: '' },
  preview: { type: Object, default: null },
  error: { type: String, default: '' },
  sheet: Boolean,
  busy: Boolean,
  saveError: Boolean
})
const emit = defineEmits(['close', 'compose', 'link', 'convert', 'update:quick', 'retry'])

const panel = ref(null)
const composing=ref(false)
const pick = ref(props.linkOptions[0]?.value || '')
const dest = ref(props.convertOptions[0]?.value || '')
function focusField(){const e=panel.value;if(e)(e.querySelector('textarea')||e.querySelector('select')||e.querySelector('input')||e.querySelector('button'))?.focus({preventScroll:true})}
watch(()=>[props.type,props.payload?.kind],async()=>{
  pick.value=props.linkOptions[0]?.value||''
  dest.value=props.convertOptions[0]?.value||''
  await nextTick();focusField()
})
watch(()=>props.linkOptions,options=>{if(!options.some(o=>o.value===pick.value))pick.value=options[0]?.value||''})
watch(()=>props.convertOptions,options=>{if(!options.some(o=>o.value===dest.value))dest.value=options[0]?.value||''})

const heading = computed(() => ({
  compose: '记下一点灵感',
  link: '关联已有内容',
  convert: props.payload?.kind === 'mubu' ? '转为设定' : '转为章节',
  preview: props.preview?.title || props.preview?.fallback || '关联目标',
  shortcuts: '键盘快捷键'
}[props.type] || ''))

const shortcuts = [
  ['搜索灵感', 'Ctrl / Cmd + K'],
  ['记录灵感', 'Ctrl / Cmd + Enter'],
  ['保存修改', 'Ctrl / Cmd + S'],
  ['关闭当前面板', 'Esc']
]

function onCompose(form) {
  if(composing.value||props.busy)return
  const fd = new FormData(form)
  emit('compose', String(fd.get('content') || ''))
}
function submitLink() {
  if (pick.value) emit('link', pick.value)
}
function submitConvert() {
  emit('convert', dest.value)
}

onMounted(async () => {
  await nextTick()
  focusField()
})
</script>

<template>
  <SnipModal :label="heading" @close="emit('close')">
    <div ref="panel" class="snip-dialog" data-dialog="action" :class="{ 'snip-detail-dialog': sheet }" role="region" :aria-label="heading">
      <div v-if="saveError" class="snip-save-error" role="alert">
        <span>保存未完成，内容已保留。</span>
        <button type="button" :disabled="busy" @click="emit('retry')">重试保存</button>
      </div>
      <div class="snip-dialog-head">
        <h2>{{ heading }}</h2>
        <button type="button" class="snip-round" aria-label="关闭" data-autofocus @click="emit('close')">×</button>
      </div>

      <form v-if="type === 'compose'" @submit.prevent="onCompose($event.currentTarget)" @keydown.ctrl.enter.prevent="onCompose($event.currentTarget)" @keydown.meta.enter.prevent="onCompose($event.currentTarget)" @compositionstart="composing=true" @compositionend="composing=false">
        <div class="snip-dialog-body">
          <textarea name="content" aria-label="新灵感内容" placeholder="第一行写标题，接着随意写…" :value="quick" @input="emit('update:quick', $event.target.value)"></textarea>
          <div v-if="error" class="snip-form-error" role="alert">{{ error }}</div>
        </div>
        <div class="snip-dialog-foot">
          <small>{{ tag ? '记录到 #' + tag : '首行作为标题 · Ctrl ↵ 记录' }}</small>
          <button type="submit" class="snip-primary" :disabled="busy">记录灵感 <OIcon name="arrow-right" :size="15" /></button>
        </div>
      </form>

      <form v-else-if="type === 'link'" @submit.prevent="submitLink">
        <div class="snip-dialog-body">
          <p>为「{{ note?.title }}」添加关联。</p>
          <label>选择目标
            <select v-model="pick">
              <optgroup v-for="group in ['正文', '设定', '人物']" :key="group" :label="group">
                <option
                  v-for="o in linkOptions.filter((x) => x.group === group)"
                  :key="o.value"
                  :value="o.value"
                >{{ o.label }}</option>
              </optgroup>
            </select>
          </label>
          <p v-if="!linkOptions.length">已有目标均已关联。</p>
        </div>
        <div class="snip-dialog-foot">
          <small>目标改名后仍保留关联</small>
          <button type="submit" class="snip-primary" :disabled="busy || !linkOptions.length">添加关联</button>
        </div>
      </form>

      <form v-else-if="type === 'convert'" @submit.prevent="submitConvert">
        <div class="snip-dialog-body">
          <p>保留「{{ note?.title }}」，并创建一份可继续写的{{ payload.kind === 'mubu' ? '设定节点' : '新章节' }}。</p>
          <label>位置
            <select v-model="dest">
              <option v-for="o in convertOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
          </label>
        </div>
        <div class="snip-dialog-foot">
          <small>原内容保留，并添加关联</small>
          <button type="submit" class="snip-primary" :disabled="busy">创建{{ payload.kind === 'mubu' ? '设定' : '章节' }}</button>
        </div>
      </form>

      <template v-else-if="type === 'preview'">
        <div class="snip-dialog-body">
          <div class="snip-preview-path">{{ preview?.path || '关联内容' }}</div>
          <div class="snip-preview-body">{{ preview?.body || '暂时没有正文。' }}</div>
        </div>
        <div class="snip-dialog-foot">
          <small>关联内容</small>
          <button type="button" class="snip-soft" @click="emit('close')">返回灵感</button>
        </div>
      </template>

      <div v-else-if="type === 'shortcuts'" class="snip-dialog-body">
        <div v-for="row in shortcuts" :key="row[0]" class="snip-shortcut-row">
          <span>{{ row[0] }}</span><span class="snip-key">{{ row[1] }}</span>
        </div>
      </div>
    </div>
  </SnipModal>
</template>
