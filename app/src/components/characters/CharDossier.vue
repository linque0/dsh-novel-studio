<!-- 主区·人物卷宗：外壳 .char-pane[data-pane='main'] 的内容（视图为 profile 时渲染）。
     结构对照设计稿 app.mjs:31 moduleHead()、app.mjs:32 profile()、app.mjs:33 editForm()、app.mjs:37 footer()，
     滚动位置的存取由外壳按 data-char-scroll="dossier" 负责。
     数据语义沿用插件既有的即时落库（work.updateCharacter），编辑态只是「显示哪套排版」，取消不回滚已写库内容。 -->
<script setup>
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import OIcon from '../OIcon.vue'
import DLinkTextMenu from '../DLinkTextMenu.vue'
import LoreRelRows from '../LoreRelRows.vue'
import { useWorkStore } from '../../stores/work'
import { useUiStore } from '../../stores/ui'
import { popOut } from '../../services/panelwindows'
import { pickFiles, arrayBufferToBlob, imageMime, IMAGE_EXTS } from '../../services/fileio'
import { jumpTo } from '../../services/doublelinks'
import { rolesOf, primaryRole, aliasesOf, splitTagString, uniqTags } from '../../services/character-tags'
import { tagColor } from '../../services/tagcolors'

const shell = inject('charShell', null)
const work = useWorkStore()
const ui = useUiStore()

const c = computed(() => work.activeCharacter)
const narrow = computed(() => !!shell?.narrow?.value)
const view = computed(() => shell?.view?.value || (work.charView === 'graph' ? 'graph' : 'profile'))
const workTitle = computed(() => work.work?.title || '未命名作品')

const editing = ref(false)
const menuOpen = ref(false)
const nameEl = ref(null)
const dlMenu = ref(null)

/* 一句话：插件版没有独立列，存在 fields 里（设计稿同位置用 fields['身份']），编辑器与阅读态共用这一格 */
const NOTE_KEY = '一句话'
const fieldsEntries = computed(() => Object.entries(c.value?.fields || {}))
const note = computed(() => String(c.value?.fields?.[NOTE_KEY] || ''))
const customFields = computed(() => fieldsEntries.value.filter(([k]) => k !== NOTE_KEY))
const roles = computed(() => rolesOf(c.value))
const roleText = computed(() => primaryRole(c.value) || '未定角色')
const otherRoles = computed(() => roles.value.slice(1).join(' / ') || '人物档案')
const aliases = computed(() => aliasesOf(c.value))
const bioParagraphs = computed(() => String(c.value?.content || '').split(/\n{2,}/).map((s) => s.trim()).filter(Boolean))
const relEntries = computed(() => (c.value ? work.loreLinksOf('character', c.value.id) : []))
const avatarUrl = computed(() => {
  void work.urlTick
  return c.value?.avatarAssetId ? work.assetUrl(c.value.avatarAssetId) : ''
})
const faceStyle = computed(() => ({ '--char-tone': tagColor(c.value?.name || '人') }))
const initial = computed(() => String(c.value?.name || '').trim().slice(0, 1) || '人')

watch(() => c.value?.avatarAssetId, (id) => {
  if (id) void work.warmUrls([id])
}, { immediate: true })
/* 换人即退出编辑态，避免把上一份表单状态带到下一个人物 */
watch(() => c.value?.id, () => {
  editing.value = false
  menuOpen.value = false
})

const ROLE_PRESETS = ['主角', '配角', '反派', '导师', '红颜', '盟友', '旁观者', '龙套']
const hasRole = (r) => roles.value.includes(r)

function patch(p) {
  if (c.value) work.updateCharacter(c.value.id, p)
}
function onText(e, key) {
  patch({ [key]: e.target.value })
}
function toggleRoleChip(r) {
  const list = hasRole(r) ? roles.value.filter((x) => x !== r) : [...roles.value, r]
  patch({ role: uniqTags(list).slice(0, 12).join('/') })
}
/* 标签输入保留用户输入的原文（局部草稿），落库的是归一化结果：
   直接绑 store 会在「雾港 /」这种中途状态把输入框改回去，光标随之跳位 */
const tagsDraft = ref('')
watch(() => c.value?.id, () => {
  tagsDraft.value = (c.value?.tags || []).join(' / ')
}, { immediate: true })
function onTags(e) {
  tagsDraft.value = e.target.value
  patch({ tags: uniqTags(splitTagString(e.target.value)) })
}
function onNote(e) {
  patch({ fields: { ...(c.value?.fields || {}), [NOTE_KEY]: e.target.value } })
}
function addField() {
  const f = { ...(c.value?.fields || {}) }
  let i = 1
  while (f['字段' + i] !== undefined) i++
  f['字段' + i] = ''
  patch({ fields: f })
}
function renameField(oldKey, e) {
  const next = String(e.target.value || '').trim()
  const f = { ...(c.value?.fields || {}) }
  if (!next || next === oldKey || f[next] !== undefined) {
    e.target.value = oldKey
    return
  }
  f[next] = f[oldKey] ?? ''
  delete f[oldKey]
  patch({ fields: f })
}
function setFieldValue(k, e) {
  patch({ fields: { ...(c.value?.fields || {}), [k]: e.target.value } })
}
function removeField(k) {
  const f = { ...(c.value?.fields || {}) }
  delete f[k]
  patch({ fields: f })
}

