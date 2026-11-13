/* 设置页的分类与检索目录：分类三项照总稿 app.mjs:14，条目十二项照 model.mjs:4-17。
   唯一改写的是 import / export 两项的 desc 与 terms——总稿写的是「TXT 或 Markdown」，
   而工坊真实能力是导入 TXT/Markdown/DOCX/PDF/EPUB/图片、按作品与章节导出 TXT/Markdown/Word
   （app/src/services/importers.js:317-348 的 DOC_EXTS / IMAGE_EXTS，exporter.js 的 txt/md/docx），
   页内说明必须按真实能力写，否则用户会以为 docx 不能导入。 */

export const SETTINGS_PAGES = [
  { key: 'appearance', title: '外观与排版', desc: '字体、字号与写作空间', icon: 'type', sub: '让文字呈现为你习惯的样子' },
  { key: 'data', title: '备份与数据', desc: '导入导出、备份与回收站', icon: 'storage', sub: '整理作品，备份每一次创作' },
  { key: 'about', title: '帮助与关于', desc: '常用操作、手册与版本', icon: 'book', sub: '了解工坊，也找到顺手的用法' }
]

export const SETTINGS_PAGE_KEYS = ['appearance', 'data', 'about']

export const SETTINGS_CATALOG = [
  { id: 'editorFont', page: 'appearance', title: '中文正文字体', desc: '选择正文中的中文字形', terms: '思源宋体 文楷 京华老宋 朝华 云游 黑体 字体 font' },
  { id: 'editorLatin', page: 'appearance', title: '西文字体', desc: '英文与数字的字形搭配', terms: '英文 拉丁 Playfair Gothic 字体' },
  { id: 'fontSize', page: 'appearance', title: '正文字号', desc: '在13–24px之间调整阅读与编辑字号', terms: '大小 排版 字号 缩放' },
  { id: 'topbarAutoHide', page: 'appearance', title: '默认隐藏顶栏', desc: '移至顶部展开，让写作空间更安静', terms: '自动收起 导航 沉浸 界面' },
  { id: 'storageLocation', page: 'data', title: '作品数据存储位置', desc: '把作品库搬到别的文件夹', terms: '路径 目录 移动 迁移 存储位置 数据目录 磁盘 library 备份盘' },
  { id: 'backup', page: 'data', title: '备份全部数据', desc: '下载作品、章节、人物与设定的完整快照', terms: 'JSON 安全 导出' },
  { id: 'restore', page: 'data', title: '恢复备份', desc: '检查备份内容后，替换当前工作区', terms: 'JSON 覆盖 导入' },
  { id: 'import', page: 'data', title: '导入文本作品', desc: '从 TXT、Markdown、Word、PDF、EPUB 或图片导入正文', terms: 'TXT MD DOCX Word PDF EPUB 图片 png jpg 文本 迁入' },
  { id: 'export', page: 'data', title: '导出正文', desc: '按作品与章节导出 TXT、Markdown 或 Word', terms: 'TXT MD Word 章节 作品 下载' },
  { id: 'trash', page: 'data', title: '回收站', desc: '找回删除的条目，或彻底移除', terms: '恢复 删除 还原 清理' },
  { id: 'help', page: 'about', title: '帮助与快捷键', desc: '了解常用操作与键盘入口', terms: '手册 使用 操作 Escape Tab Ctrl S' },
  { id: 'stats', page: 'about', title: '写作概览', desc: '查看作品、章节与正文的规模', terms: '统计 字数 数据' },
  { id: 'version', page: 'about', title: '关于小说工坊', desc: '版本与本地优先的创作方式', terms: '版本 关于 LATENT DSH' }
]

/* 检索口径同总稿 model.mjs:18：trim + 小写，命中 title/desc/terms 任一段即算；空查询不返回全表。 */
export function searchSettings(query) {
  const q = String(query || '').trim().toLocaleLowerCase()
  if (!q) return []
  return SETTINGS_CATALOG.filter((item) => [item.title, item.desc, item.terms].join(' ').toLocaleLowerCase().includes(q))
}
