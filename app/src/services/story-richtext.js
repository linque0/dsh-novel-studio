import {Editor} from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import TextStyle from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import TextAlign from '@tiptap/extension-text-align'
import Highlight from '@tiptap/extension-highlight'
import DOMPurify from 'dompurify'
import {FontSize} from './richtext.js'
import {DlLinkMark} from './doublelinks.js'
import {AnnotationMark} from './annotations.js'
import {normalizeText} from './project/text.js'
import {storyHtml} from './ai/story-core.js'

// Same content schema as the formal editor. No model-provided HTML is interpreted.
export function storyExtensions(){return [StarterKit.configure({heading:{levels:[1,2,3]}}),Underline,TextStyle,FontSize,Color,Highlight,DlLinkMark,AnnotationMark,Link.configure({openOnClick:false,autolink:true}),TextAlign.configure({types:['heading','paragraph']})]}
function create(html){return new Editor({extensions:storyExtensions(),content:DOMPurify.sanitize(html),editable:false})}
export function normalizeStoryHTML(html){const e=create(html);try{return e.getHTML()}finally{e.destroy()}}

/** Patch only the changed text interval. If coordinates cannot be proven, keep the original and retain the model result in the run. */
export function reviseStoryHTML(html,before,after){
  const e=create(html)
  try{
    if(normalizeText(e.getHTML(),'html')!==before)throw new Error('工作稿富文本与文字不一致，修稿结果已保留供对照')
    if(before===after)return e.getHTML()
    let text='',last=null
    const positions=[]
    e.state.doc.descendants((node,pos)=>{
      if(node.isText){
        if(last!==null&&pos>last){text+='\n\n';positions.push(null,null)}
        for(let i=0;i<node.text.length;i++){text+=node.text[i];positions.push(pos+i)}
        last=pos+node.text.length
      }
    })
    const leading=text.length-text.trimStart().length,trailing=text.trimEnd().length
    text=text.slice(leading,trailing);const map=positions.slice(leading,trailing)
    if(text!==before)throw new Error('此稿包含复杂段落结构，无法保证无损修稿；原稿保留，请从旅程记录查看修稿结果')
    let start=0,end=before.length,newEnd=after.length
    while(start<end&&start<newEnd&&before[start]===after[start])start++
    while(end>start&&newEnd>start&&before[end-1]===after[newEnd-1]){end--;newEnd--}
    const from=start===before.length?(map.at(-1)??0)+1:map[start]
    const to=end===0?from:end===start?from:map[end-1]!=null?map[end-1]+1:null
    if(from==null||to==null)throw new Error('修改跨越无法精确定位的段落边界，原稿保留，修稿结果请在旅程记录对照')
    let protectedMark=false
    e.state.doc.nodesBetween(from,to,n=>{if(n.marks?.some(m=>/dl|link|note|annotation/i.test(m.type.name)))protectedMark=true})
    if(protectedMark)throw new Error('修改范围包含链接或批注，原稿保留，请在工坊中手动核对修稿')
    const replacement=after.slice(start,newEnd)
    const content=replacement.includes('\n')?storyHtml(replacement):replacement?{type:'text',text:replacement,marks:(e.state.doc.nodeAt(from)?.marks||[]).map(m=>m.toJSON())}:[]
    if(!e.commands.insertContentAt({from,to},content))throw new Error('无损修稿事务未提交')
    const result=e.getHTML()
    if(normalizeText(result,'html')!==after)throw new Error('无法无损保留本稿格式，原稿及修稿预览均保留，请手动对照')
    return result
  }finally{e.destroy()}
}
