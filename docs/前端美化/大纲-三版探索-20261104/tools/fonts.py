"""从项目已有思源宋体生成展示稿文字子集；不引入新的字体来源。"""
from pathlib import Path
import re
from fontTools.ttLib import TTFont
from fontTools import subset

out = Path(__file__).resolve().parent.parent
root = out.parents[2]
source = root / 'app/src/assets/fonts'
pages = list(out.glob('[abc]-*.html'))
chars = set(ord(c) for p in pages for c in p.read_text(encoding='utf-8'))
rules = []
font_dir = out / 'assets/fonts'
font_dir.mkdir(exist_ok=True)
covered = set()
for block in re.findall(r'@font-face\s*\{[^}]+\}', (source / 'fonts.css').read_text(encoding='utf-8')):
    if "font-family: 'Noto Serif SC'" not in block:
        continue
    weight = re.search(r'font-weight:\s*(\d+)', block).group(1)
    if weight not in ('400', '500'):
        continue
    name = re.search(r'url\(\./files/([^\)]+)\)', block).group(1)
    font = TTFont(source / 'files' / name)
    needed = set(font.getBestCmap()) & chars
    # 400 仅提供 500 中文分片里没有的拉丁与标点。
    if weight == '400' and not name.endswith(('Wbg.woff2', 'bghq.woff2')):
        continue
    if not needed:
        font.close()
        continue
    opts = subset.Options()
    opts.flavor = 'woff2'
    sub = subset.Subsetter(options=opts)
    sub.populate(unicodes=needed)
    sub.subset(font)
    target = f'noto-{len(rules):02d}.woff2'
    font.save(font_dir / target)
    font.close()
    covered |= needed
    unicodes = ','.join(f'U+{c:X}' for c in sorted(needed))
    rules.append("@font-face{font-family:'Noto Serif SC';font-style:normal;font-weight:400 700;font-display:swap;src:url('./assets/fonts/" + target + "') format('woff2');unicode-range:" + unicodes + ';}')
css = '\n'.join(rules)
for page in pages:
    html = page.read_text(encoding='utf-8')
    # build.mjs 每次先重建占位符，确保可重复生成。
    assert '/*FONT_CSS*/' in html, 'Run build.mjs before fonts.py'
    page.write_text(html.replace('/*FONT_CSS*/', css), encoding='utf-8')
chinese = {c for c in chars if 0x4E00 <= c <= 0x9FFF}
missing = chinese - covered
assert not missing, f'Missing Chinese glyphs: {"".join(map(chr, missing))}'
print(f'Embedded font rules: {len(rules)}; Chinese glyphs: {len(chinese)}; missing: {len(missing)}')