/* 小传右键双链菜单：DLinkTextMenu 只挂在 textarea / contenteditable 上，编辑态的小传输入框是宿主 */
function onBioContext(e) {
  const row = c.value
  if (!row) return
  dlMenu.value?.open(e, { get: () => row.content || '', set: (v) => work.updateCharacter(row.id, { content: v }) })
}

async function changeAvatar() {
  const row = c.value
  if (!row) return
  const files = await pickFiles(IMAGE_EXTS)
  if (!files.length) return
  const f = files[0]
  const meta = await work.addAssetBlob(arrayBufferToBlob(f.data, imageMime(f.ext)), f.name)
  work.updateCharacter(row.id, { avatarAssetId: meta.id })
  await work.warmUrls([meta.id])
}
function removeAvatar() {
  patch({ avatarAssetId: null })
}

function startEdit() {
  editing.value = true
  nextTick(() => nameEl.value?.focus?.())
}
function finishEdit() {
  editing.value = false
  window.$msg?.success('档案已保存')
}
/* 取消只退出编辑态：插件是即时落库，没有草稿层可以回滚（设计稿的草稿表不引入） */
function cancelEdit() {
  editing.value = false
}

function pickRel(e) {
  jumpTo({ kind: e.otherKind, id: e.otherId })
}
function addRel() {
  if (!c.value) return
  ui.loreRelationPanel = { kind: 'character', id: c.value.id, x: Math.max(8, Math.min(420, window.innerWidth - 380)), y: 140 }
}

async function splitOut() {
  const row = c.value
  menuOpen.value = false
  if (!row) return
  await popOut(work, 'character', row.id, `${workTitle.value} · ${row.name || '未命名'}`)
}
function sendToOutline() {
  const row = c.value
  menuOpen.value = false
  if (!row) return
  work.sendCharToOutline(row.id)
  window.$msg?.success('已发送为大纲画布引用卡')
}
async function removeCharacter() {
  const row = c.value
  if (!row) return
  const run = async () => {
    await work.deleteCharacter(row.id)
    window.$msg?.success('人物及相关联系已移除')
  }
  if (!window.$dialog?.warning) return void run()
  window.$dialog.warning({
    title: '删除人物',
    content: `将「${row.name || '未命名'}」移出人物名录？同时移除该人物的人际关系与设定关联。`,
    positiveText: '删除人物',
    negativeText: '保留',
    onPositiveClick: run
  })
}

/* 视图切换与两列收起：外壳下发的 toggleRoster/toggleContext + closed 优先；
   外壳未提供时回退到 charPrefs（宽档）与抽屉 / 第二屏（窄档）。 */
function switchView(next) {
  shell?.setView?.(next)
}
const closedLeft = computed(() => shell?.closed?.value?.left ?? !!(ui.charPrefs[view.value] || {}).leftClosed)
const closedRight = computed(() => shell?.closed?.value?.right ?? !!(ui.charPrefs[view.value] || {}).rightClosed)
function setClosed(side, closed) {
  const one = ui.charPrefs[view.value] || ui.charPrefs.profile
  void ui.setPref('charPrefs', { ...ui.charPrefs, [view.value]: { ...one, [side]: closed } })
}
function toggleLeft() {
  if (shell?.toggleRoster) return shell.toggleRoster()
  if (narrow.value) return shell?.openDrawer?.()
  setClosed('leftClosed', !closedLeft.value)
}
function toggleRight() {
  if (shell?.toggleContext) return shell.toggleContext()
  if (narrow.value) return shell?.showContext?.()
  setClosed('rightClosed', !closedRight.value)
}

function onDocClick(e) {
  if (!menuOpen.value) return
  if (!e.target?.closest?.('.char-foot-more')) menuOpen.value = false
}
onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))
</script>

