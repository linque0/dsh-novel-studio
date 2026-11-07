export const CJK={song:{label:'思源宋体',stack:'"Noto Serif SC",serif'},kai:{label:'霞鹜文楷',stack:'"LXGW WenKai",serif'},jinghua:{label:'京华老宋体',stack:'"KingHwa OldSong",serif'},zhaohua:{label:'朝华标题',stack:'"Zhaohua Title",serif'},yunyou:{label:'云游手书',stack:'"Ziyu Yunyou",serif'},hei:{label:'系统黑体',stack:'"Microsoft YaHei","PingFang SC",sans-serif'}}
export const LATIN={none:{label:'跟随中文',stack:''},playfair:{label:'Playfair Display',stack:'"Playfair Display"'},gothic:{label:'Montenegrin Gothic One',stack:'"Montenegrin Gothic One"'}}
export const DEFAULTS={editorFont:'song',editorLatin:'none',fontSize:17,topbarAutoHide:false}
export const CATALOG=[
 {id:'editorFont',page:'appearance',title:'中文正文字体',desc:'选择正文中的中文字形',terms:'思源宋体 文楷 京华老宋 朝华 云游 黑体 字体 font'},
 {id:'editorLatin',page:'appearance',title:'西文字体',desc:'英文与数字的字形搭配',terms:'英文 拉丁 Playfair Gothic 字体'},
 {id:'fontSize',page:'appearance',title:'正文字号',desc:'在13–24px之间调整阅读与编辑字号',terms:'大小 排版 字号 缩放'},
 {id:'topbarAutoHide',page:'appearance',title:'默认隐藏顶栏',desc:'移至顶部展开，让写作空间更安静',terms:'自动收起 导航 沉浸 界面'},
 {id:'backup',page:'data',title:'备份全部数据',desc:'下载作品、章节、人物与设定的完整快照',terms:'JSON 安全 导出'},
 {id:'restore',page:'data',title:'恢复备份',desc:'检查备份内容后，替换当前工作区',terms:'JSON 覆盖 导入'},
 {id:'import',page:'data',title:'导入文本作品',desc:'从TXT或Markdown文件创建作品',terms:'TXT MD txt md 文本 迁入'},
 {id:'export',page:'data',title:'导出正文',desc:'选择作品与章节，导出TXT或Markdown',terms:'TXT MD txt md 下载'},
 {id:'trash',page:'data',title:'回收站',desc:'找回删除的条目，或彻底移除',terms:'恢复 删除 还原 清理'},
 {id:'help',page:'about',title:'帮助与快捷键',desc:'了解常用操作与键盘入口',terms:'手册 使用 操作 Escape Tab Ctrl S'},
 {id:'stats',page:'about',title:'写作概览',desc:'查看作品、章节与正文的规模',terms:'统计 字数 数据'},
 {id:'version',page:'about',title:'关于小说工坊',desc:'版本与本地优先的创作方式',terms:'版本 关于 LATENT DSH'}
]
export const searchSettings=query=>{const q=String(query||'').trim().toLocaleLowerCase();return q?CATALOG.filter(x=>[x.title,x.desc,x.terms].join(' ').toLocaleLowerCase().includes(q)):[]}
export const clone=value=>JSON.parse(JSON.stringify(value))
export const words=text=>String(text||'').replace(/\s/g,'').length
export function normalizePrefs(p={}){p=p&&typeof p==='object'?p:{};const n=p.fontSize==null?NaN:Number(p.fontSize);return{editorFont:Object.hasOwn(CJK,p.editorFont)?p.editorFont:'song',editorLatin:Object.hasOwn(LATIN,p.editorLatin)?p.editorLatin:'none',fontSize:Number.isFinite(n)?Math.max(13,Math.min(24,Math.round(n))):17,topbarAutoHide:p.topbarAutoHide===true}}
const TABLES=['works','chapters','characters','lore','relations','snippets','trash']
function validLibrary(library){if(!library||TABLES.some(k=>!Array.isArray(library[k])))throw Error('备份中的作品数据不完整。');for(const k of TABLES){const ids=new Set();for(const row of library[k]){if(!row||typeof row!=='object'||typeof row.id!=='string'||!row.id||ids.has(row.id))throw Error('备份中存在无效或重复的条目。');ids.add(row.id)}}return clone(library)}
const uid=()=>globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+Math.random().toString(36).slice(2)

