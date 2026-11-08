"""Three independent first-screen compositions from one shared specimen dataset."""
from pathlib import Path
import json
from html import escape

ROOT = Path(__file__).resolve().parent.parent
D = json.loads((ROOT / 'data.json').read_text(encoding='utf-8'))
N = D['notes']
total = len(N)
unmarked = sum(not n['tags'] for n in N)
linked = sum(bool(n['links']) for n in N)
tag_counts = {t: sum(t in n['tags'] for n in N) for t in dict.fromkeys(t for n in N for t in n['tags'])}
paths = {
 'search':'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
 'plus':'<path d="M12 5v14M5 12h14"/>',
 'grid':'<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
 'note':'<path d="M14 3H5v18h14V8zM14 3v5h5M8 12h8M8 16h5"/>',
 'book':'<path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Zm0 0v15"/>',
 'link':'<path d="m10 14 4-4M8.5 15.5l-2 2a3.5 3.5 0 0 1-5-5l4-4a3.5 3.5 0 0 1 5 0M15.5 8.5l2-2a3.5 3.5 0 0 1 5 5l-4 4a3.5 3.5 0 0 1-5 0" transform="translate(0 -1) scale(.95)"/>',
 'arrow':'<path d="M5 12h14m-5-5 5 5-5 5"/>',
 'chevron':'<path d="m8 10 4 4 4-4"/>',
 'tag':'<path d="m3 3 8 .5 10 10-7.5 7.5-10-10z"/><circle cx="8" cy="8" r="1"/>',
 'tray':'<path d="M4 5h16v14H4zM4 12h5l1 3h4l1-3h5"/>',
 'sort':'<path d="M8 4v16m-4-4 4 4 4-4M15 5h6M15 10h4M15 15h2"/>',
 'settings':'<circle cx="12" cy="12" r="3"/><path d="m9 3-1 3-3 1-2 3 2 2-1 3 2 3 3-1 2 3h3l1-3 3-1 2-3-2-2 1-3-2-3-3 1-2-3z"/>',
 'chart':'<path d="M5 19V9m7 10V4m7 15v-7M3 21h18"/>',
 'pen':'<path d="m15 4 5 5M4 20l5-1L21 7l-5-5L4 14zM4 14l5 5"/>',
 'lock':'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
 'more':'<circle cx="5" cy="12" r=".8"/><circle cx="12" cy="12" r=".8"/><circle cx="19" cy="12" r=".8"/>',
 'expand':'<path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6"/>',
 'person':'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
 'clock':'<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>'
}
def icon(name): return '<svg viewBox="0 0 24 24" aria-hidden="true">'+paths[name]+'</svg>'
def tags(n): return '<div class="tags">'+''.join('<span class="tag">'+escape(t)+'</span>' for t in n['tags'])+'</div>'
def ref(r): return '<div class="ref">'+icon('person' if r['kind']=='人物' else 'book' if r['kind']=='正文' else 'note')+'<span>'+r['kind']+'</span><strong>'+escape(r['name'])+'</strong><i class="arrow">↗</i></div>'
def topbar(): return '<header class="topbar"><div class="brand"><strong>小说工坊</strong><span>LATENT</span></div><nav class="global-tabs" aria-label="功能导航">'+''.join('<span class="'+('active' if t=='灵感' else '')+'">'+t+'</span>' for t in ['书架','正文','大纲','设定','人物','灵感'])+'</nav><div class="top-tools">'+''.join('<span class="round" aria-label="'+label+'">'+icon(name)+'</span>' for name,label in [('chart','写作数据'),('search','搜索'),('settings','设置'),('lock','锁定顶栏')])+'</div></header>'
def search(placeholder='搜索灵感…'): return '<label class="search">'+icon('search')+'<input aria-label="搜索灵感" placeholder="'+placeholder+'"><span class="key">Ctrl K</span></label>'
def heading(title, mode='new'): return '<div class="page-head"><div class="page-heading"><h1>'+title+'</h1><span class="crumb">'+D['work']+'<span class="slash">/</span>灵感</span></div><div class="head-tools">'+search('搜索片段、标签…' if mode=='index' else '搜索灵感…')+'<button class="'+('soft' if mode=='journal' else 'primary')+'">'+icon('plus')+'记一条灵感</button></div></div>'
def nav(label,count=None,ico=None,selected=False): return '<div class="nav-row'+(' selected' if selected else '')+'">'+(icon(ico) if ico else '<span class="quiet">#</span>')+label+(('<b>'+str(count)+'</b>') if count is not None else '')+'</div>'
def write(name,title,css,main):
 html='<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+title+' · 小说工坊</title><link rel="icon" href="data:,"><link rel="stylesheet" href="fonts.css"><link rel="stylesheet" href="common.css"><link rel="stylesheet" href="'+css+'"></head><body>'+topbar()+main+'</body></html>'
 (ROOT/name).write_text(html,encoding='utf-8')

