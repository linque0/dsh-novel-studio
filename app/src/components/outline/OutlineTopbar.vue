<script setup>
import { computed } from 'vue'
import { NDropdown } from 'naive-ui'
import { useUiStore } from '../../stores/ui'
import { useWorkStore } from '../../stores/work'
import { APP_NAVIGATION } from '../app-navigation'
import AutoHideTopbar from '../AutoHideTopbar.vue'
import Glyph from './OutlineGlyph.vue'
const props=defineProps({detached:Boolean,actions:{type:Array,default:()=>[]}})
const emit=defineEmits(['navigate','action','close'])
const ui=useUiStore(),work=useWorkStore()
const nav=APP_NAVIGATION.filter(n=>n.key!=='settings')
const saved=computed(()=>ui.autosave.saving?'保存中…':ui.autosave.pending?'未保存':'已保存')
const options=computed(()=>[
  {key:'canvas-settings',label:'画布设置与操作'},
  {key:'app-settings',label:'应用设置'},
  {key:'topbar-pin',label:ui.topbarAutoHide?'锁定顶栏':'自动隐藏顶栏'},
  {type:'divider',key:'divider'},
  ...props.actions,
  ...(props.detached?[{key:'panel-close',label:'保存并关闭窗口'}]:[])
])
function action(key){
  if(key==='canvas-settings')window.dispatchEvent(new CustomEvent('outline-command',{detail:{command:'settings'}}))
  else if(key==='app-settings')emit('navigate','settings')
  else if(key==='topbar-pin')ui.setPref('topbarAutoHide',!ui.topbarAutoHide)
  else if(key==='panel-close')emit('close')
  else emit('action',key)
}
</script>
<template>
  <AutoHideTopbar class="outline-topbar-shell" :auto-hide="ui.topbarAutoHide" @update:auto-hide="v=>ui.setPref('topbarAutoHide',v)">
    <header class="outline-topbar app-topbar" :class="{'panel-topbar':detached}">
      <button class="brand" type="button" aria-label="小说工坊，返回书架" @click="emit('navigate','shelf')">小说工坊 <small>LATENT</small></button>
      <nav class="nav" aria-label="功能模块"><button v-for="item in nav" :key="item.key" type="button" :data-nav="item.key" :class="{active:item.key==='outline'}" :aria-current="item.key==='outline'?'page':undefined" @click="emit('navigate',item.key)">{{item.label}}</button></nav>
      <div class="top-actions"><span class="saved app-topbar-save" :data-save-state="ui.autosave.saving?'saving':ui.autosave.pending?'dirty':'saved'" role="status"><Glyph name="check" :size="13"/> {{saved}}</span><button class="round" type="button" aria-label="搜索" @click="ui.searchOpen=true"><Glyph name="search"/></button><NDropdown trigger="click" :options="options" placement="bottom-end" @select="action"><button class="round" type="button" aria-label="设置"><Glyph name="gear"/></button></NDropdown></div>
      <span class="outline-mobile-title">{{work.work?.title}}</span>
    </header>
  </AutoHideTopbar>
</template>
