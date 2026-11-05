<script setup>
import {NButton} from 'naive-ui'
import {useWorkStore} from '../../stores/work'
import {useAiStore} from '../../stores/ai'
import {useUiStore} from '../../stores/ui'
import {useAssistantTaskStore} from '../../stores/assistant-task.js'
const props=defineProps({module:{type:String,required:true}})
const ui=useUiStore(),work=useWorkStore(),ai=useAiStore(),task=useAssistantTaskStore()
function open(){task.open(props.module).catch(e=>window.$msg?.warning(e.message))}
defineExpose({open})
</script>
<template>
    <div class="module-agent"><NButton size="tiny" :disabled="!work.work||ai.busy" @click="open">恍然梦 · {{ {chapters:'正文',outline:'大纲',lore:'设定',characters:'人物',snippets:'灵感'}[module] }}助手</NButton><span>生成草稿与提案，确认后保存</span></div>
</template>
<style scoped>
.module-agent{display:flex;gap:10px;align-items:center;flex:none;padding:6px 12px;border-bottom:1px solid var(--border);font-size:11px;color:var(--text-dim);flex-wrap:wrap}
</style>