export function createSettings(seed,{storage=null,key='latent-settings-design-v1'}={}){
 const state={prefs:{...DEFAULTS},library:clone(seed),page:'appearance',scroll:{},lastBackup:null,error:'',pending:false,history:[]}
 const serialize=()=>JSON.stringify({version:1,prefs:state.prefs,library:state.library,page:state.page,scroll:state.scroll,lastBackup:state.lastBackup})
 function read(raw){const saved=JSON.parse(raw);if(saved?.version!==1)throw Error('version');return{prefs:normalizePrefs(saved.prefs),library:validLibrary(saved.library),page:['appearance','data','about'].includes(saved.page)?saved.page:'appearance',scroll:saved.scroll&&typeof saved.scroll==='object'?saved.scroll:{},lastBackup:typeof saved.lastBackup==='string'?saved.lastBackup:null}}
 try{const raw=storage?.getItem(key);if(raw)Object.assign(state,read(raw))}catch{state.error='无法读取上次设置，已载入默认值。';state.pending=true}
 function persist(){try{storage?.setItem(key,serialize());state.pending=false;state.error='';return true}catch{state.pending=true;state.error='改动尚未保存，当前选择仍保留。请释放存储空间后重试。';return false}}
 function checkpoint(){state.history.push(clone({prefs:state.prefs,library:state.library,lastBackup:state.lastBackup}));if(state.history.length>12)state.history.shift()}
 function setPref(k,v){if(!Object.hasOwn(DEFAULTS,k))return false;state.prefs=normalizePrefs({...state.prefs,[k]:v});return persist()}
 function resetAppearance(){checkpoint();state.prefs={...DEFAULTS};return persist()}
 function undo(){const prev=state.history.pop();if(!prev)return false;Object.assign(state,prev);return persist()}
 function importText(filename,content){if(!String(content||'').trim())throw Error('这个文件没有可以导入的正文。');checkpoint();const id=uid(),title=String(filename||'未命名作品').split(/[\\/]/).at(-1).replace(/\.(txt|md)$/i,'')||'未命名作品';state.library.works.push({id,title});state.library.chapters.push({id:uid(),workId:id,title:'正文',content:String(content),order:0});persist();return id}
 function exportText(workId,ids,format='txt'){const work=state.library.works.find(w=>w.id===workId),selected=new Set(ids),rows=state.library.chapters.filter(c=>c.workId===workId&&selected.has(c.id)).sort((a,b)=>(a.order||0)-(b.order||0));if(!work||!rows.length)throw Error('请至少选择一章正文。');const md=format==='md';return(md?'# ':'')+work.title+'\n\n'+rows.map(c=>(md?'## ':'')+c.title+'\n\n'+c.content).join('\n\n')+'\n'}
 function backup(){return JSON.stringify({format:'latent-settings-design',version:1,createdAt:new Date().toISOString(),preferences:state.prefs,library:state.library},null,2)}
 function parseBackup(raw){let data;try{data=JSON.parse(raw)}catch{throw Error('文件无法读取，请选择完整的JSON备份。')}if(data?.format!=='latent-settings-design'||data.version!==1)throw Error('这份备份的格式与当前工作区不兼容。');validLibrary(data.library);return{...data,preferences:normalizePrefs(data.preferences),library:clone(data.library)}}
 function restore(candidate){const data=parseBackup(JSON.stringify(candidate));checkpoint();state.library=data.library;state.prefs=data.preferences;return persist()}
 function restoreTrash(id){const row=state.library.trash.find(x=>x.id===id);if(!row)return false;if(!['chapters','characters','lore','snippets'].includes(row.kind))throw Error('这个条目无法恢复。');if(row.kind==='chapters'&&!state.library.works.some(w=>w.id===row.workId))throw Error('原作品不存在，暂时无法恢复这一章。');checkpoint();const{kind,deletedAt,...item}=row;if(!state.library[kind].some(x=>x.id===id))state.library[kind].push(item);state.library.trash=state.library.trash.filter(x=>x.id!==id);return persist()}
 function purgeTrash(id){if(!state.library.trash.some(x=>x.id===id))return false;checkpoint();state.library.trash=state.library.trash.filter(x=>x.id!==id);return persist()}
 function sync(raw){if(state.pending)return false;try{const {page,scroll,...data}=read(raw);Object.assign(state,data);state.history=[];return true}catch{return false}}
 function summary(){return{works:state.library.works.length,chapters:state.library.chapters.length,characters:state.library.characters.length,lore:state.library.lore.length,words:state.library.chapters.reduce((s,c)=>s+words(c.content),0),trash:state.library.trash.length}}
 return{state,setPref,persist,serialize,resetAppearance,undo,importText,exportText,backup,parseBackup,restore,restoreTrash,purgeTrash,sync,summary}
}
