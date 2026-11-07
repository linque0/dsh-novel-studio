<!-- 人物名录列：外壳 .char-pane[data-pane='roster'] 的内容。
     结构对照设计稿 app.mjs:28-30 的 paneHead()/sidebar()/emptyList()（pane-top / search-box / select-filter /
     list-label / person-row / pane-foot），滚动位置的存取由外壳按 data-char-scroll="roster" 负责。 -->
<script setup>
import { computed, inject, nextTick, ref, watch } from 'vue'
import OIcon from '../OIcon.vue'
import { useWorkStore } from '../../stores/work'
import { useUiStore } from '../../stores/ui'
import { rolesOf, primaryRole, aliasesOf, characterTagList } from '../../services/character-tags'
import { tagColor } from '../../services/tagcolors'

const shell = inject('charShell', null)
const work = useWorkStore()
const ui = useUiStore()
const queryEl = ref(null)

const narrow = computed(() => !!shell?.narrow?.value)
const view = computed(() => shell?.view?.value || (work.charView === 'graph' ? 'graph' : 'profile'))

/* 筛选候选取全部未删人物：不被当前筛选结果裁剪（原型 sidebar() 的 new Set(all.flatMap(...))） */
const roleOptions = computed(() => [...new Set(work.liveCharacters.flatMap((c) => rolesOf(c)))].sort((a, b) => a.localeCompare(b)))
const tagOptions = computed(() => [...new Set(work.liveCharacters.flatMap((c) => characterTagList(c)))].sort((a, b) => a.localeCompare(b)))

const filtering = computed(() => !!(ui.charQuery || ui.charRole || ui.charTag))
/* 检索语义照原型 model.mjs:17：姓名/别名/角色/标签拼串包含；角色按多值之一；标签按标签集之一 */
const rows = computed(() => {
  const q = String(ui.charQuery || '').trim().toLowerCase()
  const role = String(ui.charRole || '')
  const tag = String(ui.charTag || '')
  return work.liveCharacters.filter((c) => {
    if (q && ![c.name, c.aliases, c.role, ...(c.tags || [])].filter(Boolean).join(' ').toLowerCase().includes(q)) return false
    if (role && !rolesOf(c).includes(role)) return false
    if (tag && !characterTagList(c).includes(tag)) return false
    return true
  })
})

/* 头像走 assets 的 objectURL：缓存未热时 assetUrl 返回空串，先 warm 可见行 */
watch(rows, (list) => {
  const ids = list.map((c) => c.avatarAssetId).filter(Boolean)
  if (ids.length) void work.warmUrls(ids)
}, { immediate: true })

function avatarUrl(c) {
  void work.urlTick
  return c?.avatarAssetId ? work.assetUrl(c.avatarAssetId) : ''
}
/* 色标由姓名稳定 hash（services/tagcolors 的 tagColor，同名恒同色）：原型 .portrait 的 tone-* 在插件版没有对应列 */
function faceStyle(c) {
  return { '--char-tone': tagColor(c?.name || '人') }
}
function initial(c) {
  return String(c?.name || '').trim().slice(0, 1) || '人'
}

function persist(patch) {
  ui.saveCharState(work.work?.id, patch)
}
function onQuery(e) {
  ui.charQuery = e.target.value
  persist({ query: ui.charQuery })
}
function onRole(e) {
  ui.charRole = e.target.value
  persist({ role: ui.charRole })
}
function onTag(e) {
  ui.charTag = e.target.value
  persist({ tag: ui.charTag })
}
function clearQuery() {
  ui.charQuery = ''
  persist({ query: '' })
  nextTick(() => queryEl.value?.focus())
}
function clearFilters() {
  ui.charQuery = ''
  ui.charRole = ''
  ui.charTag = ''
  persist({ query: '', role: '', tag: '' })
}
function pick(c) {
  shell?.select?.(c.id)
}
/* 新建：清筛选并选中新行（原型 new 分支），随后由卷宗侧进入填写 */
function create() {
  const row = work.addCharacter()
  clearFilters()
  shell?.select?.(row.id)
}
/* 收起整列：窄档是抽屉的相反动作（原型 app.mjs:98 的 toggle-left 在 <1100 走 runtime.drawer），宽档落 charPrefs */
function collapse() {
  if (narrow.value) {
    shell?.closeDrawer?.()
    return
  }
  const one = ui.charPrefs[view.value] || ui.charPrefs.profile
  void ui.setPref('charPrefs', { ...ui.charPrefs, [view.value]: { ...one, leftClosed: true } })
}
</script>

<template>
  <div class="char-roster">
    <header class="char-roster-head">
      <OIcon name="user" :size="17" />
      <h2>人物名录</h2>
      <button class="char-icon-btn" type="button" title="收起人物名录" aria-label="收起人物名录" @click="collapse">
        <OIcon name="arrow-left" :size="14" />
      </button>
    </header>

    <label class="char-search">
      <OIcon name="search" :size="14" />
      <input
        ref="queryEl"
        type="text"
        :value="ui.charQuery"
        placeholder="搜索姓名、别名、标签…"
        aria-label="搜索人物"
        autocomplete="off"
        @input="onQuery"
      />
      <button v-if="ui.charQuery" class="char-icon-btn" type="button" title="清除搜索" aria-label="清除搜索" @click="clearQuery">
        <OIcon name="close" :size="12" />
      </button>
    </label>

    <div class="char-filters">
      <select :value="ui.charRole" aria-label="按角色筛选" @change="onRole">
        <option value="">全部角色</option>
        <option v-for="r in roleOptions" :key="r" :value="r">{{ r }}</option>
      </select>
      <select :value="ui.charTag" aria-label="按标签筛选" @change="onTag">
        <option value="">全部标签</option>
        <option v-for="t in tagOptions" :key="t" :value="t">{{ t }}</option>
      </select>
    </div>

    <div class="char-roster-label">
      <span>{{ filtering ? '筛选结果' : '全部人物' }}</span>
      <span>{{ rows.length }} 人</span>
    </div>

    <div class="char-roster-list" data-char-scroll="roster">
      <button
        v-for="c in rows"
        :key="c.id"
        type="button"
        class="char-person"
        :class="{ on: work.selCharacterId === c.id }"
        :aria-current="work.selCharacterId === c.id ? 'true' : undefined"
        :title="c.name || '未命名'"
        @click="pick(c)"
      >
        <span class="char-portrait" :style="faceStyle(c)">
          <img v-if="avatarUrl(c)" :src="avatarUrl(c)" alt="" />
          <template v-else>{{ initial(c) }}</template>
        </span>
        <span class="char-person-copy">
          <strong>{{ c.name || '未命名' }}</strong>
          <small>{{ primaryRole(c) || '未定角色' }} · {{ aliasesOf(c)[0] || '暂无别名' }}</small>
        </span>
        <OIcon class="char-person-go" name="caret-right" :size="12" />
      </button>

      <div v-if="!rows.length" class="char-roster-empty">
        <template v-if="filtering">
          <p>没有找到符合条件的人物</p>
          <button class="char-btn small" type="button" @click="clearFilters">清除筛选</button>
        </template>
        <template v-else>
          <p>还没有人物。新建一张角色卡，写下他的外貌、动机与秘密。</p>
          <button class="char-btn small" type="button" @click="create">
            <OIcon name="plus" :size="11" />
            <span>新建人物</span>
          </button>
        </template>
      </div>
    </div>

    <footer class="char-roster-foot">
      <button class="char-btn" type="button" @click="create">
        <OIcon name="plus" :size="13" />
        <span>新建人物</span>
      </button>
    </footer>
  </div>
</template>
