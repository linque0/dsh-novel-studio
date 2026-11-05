<script setup>
import { ref } from "vue";
import { NButton, NInput, NSelect, NInputNumber } from "naive-ui";
import { useAiStore } from "../../stores/ai";
import { renderChat } from "../../services/ai/chat-text";
import { saveTextFile } from "../../services/fileio";
const ai = useAiStore(),
  a = ref(ai.selectedPresetId),
  b = ref(null),
  question = ref(
    "基于当前章节续写约三百字。遵守各自预设的语言、人称和输出格式。",
  ),
  language = ref("中文"),
  person = ref("不限"),
  format = ref("不限"),
  error = ref("");
async function run() {
  error.value = "";
  try {
    await ai.evaluatePresets([a.value, b.value], question.value, {
      language: language.value,
      person: person.value,
      format: format.value,
    });
  } catch (e) {
    error.value = e.message;
  }
}
async function exportResults() {
  await saveTextFile(
    "预设输出对照.json",
    JSON.stringify(
      {
        question: question.value,
        requirements: {
          language: language.value,
          person: person.value,
          format: format.value,
        },
        results: ai.evaluation.results,
      },
      null,
      2,
    ),
  );
}
</script>
<template>
  <p>
    手动运行：同一作品、章节和历史，两套预设各生成三次。调用当前模型
    {{ ai.model }}，计入用量。只评估文本，不调用工具或应用到作品。
  </p>
  <div class="fields">
    <NSelect
      v-model:value="a"
      :disabled="ai.evaluation.running"
      :options="ai.presets.map((p) => ({ label: p.name, value: p.id }))"
      placeholder="预设 A"
    /><NSelect
      v-model:value="b"
      :disabled="ai.evaluation.running"
      :options="ai.presets.map((p) => ({ label: p.name, value: p.id }))"
      placeholder="预设 B"
    />
  </div>
  <NInput
    v-model:value="question"
    :disabled="ai.evaluation.running"
    type="textarea"
  />
  <div class="fields">
    <NSelect
      v-model:value="language"
      :options="['中文', '英文'].map((value) => ({ label: value, value }))"
    /><NSelect
      v-model:value="person"
      :options="
        ['不限', '第一人称', '第三人称'].map((value) => ({
          label: value,
          value,
        }))
      "
    /><NSelect
      v-model:value="format"
      :options="
        ['不限', 'JSON', '代码块'].map((value) => ({ label: value, value }))
      "
    />
  </div>
  <NButton
    v-if="!ai.evaluation.running"
    type="primary"
    :disabled="ai.busy || !ai.ready || !b || a === b"
    @click="run"
    >开始六次生成</NButton
  ><NButton v-else type="error" @click="ai.cancel()">停止评测</NButton
  ><NButton :disabled="!ai.evaluation.results.length" @click="exportResults"
    >导出评测记录</NButton
  >
  <p v-if="error || ai.evaluation.error" class="error">
    {{ error || ai.evaluation.error?.message }}
  </p>
  <p>
    规则检查只提供初筛。语言、人称、格式、说明文字以及文风差异仍须人工评价。
  </p>
  <details v-for="(r, i) in ai.evaluation.results" :key="i" open>
    <summary>
      {{ r.preset.name }} · 第 {{ r.trial }} 次 · {{ r.finishReason }}
    </summary>
    <div v-html="renderChat(r.text)"></div>
    <small>{{ r.checks }}</small>
    <div class="fields">
      <NInputNumber
        v-model:value="r.rating"
        :min="1"
        :max="5"
        placeholder="人工文风保持评分 1–5"
      /><NInput
        v-model:value="r.notes"
        placeholder="人工评价、漏检与格式问题"
      />
    </div>
  </details>
</template>
<style scoped>
.fields {
  display: flex;
  gap: 12px;
  margin: 12px 0;
}
.fields > * {
  flex: 1;
}
p {
  line-height: 1.7;
  color: var(--text-dim);
}
details {
  border-top: 1px solid var(--border);
  padding: 14px 0;
}
summary {
  cursor: pointer;
}
.error {
  color: #d55;
}
</style>
