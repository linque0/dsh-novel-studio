<script setup>
import {ref,nextTick} from 'vue'
import {NPopover} from 'naive-ui'
import {useUiStore} from '../stores/ui'
import {WRITING_PAPERS} from '../services/writing-paper.js'
import '../styles/writing-paper.css'
defineProps({settings:{type:Boolean,default:false}})
const ui=useUiStore(),open=ref(false),trigger=ref(null),list=ref(null)
async function choose(id){
  try{if(await ui.setWritingPaperStyle(id)){open.value=false;await nextTick();trigger.value?.focus()}}
  catch(e){window.$msg?.error('纸面未能保存，请重试。'+(e.message||''))}
}
function close(){open.value=false;nextTick(()=>trigger.value?.focus())}
function keys(event){
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();return}
  const buttons=[...(list.value?.querySelectorAll('button')||[])],index=buttons.indexOf(document.activeElement)
  let target
  if(event.key==='ArrowDown'||event.key==='ArrowRight')target=(index+1)%buttons.length
  if(event.key==='ArrowUp'||event.key==='ArrowLeft')target=(index-1+buttons.length)%buttons.length
  if(event.key==='Home')target=0
  if(event.key==='End')target=buttons.length-1
  if(target!==undefined){event.preventDefault();buttons[target]?.focus()}
}
async function shown(value){if(value){await nextTick();list.value?.querySelector('[aria-checked="true"]')?.focus()}}
</script>
<template>
  <div v-if="settings" class="writing-paper-options" role="group" aria-label="正文纸面装帧" :data-paper-skin="ui.skin" :data-paper-theme="ui.theme">
    <button v-for="paper in WRITING_PAPERS" :key="paper.id" type="button" :data-paper-choice="paper.id" :aria-pressed="ui.writingPaperStyle===paper.id" :disabled="ui.writingPaperSaving" @click="choose(paper.id)">
      <span class="writing-paper-swatch writing-paper-surface" :data-writing-paper="paper.id" aria-hidden="true"><i></i><i></i><i></i></span><span class="paper-option-copy"><strong>{{paper.label}}</strong><small>{{paper.description}}</small></span><span class="paper-check" aria-hidden="true">{{ui.writingPaperStyle===paper.id?'✓':''}}</span>
    </button>
  </div>
  <span v-else class="writing-paper-menu" @click.stop @mousedown.stop>
    <NPopover v-model:show="open" trigger="click" :show-arrow="false" placement="bottom-end" @update:show="shown">
      <template #trigger><button ref="trigger" type="button" class="tb paper-menu-trigger" aria-label="纸面" aria-haspopup="menu" :aria-expanded="open" :disabled="ui.writingPaperSaving" :title="'纸面：'+WRITING_PAPERS.find(p=>p.id===ui.writingPaperStyle)?.label" @keydown.esc.stop="close" @mousedown.prevent>纸面 ⌄</button></template>
      <div ref="list" class="writing-paper-menu-list" role="menu" aria-label="选择正文纸面" :data-paper-skin="ui.skin" :data-paper-theme="ui.theme" @keydown="keys">
        <button v-for="paper in WRITING_PAPERS" :key="paper.id" type="button" role="menuitemradio" :data-paper-choice="paper.id" :aria-checked="ui.writingPaperStyle===paper.id" :disabled="ui.writingPaperSaving" @click="choose(paper.id)"><span class="writing-paper-swatch writing-paper-surface" :data-writing-paper="paper.id" aria-hidden="true"><i></i><i></i><i></i></span><span class="paper-option-copy"><strong>{{paper.label}}</strong><small>{{paper.description}}</small></span><span class="paper-check" aria-hidden="true">{{ui.writingPaperStyle===paper.id?'✓':''}}</span></button>
      </div>
    </NPopover>
  </span>
</template>