# A: dated, continuous reading surface. Capture and complete excerpts are primary.
def journal_note(n, compact=False):
 return '<article class="journal-note glass '+('compact' if compact else 'current')+'"><div class="note-top"><div class="meta"><time class="num">'+n['time']+'</time>'+('' if compact else '<span>已选中</span>')+'</div><span class="note-tool">'+icon('more')+'</span></div><h3>'+escape(n['title'])+'</h3><div class="read-body">'+escape(n['body'])+'</div><div class="note-footer">'+tags(n)+'<span class="link-count">'+icon('link')+str(len(n['links']))+' 处关联</span></div></article>'
left='<aside class="journal-nav glass"><h2>我的灵感</h2>'+nav('全部灵感',total,'tray',True)+nav('未标记',unmarked,'tag')+nav('有关联',linked,'link')+'<div class="nav-heading">标签</div>'+''.join(nav(t,tag_counts[t]) for t in ['场景','人物','对白','雾港','来信'])+'<div class="nav-heading">创建时间</div><div class="nav-row"><span class="dot"></span>2026 年 11 月<b>'+str(sum(n['date'].startswith('2026-11') for n in N))+'</b></div><div class="nav-row">2026 年 10 月<b>'+str(sum(n['date'].startswith('2026-10') for n in N))+'</b></div><div class="month">'+icon('book')+' 雾港纪年 '+icon('chevron')+'</div></aside>'
capture='<div class="capture glass"><div class="capture-prompt">'+icon('pen')+'此刻，想到了什么？</div><textarea rows="2" aria-label="随手记录灵感" placeholder="一个画面，一句对白，或还没想清楚的念头…"></textarea><div class="capture-bottom"><span>首行作为标题<span class="quiet"> · </span><span class="num">Ctrl ↵</span> 记录</span><button class="primary">记录 '+icon('arrow')+'</button></div></div>'
feed='<section class="journal-feed scroller">'+capture+'<div class="date-heading"><h2>今天</h2><time>11.07 · 周六</time><span>2 条灵感</span></div>'+journal_note(N[0])+journal_note(N[1],True)+'<div class="date-heading"><h2>昨天</h2><time>11.06 · 周五</time><span>3 条灵感</span></div>'+journal_note(N[2],True)+'<p class="timeline-foot">已按创建时间排列</p></section>'
right='<aside class="organize glass"><h2>片段整理</h2><div class="selected-title">'+N[0]['title']+'</div><div class="section-title">标签 <span>'+icon('tag')+'</span></div><div class="tag-edit">'+''.join('<span class="tag">'+t+'</span>' for t in N[0]['tags'])+'<span class="mini-plus">＋</span></div><div class="section-title">已有关联 <span class="num">2</span></div>'+''.join(ref(r) for r in N[0]['links'])+'<div class="divider"></div><div class="section-title">继续写下去</div><div class="convert"><button class="soft">'+icon('book')+'转为章节</button><button class="soft">'+icon('note')+'转为设定</button></div><p class="footnote">转换后保留原灵感。</p><div class="divider"></div><div class="footer-line"><span>创建于</span><time class="num">2026.11.07 09:42</time></div></aside>'
write('a-journal.html','灵感手札','a-journal.css',heading('灵感手札','journal')+'<main class="journal">'+left+feed+right+'</main>')

# B: three text-card lanes; all membership comes from real sample tags, no fake workflow.
def card(n,selected=False,short=False):
 quoted=n['tags'] and n['tags'][0]=='对白'
 classes='idea-card '+('selected ' if selected else '')+('quote ' if quoted else '')+('short' if short else '')
 text=n['body'] if selected or quoted else n['body'].split('\n\n')[0]
 if quoted and text.startswith(n['title']+'\n'):text=text[len(n['title']):].lstrip()
 return '<article class="'+classes+'"><div class="card-meta"><time class="num">'+n['date'][5:].replace('-','.')+' · '+n['time']+'</time>'+icon('more')+'</div><h3 class="card-title">'+escape(n['title'])+'</h3><p class="card-copy">'+escape(text)+'</p>'+tags(n)+('<div class="card-references">'+icon('link')+''.join('<span>'+r['name']+'</span>' for r in n['links'])+'</div>' if n['links'] else '')+('<div class="arrange-link"><span>整理这条灵感</span><span>↗</span></div>' if selected else '')+'</article>'
