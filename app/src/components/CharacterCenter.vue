<script setup>
import TaskLauncher from './ai/TaskLauncher.vue'
import { computed, ref, watch, onMounted, nextTick } from 'vue'
import { NButton, NInput, NSelect, NTag, NDropdown } from 'naive-ui'
import OIcon from './OIcon.vue'
import { useWorkStore } from '../stores/work'
import { useUiStore } from '../stores/ui'
import { useAiStore } from '../stores/ai'
import { popOut } from '../services/panelwindows'
import { pickFiles, arrayBufferToBlob, imageMime, IMAGE_EXTS } from '../services/fileio'
import { jumpTo } from '../services/doublelinks'
import DLinkTextMenu from './DLinkTextMenu.vue'
import LoreRelRows from './LoreRelRows.vue'
import CharacterGraph from './CharacterGraph.vue'
import CharacterList from './CharacterList.vue'
import { rolesOf, primaryRole, aliasesOf, aliasTagEntries, splitTagString, uniqTags } from '../services/character-tags'

const work = useWorkStore()
const ui = useUiStore()
const ai = useAiStore()
/* 插件版（dsh 皮肤）没有恍然梦，人物页里的「丰富」入口一起收掉 */
const nsPlugin = __NS_PLUGIN__
const c = computed(() => work.activeCharacter)
const dlMenu = ref(null)
/* 赤月戏：档案分页与角色/别名标签编辑 */
const dossierPage = ref('profile')
const dossierEl = ref(null)
const roleDraft = ref('')
const aliasDraft = ref('')
const roleInputEl = ref(null)
const aliasInputEl = ref(null)
/* 赤月戏：模块条与卷宗头动作走真实入口 */
async function popCharacter() {
  if (!c.value) return
  await popOut(work, 'character', c.value.id, `${work.work?.title || ''} · ${c.value.name || ''}`)
}
/* 模块条「＋ 人物」：关系图视图下先切回列表，方便立即编辑新人物 */
function addCharacterFromBar() {
  work.charView = 'list'
  work.addCharacter()
}
/* 角色定位：自定义输入为主 + 常见故事定位快捷项（再点取消） */
const ROLE_PRESETS = ['主角', '配角', '反派', '导师', '红颜', '盟友', '旁观者', '龙套']
const myRoles = computed(() => rolesOf(c.value))
const aliasTags = computed(() => aliasTagEntries(c.value))
const primaryRoleText = computed(() => primaryRole(c.value) || '人物')
const aliasPreview = computed(() => aliasesOf(c.value)[0] || '')
const availableRolePresets = computed(() => ROLE_PRESETS.filter((r) => !myRoles.value.includes(r)))

/* 赤月戏：多角色（/ 分隔）与别名/标签合并编辑 */
function saveRoles(list) {
  if (!c.value) return
  work.updateCharacter(c.value.id, { role: uniqTags(list).slice(0, 12).join('/') })
}
function addRole(role) {
  if (!role || myRoles.value.includes(role)) return
  saveRoles([...myRoles.value, role])
}
function removeRole(role) {
  saveRoles(myRoles.value.filter((x) => x !== role))
}
function commitRoleDraft() {
  const parts = splitTagString(roleDraft.value)
  if (parts.length) saveRoles([...myRoles.value, ...parts])
  roleDraft.value = ''
}
function onRoleKey(e) {
  if (e.key === '/' || e.key === 'Enter') {
    e.preventDefault()
    commitRoleDraft()
    return
  }
  if (e.key === 'Backspace' && !roleDraft.value && myRoles.value.length) {
    e.preventDefault()
    removeRole(myRoles.value[myRoles.value.length - 1])
  }
}
function focusRoleInput() {
  roleInputEl.value?.focus?.()
}
function saveAliases(list) {
  if (!c.value) return
  work.updateCharacter(c.value.id, { aliases: uniqTags(list).join('/') })
}
function commitAliasDraft() {
  const existing = new Set(aliasTags.value.map((t) => t.value))
  const add = splitTagString(aliasDraft.value).filter((v) => !existing.has(v))
  if (add.length) saveAliases([...aliasesOf(c.value), ...add])
  aliasDraft.value = ''
}
function removeAliasTag(entry) {
  if (!c.value || !entry) return
  if (entry.kind === 'tag') {
    work.updateCharacter(c.value.id, { tags: (c.value.tags || []).filter((t) => t !== entry.value) })
    return
  }
  saveAliases(aliasesOf(c.value).filter((x) => x !== entry.value))
}
function onAliasKey(e) {
  if (e.key === '/' || e.key === 'Enter') {
    e.preventDefault()
    commitAliasDraft()
    return
  }
  if (e.key === 'Backspace' && !aliasDraft.value && aliasTags.value.length) {
    e.preventDefault()
    removeAliasTag(aliasTags.value[aliasTags.value.length - 1])
  }
}
function focusAliasInput() {
  aliasInputEl.value?.focus?.()
}
function setDossierPage(page) {
  dossierPage.value = page
  nextTick(() => {
    if (dossierEl.value) dossierEl.value.scrollTop = 0
  })
}
watch(
  () => c.value?.id,
  () => {
    dossierPage.value = 'profile'
    roleDraft.value = ''
    aliasDraft.value = ''
  }
)

