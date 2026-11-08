<script setup>
import {ref,onMounted,onBeforeUnmount,nextTick} from 'vue'
import {useUiStore} from '../../stores/ui'
defineOptions({inheritAttrs:false})
defineProps({label:{type:String,default:'灵感面板'}})
const emit=defineEmits(['close']),ui=useUiStore(),modal=ref(null)
let origin,originId,originLabel
onMounted(()=>{
 origin=document.activeElement;originId=origin?.closest('[data-id]')?.dataset.id;originLabel=origin?.getAttribute('aria-label')
 modal.value.showModal()
 // Read-only details contain a tag input; opening them must not summon a phone keyboard.
 // Compose/convert dialogs and explicit edit actions choose their field after this mount.
 modal.value.querySelector('button')?.focus({preventScroll:true})
})
onBeforeUnmount(()=>{
 modal.value?.close()
 nextTick(()=>{
  if(document.querySelector('dialog[open]'))return
  const visible=e=>e?.getClientRects().length&&!e.closest('[inert]')
  const cards=[...document.querySelectorAll('.snip-note')],card=cards.find(e=>e.dataset.id===originId&&visible(e))
  const same=card&&[...card.querySelectorAll('[aria-label]')].find(e=>e.getAttribute('aria-label')===originLabel)
  const target=visible(origin)?origin:same||card||document.querySelector('.snip-mobile-menu')||document.querySelector('.snip-view-switch [aria-selected=true]')
  if(visible(target))target.focus({preventScroll:true})
 })
})
</script>
<template><Teleport to="body"><dialog ref="modal" v-bind="$attrs" class="snip-shell snip-native" :style="ui.rootStyle" :aria-label="label" @cancel.prevent="emit('close')" @keydown.esc.stop @click.self="emit('close')"><slot /></dialog></Teleport></template>
