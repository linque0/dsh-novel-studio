import { onBeforeUpdate, onMounted, onUpdated, onBeforeUnmount, toValue } from 'vue'
import { createStatsMotion } from '../../services/writing-stats-motion.js'
export function useStatsMotion(root,key,options){
 const motion=createStatsMotion(options);let before=null,frame=0
 const run=()=>{if(root.value&&before)motion.finish(root.value,before);before=null}
 onMounted(()=>{if(root.value){before=motion.prepare(root.value,toValue(key));run()}})
 onBeforeUpdate(()=>{if(root.value)before=motion.prepare(root.value,toValue(key))})
 onUpdated(()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(run)})
 onBeforeUnmount(()=>{cancelAnimationFrame(frame);motion.dispose()})
}