/* 人物小传右键快捷栏：剪切/复制/粘贴 + 添加关系链接 */
function onCtx(e) {
  if (!c.value) return
  const ch = c.value
  dlMenu.value?.open(e, { get: () => ch.content || '', set: (v) => work.updateCharacter(ch.id, { content: v }) })
}

const avatarUrl = computed(() => {
  void work.urlTick
  return c.value?.avatarAssetId ? work.assetUrl(c.value.avatarAssetId) : ''
})

const fieldsRows = computed(() => Object.entries(c.value?.fields || {}))
const tagAdding = ref(false)
const newTag = ref('')
const newTagInput = ref(null)

async function beginTagAdd() {
  tagAdding.value = true
  await nextTick()
  newTagInput.value?.focus()
}
function commitTag() {
  if (!tagAdding.value || !c.value) return
  const value = newTag.value.trim()
  if (value && !(c.value.tags || []).includes(value)) {
    work.updateCharacter(c.value.id, { tags: [...(c.value.tags || []), value] })
  }
  newTag.value = ''
  tagAdding.value = false
}
function cancelTag() {
  newTag.value = ''
  tagAdding.value = false
}
function removeTag(tag) {
  if (!c.value) return
  work.updateCharacter(c.value.id, { tags: (c.value.tags || []).filter((item) => item !== tag) })
}

async function changeAvatar() {
  if (!c.value) return
  const files = await pickFiles(IMAGE_EXTS)
  if (!files.length) return
  const f = files[0]
  const meta = await work.addAssetBlob(arrayBufferToBlob(f.data, imageMime(f.ext)), f.name)
  work.updateCharacter(c.value.id, { avatarAssetId: meta.id })
  await work.warmUrls([meta.id])
}

/* 新人物默认字段（外貌/性格角色要素，可删可改名）。
 * 播种标记放会话级 Set——此前挂在人物行对象上，会经 autosave 引用落库污染数据（v1.0.22 修复） */
const DEFAULT_FIELDS = ['外貌', '性格']
const defaultsSeeded = new Set()
function ensureDefaultFields() {
  const c0 = c.value
  if (!c0 || defaultsSeeded.has(c0.id)) return
  const hasAny = Object.keys(c0.fields || {}).length > 0
  if (!hasAny) {
    const f = {}
    for (const k of DEFAULT_FIELDS) f[k] = ''
    work.updateCharacter(c0.id, { fields: f })
  }
  defaultsSeeded.add(c0.id)
}
watch(c, ensureDefaultFields, { immediate: true })

