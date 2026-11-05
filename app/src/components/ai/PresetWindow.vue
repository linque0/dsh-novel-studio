<script setup>
import { computed, onMounted, ref } from "vue";
import {
  NButton,
  NInput,
  NInputNumber,
  NSelect,
  NSwitch,
  NModal,
} from "naive-ui";
import { useAiStore } from "../../stores/ai";
import { useWorkStore } from "../../stores/work";
import {
  defaultPreset,
  orderOf,
  copy,
  presetId,
  SLOT_LABELS,
  compatibility,
  importPreset,
  exportPreset,
  GENERATION_TYPES,
  BUILTIN_IDS,
  builtinPrompt,
  mergePromptManager,
  estimate,
} from "../../services/ai/presets";
import { processRegex } from "../../services/ai/regex";
import { pickFiles, saveTextFile } from "../../services/fileio";
const ai = useAiStore(),
  work = useWorkStore(),
  editing = ref(null),
  dirty = ref(false),
  error = ref(""),
  tab = ref("prompts"),
  drag = ref(-1),
  entry = ref(null),
  libraryId = ref(null);
const incoming = ref(null),
  importMode = ref("merge"),
  preview = ref(null),
  showPreview = ref(false),
  previewQuestion = ref("请根据当前写作对象继续创作。"),
  previewType = ref("normal"),
  previewBusy = ref(false);
const regexEntry = ref(null),
  regexIndex = ref(-1),
  regexSample = ref("这是样本文本。"),
  regexResult = ref(null),
  regexPlacement = ref(2),
  regexPhase = ref("regular");