<template>
  <div class="char-dossier-wrap">
    <header class="char-module-head">
      <div>
        <div class="char-crumbs">
          <span>{{ workTitle }}</span>
          <OIcon name="caret-right" :size="10" />
          <span>人物</span>
        </div>
        <h1>人物卷宗</h1>
      </div>
      <div class="char-head-actions">
        <button
          class="char-icon-btn char-head-toggle"
          data-act="toggle-left"
          type="button"
          :title="closedLeft ? '展开人物名录' : '收起人物名录'"
          :aria-label="closedLeft ? '展开人物名录' : '收起人物名录'"
          :aria-pressed="closedLeft"
          @click="toggleLeft"
        >
          <OIcon name="arrow-left" :size="14" />
        </button>
        <span class="char-segmented" role="group" aria-label="人物视图">
          <button type="button" :class="{ on: view === 'profile' }" :aria-pressed="view === 'profile'" @click="switchView('profile')">人物卷宗</button>
          <button type="button" :class="{ on: view === 'graph' }" :aria-pressed="view === 'graph'" @click="switchView('graph')">关系剧场</button>
        </span>
        <button
          class="char-icon-btn char-head-toggle"
          data-act="toggle-right"
          type="button"
          :title="closedRight ? '展开关系与设定' : '收起关系与设定'"
          :aria-label="closedRight ? '展开关系与设定' : '收起关系与设定'"
          :aria-pressed="closedRight"
          @click="toggleRight"
        >
          <OIcon name="arrow-right" :size="14" />
        </button>
      </div>
    </header>

    <div class="char-content-scroll" data-char-scroll="dossier">
      <!-- 空态：app.mjs:36 blank() -->
      <div v-if="!c" class="char-blank">
        <div class="char-blank-inner">
          <OIcon name="user" :size="34" />
          <h2>众生有相</h2>
          <p>从名录选择或新建一个人物。</p>
        </div>
      </div>

      <!-- 编辑态：app.mjs:33 editForm() -->
      <form v-else-if="editing" class="char-edit" @submit.prevent="finishEdit">
        <div class="char-editing-label">
          <OIcon name="edit" :size="14" />
          <span>正在编辑 · {{ c.name || '未命名' }}</span>
          <button class="char-btn small soft" type="button" @click="cancelEdit">取消</button>
        </div>

        <div class="char-avatar-edit">
          <span class="char-portrait" :style="faceStyle">
            <img v-if="avatarUrl" :src="avatarUrl" alt="" />
            <template v-else>{{ initial }}</template>
          </span>
          <div>
            <button class="char-btn small" type="button" @click="changeAvatar">
              <OIcon name="upload" :size="12" />
              <span>更换头像</span>
            </button>
            <button v-if="avatarUrl" class="char-btn small soft" type="button" @click="removeAvatar">移除</button>
          </div>
        </div>

        <label class="char-edit-field">
          <span>人物姓名</span>
          <input
            ref="nameEl"
            class="char-name-input"
            type="text"
            :value="c.name"
            placeholder="为这个人物起名"
            autocomplete="off"
            @input="onText($event, 'name')"
          />
        </label>

        <div class="char-form-pair">
          <div class="char-edit-field">
            <span>角色定位</span>
            <input type="text" aria-label="角色定位" :value="c.role" placeholder="主角 / 守护者" @input="onText($event, 'role')" />
            <small>多个角色用 / 分隔</small>
            <span class="char-role-chips">
              <button
                v-for="r in ROLE_PRESETS"
                :key="r"
                class="char-tag"
                :class="{ on: hasRole(r) }"
                type="button"
                @click="toggleRoleChip(r)"
              >{{ r }}</button>
            </span>
          </div>
          <label class="char-edit-field">
            <span>别名</span>
            <input type="text" :value="c.aliases" placeholder="别名 / 称呼" @input="onText($event, 'aliases')" />
          </label>
        </div>

        <label class="char-edit-field">
          <span>人物标签</span>
          <input type="text" :value="tagsDraft" placeholder="雾港 / 灯塔" @input="onTags" />
        </label>

        <label class="char-edit-field">
          <span>一句话</span>
          <input type="text" :value="note" placeholder="一句话说清这个人在故事里的位置" @input="onNote" />
        </label>

        <label class="char-edit-field">
          <span>人物小传</span>
          <textarea
            class="char-bio"
            :value="c.content"
            placeholder="写下这个人的经历、动机与秘密……"
            @input="onText($event, 'content')"
            @contextmenu="onBioContext"
          ></textarea>
        </label>

        <div class="char-field-editor-title">
          <span>自定义字段</span>
          <button class="char-btn small soft" type="button" @click="addField">
            <OIcon name="plus" :size="11" />
            <span>添加字段</span>
          </button>
        </div>
        <div v-for="[k, v] in customFields" :key="k" class="char-custom-field">
          <input type="text" :value="k" :aria-label="'字段名称：' + k" @change="renameField(k, $event)" />
          <textarea :value="v" :aria-label="k + '的内容'" @input="setFieldValue(k, $event)"></textarea>
          <button class="char-icon-btn" type="button" :title="'移除字段 ' + k" :aria-label="'移除字段 ' + k" @click="removeField(k)">
            <OIcon name="close" :size="11" />
          </button>
        </div>

        <div class="char-edit-buttons">
          <button class="char-btn" type="button" @click="cancelEdit">取消</button>
          <button class="char-btn primary" type="submit">
            <OIcon name="check" :size="13" />
            <span>完成</span>
          </button>
        </div>
      </form>

      <!-- 阅读态：app.mjs:32 profile() -->
      <article v-else class="char-dossier">
        <div class="char-identity">
          <span class="char-portrait" :style="faceStyle">
            <img v-if="avatarUrl" :src="avatarUrl" alt="" />
            <template v-else>{{ initial }}</template>
          </span>
          <div class="char-identity-copy">
            <div class="char-identity-meta">
              <span class="char-role-mark">{{ roleText }}</span>
              <span>·</span>
              <span>{{ otherRoles }}</span>
            </div>
            <h2>{{ c.name || '未命名' }}</h2>
            <p class="char-aliases">{{ aliases.join(' / ') || '尚未填写别名' }}</p>
            <div v-if="(c.tags || []).length" class="char-tags">
              <button
                v-for="t in c.tags"
                :key="t"
                class="char-tag"
                :class="{ on: ui.charTag === t }"
                type="button"
                :title="ui.charTag === t ? '取消标签筛选' : '按「' + t + '」筛选名录'"
                @click="ui.charTag = ui.charTag === t ? '' : t"
              >{{ t }}</button>
            </div>
          </div>
        </div>

        <p v-if="note" class="char-identity-note">{{ note }}</p>

        <section class="char-section">
          <div class="char-section-head">
            <span class="char-section-index">01</span>
            <h3>人物小传</h3>
            <button class="char-icon-btn" type="button" title="编辑人物档案" aria-label="编辑人物档案" @click="startEdit">
              <OIcon name="edit" :size="13" />
            </button>
          </div>
          <div v-if="bioParagraphs.length" class="char-prose">
            <p v-for="(p, i) in bioParagraphs" :key="i">{{ p }}</p>
          </div>
          <template v-else>
            <p class="char-tiny-empty">还没有写下这个人的故事。</p>
            <button class="char-btn small" type="button" @click="startEdit">
              <OIcon name="edit" :size="11" />
              <span>开始写小传</span>
            </button>
          </template>
        </section>

        <section class="char-section">
          <div class="char-section-head">
            <span class="char-section-index">02</span>
            <h3>自定义字段</h3>
            <button class="char-icon-btn" type="button" title="编辑自定义字段" aria-label="编辑自定义字段" @click="startEdit">
              <OIcon name="edit" :size="13" />
            </button>
          </div>
          <dl v-if="customFields.length" class="char-field-grid">
            <div v-for="[k, v] in customFields" :key="k" class="char-field-item">
              <dt>{{ k }}</dt>
              <dd>{{ v || '—' }}</dd>
            </div>
          </dl>
          <p v-else class="char-tiny-empty">暂无自定义字段</p>
        </section>

        <section class="char-section">
          <div class="char-section-head">
            <span class="char-section-index">03</span>
            <h3>关联关系（设定 / 人物）</h3>
            <small>{{ relEntries.length }}</small>
            <button class="char-icon-btn" type="button" title="添加关联关系" aria-label="添加关联关系" @click="addRel">
              <OIcon name="plus" :size="13" />
            </button>
          </div>
          <LoreRelRows v-if="relEntries.length" :entries="relEntries" dossier @pick="pickRel" />
          <p v-else class="char-tiny-empty">暂无关联关系（如：人物「属于」某地点）</p>
        </section>
      </article>
    </div>

    <footer class="char-pane-foot">
      <span class="char-foot-path">{{ workTitle }} / {{ c?.name || '人物' }}</span>
      <template v-if="c">
        <button class="char-icon-btn" type="button" title="删除人物" aria-label="删除人物" @click="removeCharacter">
          <OIcon name="trash" :size="13" />
        </button>
        <div class="char-foot-more">
          <button
            class="char-icon-btn"
            type="button"
            title="更多"
            aria-label="更多"
            :aria-expanded="menuOpen"
            @click.stop="menuOpen = !menuOpen"
          >
            <OIcon name="dots" :size="14" />
          </button>
          <div v-if="menuOpen" class="char-foot-menu" role="menu">
            <button type="button" role="menuitem" @click="splitOut">
              <OIcon name="split" :size="12" />
              <span>拆分窗口查看</span>
            </button>
            <button type="button" role="menuitem" @click="sendToOutline">
              <OIcon name="bookmark" :size="12" />
              <span>发送为大纲引用卡</span>
            </button>
          </div>
        </div>
        <button v-if="!editing" class="char-btn" type="button" @click="startEdit">
          <OIcon name="edit" :size="12" />
          <span>编辑档案</span>
        </button>
      </template>
    </footer>

    <DLinkTextMenu ref="dlMenu" />
  </div>
</template>
