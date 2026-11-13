<script setup>
/* 更改作品数据存储位置。
 *
 * 为什么要有这个弹窗、而不是直接调后端换目录：迁移的真实语义是「移动」——成功后原位置
 * 不再保留。所以选目录之后必须让作者再看一眼目标路径和后果，并亲手点一次「确认迁移」。
 * 两步放在同一弹窗里靠 step 切换：再套一层 <dialog> 会和通用壳写死的 #settings-dialog id
 * 打架（同时挂两个时标题选择器会命中关闭着的那个），也让人以为两次操作是两件事。
 *
 * 桌面版的原生选择器在数据页里就调完了（window.native.pickLibraryDir），结果通过 confirmDir
 * 传进来，这里直接落在确认步；插件版没有原生 dialog，才是本弹窗的浏览步逐级点选。
 * 浏览与迁移都走 services/library.js 的 libraryBrowse / libraryRelocate，宿主没挂通道时
 * 它们会抛出人话错误，落在弹窗内的 #error 槽里，不会白屏。
 *
 * 弹窗能被 Esc 和点遮罩关掉，但迁移在途时必须关不上：那次 RPC 的返回无人接收，
 * 作者会以为迁移没发生或已经失败，而磁盘上的文件其实已经搬完。 */
import { computed, inject, onBeforeUnmount, onMounted, ref } from 'vue'
import { libraryBrowse, libraryRelocate } from '../../services/library.js'
import { SETTINGS_TOAST_KEY } from './settings-toast.js'
import SettingsDialog from './SettingsDialog.vue'

const props = defineProps({
  /* 当前作品库目录，作为浏览起点 */
  current: { type: String, default: '' },
  /* 桌面原生选择器已选好的目录；非空即跳过浏览步 */
  confirmDir: { type: String, default: '' }
})
const emit = defineEmits(['close', 'relocated'])

const toast = inject(SETTINGS_TOAST_KEY, null)

/* 后端错误码到人话：键和 bridge 的 code 一一对应，未收录的码原样透出，
   总比吞掉错误让人以为迁移成功了安全。 */
const REASONS = {
  TARGET_IS_LIBRARY: '这个目录本身就是作品库，请选择它的上一级或另一个目录。',
  TARGET_NOT_EMPTY: '这个目录里已有其他文件，为避免覆盖，请选择一个空目录。',
  TARGET_NOT_WRITABLE: '没有写入这个目录的权限，请换一个位置或调整系统权限。',
  NESTED: '不能把作品库移动到它自己内部，请选择它外面的目录。',
  SAME_DIR: '这就是当前存储位置，无需迁移。',
  BAD_PATH: '路径无效或不存在，请重新选择。',
  VERIFY_FAILED: '迁移后校验未通过，原位置的数据仍完整保留，请重试或换一个目录。'
}

const visible = ref(false)
const step = ref('browse')
const busy = ref(false)
const isLoading = ref(false)
const error = ref('')

const dir = ref('')
const parent = ref('')
const entries = ref([])
const pathInput = ref('')
/* 当前浏览目录是否可以作为迁移目标；原生选择器给的目标没经过浏览，按下可试放行，
   最终校验由后端在迁移时做 */
const browsable = ref(false)
const reason = ref('')

/* 每次浏览自增；返回时对不上就丢弃，避免慢响应盖掉作者已经点到的新目录 */
let browseToken = 0
let alive = true

const target = computed(() => props.confirmDir || dir.value)
const validTarget = computed(() => !!props.confirmDir || browsable.value)
const canRelocate = computed(() => !busy.value && !!target.value && validTarget.value)
const reasonText = computed(() => humanize(reason.value))

function humanize(code) {
  if (!code) return ''
  return REASONS[code] || String(code)
}

function close() {
  /* 迁移在途：按钮已禁用，Esc 与遮罩也一并挡住，见文件头注释 */
  if (busy.value) return
  visible.value = false
  setTimeout(() => emit('close'), 0)
}

function normalize(input) {
  const text = String(input || '').trim()
  if (!text) return ''
  /* 容忍尾部分隔符与混用：Windows 反斜杠、POSIX 斜杠都可能被作者手打进来 */
  const trimmed = text.replace(/[\\/]+$/, '')
  return trimmed || text
}

async function browse(input) {
  const target = normalize(input)
  if (!target) {
    error.value = '请填写完整路径。'
    return
  }
  const token = ++browseToken
  isLoading.value = true
  error.value = ''
  try {
    const data = await libraryBrowse(target)
    if (!alive || token !== browseToken || !data) return
    dir.value = data.dir || target
    parent.value = data.parent || ''
    entries.value = Array.isArray(data.entries) ? data.entries : []
    browsable.value = data.isValidTarget === true
    reason.value = data.isValidTarget === false ? humanize(data.reason) : ''
    pathInput.value = dir.value
  } catch (err) {
    if (!alive || token !== browseToken) return
    /* 非法路径只在弹窗内说，不弹 toast：手打路径时会连续错好几次 */
    error.value = humanize(err?.code) || String(err?.message || err)
  } finally {
    if (alive && token === browseToken) isLoading.value = false
  }
}

