<script setup>
import {computed} from 'vue'
import {NButton,NSelect} from 'naive-ui'
import {useAssistantTaskStore} from '../../stores/assistant-task.js'
import {useWritingStore} from '../../stores/writing.js'
import {useAiStore} from '../../stores/ai.js'
import {useWorkStore} from '../../stores/work.js'
const task=useAssistantTaskStore(),writing=useWritingStore(),ai=useAiStore(),work=useWorkStore()
const s=computed(()=>writing.active)
const chapterOptions=computed(()=>work.liveChapters.map(c=>({value:c.id,label:c.title})))
const targetOptions=computed(()=>[{value:'',label:task.module==='characters'?'新人物 / 批量提取':'作品根目录'},...(work[{outline:'olnodes',lore:'mubu',characters:'characters',snippets:'snippets'}[task.module]]||[]).filter(r=>!r.deletedAt).map(r=>({value:r.id,label:r.name||r.title||(r.text||r.content||'').slice(0,40)||'空条目'}))])
const modes=computed(()=>[{label:'光标处续写',value:'insert'},{label:'章节末尾续写',value:'append'},...(s.value?.anchors.replace?[{label:'选段后接写',value:'afterSelection'},{label:'改写选段',value:'replace'}]:[])])
const call=fn=>Promise.resolve().then(fn).catch(e=>{task.error=e.message})
</script>
<template>
  <div class="agent-task-parameters">
    <template v-if="task.mode==='writing'&&s">
      <label>写作位置<NSelect :value="s.mode" :options="modes" :disabled="ai.busy||s.running" @update:value="v=>call(()=>writing.setMode(v))" /></label>
      <label v-if="s.operation==='chapter.continue'">剧情方向<NSelect :value="s.directionCount" :disabled="ai.busy||s.running" :options="[4,5,6].map(value=>({label:value+' 个方向',value}))" @update:value="v=>{s.directionCount=v;writing.changed(s)}" /></label>
      <p class="agent-caption">{{s.chapterTitle}} · {{s.anchor.label}}</p>
      <div class="agent-inline-actions"><NButton size="small" :disabled="ai.busy" @click="call(()=>writing.open({fresh:true}))">重新定位</NButton><NButton v-if="s.directions.length" size="small" :disabled="ai.busy" @click="call(()=>writing.open({fresh:true,reuseDirections:true}))">保留方向重新定位</NButton></div>
    </template>
    <template v-else-if="task.mode==='task'">
      <label v-if="task.module!=='chapters'">目标条目 / 挂载位置<NSelect v-model:value="task.targetId" :options="targetOptions" :disabled="ai.busy" /></label>
      <label v-else>目标章节<NSelect v-model:value="task.chapterId" :options="chapterOptions" :disabled="ai.busy" @update:value="task.selection=''" /></label>
      <label v-if="task.selected?.extraction&&task.type!=='memory.extract'">完整读取范围<NSelect v-model:value="task.chapterIds" multiple filterable :options="chapterOptions" :disabled="ai.busy" /></label>
      <p v-if="task.selection" class="agent-caption">已捕获正文选段：{{task.selection.slice(0,100)}}{{task.selection.length>100?'…':''}}</p>
      <details><summary>任务说明</summary><p class="agent-caption">{{task.selected?.instruction}}</p></details>
    </template>
  </div>
</template>
<style scoped>
.agent-task-parameters{display:grid;gap:12px}.agent-task-parameters label{display:grid;gap:6px;font-size:13px}.agent-caption{margin:0;font-size:12px;line-height:1.6;color:var(--agent-muted,var(--text-dim))}.agent-inline-actions{display:flex;gap:8px;flex-wrap:wrap}summary{font-size:12px;cursor:pointer}
</style>
