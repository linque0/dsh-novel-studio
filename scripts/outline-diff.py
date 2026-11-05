"""截图测量与叠加检查，不更改设计稿或正式界面。"""
from pathlib import Path
import sys,json
from PIL import Image, ImageChops, ImageEnhance
out=Path(sys.argv[1]);shots=out/'screenshots'
a=Image.open(shots/'01-reference-b.png').convert('RGB');b=Image.open(shots/'02-actual-b-chrome.png').convert('RGB')
Image.blend(a,b,.5).save(shots/'05-overlay.png')
ImageEnhance.Contrast(ImageChops.difference(a,b)).enhance(3).save(shots/'06-difference.png')
sheet=Image.new('RGB',(2880,900),'#16151b');sheet.paste(a,(0,0));sheet.paste(b,(1440,0));sheet.save(shots/'07-side-by-side.png')
report=json.loads((out/'comparison-report.json').read_text(encoding='utf-8'))
for name,box in [('topbar',(0,0,1440,84)),('sidebar',(28,108,248,870)),('detail',(1094,108,1412,870)),('heading',(264,108,1078,212))]:
    pair=Image.new('RGB',((box[2]-box[0])*2,box[3]-box[1]),'#16151b');pair.paste(a.crop(box),(0,0));pair.paste(b.crop(box),(box[2]-box[0],0));pair.save(shots/f'compare-{name}.png')
def card_box(r):return tuple(round(v) for v in (r['x']-12,r['y']-12,r['x']+r['width']+12,r['y']+r['height']+12))
cards=[a.crop(card_box(report['referenceCard'])),b.crop(card_box(report['actualCard']))]
pair=Image.new('RGB',(sum(c.width for c in cards)+12,max(c.height for c in cards)),'#30283d');pair.paste(cards[0],(0,0));pair.paste(cards[1],(cards[0].width+12,0));pair.save(shots/'compare-card.png')
choices=[('07-side-by-side','并排对照'),('05-overlay','50% 叠加'),('06-difference','差异图'),('02-actual-b-chrome','正式界面'),('08-container-readable','容器 · 阅读'),('03-container-overview','容器 · 总览'),('04-a-collapse','侧栏收起'),('compare-topbar','顶栏局部'),('compare-sidebar','结构局部'),('compare-heading','标题局部'),('compare-card','纸卡局部'),('compare-detail','详情局部'),('verified-outline-1280','1280px'),('verified-outline-760-canvas','760px'),('verified-outline-380-canvas','380px'),('verified-panel-outline-1440','独立窗口')]
buttons=''.join(f'<button type="button" data-name="{name}">{label}</button>' for name,label in choices)
(out/'index.html').write_text('''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>大纲 · 设计对照</title><style>*{box-sizing:border-box}body{margin:0;padding:24px;background:#17151f;color:#f5effa;font:14px/1.8 "Microsoft YaHei",sans-serif}h1{font-size:23px;margin:0 0 8px}p{color:#cbbdd8}nav{display:flex;flex-wrap:wrap;gap:8px;margin:20px 0}button,a{color:inherit;background:#30283d;border:1px solid #65546e;border-radius:8px;padding:6px 12px;cursor:pointer;text-decoration:none;font:inherit}button[aria-pressed=true]{background:#eee6f5;color:#27202f}img{width:100%;height:auto;display:block;border-radius:10px}#main{overflow:auto}#main.native img{width:auto;max-width:none}small{color:#bdafc9}.hint{max-width:1000px}h2{font-size:15px}</style><h1>大纲 · B 稿与正式界面对照</h1><p class="hint">1440 × 900，同一作品内容、选中事件与背景静帧。正式界面使用真实组件与数据接口；容器、统计和面包屑按实际层级显示。并排图左为原稿，右为正式界面。</p><nav>''' + buttons + '''<button type="button" id="native">原尺寸 / 适应</button></nav><h2 id="caption">并排对照</h2><div id="main"><img id="shot" alt="B 设计稿与正式界面的对照截图" src="screenshots/07-side-by-side.png"></div><p class="hint"><small>固定三栏位置、字体、顶栏和详情纵向节奏见 comparison-report.json。底部创建栏向左移 17.5px 以消除原稿与缩放栏的交叠；跨层提示单独占行，画布留出底部工具安全区。总览供全书定位，100% 或进入容器可恢复阅读。测试环境、剩余差异与验收记录见 README.md。</small></p><script>document.querySelectorAll('[data-name]').forEach(b=>b.onclick=()=>{document.querySelector('#shot').src='screenshots/'+b.dataset.name+'.png';document.querySelector('#caption').textContent=b.textContent;document.querySelectorAll('[data-name]').forEach(e=>e.setAttribute('aria-pressed',String(e===b)))});document.querySelector('#native').onclick=()=>document.querySelector('#main').classList.toggle('native')</script></html>''',encoding='utf-8')
print('Saved comparisons and native-size gallery.')