const roles = ["system", "user", "assistant"].map((value) => ({
  label: value,
  value,
}));
const slotOptions = Object.entries(SLOT_LABELS).map(([value, label]) => ({
  value,
  label,
}));
const order = computed(() =>
  editing.value
    ? orderOf(editing.value.payload, editing.value.adaptation.orderBranch)
    : [],
);
const rules = computed(
  () => editing.value?.payload.extensions?.regex_scripts || [],
);
const warnings = computed(() =>
  editing.value ? compatibility(editing.value) : [],
);
const active = computed(
  () => editing.value?.id === ai.selectedPresetId && !dirty.value,
);
const importMerge = computed(() =>
  incoming.value && editing.value
    ? mergePromptManager(editing.value, incoming.value.row)
    : null,
);
const identityLabels = {
  authorNote: "作者要求",
  charDescription: "助手描述",
  charPersonality: "助手个性",
  personaDescription: "作者身份",
  dialogueExamples: "对话示例（<START> 分隔；作者: / 恍然梦:）",
};
const numeric = {
  temperature: [0, 2],
  top_p: [0, 1],
  frequency_penalty: [-2, 2],
  presence_penalty: [-2, 2],
  openai_max_context: [1000, 1000000],
  openai_max_tokens: [128, 200000],
  seed: [-1, 2147483647],
};
function changed() {
  dirty.value = true;
  preview.value = null;
}
function find(id) {
  return editing.value?.payload.prompts.find((p) => p.identifier === id);
}
function choose(row) {
  if (!row) return;
  if (dirty.value && !window.confirm("放弃当前未保存的预设修改？")) return;
  editing.value = copy(row);
  editing.value.adaptation ||= {};
  editing.value.adaptation.mappings ||= {};
  editing.value.adaptation.wrappers ||= {};
  dirty.value = false;
  error.value = "";
  preview.value = null;
}
async function guard(fn) {
  error.value = "";
  try {
    await fn();
  } catch (e) {
    error.value = e.message;
  }
}
async function save() {
  await guard(async () => {
    const workId = work.work?.id;
    if (!workId) throw new Error("请打开关联作品后保存并启用");
    editing.value = await ai.savePreset(editing.value, {
      activateWorkId: workId,
    });
    dirty.value = false;
    window.$msg?.success("已保存，并启用于 " + work.work.title);
  });
}
function duplicate() {
  const row = copy(editing.value || defaultPreset());
  row.id = presetId();
  row.name += " 副本";
  row.revision = 0;
  row.builtin = false;
  editing.value = row;
  changed();
}
function newPreset() {
  if (dirty.value && !window.confirm("放弃未保存修改并新建预设？")) return;
  const row = defaultPreset();
  row.id = presetId();
  row.name = "新预设";
  row.builtin = false;
  row.revision = 0;
  editing.value = row;
  changed();
}
function edit(id) {
  entry.value = copy(find(id));
}
function addPrompt(marker = false) {
  entry.value = {
    identifier: presetId(),
    name: marker ? "动态材料" : "新提示",
    role: "system",
    content: "",
    marker,
    system_prompt: false,
    injection_position: 0,
    injection_depth: 4,
    injection_order: 100,
  };
}
function commitEntry() {
  if (!entry.value.name?.trim()) return;
  const id = entry.value.identifier;
  const index = editing.value.payload.prompts.findIndex(
    (p) => p.identifier === id,
  );
  if (index < 0) editing.value.payload.prompts.push(copy(entry.value));
  else editing.value.payload.prompts[index] = copy(entry.value);
  entry.value = null;
  changed();
}
function append() {
  if (
    !libraryId.value ||
    order.value.some((o) => o.identifier === libraryId.value)
  )
    return;
  order.value.push({ identifier: libraryId.value, enabled: true });
  changed();
}
function removeOrder(index) {
  order.value.splice(index, 1);
  changed();
}
function move(from, to) {
  if (from < 0 || to < 0 || to >= order.value.length) return;
  const item = order.value.splice(from, 1)[0];
  order.value.splice(to, 0, item);
  changed();
}
function reset(id) {
  const i = editing.value.payload.prompts.findIndex((p) => p.identifier === id);
  editing.value.payload.prompts[i] = builtinPrompt(id);
  changed();
}
function clonePrompt(id) {
  const p = copy(find(id));
  p.identifier = presetId();
  p.name += " 副本";
  p.system_prompt = false;
  p.marker = false;
  editing.value.payload.prompts.push(p);
  libraryId.value = p.identifier;
  changed();
}
function deletePrompt(id) {
  const branches = editing.value.payload.prompt_order || [],
    refs = branches[0]?.identifier
      ? [{ character_id: "当前", order: branches }]
      : branches;
  const used = refs.filter((b) => b.order?.some((o) => o.identifier === id));
  if (
    !window.confirm(
      "删除提示库条目？" +
        (used.length
          ? "将同时移除 " +
            used.map((b) => b.character_id).join("、") +
            " 顺序分支中的引用。"
          : ""),
    )
  )
    return;
  for (const b of refs)
    for (let i = b.order.length - 1; i >= 0; i--)
      if (b.order[i].identifier === id) b.order.splice(i, 1);
  editing.value.payload.prompts = editing.value.payload.prompts.filter(
    (p) => p.identifier !== id,
  );
  libraryId.value = null;
  changed();
}
async function importFile() {
  await guard(async () => {
    const files = await pickFiles(["json"]);
    if (!files.length) return;
    incoming.value = importPreset(
      JSON.parse(new TextDecoder().decode(files[0].data)),
      files[0].name,
    );
    importMode.value =
      incoming.value.row.importedFormat === "prompt-manager" ? "merge" : "new";
  });
}
function acceptImport() {
  editing.value = copy(
    importMode.value === "merge" ? importMerge.value.row : incoming.value.row,
  );
  incoming.value = null;
  changed();
}
async function exportFile(format) {
  await guard(() =>
    saveTextFile(
      editing.value.name +
        (format === "prompt-manager" ? "-PromptManager" : "") +
        ".json",
      JSON.stringify(exportPreset(editing.value, format), null, 2),
    ),
  );
}
async function previewSend() {
  previewBusy.value = true;
  await guard(async () => {
    preview.value = await ai.previewPreset(
      editing.value,
      previewQuestion.value,
      { generationType: previewType.value },
    );
    showPreview.value = true;
  });
  previewBusy.value = false;
}
function editRegex(index = -1) {
  regexIndex.value = index;
  regexEntry.value =
    index >= 0
      ? { trimStrings: [], placement: [2], ...copy(rules.value[index]) }
      : {
          id: presetId(),
          scriptName: "新正则",
          findRegex: "",
          replaceString: "",
          trimStrings: [],
          placement: [2],
          disabled: false,
          markdownOnly: false,
          promptOnly: false,
          runOnEdit: true,
          substituteRegex: 0,
          minDepth: null,
          maxDepth: null,
        };
}
function commitRegex() {
  editing.value.payload.extensions ||= {};
  editing.value.payload.extensions.regex_scripts ||= [];
  if (regexIndex.value < 0) rules.value.push(copy(regexEntry.value));
  else rules.value[regexIndex.value] = copy(regexEntry.value);
  regexEntry.value = null;
  changed();
}
function moveRegex(i, delta) {
  if (i + delta < 0 || i + delta >= rules.value.length) return;
  const item = rules.value.splice(i, 1)[0];
  rules.value.splice(i + delta, 0, item);
  changed();
}
async function testRegex() {
  await guard(async () => {
    regexResult.value = await processRegex(
      regexSample.value,
      editing.value,
      { placement: regexPlacement.value, phase: regexPhase.value, depth: 0 },
      {
        user: "作者",
        char: "恍然梦",
        work: work.work?.title || "",
        input: regexSample.value,
      },
      { local: {}, global: {} },
    );
  });
}
onMounted(async () => {
  await ai.loadSettings();
  await ai.loadPresets();
  choose(ai.presets.find((p) => p.id === ai.selectedPresetId) || ai.presets[0]);
});
</script>
<template>
  <div class="preset-window">
    <header>
      <strong>恍然梦 · 预设</strong
      ><NSelect
        class="preset-selector"
        :value="editing?.id"
        filterable
        :options="ai.presets.map((p) => ({ label: p.name, value: p.id }))"
        @update:value="(id) => choose(ai.presets.find((p) => p.id === id))"
      /><span class="status"
        >{{ dirty ? "编辑中 · 未保存" : "已保存"
        }}{{ active ? " · 当前作品使用中" : "" }}</span
      >
    </header>
    <div class="toolbar">
      <NButton size="small" @click="newPreset">新建</NButton
      ><NButton size="small" type="primary" @click="save">保存并启用</NButton
      ><NButton size="small" @click="duplicate">另存为</NButton
      ><NButton
        size="small"
        @click="
          guard(async () => {
            const name = window.prompt('预设名称', editing.name);
            if (name?.trim()) {
              editing.name = name.trim();
              changed();
            }
          })
        "
        >重命名</NButton
      ><NButton
        size="small"
        :disabled="editing?.id === 'novel-default'"
        @click="
          guard(async () => {
            if (window.confirm('删除此预设？')) {
              await ai.deletePreset(editing.id);
              dirty = false;
              choose(ai.presets[0]);
            }
          })
        "
        >删除</NButton
      ><NButton size="small" @click="importFile">导入</NButton
      ><NButton size="small" @click="exportFile('chat-completion')"
        >完整导出</NButton
      ><NButton size="small" @click="exportFile('prompt-manager')"
        >提示管理器导出</NButton
      >
    </div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <main v-if="editing">
      <details class="parameters">
        <summary>生成设置</summary>
        <div class="fields">
          <label v-for="(range, key) in numeric" :key="key"
            >{{ key
            }}<NInputNumber
              v-model:value="editing.payload[key]"
              :min="range[0]"
              :max="range[1]"
              placeholder="自动／继承"
              @update:value="changed" /></label
          ><label v-for="key in ['reasoning_effort', 'verbosity']" :key="key"
            >{{ key
            }}<NSelect
              v-model:value="editing.payload[key]"
              clearable
              :options="
                (key === 'verbosity'
                  ? ['auto', 'low', 'medium', 'high']
                  : [
                      'auto',
                      'none',
                      'minimal',
                      'low',
                      'medium',
                      'high',
                      'xhigh',
                    ]
                ).map((value) => ({ label: value, value }))
              "
              @update:value="changed"
          /></label>
        </div>
        <div class="fields">
          <label
            >流式输出
            <NSwitch
              v-model:value="editing.payload.stream_openai"
              @update:value="changed" /></label
          ><label
            >显式开启工具
            <NSwitch
              v-model:value="editing.payload.function_calling"
              @update:value="changed" /></label
          ><label
            >合并相邻系统消息
            <NSwitch
              v-model:value="editing.payload.squash_system_messages"
              @update:value="changed" /></label
          ><label
            >助手续写前缀
            <NSwitch
              v-model:value="editing.payload.continue_prefill"
              @update:value="changed"
          /></label>
        </div>
        <div class="fields">
          <label
            >名称行为<NSelect
              v-model:value="editing.payload.names_behavior"
              :options="[
                { label: '无名称', value: -1 },
                { label: '默认', value: 0 },
                { label: 'Completion name', value: 1 },
                { label: '正文前缀', value: 2 },
              ]"
              @update:value="changed" /></label
          ><label
            >续写后缀<NSelect
              v-model:value="editing.payload.continue_postfix"
              :options="[
                { label: '无', value: '' },
                { label: '空格', value: ' ' },
                { label: '换行', value: '\n' },
                { label: '空行', value: '\n\n' },
              ]"
              @update:value="changed"
          /></label>
        </div>
        <label
          v-for="key in [
            'new_chat_prompt',
            'new_example_chat_prompt',
            'continue_nudge_prompt',
          ]"
          :key="key"
          >{{ key
          }}<NInput
            v-model:value="editing.payload[key]"
            type="textarea"
            :autosize="{ minRows: 1, maxRows: 4 }"
            @update:value="changed"
        /></label>
      </details>
      <nav>
        <button
          v-for="(label, key) in {
            prompts: '提示管理器',
            adaptation: '上下文适配',
            regex: '正则',
            inspect: '检查与预览',
          }"
          :key="key"
          :class="{ active: tab === key }"
          @click="tab = key"
        >
          {{ label }}
        </button>
      </nav>
      <section v-if="tab === 'prompts'" class="prompt-manager">
        <div class="prompt-list">
          <h3>发送顺序</h3>
          <NSelect
            v-if="editing.payload.prompt_order?.[0]?.order"
            v-model:value="editing.adaptation.orderBranch"
            :options="
              editing.payload.prompt_order.map((b) => ({
                label: '顺序分支 ' + b.character_id,
                value: b.character_id,
              }))
            "
            @update:value="changed"
          />
          <p>拖动调整发送位置；移出顺序会保留提示库条目。</p>
          <div
            v-for="(item, i) in order"
            :key="item.identifier"
            class="prompt-row"
            draggable="true"
            @dragstart="drag = i"
            @dragover.prevent
            @drop.prevent="move(drag, i)"
          >
            <input
              v-model="item.enabled"
              type="checkbox"
              aria-label="启用条目"
              @change="changed"
            /><button class="prompt-name" @click="edit(item.identifier)">
              {{ find(item.identifier)?.name || item.identifier }}</button
            ><small
              >{{ find(item.identifier)?.role || "system" }} ·
              {{
                find(item.identifier)?.injection_position === 1
                  ? "深度 " + find(item.identifier)?.injection_depth
                  : "相对"
              }}
              · ≈{{ estimate(find(item.identifier)?.content) }}t</small
            ><button title="上移" @click="move(i, i - 1)">↑</button
            ><button title="下移" @click="move(i, i + 1)">↓</button
            ><button title="移出发送顺序" @click="removeOrder(i)">×</button>
          </div>
        </div>
        <aside class="prompt-library">
          <h3>提示库</h3>
          <div class="fields">
            <NButton size="tiny" @click="addPrompt()">新建提示</NButton
            ><NButton size="tiny" @click="addPrompt(true)">新建材料槽</NButton>
          </div>
          <NSelect
            v-model:value="libraryId"
            filterable
            :options="
              editing.payload.prompts.map((p) => ({
                label: p.name || p.identifier,
                value: p.identifier,
              }))
            "
            placeholder="选择库中条目"
          />
          <div class="fields">
            <NButton
              size="small"
              :disabled="
                !libraryId || order.some((o) => o.identifier === libraryId)
              "
              @click="append"
              >添加到顺序</NButton
            ><NButton
              size="small"
              :disabled="!libraryId"
              @click="edit(libraryId)"
              >编辑</NButton
            ><NButton
              v-if="BUILTIN_IDS.has(libraryId)"
              size="small"
              @click="reset(libraryId)"
              >恢复默认</NButton
            ><template v-else
              ><NButton
                size="small"
                :disabled="!libraryId"
                @click="clonePrompt(libraryId)"
                >复制</NButton
              ><NButton
                size="small"
                :disabled="!libraryId"
                @click="deletePrompt(libraryId)"
                >删除条目</NButton
              ></template
            >
          </div>
          <p>
            未保存的编辑只用于检查，不影响对话。保存后当前作品使用此版本；生成中的请求保留原版本。
          </p>
        </aside>
      </section>
      <section v-if="tab === 'adaptation'">
        <h3>小说工坊材料来源</h3>
        <div class="fields">
          <label
            >前情章数<NInputNumber
              v-model:value="editing.adaptation.historyChapters"
              :min="0"
              :max="20"
              @update:value="changed" /></label
          ><label
            >材料预算<NInputNumber
              v-model:value="editing.adaptation.contextBudget"
              :min="256"
              :max="64000"
              @update:value="changed"
          /></label>
        </div>
        <label
          v-for="key in [
            'authorNote',
            'charDescription',
            'charPersonality',
            'personaDescription',
            'dialogueExamples',
          ]"
          :key="key"
          >{{ identityLabels[key]
          }}<NInput
            v-model:value="editing.adaptation[key]"
            type="textarea"
            @update:value="changed"
        /></label>
        <div
          v-for="p in editing.payload.prompts.filter((p) => p.marker)"
          :key="p.identifier"
          class="mapping"
        >
          <strong>{{ p.name }}</strong
          ><NSelect
            v-model:value="editing.adaptation.mappings[p.identifier]"
            clearable
            :options="slotOptions"
            :placeholder="SLOT_LABELS[p.identifier] || '未映射'"
            @update:value="changed"
          /><NInput
            v-model:value="editing.adaptation.wrappers[p.identifier]"
            placeholder="包装模板：{0} 插入来源文本"
            @update:value="changed"
          />
        </div>
        <p>
          材料不会展开其中的宏；正文事实按发送时的章节范围读取。工具和作品写入仍受隐私及确认机制约束。
        </p>
      </section>
      <section v-if="tab === 'regex'">
        <h3>正则脚本</h3>
        <NButton size="small" @click="editRegex()">添加规则</NButton>
        <div v-for="(rule, i) in rules" :key="rule.id || i" class="prompt-row">
          <input
            :checked="!rule.disabled"
            type="checkbox"
            @change="
              rule.disabled = !rule.disabled;
              changed();
            "
          /><button class="prompt-name" @click="editRegex(i)">
            {{ rule.scriptName || "规则 " + (i + 1) }}</button
          ><small
            >{{ rule.markdownOnly ? "展示 " : ""
            }}{{ rule.promptOnly ? "发送 " : ""
            }}{{ !rule.markdownOnly && !rule.promptOnly ? "常规" : "" }}</small
          ><button @click="moveRegex(i, -1)">↑</button
          ><button @click="moveRegex(i, 1)">↓</button
          ><button
            @click="
              rules.splice(i, 1);
              changed();
            "
          >
            ×
          </button>
        </div>
        <h3>样本测试（变量使用副本）</h3>
        <NInput v-model:value="regexSample" type="textarea" />
        <div class="fields">
          <NSelect
            v-model:value="regexPlacement"
            :options="[
              { label: '作者输入', value: 1 },
              { label: '助手输出', value: 2 },
              { label: '世界资料', value: 5 },
              { label: '推理文本', value: 6 },
            ]"
          /><NSelect
            v-model:value="regexPhase"
            :options="
              ['regular', 'display', 'prompt'].map((value) => ({
                label: value,
                value,
              }))
            "
          /><NButton @click="testRegex">测试</NButton>
        </div>
        <template v-if="regexResult">
          <pre>{{ regexResult.text }}</pre>
          <p v-for="w in regexResult.warnings" :key="w">{{ w }}</p></template
        >
      </section>
      <section v-if="tab === 'inspect'">
        <h3>使用主窗口的真实作品与会话</h3>
        <NInput v-model:value="previewQuestion" type="textarea" />
        <div class="fields">
          <NSelect
            v-model:value="previewType"
            :options="
              ['normal', 'swipe', 'continue'].map((value) => ({
                label: value,
                value,
              }))
            "
          /><NButton :loading="previewBusy" @click="previewSend"
            >发送预览（不调用模型）</NButton
          >
        </div>
        <details>
          <summary>兼容报告 · {{ warnings.length }}</summary>
          <p v-for="w in warnings" :key="w">{{ w }}</p>
        </details>
      </section>
    </main>
    <footer>
      <span
        >{{ work.work?.title || "未关联作品" }} · 编辑版本
        {{ editing?.revision }}</span
      ><NButton size="small" :loading="previewBusy" @click="previewSend"
        >检查发送</NButton
      ><NButton size="small" type="primary" @click="save">保存并启用</NButton>
    </footer>
    <NModal
      :show="!!entry"
      preset="card"
      title="编辑提示条目"
      class="editor-modal"
      @update:show="entry = null"
      ><template v-if="entry"
        ><NInput v-model:value="entry.name" placeholder="名称" /><code>{{
          entry.identifier
        }}</code>
        <div class="fields">
          <label
            >角色<NSelect v-model:value="entry.role" :options="roles" /></label
          ><label
            >位置<NSelect
              v-model:value="entry.injection_position"
              :options="[
                { label: '相对顺序', value: 0 },
                { label: '聊天深度', value: 1 },
              ]" /></label
          ><label v-if="entry.injection_position === 1"
            >深度<NInputNumber
              v-model:value="entry.injection_depth"
              :min="0"
              :max="100000" /></label
          ><label v-if="entry.injection_position === 1"
            >优先级<NInputNumber v-model:value="entry.injection_order"
          /></label>
        </div>
        <label
          >触发（空为全部）<NSelect
            v-model:value="entry.injection_trigger"
            multiple
            clearable
            :options="
              GENERATION_TYPES.filter((t) => t !== 'regenerate').map(
                (value) => ({ label: value, value }),
              )
            "
        /></label>
        <p v-if="entry.marker">
          材料源与包装在「上下文适配」中编辑；条目角色与位置决定发送方式。
        </p>
        <NInput
          v-else
          v-model:value="entry.content"
          type="textarea"
          :autosize="{ minRows: 10, maxRows: 20 }"
          placeholder="支持酒馆宏，例如 {{user}}、{{char}}、{{getvar::偏好}}"
        />
        <div class="fields">
          <label v-if="!entry.marker"
            >含原文／范文
            <NSwitch v-model:value="entry.novel_verbatim" /></label
          ><label v-if="entry.system_prompt && !entry.marker"
            >禁止角色覆盖 <NSwitch v-model:value="entry.forbid_overrides"
          /></label>
        </div>
        <NButton type="primary" @click="commitEntry">保存条目到编辑区</NButton
        ><NButton @click="entry = null">取消</NButton></template
      ></NModal
    >
    <NModal
      :show="!!regexEntry"
      preset="card"
      title="编辑正则规则"
      class="editor-modal"
      @update:show="regexEntry = null"
      ><template v-if="regexEntry"
        ><label>名称<NInput v-model:value="regexEntry.scriptName" /></label
        ><label
          >查找（支持 /pattern/flags）<NInput
            v-model:value="regexEntry.findRegex"
            type="textarea" /></label
        ><label
          >替换（$1、$&lt;name&gt;、<span v-pre>{{ match }}</span
          >）<NInput
            v-model:value="regexEntry.replaceString"
            type="textarea" /></label
        ><label
          >捕获内容移除字符串（每行一条）<NInput
            :value="regexEntry.trimStrings.join('\n')"
            type="textarea"
            @update:value="
              (v) => (regexEntry.trimStrings = v.split('\n').filter(Boolean))
            " /></label
        ><NSelect
          v-model:value="regexEntry.placement"
          multiple
          :options="[
            { label: '作者输入', value: 1 },
            { label: '助手输出', value: 2 },
            { label: '世界资料', value: 5 },
            { label: '推理文本', value: 6 },
          ]"
        />
        <div class="fields">
          <label
            v-for="key in [
              'disabled',
              'markdownOnly',
              'promptOnly',
              'runOnEdit',
            ]"
            :key="key"
            >{{ key }} <NSwitch v-model:value="regexEntry[key]" /></label
          ><label
            >最小深度<NInputNumber
              v-model:value="regexEntry.minDepth"
              :min="-1" /></label
          ><label
            >最大深度<NInputNumber
              v-model:value="regexEntry.maxDepth"
              :min="-1" /></label
          ><label
            >查找宏<NSelect
              v-model:value="regexEntry.substituteRegex"
              :options="[
                { label: '不展开', value: 0 },
                { label: '展开', value: 1 },
                { label: '展开并转义', value: 2 },
              ]"
          /></label>
        </div>
        <NButton type="primary" @click="commitRegex"
          >保存规则到编辑区</NButton
        ></template
      ></NModal
    >
    <NModal
      v-model:show="showPreview"
      preset="card"
      title="实际发送检查器"
      class="editor-modal"
      ><template v-if="preview"
        ><p v-for="r in preview.sourceReport" :key="r">{{ r }}</p>
        <p>
          输入 {{ preview.tokens.used }}/{{ preview.tokens.inputCap }} ·
          输出预留 {{ preview.tokens.outputReserve }}
        </p>
        <pre>{{
          JSON.stringify(preview.presetSnapshot.parameters, null, 2)
        }}</pre>
        <p v-for="w in preview.warnings" :key="w">{{ w }}</p>
        <details v-for="t in preview.trace" :key="t.identifier">
          <summary>
            {{ t.name }} · {{ t.status }} · {{ t.role }} · 位置
            {{ t.position ?? "—" }} · ≈{{ t.tokens }}t
          </summary>
          <pre>{{ t.content }}</pre>
        </details>
        <details v-for="(m, i) in preview.messages" :key="i">
          <summary>最终消息 {{ i + 1 }} · {{ m.role }}</summary>
          <pre>{{ m.content }}</pre>
        </details>
        <p v-for="d in preview.dropped" :key="d.label">
          {{ d.label }}：{{ d.reason }}
        </p></template
      ></NModal
    >
    <NModal
      :show="!!incoming"
      preset="card"
      title="导入适配预览"
      class="editor-modal"
      @update:show="incoming = null"
      ><template v-if="incoming"
        ><p>
          原文与扩展字段保留。缺失的内置提示已补全；角色扮演规则由作者手动适配。
        </p>
        <NSelect
          v-if="incoming.row.importedFormat === 'prompt-manager'"
          v-model:value="importMode"
          :options="[
            { label: '合并到当前预设（替换当前顺序）', value: 'merge' },
            { label: '建立新预设', value: 'new' },
          ]"
        />
        <details
          v-if="importMode === 'merge'"
          v-for="change in importMerge?.changes"
          :key="change.identifier"
        >
          <summary>同 identifier 替换：{{ change.identifier }}</summary>
          <pre>