index='<aside class="board-index"><div class="index-title">当前作品</div><h2>雾港纪年</h2>'+nav('叙事拼板',None,'grid',True)+nav('全部灵感',total,'tray')+nav('未标记',unmarked,'tag')+'<div class="nav-heading">标签分组</div>'+''.join(nav(t,tag_counts[t]) for t in ['场景','人物','对白'])+'<div class="board-history"><span class="quiet">其他标签</span><br># 雾港　# 来信<br># 伏笔　# 离别</div><div class="index-foot">'+str(total)+' 条灵感<br>按标签并置片段</div></aside>'
columns=''
for t in ['场景','人物','对白']:
 rows=[n for n in N if t in n['tags']]
 columns+='<section class="board-column"><div class="lane-head"><div><h2>'+t+'</h2><small>'+str(len(rows))+' 条</small></div>'+icon('plus')+'</div>'+''.join(card(n,n['id']=='i01',i>0) for i,n in enumerate(rows))+'<div class="add-card">'+icon('plus')+'记录'+t+'灵感</div></section>'
board='<div class="board-space"><div class="board-toolbar"><div class="left"><span class="scope-label">'+icon('tag')+'按标签分组</span><span class="quiet">/</span><span>场景 · 人物 · 对白</span></div><div class="right"><div class="view-controls"><span class="active">拼板</span><span>紧凑</span></div><span>'+icon('expand')+'</span></div></div><div class="board-columns scroller">'+columns+'</div></div>'
write('b-pinboard.html','叙事拼板','b-board.css',heading('叙事拼板')+'<main class="board-shell">'+index+board+'</main>')

# C: compact catalogue and a full-height manuscript inspector.
filters='<aside class="index-filters glass"><h2>灵感索引</h2>'+nav('全部灵感',total,'tray',True)+nav('未标记',unmarked,'tag')+'<div class="nav-heading">标签</div>'+''.join(nav(t,tag_counts[t]) for t in ['场景','人物','对白','雾港','来信','离别'])+'<div class="nav-heading">关联情况</div>'+nav('有关联',linked,'link')+nav('暂无关联',total-linked,'note')+'<div class="lower">搜索正文或标签，<br>也可按关联范围缩小结果。</div></aside>'
rows=''
for i,n in enumerate(N):
 rows+='<tr class="'+('picked' if i==0 else '')+'"><td><input aria-label="选择'+escape(n['title'])+'" type="checkbox" '+('checked' if i==0 else '')+'></td><td><span class="title">'+escape(n['title'])+'</span>'+(tags(n) if n['tags'] else '<span class="none">未标记</span>')+'</td><td class="refs '+('missing' if not n['links'] else '')+'">'+(str(len(n['links'])) if n['links'] else '—')+'</td><td class="table-date">'+n['date'][5:].replace('-','.')+'<br><span class="quiet">'+n['time']+'</span></td></tr>'
catalogue='<section class="catalogue glass"><div class="catalogue-header"><div><h2>全部灵感<small class="num">'+str(total)+' 条</small></h2></div><span class="sort">创建时间 '+icon('sort')+'</span></div><div class="table-body scroller"><table class="index-table"><thead><tr><th></th><th>片段 / 标签</th><th>关联</th><th>创建时间</th></tr></thead><tbody>'+rows+'</tbody></table></div><div class="bulk"><span>已选 1 条</span><span>添加标签</span><span>移入回收站</span><span>取消选择</span></div></section>'
n=N[0]
reader='<aside class="reader glass"><div class="reader-top"><span>灵感详情</span><div class="reader-actions">'+icon('expand')+icon('more')+'</div></div><div class="reader-content scroller"><h2>'+n['title']+'</h2>'+tags(n)+'<div class="read-body">'+escape(n['body'])+'</div><div class="section-title">已有关联 <span>2 处</span></div>'+''.join(ref(r) for r in n['links'])+'<div class="reader-meta">创建于 <time class="num">2026.11.07 09:42</time><br>所属作品　雾港纪年</div></div><div class="reader-bottom"><span>保留原灵感</span><div style="display:flex;gap:7px"><button class="soft">'+icon('book')+'转为章节</button><button class="soft">'+icon('note')+'转为设定</button></div></div></aside>'
write('c-index.html','线索索引','c-index.css',heading('线索索引','index')+'<main class="index-workspace">'+filters+catalogue+reader+'</main>')
assert total==12 and unmarked==2 and linked==3
print('Built three independent first screens; 12 shared notes, 2 untagged, 3 linked.')
