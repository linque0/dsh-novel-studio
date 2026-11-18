<!-- 主区·人物卷宗：外壳 .char-pane[data-pane='main'] 的内容（视图为 profile 时渲染）。
     结构对照设计稿 app.mjs:31 moduleHead()、app.mjs:32 profile()、app.mjs:33 editForm()、app.mjs:37 footer()，
     滚动位置的存取由外壳按 data-char-scroll="dossier" 负责。 -->
<script setup>
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
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
import { characterDraftPatch, createCharacterDraft, readCharacterBiographies } from '../../services/character-biographies.js'

const shell = inject('charShell', null)
const work = useWorkStore()
const ui = useUiStore()

const c = computed(() => work.activeCharacter)
const narrow = computed(() => !!shell?.narrow?.value)
const view = computed(() => shell?.view?.value || (work.charView === 'graph' ? 'graph' : 'profile'))
const workTitle = computed(() => work.work?.title || '未命名作品')

const draft = ref(null)
const editing = computed(() => !!draft.value)
const profile = computed(() => draft.value || c.value)
const saving = ref(false)
const pendingAvatar = shallowRef(null)
let originalDraft
const menuOpen = ref(false)
const nameEl = ref(null)
const dlMenu = ref(null)

// Keep the retired field in saved character data.
const LEGACY_NOTE_KEY = '一句话'
const customFields = computed(() => Object.entries(profile.value?.fields || {}).filter(([key]) => key !== LEGACY_NOTE_KEY))
const roles = computed(() => rolesOf(profile.value))
const roleText = computed(() => primaryRole(c.value) || '未定角色')
const otherRoles = computed(() => roles.value.slice(1).join(' / ') || '人物档案')
const aliases = computed(() => aliasesOf(c.value))
const biographies = computed(() => readCharacterBiographies(c.value))
const relEntries = computed(() => (c.value ? work.loreLinksOf('character', c.value.id) : []))
const avatarUrl = computed(() => {
  void work.urlTick
  return pendingAvatar.value?.url || (profile.value?.avatarAssetId ? work.assetUrl(profile.value.avatarAssetId) : '')
})
const faceStyle = computed(() => ({ '--char-tone': tagColor(profile.value?.name || '人') }))
const initial = computed(() => String(profile.value?.name || '').trim().slice(0, 1) || '人')

watch(() => c.value?.avatarAssetId, (id) => {
  if (id) void work.warmUrls([id])
}, { immediate: true })
/* 换人即退出编辑态，避免把上一份表单状态带到下一个人物 */
watch(() => c.value?.id, () => {
  discardDraft()
  menuOpen.value = false
})

const ROLE_PRESETS = ['主角', '配角', '反派', '导师', '盟友', '旁观者', '龙套']
const hasRole = (r) => roles.value.includes(r)

function patch(p) {
  if (draft.value) Object.assign(draft.value, p)
}
function onText(e, key) {
  patch({ [key]: e.target.value })
}
function toggleRoleChip(r) {
  const list = hasRole(r) ? roles.value.filter((x) => x !== r) : [...roles.value, r]
  patch({ role: uniqTags(list).slice(0, 12).join('/') })
}
const tagsDraft = ref('')
function onTags(e) {
  tagsDraft.value = e.target.value
  patch({ tags: uniqTags(splitTagString(e.target.value)) })
}
function addField() {
  const f = { ...draft.value.fields }
  let i = 1
  while (f['字段' + i] !== undefined) i++
  f['字段' + i] = ''
  patch({ fields: f })
}
function renameField(oldKey, e) {
  const next = String(e.target.value || '').trim()
  const f = { ...draft.value.fields }
  if (!next || next === oldKey || next === LEGACY_NOTE_KEY || f[next] !== undefined) {
    e.target.value = oldKey
    return
  }
  f[next] = f[oldKey] ?? ''
  delete f[oldKey]
  patch({ fields: f })
}
function setFieldValue(k, e) {
  patch({ fields: { ...draft.value.fields, [k]: e.target.value } })
}
function removeField(k) {
  const f = { ...draft.value.fields }
  delete f[k]
  patch({ fields: f })
}

function addBiography() {
  draft.value.biographies.push({ id: crypto.randomUUID(), title: '', content: '' })
}
function removeBiography(index) {
  if (draft.value.biographies.length <= 1) return
  dlMenu.value?.close()
  draft.value.biographies.splice(index, 1)
}
function onBioContext(e, biography) {
  dlMenu.value?.open(e, {
    get: () => biography.content,
    set: value => { if (draft.value?.biographies.includes(biography)) biography.content = value }
  })
}

function clearAvatarPreview() {
  if (pendingAvatar.value) URL.revokeObjectURL(pendingAvatar.value.url)
  pendingAvatar.value = null
}

async function changeAvatar() {
  const current = draft.value
  if (!current) return
  const files = await pickFiles(IMAGE_EXTS)
  if (!files.length || draft.value !== current || saving.value) return
  const f = files[0]
  const blob = arrayBufferToBlob(f.data, imageMime(f.ext))
  clearAvatarPreview()
  pendingAvatar.value = { blob, name: f.name, url: URL.createObjectURL(blob) }
}
function removeAvatar() {
  clearAvatarPreview()
  patch({ avatarAssetId: null })
}

