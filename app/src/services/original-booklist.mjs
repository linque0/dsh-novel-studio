export function titleTreatment(title) {
  const value=String(title||'').trim(), length=[...value].length
  if(!value)return 'balanced'
  if(/[A-Za-z\d]/.test(value))return 'mixed'
  if(/^[\p{Script=Han}·・]+$/u.test(value)&&length<=4)return 'vertical'
  return length<=10?'balanced':'long'
}
export function booklistPage(works,requestedPage=0,pageSize=6) {
  const size=[6,12,24].includes(pageSize)?pageSize:6
  const count=Math.max(1,Math.ceil(works.length/size))
  const page=Math.max(0,Math.min(count-1,Math.trunc(Number(requestedPage)||0)))
  return {page,count,items:works.slice(page*size,(page+1)*size),start:works.length?page*size+1:0,end:Math.min(works.length,(page+1)*size)}
}