function addField() {
  if (!c.value) return
  let i = 1
  while (c.value.fields['字段' + i] !== undefined) i++
  work.updateCharacter(c.value.id, { fields: { ...c.value.fields, ['字段' + i]: '' } })
}
function setFieldKey(oldKey, newKey) {
  if (!c.value || !newKey || newKey === oldKey || c.value.fields[newKey] !== undefined) return
  const f = { ...c.value.fields }
  f[newKey] = f[oldKey]
  delete f[oldKey]
  work.updateCharacter(c.value.id, { fields: f })
}
function setFieldValue(k, v) {
  if (!c.value) return
  work.updateCharacter(c.value.id, { fields: { ...c.value.fields, [k]: v } })
}
function removeField(k) {
  if (!c.value) return
  const f = { ...c.value.fields }
  delete f[k]
  work.updateCharacter(c.value.id, { fields: f })
}

const otherOpts = computed(() =>
  work.liveCharacters.filter((x) => x.id !== c.value?.id).map((x) => ({ label: x.name, value: x.id }))
)
const relOther = ref(null)
const relLabel = ref('')
const myRelations = computed(() => {
  if (!c.value) return []
  return work.relations
    .filter((r) => r.fromId === c.value.id || r.toId === c.value.id)
    .map((r) => ({ ...r, other: work.characters.find((x) => x.id === (r.fromId === c.value.id ? r.toId : r.fromId)) }))
})
function addRelation() {
  if (!c.value || !relOther.value) return
  work.addRelation(c.value.id, relOther.value, relLabel.value.trim() || '关联')
  relOther.value = null
  relLabel.value = ''
}

/* 关联关系（关系链接）：跨模块条目级关系（人物 ↔ 设定 / 人物），与人物关系（relations）并存 */
const relEntries = computed(() => (c.value ? work.loreLinksOf('character', c.value.id) : []))
function pickRel(e) {
  jumpTo({ kind: e.otherKind, id: e.otherId })
}
function openRelPanel() {
  if (!c.value) return
  ui.loreRelationPanel = { kind: 'character', id: c.value.id, x: Math.max(8, Math.min(420, window.innerWidth - 380)), y: 140 }
}

/* 恍然梦：丰富（方案 §五.4）：字段补全 / 小传扩写 / 别名建议 / 关系建议（diff 确认后写入） */
const AI_UNSET_HINT = '恍然梦未配置：请先在设置中完成恍然梦配置'
function aiEnrich() {
  if (!ai.ready) return window.$msg?.warning(AI_UNSET_HINT)
  if (!c.value) return
  ai.prepare('请讨论这个人物的塑造。', {characterId:c.value.id})
}

onMounted(() => {
  if (!ai.loaded) ai.loadSettings() // 保障入口置灰判定基于已装载的配置（幂等）
})
</script>

