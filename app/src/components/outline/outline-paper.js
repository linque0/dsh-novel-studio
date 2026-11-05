/* 纸面素材（设计稿 outline-workbench-preview）：纹理只用于界面，不提供原图下载。
 * 图片来自 docs/outline-canvas-preview/assets，已压缩为 900×600 WebP 后随应用打包。 */

import eventPaper from '../../assets/outline-paper/event.webp'
import eventDiamondPaper from '../../assets/outline-paper/event-diamond.webp'
import eventParaPaper from '../../assets/outline-paper/event-para.webp'
import eventEllipsePaper from '../../assets/outline-paper/event-ellipse.webp'
import notePaper from '../../assets/outline-paper/note.webp'
import citePaper from '../../assets/outline-paper/cite.webp'
import anchorPaper from '../../assets/outline-paper/anchor.webp'
import volumePaper from '../../assets/outline-paper/volume.webp'

/* 事件四形态：尺寸与设计稿对齐；path 用于素材库小样，clip 用于正式卡片的纸面裁切。 */
export const EVENT_SHAPES = {
  process: {
    label: '矩形',
    material: '冷白棉纸 · 压印细边',
    image: eventPaper,
    tone: '#f5f7f6',
    edge: '#b8c9cb',
    w: 224,
    h: 154,
    path: 'M4 1H96Q99 1 99 4V96Q99 99 96 99H4Q1 99 1 96V4Q1 1 4 1Z',
    clip: 'inset(0 round 8px)'
  },
  diamond: {
    label: '菱形',
    material: '象牙压纹纸 · 精切斜边',
    image: eventDiamondPaper,
    tone: '#f6f1e4',
    edge: '#c8ba99',
    w: 250,
    h: 210,
    path: 'M50 1L99 50L50 99L1 50Z',
    clip: 'polygon(50% 1.6%, 98.4% 50%, 50% 98.4%, 1.6% 50%)'
  },
  para: {
    label: '平行四边形',
    material: '灰蓝纤维纸 · 平行压线',
    image: eventParaPaper,
    tone: '#edf3f5',
    edge: '#aebfc9',
    w: 254,
    h: 170,
    path: 'M12 1H99L88 99H1Z',
    clip: 'polygon(12% 1.6%, 98.4% 1.6%, 88% 98.4%, 1.6% 98.4%)'
  },
  ellipse: {
    label: '椭圆',
    material: '浅青柔纹纸 · 环形压边',
    image: eventEllipsePaper,
    tone: '#edf2e9',
    edge: '#b3c2aa',
    w: 210,
    h: 118,
    path: 'M99 50A49 49 0 1 1 1 50A49 49 0 1 1 99 50Z',
    clip: 'ellipse(49% 49% at 50% 50%)'
  }
}

/* 五类纸面内容卡；容器与文本框按设计稿保持无纹理。 */
export const PAPER_KINDS = {
  note: { label: '便签', material: '浅麦纸纹 · 轻盈折角', image: notePaper },
  cite: { label: '引用卡', material: '叠页书纸 · 压印引号', image: citePaper },
  anchor: { label: '章节锚点', material: '象牙帘纹 · 布面书签', image: anchorPaper },
  volume: { label: '卷', material: '深松布纹 · 黄铜细线', image: volumePaper }
}

export const STATUS = {
  done: '已完成',
  writing: '正在写',
  revise: '待修改',
  planned: '待展开'
}

export const STATUS_COLORS = {
  done: '#78977b',
  writing: '#b29a65',
  revise: '#b58f86',
  planned: '#b8bfa9'
}

export const CONTAINER_COLORS = [
  ['#6e8c79', '苔绿'],
  ['#a08455', '麦金'],
  ['#758b9b', '雾蓝'],
  ['#8d8196', '灰紫'],
  ['#a97868', '陶红'],
  ['#748b80', '石绿']
]

/** 事件纸面 CSS 变量；形状裁切与色调由 CSS 继续叠加。 */
export function paperStyle(shape) {
  const item = EVENT_SHAPES[shape] || EVENT_SHAPES.process
  return {
    '--paper-image': `url(${item.image})`,
    '--paper-tone': item.tone,
    '--paper-edge': item.edge,
    '--paper-clip': item.clip
  }
}

export function kindPaperStyle(kind) {
  const item = PAPER_KINDS[kind]
  if (!item) return null
  return { '--paper-image': `url(${item.image})` }
}
