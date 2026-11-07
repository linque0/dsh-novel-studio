<script setup>
import { computed,ref,watch } from 'vue'
import StatsPagination from './StatsPagination.vue'
const props=defineProps({rows:{type:Array,default:()=>[]},unit:String,selectable:Boolean,empty:{type:String,default:'暂无数据'}})
const emit=defineEmits(['select'])
const page=ref(0),max=computed(()=>Math.max(1,...props.rows.map(r=>r.value))),visible=computed(()=>props.rows.slice(page.value*30,(page.value+1)*30))
watch(()=>props.rows.map(r=>r.id).join('|'),()=>page.value=0)
</script>
<template><div class="rank stats-bars"><p v-if="!rows.length" class="empty">{{empty}}</p><component :is="selectable?'button':'div'" v-for="row in visible" :key="row.id" :type="selectable?'button':undefined" class="bar-row" :data-row-motion="'rank-'+row.id" @click="selectable&&emit('select',row.id)"><span>{{row.label}}<small v-if="row.work">{{row.work}}</small></span><span class="meter"><i :style="{width:row.value/max*100+'%'}"/></span><b>{{row.value.toLocaleString('zh-CN')}} {{unit}}</b></component><StatsPagination v-model:page="page" :total="rows.length" :size="30"/></div></template>
