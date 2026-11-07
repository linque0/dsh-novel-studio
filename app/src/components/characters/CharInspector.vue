<!-- 剧场视图·右列「紧凑档案」：332px 的只读摘要（身份块 + 01 人物小传 + 02 人物侧写）。
     设计真值 docs/前端美化/人物-融合总稿-20261105/app.mjs:32 profile(c, true) 与 studio.css 的 .compact-dossier；
     外观度量见 chars-context.css。只读自包含，不改动卷宗组件（并行期 CharDossier.vue 由 D2 收口）。 -->
<script setup>
import { computed, inject, watch, watchEffect } from 'vue'
import OIcon from '../OIcon.vue'
import { useWorkStore } from '../../stores/work'
import { aliasesOf, primaryRole, rolesOf, uniqTags } from '../../services/character-tags'

const shell = inject('charShell', null)
const work = useWorkStore()
const current = computed(() => work.activeCharacter)
const isNarrow = computed(() => !!shell?.narrow?.value)
const avatarUrl = computed(() => {
  void work.urlTick
  return current.value?.avatarAssetId ? work.assetUrl(current.value.avatarAssetId) : ''
})
const roleMain = computed(() => primaryRole(current.value) || '人物')
const roleRest = computed(() => rolesOf(current.value).slice(1).join(' / ') || '人物档案')
const aliasText = computed(() => aliasesOf(current.value).join(' / ') || '尚未填写别名')
const tags = computed(() => uniqTags(current.value?.tags || []))
const note = computed(() => String((current.value?.fields || {})['身份'] || '').trim())
const sideFields = computed(() => Object.entries(current.value?.fields || {}).filter(([k]) => k !== '身份'))
const paras = computed(() =>
  String(current.value?.content || '')
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean)
)
const initial = computed(() => (current.value?.name || '人').slice(0, 1))

function toDossier() {
  shell?.setView?.('profile')
}
function backToMain() {
  shell?.backToMain?.()
}

watch(
  () => current.value?.avatarAssetId,
  (id) => {
    if (id) work.warmUrls([id])
  },
  { immediate: true }
)

/* 窄档第二屏的三段工具条：左键回主区（关系剧场画布），右键去完整卷宗 */
watchEffect(() => {
  if (!isNarrow.value) return
  shell?.setBar?.({
    left: { label: '‹ 关系剧场', act: () => shell?.backToMain?.() },
    title: current.value?.name || '人物档案',
    right: { label: '人物卷宗', act: () => shell?.setView?.('profile') }
  })
})
</script>

<template>
  <div class="char-inspector char-side">
    <header class="inspector-label">
      <div class="inspector-identity">
        <span class="inspector-heading"><OIcon name="user" :size="14" /><span>{{ current?.name || '人物档案' }}</span></span>
        <small class="context-sub">{{ current ? '人物档案' : '未选择人物' }}</small>
      </div>
      <div class="inspector-actions">
        <button type="button" class="icon-btn" title="打开完整卷宗" @click="toDossier"><OIcon name="books" :size="14" /></button>
        <button v-if="isNarrow" type="button" class="icon-btn" title="返回关系剧场" @click="backToMain"><OIcon name="back" :size="14" /></button>
      </div>
    </header>

    <div class="inspector-scroll" data-char-scroll="context">
      <article v-if="current" class="compact-dossier" :aria-label="(current.name || '人物') + '的人物档案'">
        <div class="identity">
          <span class="cd-portrait">
            <img v-if="avatarUrl" :src="avatarUrl" :alt="current.name || '人物头像'" />
            <span v-else>{{ initial }}</span>
          </span>
          <div class="identity-copy">
            <div class="identity-meta">
              <span class="role-mark">{{ roleMain }}</span>
              <span>·</span>
              <span>{{ roleRest }}</span>
            </div>
            <h2>{{ current.name || '未命名' }}</h2>
            <p class="aliases">{{ aliasText }}</p>
            <div v-if="tags.length" class="tags">
              <span v-for="t in tags" :key="t" class="tag">{{ t }}</span>
            </div>
          </div>
        </div>

        <p v-if="note" class="identity-note">{{ note }}</p>

        <section class="dossier-section">
          <div class="section-head">
            <span class="section-index">01</span>
            <h3>人物小传</h3>
          </div>
          <div class="prose">
            <p v-for="(p, i) in paras" :key="i">{{ p }}</p>
            <template v-if="!paras.length">
              <p class="context-note">还没有写下这个人的故事。</p>
              <button type="button" class="btn tiny" @click="toDossier">开始写小传</button>
            </template>
          </div>
        </section>

        <section class="dossier-section">
          <div class="section-head">
            <span class="section-index">02</span>
            <h3>人物侧写</h3>
            <small>{{ sideFields.length }}</small>
          </div>
          <dl v-if="sideFields.length" class="field-grid">
            <div v-for="[k, v] in sideFields" :key="k" class="field-item">
              <dt>{{ k }}</dt>
              <dd>{{ v || '—' }}</dd>
            </div>
          </dl>
          <p v-else class="tiny-empty">暂无侧写字段</p>
        </section>
      </article>

      <p v-else class="ctx-empty">从人物名录或关系图中选择一位。</p>
    </div>

    <footer class="pane-foot">
      <span>{{ current ? roleMain : '未选择人物' }}</span>
      <button type="button" class="btn" :disabled="!current" @click="toDossier">编辑档案</button>
    </footer>
  </div>
</template>
