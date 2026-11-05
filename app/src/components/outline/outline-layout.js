// 只计算显示尺寸，不改写记忆宽度或画布坐标。
export const OUTLINE_LAYOUT_KEY = Symbol('outline-workspace')
export function normalizeOutlineWidth(side, value) {
  const fallback=side==='left'?220:318, min=side==='left'?180:260, max=side==='left'?420:480
  const number=value==null||value===''?NaN:Number(value)
  return Math.round(Math.max(min,Math.min(max,Number.isFinite(number)?number:fallback)))
}
export function outlineLayout({width=0,leftWidth=220,rightWidth=318,leftOpen=false,rightOpen=false}={}) {
  const narrow=width<1100, available=Math.max(0,width-56)
  if(narrow)return {narrow,left:0,right:0,canvas:available}
  const leftChrome=leftOpen?16:40,rightChrome=rightOpen?16:40
  const budget=available-480-leftChrome-rightChrome
  const left=leftOpen?Math.min(normalizeOutlineWidth('left',leftWidth),budget-(rightOpen?260:0)):0
  const right=rightOpen?Math.min(normalizeOutlineWidth('right',rightWidth),budget-left):0
  return {narrow,left,right,canvas:available-left-right-leftChrome-rightChrome}
}
export function initialExpandedContainers(nodes, saved) {
  const containers=new Set(nodes.filter(n=>n.kind==='container'&&!n.deletedAt).map(n=>n.id))
  if(Array.isArray(saved))return saved.filter(id=>containers.has(id))
  return nodes.filter(n=>containers.has(n.id)&&!n.parentId).map(n=>n.id)
}