function enter(entry) {
  if (busy.value || !entry?.path) return
  browse(entry.path)
}

function goUp() {
  if (busy.value || !parent.value) return
  browse(parent.value)
}

function goPath() {
  if (busy.value) return
  browse(pathInput.value)
}

function toConfirm() {
  if (!canRelocate.value) return
  step.value = 'confirm'
}

function backToBrowse() {
  if (busy.value) return
  /* 原生选择器给的目录没有浏览上下文，退回浏览步没有意义 */
  if (props.confirmDir) {
    close()
    return
  }
  step.value = 'browse'
}

async function relocate() {
  if (!canRelocate.value) return
  busy.value = true
  error.value = ''
  try {
    const result = await libraryRelocate(target.value)
    if (!alive) return
    /* 重启提示按后端回的 restartHint 分岔：插件版改了宿主读的数据目录，必须重启 DSH 才生效；
       桌面版下一次 IPC 就走新路径，立即生效。 */
    toast?.show(result?.restartHint === 'dsh' ? '作品数据已移动，请重启 DSH 后生效。' : '作品数据已移动到新位置，立即生效。')
    visible.value = false
    emit('relocated')
    setTimeout(() => emit('close'), 0)
  } catch (err) {
    if (!alive) return
    error.value = humanize(err?.code) || String(err?.message || err)
    busy.value = false
  }
}

onMounted(() => {
  visible.value = true
  if (props.confirmDir) {
    step.value = 'confirm'
    dir.value = normalize(props.confirmDir)
    pathInput.value = dir.value
    return
  }
  /* 当前位置读不出来时不要用空路径去问后端：那样只会得到一条与作者无关的报错，
     直接请他自己填一个路径更快 */
  if (!normalize(props.current)) {
    error.value = '未能读取当前存储位置，请在下方填写一个完整路径。'
    return
  }
  browse(props.current)
})

onBeforeUnmount(() => {
  alive = false
  /* 令在途响应全部作废：卸载后没有人能接收它们 */
  browseToken += 1
})
</script>

<template>
  <SettingsDialog :open="visible" title="更改作品数据存储位置" wide @update:open="close">
    <template v-if="step === 'browse'">
      <div class="loc-browse-head">
        <span class="loc-crumb" :title="dir">{{ dir || '正在读取…' }}</span>
        <button type="button" class="btn" data-act="dir-up" :disabled="busy || !parent" @click="goUp">上一级</button>
      </div>

      <div class="loc-dir-list" :class="{ loading: isLoading }">
        <button
          v-for="entry in entries"
          :key="entry.path"
          type="button"
          class="loc-dir-row"
          data-dir-entry
          :data-path="entry.path"
          @click="enter(entry)"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
          <span>{{ entry.name }}</span>
        </button>
        <p v-if="!entries.length && !isLoading" class="dialog-note">这里没有子目录。可以直接选当前目录，或在上方填写路径。</p>
      </div>

      <div class="loc-path-field">
        <label for="loc-path-input">直接输入路径</label>
        <div>
          <input
            id="loc-path-input"
            v-model="pathInput"
            type="text"
            spellcheck="false"
            placeholder="例如 D:\写作\作品数据"
            @keyup.enter="goPath"
          />
          <button type="button" class="btn" data-act="dir-go" :disabled="busy" @click="goPath">前往</button>
        </div>
      </div>

      <p v-if="reasonText" class="loc-reason">{{ reasonText }}</p>
    </template>

    <template v-else>
      <p>将把全部作品数据移动到：</p>
      <p class="loc-target" :title="target">{{ target }}</p>
      <p class="dialog-note">
        移动成功后原位置不再保留。请先确认这个目录在你有权限访问的磁盘上。
      </p>
      <p class="dialog-note">
        {{ confirmDir ? '桌面版会立即生效，无需重启。' : '插件版需要重启 DSH 后生效。' }}
      </p>
    </template>

    <template #footer>
      <button v-if="step === 'confirm'" type="button" class="btn" data-act="relocate-cancel" :disabled="busy" @click="backToBrowse">取消</button>
      <button v-else type="button" class="btn" data-act="dialog-close" :disabled="busy" @click="close">取消</button>
      <button v-if="step === 'browse'" type="button" class="btn primary" data-act="relocate-next" :disabled="!canRelocate" @click="toConfirm">迁移到此目录</button>
      <button v-else type="button" class="btn danger" data-act="relocate" :disabled="!canRelocate" @click="relocate">
        {{ busy ? '正在迁移…' : '确认迁移' }}
      </button>
    </template>
    <template #error>{{ error }}</template>
  </SettingsDialog>
</template>