原内容：{{ change.before }}
导入内容：{{ change.after }}</pre>
        </details>
        <p v-for="w in incoming.report" :key="w">{{ w }}</p>
        <NButton type="primary" @click="acceptImport"
          >确认导入到编辑区</NButton
        ></template
      ></NModal
    >
  </div>
</template>
<style scoped>
.preset-window {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  color: var(--text);
  font-size: 13px;
}
header,
footer,
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 12px 20px;
  border-bottom: 1px solid var(--border);
}
header strong {
  white-space: nowrap;
}
.preset-selector {
  width: 300px;
}
.status,
footer span {
  flex: 1;
  color: var(--text-dim);
}
main {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0 20px 20px;
}
nav {
  display: flex;
  gap: 8px;
  padding: 16px 0;
  border-bottom: 1px solid var(--border);
}
button {
  color: inherit;
  background: transparent;
  border: 0;
  cursor: pointer;
}
nav button {
  padding: 8px 16px;
  border-radius: 6px;
}
.active {
  background: var(--bg-hover);
  color: var(--accent);
}
.prompt-manager {
  display: grid;
  grid-template-columns: minmax(450px, 1.5fr) minmax(280px, 1fr);
  gap: 24px;
}
.prompt-row {
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 10px 0;
  border-bottom: 1px solid var(--border);
}
.prompt-name {
  flex: 1;
  text-align: left;
}
.prompt-row small {
  font-size: 11px;
  color: var(--text-dim);
}
.fields {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin: 12px 0;
}
.fields label {
  flex: 1;
  min-width: 150px;
}
label {
  display: block;
  margin: 12px 0;
}
.mapping {
  display: grid;
  grid-template-columns: 140px 230px 1fr;
  gap: 12px;
  align-items: center;
  margin: 12px 0;
}
details {
  padding: 12px 0;
  border-bottom: 1px solid var(--border);
}
summary {
  cursor: pointer;
  font-weight: 600;
}
p {
  color: var(--text-dim);
  line-height: 1.7;
}
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 350px;
  overflow: auto;
  font-size: 12px;
}
code {
  display: block;
  font-size: 11px;
  color: var(--text-dim);
  margin: 8px 0;
}
.error {
  padding: 0 20px;
  color: #d55;
}
.editor-modal {
  width: min(880px, 92vw);
  max-height: 85vh;
  overflow: auto;
}
footer {
  border-top: 1px solid var(--border);
}
@media (max-width: 800px) {
  .prompt-manager {
    grid-template-columns: 1fr;
  }
  .mapping {
    grid-template-columns: 1fr;
  }
}
</style>
