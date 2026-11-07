<script setup>
import { watch } from 'vue'
const props=defineProps({page:Number,total:Number,size:{type:Number,default:40}});const emit=defineEmits(['update:page'])
watch(()=>[props.page,props.total,props.size],()=>{
 const last=Math.max(0,Math.ceil(props.total/props.size)-1)
 if(props.page>last||props.page<0)emit('update:page',Math.max(0,Math.min(last,props.page)))
},{immediate:true})
</script>
<template><div v-if="total>size" class="stats-pagination"><button class="soft" :disabled="page===0" @click="emit('update:page',page-1)">上一页</button><span>{{page+1}} / {{Math.ceil(total/size)}}</span><button class="soft" :disabled="(page+1)*size>=total" @click="emit('update:page',page+1)">下一页</button></div></template>