function startEdit() {
  if (!c.value || editing.value || saving.value) return
  originalDraft = createCharacterDraft(c.value)
  draft.value = createCharacterDraft(c.value)
  tagsDraft.value = draft.value.tags.join(' / ')
  menuOpen.value = false
  nextTick(() => nameEl.value?.focus?.())
}
function discardDraft() {
  dlMenu.value?.close()
  clearAvatarPreview()
  draft.value = null
  originalDraft = null
}
async function finishEdit() {
  if (!draft.value || !c.value || saving.value) return
  const current = draft.value
  const id = c.value.id
  const workId = work.work?.id
  const changes = characterDraftPatch(originalDraft, current)
  const avatar = pendingAvatar.value
  saving.value = true
  try {
    if (avatar) {
      const meta = await work.addAssetBlob(avatar.blob, avatar.name)
      changes.avatarAssetId = meta.id
      if (work.work?.id === workId) void work.warmUrls([meta.id])
    }
    if (work.work?.id !== workId) return
    if (Object.keys(changes).length) work.updateCharacter(id, changes)
    if (draft.value === current) discardDraft()
    window.$msg?.success('档案修改已确认')
  } catch {
    window.$msg?.error('无法确认档案修改，请重试')
  } finally {
    saving.value = false
  }
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
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  discardDraft()
})
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
          :aria-expanded="!closedLeft"
          @click="toggleLeft"
        >
          <OIcon :name="closedLeft ? 'arrow-right' : 'back'" :size="14" />
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
      <form v-else-if="editing" class="char-edit" :inert="saving" @submit.prevent="finishEdit">
        <div class="char-editing-label">
          <OIcon name="edit" :size="14" />
          <span>正在编辑 · {{ draft.name || '未命名' }}</span>
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
            :value="draft.name"
            placeholder="为这个人物起名"
            autocomplete="off"
            @input="onText($event, 'name')"
          />
        </label>

        <div class="char-form-pair">
          <div class="char-edit-field">
            <span>角色定位</span>
            <input type="text" aria-label="角色定位" :value="draft.role" placeholder="主角 / 守护者" @input="onText($event, 'role')" />
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
            <input type="text" :value="draft.aliases" placeholder="别名 / 称呼" @input="onText($event, 'aliases')" />
          </label>
        </div>

        <label class="char-edit-field">
          <span>人物标签</span>
          <input type="text" :value="tagsDraft" placeholder="雾港 / 灯塔" @input="onTags" />
        </label>

        <section aria-label="人物小传">
          <div class="char-field-editor-title">
            <span>人物小传</span>
            <button class="char-btn small soft" type="button" @click="addBiography">
              <OIcon name="plus" :size="11" />
              <span>添加小传</span>
            </button>
          </div>
          <div v-for="(biography, index) in draft.biographies" :key="biography.id" class="char-edit-field char-biography-edit">
            <div class="char-biography-title">
              <input v-model="biography.title" type="text" :aria-label="'第 ' + (index + 1) + ' 篇小传标题'"
                :placeholder="index ? '小传 ' + (index + 1) : '人物小传'">
              <button v-if="draft.biographies.length > 1" class="char-icon-btn" type="button" title="移除这篇小传"
                :aria-label="'移除第 ' + (index + 1) + ' 篇小传'" @click="removeBiography(index)">
                <OIcon name="trash" :size="13" />
              </button>
            </div>
            <textarea v-model="biography.content" class="char-bio" :aria-label="'第 ' + (index + 1) + ' 篇小传正文'"
              placeholder="写下这个人的经历、动机与秘密……" @contextmenu="onBioContext($event, biography)"></textarea>
          </div>
        </section>

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

        <section class="char-section">
          <div class="char-section-head">
            <span class="char-section-index">01</span>
            <h3>人物小传</h3>
            <button class="char-icon-btn" type="button" title="编辑人物档案" aria-label="编辑人物档案" @click="startEdit">
              <OIcon name="edit" :size="13" />
            </button>
          </div>
          <div v-if="biographies.length" class="char-biography-list">
            <div v-for="biography in biographies" :key="biography.id">
              <h4 v-if="biographies.length > 1 || biography.title !== '人物小传'" class="char-biography-heading">{{ biography.title }}</h4>
              <div v-if="biography.paragraphs.length" class="char-prose">
                <p v-for="(p, i) in biography.paragraphs" :key="i">{{ p }}</p>
              </div>
            </div>
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
      <div v-if="editing" class="char-edit-buttons">
        <button class="char-btn" type="button" :disabled="saving" @click="discardDraft">取消</button>
        <button class="char-btn primary" type="button" :disabled="saving" @click="finishEdit">
          <OIcon name="check" :size="13" />
          <span>{{ saving ? '保存中…' : '完成' }}</span>
        </button>
      </div>
      <template v-else-if="c">
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
        <button class="char-btn" type="button" @click="startEdit">
          <OIcon name="edit" :size="12" />
          <span>编辑档案</span>
        </button>
      </template>
    </footer>

    <DLinkTextMenu ref="dlMenu" />
  </div>
</template>