<template>
  <TaskLauncher v-if="!nsPlugin" module="characters" />
  <!-- 关系图视图：整幅画布（8.8.3）；列表视图：人物详情 -->
  <CharacterGraph v-if="work.charView === 'graph'" />
  <div v-else-if="c" class="character-surface" style="flex: 1; overflow: auto; padding: 22px 34px">
    <div v-if="c" ref="dossierEl" class="dossier-body">
    <div class="character-identity" style="display: flex; gap: 16px; align-items: flex-start; margin-bottom: 16px">
      <div class="character-portrait">
        <img v-if="avatarUrl" :src="avatarUrl" class="avatar-lg" :alt="c.name || '人物头像'" /><div v-else class="avatar-lg character-initial">{{ (c.name || '人').slice(0, 1) }}</div>
      </div>
      <div style="flex: 1; display: flex; flex-direction: column; gap: 8px">
        <div class="character-name-row" style="display: flex; gap: 8px">
          <NInput class="rp-input" :value="c.name" placeholder="姓名" style="flex: 1; font-size: 16px; font-weight: 700" @update:value="(v) => work.updateCharacter(c.id, { name: v })" />
          <NInput class="rp-input character-role" :value="c.role" placeholder="角色定位（可自定义）" style="width: 170px" @update:value="(v) => work.updateCharacter(c.id, { role: v })" />
        </div>
          <div class="role-chips">
            <span
              v-for="r in ROLE_PRESETS"
              :key="r"
              class="role-chip"
              :class="{ on: c.role === r }"
              @click="work.updateCharacter(c.id, { role: c.role === r ? '' : r })"
            >{{ r }}</span>
          </div>
          <div class="character-alias-row" style="display: flex; gap: 8px">
            <NInput class="rp-input" :value="c.aliases" placeholder="别名（用 / 分隔）" style="flex: 1" @update:value="(v) => work.updateCharacter(c.id, { aliases: v })" />
            <NButton size="small" @click="changeAvatar">{{ avatarUrl ? '换头像' : '设头像' }}</NButton>
            <NButton v-if="!nsPlugin" size="small" :disabled="!ai.ready" :title="ai.ready ? '恍然梦：丰富（字段补全 / 小传扩写 / 别名建议 / 关系建议）' : AI_UNSET_HINT" @click="aiEnrich">恍然梦：丰富</NButton>
            <NButton size="small" quaternary type="error" @click="work.deleteCharacter(c.id)">删除</NButton>
          </div>
      </div>
    </div>


    <div class="character-sections">
    <section class="character-fields">
    <hr class="divider" />
    <div class="rp-title">自定义字段</div>
    <div v-for="[k, v] in fieldsRows" :key="k" class="field-row">
      <input class="rp-input" :value="k" style="width: 120px" title="点击修改字段名（失焦或回车提交）" @change="setFieldKey(k, $event.target.value.trim())" @keyup.enter="$event.target.blur()" />
      <NInput class="rp-input" :value="v" style="flex: 1" @update:value="(v2) => setFieldValue(k, v2)" />
      <NButton size="tiny" quaternary @click="removeField(k)"><OIcon name="close" :size="11" /></NButton>
    </div>
    <NButton size="tiny" @click="addField"><OIcon name="plus" :size="11" /> 字段</NButton>
    </section>

    <section class="character-relations">
    <hr class="divider" />
    <div class="rp-title">人物关系</div>
    <div v-for="r in myRelations" :key="r.id" class="field-row" style="align-items: center">
      <NTag size="small" :bordered="false">{{ r.other?.name || '?' }}</NTag>
      <NInput class="rp-input" :value="r.label" style="flex: 1" @update:value="(v) => work.updateRelation(r.id, { label: v })" />
      <NButton size="tiny" quaternary @click="work.removeRelation(r.id)"><OIcon name="close" :size="11" /></NButton>
    </div>
    <div class="field-row" style="align-items: center">
      <NSelect v-model:value="relOther" :options="otherOpts" size="small" placeholder="选择人物" style="width: 140px" />
      <NInput v-model:value="relLabel" size="small" placeholder="关系（如：师徒 / 宿敌）" style="flex: 1" @keyup.enter="addRelation" />
      <NButton size="tiny" @click="addRelation">添加</NButton>
    </div>
    </section>

    <section class="character-crosslinks">
    <hr class="divider" />
    <div class="rp-title">关联关系（设定 / 人物）</div>
    <LoreRelRows v-if="relEntries.length" :entries="relEntries" @pick="pickRel" />
    <div v-else class="crosslinks-empty" style="font-size: 12px; color: var(--text-dim); padding: 2px 0 6px">暂无关联关系（如：人物「属于」某地点）</div>
    <NButton size="tiny" @click="openRelPanel"><OIcon name="plus" :size="11" /> 添加关联</NButton>
    </section>

    <section class="character-biography">
    <hr class="divider" />
    <div class="rp-title">人物小传（外貌 / 性格 / 背景 / 动机……）</div>
    <textarea
      class="rp-textarea"
      style="min-height: 220px; font-size: 14px; line-height: 1.9"
      :value="c.content"
      data-dl-token
      @input="(e) => work.updateCharacter(c.id, { content: e.target.value })"
      @contextmenu="onCtx"
    ></textarea>
    </section>
    </div>
    </div>
    <div v-else class="dossier-body is-empty">
      <div class="empty-shelf">
        <div class="big">众生有相</div>
        <p>从左侧选择或创建一个人物。</p>
      </div>
    </div>
  </div>
  <div v-else class="empty-shelf" style="padding-top: 140px">
    <div class="big">众生有相</div>
    <p>从左侧选择或创建一个人物。</p>
  </div>
  <DLinkTextMenu v-if="work.charView === 'list'" ref="dlMenu" />
</template>
