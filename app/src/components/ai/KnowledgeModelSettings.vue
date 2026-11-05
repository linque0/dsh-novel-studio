<script setup>
/* 知识库模型设置：把原先散落在供应商预设参数里的「语义检索 / 向量模型」独立成一页。
 * 向量模型仍跟随当前供应商预设的连接（Base URL / API Key），不新增第二套连接配置。 */
import { computed, onMounted, ref, watch } from 'vue'
import { NButton, NInput, NSwitch, NTag } from 'naive-ui'
import OIcon from '../OIcon.vue'
import { useAiStore } from '../../stores/ai'

const emit = defineEmits(['go-ai'])
const ai = useAiStore()
const cur = computed(() => ai.activeProvider)
const noEmbeddingsApi = computed(() => cur.value?.apiFormat === 'anthropic')
const embLocal = ref('')

function syncEmb() {
  embLocal.value = cur.value?.params?.embeddings?.model || ''
}

watch(() => ai.activeProviderId, syncEmb, { immediate: true })

onMounted(async () => {
  if (!ai.loaded) await ai.loadSettings()
  syncEmb()
})

async function setEnabled(value) {
  if (!cur.value) return
  await ai.updateParams({ embeddings: { enabled: value } })
}

async function saveModel() {
  if (!cur.value) return
  const value = embLocal.value.trim()
  if (value === (cur.value.params?.embeddings?.model || '')) return
  await ai.updateParams({ embeddings: { model: value } })
}
</script>

<template>
  <div v-if="cur" class="kb-model">
    <div class="kb-summary">
      <span class="kb-badge"><OIcon name="link" :size="12" /> 跟随当前供应商预设</span>
      <strong>{{ cur.name }}</strong>
      <NTag v-if="!cur.enabled" size="tiny" :bordered="false">已停用</NTag>
      <NTag v-else size="tiny" :bordered="false" :type="ai.ready ? 'success' : 'default'">{{ ai.ready ? '连接就绪' : '未就绪' }}</NTag>
      <small>{{ cur.baseURL || '未填写 Base URL' }} · {{ cur.apiFormat === 'anthropic' ? 'Anthropic Messages' : 'Chat Completions' }}</small>
    </div>

    <div class="kb-row">
      <span class="kb-lb">语义检索</span>
      <NSwitch :value="cur.params?.embeddings?.enabled" :disabled="noEmbeddingsApi" size="small" @update:value="setEnabled" />
      <span class="kb-hint">{{ noEmbeddingsApi ? 'Anthropic Messages 不提供向量接口，不可用' : '默认关闭，失败回落关键词' }}</span>
    </div>
    <div class="kb-row">
      <span class="kb-lb">向量模型</span>
      <NInput
        v-model:value="embLocal"
        size="small"
        :disabled="noEmbeddingsApi"
        placeholder="如 text-embedding-3-small / bge-m3"
        @blur="saveModel"
        @keydown.enter="saveModel"
      />
    </div>
    <div class="kb-note">向量模型走当前预设的 Base URL 与 API Key；修改后在下一次语义检索或知识库构建时生效。需要更换连接地址时，请先到「模型设置」切换供应商预设。</div>
  </div>

  <div v-else class="kb-empty">
    <p>还没有供应商预设。向量模型需要绑定一个 OpenAI 兼容的供应商连接。</p>
    <NButton size="small" type="primary" @click="emit('go-ai')">前往模型设置</NButton>
  </div>
</template>

<style scoped>
.kb-model {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 12.5px;
  color: var(--text);
}
.kb-summary {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-editor, transparent);
}
.kb-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-dim);
}
.kb-summary strong {
  font-size: 13px;
  color: var(--text);
}
.kb-summary small {
  flex-basis: 100%;
  color: var(--text-dim);
  font-family: var(--editor-font);
  font-size: 11px;
  word-break: break-all;
}
.kb-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 0;
}
.kb-lb {
  flex: none;
  width: 72px;
  color: var(--text-dim);
  font-size: 12px;
}
.kb-row > :not(.kb-lb):not(.kb-hint) {
  flex: 1;
  min-width: 0;
}
.kb-row > .n-switch {
  flex: none;
}
.kb-hint {
  flex: none;
  color: var(--text-faint, var(--text-dim));
  font-size: 11px;
}
.kb-note {
  padding-left: 82px;
  color: var(--text-faint, var(--text-dim));
  font-size: 11px;
  line-height: 1.6;
}
.kb-empty {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
  padding: 8px 0;
  color: var(--text-dim);
  font-size: 12px;
}
.kb-empty p {
  margin: 0;
  line-height: 1.7;
}
</style>
