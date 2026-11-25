/**
 * 小说工坊使用手册结构化数据源（零 DOM 依赖）：
 * - 按 4 大分组组织全部已上线功能，服务于 HelpManual.vue 双栏阅读与关键词检索；
 * - 文案遵循「说人话、动词开头、卡片标题 ≤ 8 字、说明 ≤ 35 字」规范。
 */

export const MANUAL_GROUPS = [
  {
    id: 'start',
    label: '快速上手',
    sections: [
      { id: 'overview', title: '工作台全景', short: '全景', icon: 'compass' },
      { id: 'quickstart', title: '三步开写', short: '开写', icon: 'steps' }
    ]
  },
  {
    id: 'core',
    label: '核心创作模块',
    sections: [
      { id: 'writing', title: '文 · 正文写作', short: '正文', icon: 'manuscript' },
      { id: 'outline', title: '纲 · 故事大纲', short: '大纲', icon: 'network' },
      { id: 'characters', title: '人 · 人物档案', short: '人物', icon: 'users' },
      { id: 'lore', title: '设 · 世界观设定', short: '设定', icon: 'layers' },
      { id: 'snippets', title: '灵 · 灵感拼板', short: '灵感', icon: 'sparkle' },
      { id: 'stats', title: '析 · 写作分析', short: '分析', icon: 'stats' }
    ]
  },
  {
    id: 'advanced',
    label: '进阶与拓展功能',
    sections: [
      { id: 'galaxy', title: '关系星系与导图', short: '星系', icon: 'orbit' },
      { id: 'relations', title: '跨模块双向关联', short: '关联', icon: 'link' },
      { id: 'power', title: '效率与生态拓展', short: '拓展', icon: 'sliders' }
    ]
  },
  {
    id: 'system',
    label: '数据安全与系统',
    sections: [
      { id: 'safety', title: '本地优先保障', short: '安全', icon: 'shield' },
      { id: 'backup', title: '备份、迁移与版本', short: '备份', icon: 'archive' }
    ]
  }
]

export const MANUAL_SECTIONS = {
  overview: {
    id: 'overview',
    groupId: 'start',
    groupLabel: '快速上手',
    icon: 'compass',
    title: '工作台全景',
    subtitle: '本地优先的长篇小说桌面创作空间（幻流工作台），输入即自动保存，把灵感、大纲、人物、设定与正文收在同一处。',
    keywords: '工作台 幻流 书架 顶栏 导航 创作链路 概览 全景 拆窗',
    pipeline: [
      { badge: '灵', name: '灵感拼板', role: '记下零碎念头', target: 'snippets' },
      { badge: '纲', name: '故事大纲', role: '搭好主线脉络', target: 'outline' },
      { badge: '人', name: '人物档案', role: '塑造角色关系', target: 'characters' },
      { badge: '设', name: '世界观设定', role: '构建世界规则', target: 'lore' },
      { badge: '文', name: '正文写作', role: '沉浸落笔成章', target: 'writing' },
      { badge: '析', name: '写作分析', role: '复盘码字节奏', target: 'stats' }
    ],
    cards: [
      {
        title: '3D 书封书架',
        desc: '按连载、完结、构思或搁置筛选书目，卡片直显字数与上次停靠章节。',
        tags: ['书架', '← / → 切书']
      },
      {
        title: '顶部胶囊导航',
        desc: '居中胶囊一键在书架、正文、大纲、设定、人物与灵感间顺滑切换。',
        tags: ['统一顶栏', '可隐藏']
      },
      {
        title: '弹性侧栏视野',
        desc: '拖拽边栏边缘自由调宽或折叠为窄边标签，双击分隔手柄恢复默认宽幅。',
        tags: ['双击复位', '沉浸视野']
      },
      {
        title: '独立拆窗对照',
        desc: '将正文、大纲、人物、设定或分析拆成独立窗口并排查看，边查边写。',
        tags: ['多窗协作', '实体锁']
      }
    ],
    callout: {
      badge: '技巧',
      title: '顶栏右簇常驻快捷入口',
      items: [
        '实时显示保存状态，随时点击进入全局搜索、写作速览、设置或锁定顶栏。',
        '在「设置 → 外观与排版」开启「默认隐藏顶栏」，把全部屏幕留给文字。'
      ],
      keys: ['Ctrl + Shift + F', 'Esc']
    }
  },

  quickstart: {
    id: 'quickstart',
    groupId: 'start',
    groupLabel: '快速上手',
    icon: 'steps',
    title: '三步开写',
    subtitle: '无需复杂配置，三分钟搭建好一部长篇的专属工作台。',
    keywords: '新手 入门 新建 切换 书目 导入 开写 三步 流程',
    steps: [
      {
        num: '01',
        title: '新建或切换书目',
        desc: '在书架点「＋」新建作品，或在「设置 → 备份与数据」导入已有书稿。',
        chips: ['TXT', 'MD', 'DOCX', 'PDF', 'EPUB']
      },
      {
        num: '02',
        title: '梳理大纲与设定',
        desc: '先用大纲画布或幕布定下章节走向，再补齐核心人物档案与世界观条目。',
        chips: ['大纲画布', '人物卷宗', '设定节点']
      },
      {
        num: '03',
        title: '专注正文创作',
        desc: '进入正文三栏写稿台直接开写，折叠侧栏沉浸码字，所有修改即时落盘。',
        chips: ['输入即存', '阅读模式', '历史快照']
      }
    ],
    callout: {
      badge: '技巧',
      title: '已有旧稿也能快速迁入',
      items: [
        '导入 TXT 时自动识别 UTF-8 / GBK 编码并按「第 X 章」智能拆分分卷与章节。',
        '所有导入均在落库前提供分章预览，确认结构无误后再写入书库。'
      ],
      keys: ['← / → 选书', 'Enter 打开']
    }
  },

  writing: {
    id: 'writing',
    groupId: 'core',
    groupLabel: '核心创作模块',
    icon: 'manuscript',
    title: '文 · 正文写作',
    subtitle: '三栏沉浸写稿，结构清晰且输入即存。',
    keywords: '正文 写作 章节 分卷 编辑器 富文本 批注 插图 阅读模式 快照 回滚 字数目标',
    cards: [
      {
        title: '分卷分章目录',
        desc: '按卷与章管理全书目录，支持关键词搜章、星标收藏与拖拽调序。',
        tags: ['拖拽排序', '★ 书签']
      },
      {
        title: '沉浸富文本稿面',
        desc: '支持标题、加粗、对齐、字色与高亮排版，顶部实时追踪章节目标字数。',
        tags: ['选中右键', '字数进度']
      },
      {
        title: '随章五项资料栏',
        desc: '右栏自动同步本章批注、本章大纲、出场人物识别、本章插图与字数信息。',
        tags: ['彩色批注', '贴图上传']
      },
      {
        title: '自动存盘与快照',
        desc: '停笔即自动保存，每 5 分钟留存历史快照，随时可预览并一键回滚。',
        tags: ['最多 30 份', '一键回滚']
      }
    ],
    callout: {
      badge: '技巧',
      title: '专注视角与彩色批注玩法',
      items: [
        '折叠左右栏即可让稿纸居中展开；点顶部「阅读」切入限宽只读模式，按 Esc 逐级退出。',
        '选中正文右键可加用途色批注（待改 / 疑问 / 伏笔 / 灵感 / 考据）或 [[关系链接]]，同句叠加互不遮挡。'
      ],
      keys: ['Ctrl + S', 'Ctrl + B', 'Ctrl + Z / Y', '选中右键']
    }
  },

  outline: {
    id: 'outline',
    groupId: 'core',
    groupLabel: '核心创作模块',
    icon: 'network',
    title: '纲 · 故事大纲',
    subtitle: '画布与文本双视图联动，理顺长篇脉络。',
    keywords: '大纲 画布 文本 幕布 事件 便签 容器 语义连线 连接点 曲线塑形 绕障 故事结构',
    cards: [
      {
        title: '画布与文本互切',
        desc: '右上角无损切换自由画布与缩进幕布，两套视图共享同一份剧情数据。',
        tags: ['数据同源', 'MD / TXT 导入']
      },
      {
        title: '多样情节模块',
        desc: '自由摆放事件、便签、引用、文本框、锚点、分卷与容器，双击空白速建。',
        tags: ['4 种形状', '4 种状态']
      },
      {
        title: '语义连线自动绕障',
        desc: '拖线区分关联、因果、伏笔与冲突，挪动卡片自动避障且两端接口不漂移。',
        tags: ['右键编辑', '曲线塑形']
      },
      {
        title: '全书结构侧栏',
        desc: '左侧树形目录同步显示全部层级，点击即可自动跨层居中定位节点。',
        tags: ['跨层跳转', '侧栏可收']
      }
    ],
    callout: {
      badge: '拓展',
      title: '分层容器、连接点与画布整理',
      items: [
        '拖入模块即归属容器，可「就地展开」查看两列迷你卡，或「进入容器」下钻独立子画布。',
        '拖线落到已有连线上可建中途连接点分出多支；按住连线拖动可自由弯曲线路，双击恢复自动路由。',
        '多选同层节点可一键封装为容器；📌 固定关键模块后执行「整理布局」不会移动它。'
      ],
      keys: ['Ctrl + K 速搜', '方向键微移', 'Shift + 方向键', '右键连线']
    }
  },

  characters: {
    id: 'characters',
    groupId: 'core',
    groupLabel: '核心创作模块',
    icon: 'users',
    title: '人 · 人物档案',
    subtitle: '从卷宗细节到关系剧场，一眼看清人物网。',
    keywords: '人物 角色 卷宗 小传 头像 定位 关系剧场 关系图 拖线 孤岛人物 故事坐标',
    cards: [
      {
        title: '多维检索名录',
        desc: '按姓名、别名或标签实时搜索，支持角色定位与标签组合筛选。',
        tags: ['快速筛选', '双条件过滤']
      },
      {
        title: '立体角色卷宗',
        desc: '上传头像、勾选多角色定位、撰写多篇独立小传，并自由增删自定义字段。',
        tags: ['多篇小传', '自定义字段']
      },
      {
        title: '故事坐标速览',
        desc: '右栏集中呈现当前角色的一度关系与关联设定，点一下直达关系剧场。',
        tags: ['一度关系', '关联设定']
      },
      {
        title: '关系剧场拖线',
        desc: '拖线连接两位角色新建关系，拖向已有连线即可原地修改或删除。',
        tags: ['圆形/网格排布', '实时同步']
      }
    ],
    callout: {
      badge: '拓展',
      title: '剧场聚焦与跨模块联动',
      items: [
        '关系剧场支持切换「一度关系 / 全部人物」并高亮孤岛人物，双击节点直达卷宗详情。',
        '右键人物节点可直接发送为大纲引用卡；小传内右键支持插入 [[关系链接]] 串联设定与章节。'
      ],
      keys: ['拖线建改关系', '双击开卷宗', '右键发大纲', 'Delete 移回收站']
    }
  },

  lore: {
    id: 'lore',
    groupId: 'core',
    groupLabel: '核心创作模块',
    icon: 'layers',
    title: '设 · 世界观设定',
    subtitle: '一棵统一节点树，三种视图掌控世界观。',
    keywords: '设定 世界观 节点大纲 三栏阅读 视觉导图 层级导图 关系星系 权重 幕布 导入',
    viewModes: [
      {
        name: '节点大纲',
        badge: '录入与整理',
        scene: '适合成批搭建世界观与快速改稿',
        desc: '无限嵌套幕布树，键盘秒级缩进升降、自由拖拽调整层级，支持行内富文本、贴图与撤销重做。',
        chips: ['Tab / Shift+Tab', 'MD / TXT 导入']
      },
      {
        name: '三栏阅读',
        badge: '查阅与复盘',
        scene: '适合边写边查、核对细则与逐级下钻',
        desc: '左目录、中同级卡片（带标签筛选）、右详读卡并列呈现，直观查阅关联列表与编号子条目。',
        chips: ['标签筛选', '子条目下钻']
      },
      {
        name: '视觉导图',
        badge: '全景与推演',
        scene: '适合理清宏观脉络与推演复杂关联',
        desc: '内置「层级导图」展开树状分支与「关系星系」3D 轨道鸟瞰，直观呈现全书设定与跨模块连接。',
        chips: ['层级导图', '3D 关系星系']
      }
    ],
    cards: [
      {
        title: '条目权重分级',
        desc: '为条目或标签标记核心、关键、标准、点缀、末节五档权重，主次一目了然。',
        tags: ['五级权重', '标签继承']
      },
      {
        title: '行内富文本与插图',
        desc: '支持文字配色、高亮与图片嵌入，可一键切换图片显隐保持版面清爽。',
        tags: ['右键菜单', '图片显隐']
      }
    ],
    callout: {
      badge: '拓展',
      title: '深入探索关系星系与双向关联',
      items: [
        '右键条目选择「设置关系…」可建立设定间或设定与人物的双向关系，双击条目进入专属详情页。',
        '更多 3D 星系键鼠操作与连线图例，请前往「进阶与拓展功能」查看。'
      ],
      keys: ['双击进详情', '右键设关系', 'Alt + ← / → 历史'],
      jumpLinks: [
        { label: '查看关系星系操作表 →', target: 'galaxy' },
        { label: '查看双向关联说明 →', target: 'relations' }
      ]
    }
  },

  snippets: {
    id: 'snippets',
    groupId: 'core',
    groupLabel: '核心创作模块',
    icon: 'sparkle',
    title: '灵 · 灵感拼板',
    subtitle: '按标签分栏收纳灵光，一键落入正式稿件。',
    keywords: '灵感 拼板 标签 泳道 图钉 拖拽 配色 卡片大小 参考图 网址 转为章节 转为设定 回收站',
    cards: [
      {
        title: '按标签分栏收纳',
        desc: '按标签自动分栏排布灵感，支持贴入参考图、收藏网址与 6 种柔和配色。',
        tags: ['参考图片', '6 种配色']
      },
      {
        title: '图钉拖拽理顺',
        desc: '拖住卡片顶部图钉即可调整组内顺序，或跨栏拖进其他标签组重新归类。',
        tags: ['拖拽排序', '跨栏归类']
      },
      {
        title: '自由调节看板',
        desc: '左下角切换排序与连续缩放卡片大小，误删卡片可随时在回收站找回。',
        tags: ['卡片缩放', '独立回收站']
      },
      {
        title: '一键转入正文设定',
        desc: '在右侧整理抽屉点击「转为章节」或「转为设定」，原灵感卡片保留方便回溯。',
        tags: ['转为章节', '转为设定']
      }
    ],
    callout: {
      badge: '技巧',
      title: '宽幅编辑与关联回溯',
      items: [
        '点选卡片后可在右侧抽屉或打开宽幅编辑窗精修，支持关联正文、人物或设定条目。',
        '拼板操作与整理动作均支持撤销与重做，拖错位置也能一键恢复。'
      ],
      keys: ['图钉拖拽', 'Ctrl + S 保存草稿', '宽幅编辑']
    }
  },

  stats: {
    id: 'stats',
    groupId: 'core',
    groupLabel: '核心创作模块',
    icon: 'stats',
    title: '析 · 写作分析',
    subtitle: '离线统计码字节奏与全书规模，随时复盘。',
    keywords: '写作分析 统计 速览 柱状图 曲线 日历 活跃 作品对照 章节结构 改稿轨迹 热力矩阵',
    cards: [
      {
        title: '随手看写作速览',
        desc: '点顶栏统计图标即看当前正文字数、章节数、今日净增与近 7 日柱状图。',
        tags: ['书架/作品通用', '点柱看明细']
      },
      {
        title: '创作历程与对照',
        desc: '检视区间累计净增曲线与活跃日历，或同屏对比两部作品的码字走势。',
        tags: ['拖选日期区间', '双作品对照']
      },
      {
        title: '章节与改稿轨迹',
        desc: '查看分卷字数分布与完成度，沿章节×日期矩阵回看每章的改稿净差。',
        tags: ['章节结构', '改稿热力图']
      },
      {
        title: '全模块资产盘点',
        desc: '按大纲、设定、人物与灵感分项统计规模，点击图表直接联动右侧详情。',
        tags: ['纯离线计算', '点击联动']
      }
    ],
    callout: {
      badge: '技巧',
      title: '独立分析窗与逐日台账',
      items: [
        '在速览浮窗点击「查看完整分析」，可在独立窗口中展开完整数据面板并查阅逐日数值表。',
        '所有指标全部基于本机保存记录离线生成，不上传任何稿件数据。'
      ],
      keys: ['顶栏 📊', '拖选时间段', '独立窗口']
    }
  },

  galaxy: {
    id: 'galaxy',
    groupId: 'advanced',
    groupLabel: '进阶与拓展功能',
    icon: 'orbit',
    title: '关系星系与 3D 导图交互',
    subtitle: '把庞大世界观化作可操控的 3D 同心轨道星系与树状层级导图。',
    keywords: '关系星系 3D 导图 轨道 并轨 公转 自转 发光 卡尺 旋转 平移 缩放 图层 层级导图 肘形 贝塞尔',
    interactions: [
      {
        category: '星系视角操控',
        rows: [
          { keys: ['左键拖拽空白'], action: '旋转 3D 星系视角', note: '松手带惯性平滑滑行，也可按方向键微调角度' },
          { keys: ['中键拖拽', 'Shift + 左键'], action: '平移画布视野', note: '自由移动星系中心在画面中的位置' },
          { keys: ['滚轮', '双指捏合'], action: '缩放视野远近', note: '拉近自动呈现低权重细节条目（LOD 渐显）' },
          { keys: ['Esc'], action: '逐级退回 / 取消', note: '依次关闭菜单、清除选中，再按返回上一级星域' }
        ]
      },
      {
        category: '星体、轨道与参数调节',
        rows: [
          { keys: ['单击星域 / 条目'], action: '下钻星域或查摘要', note: '点设定集飞入其内部星域；点条目在右栏看摘要与关联' },
          { keys: ['拖动边缘卡尺'], action: '调节星体与条目大小', note: '悬停星体或条目圆边缘出现缩放手势，拖拉即生效并记忆' },
          { keys: ['拖拽星域', '轨道编辑'], action: '调整轨道与并轨', note: '拖改轨道半径与角度；靠近另一条轨道松手自动并轨' },
          { keys: ['右键星体'], action: '调节公转 / 自转与大小', note: '可单独设定公转速度、自转速度百分比，或一键恢复默认' },
          { keys: ['右键中心星体', 'Shift + F10'], action: '定制中心发光样式', note: '切换经典 / 跟随封面 / 自定义配色、光影动效、亮度与速度' }
        ]
      }
    ],
    cards: [
      {
        title: '图层筛选与独显',
        desc: '点击底部图例开关四类星图图层，鼠标悬停可临时独显单类关系。',
        tags: ['点击显隐', '悬停独显']
      },
      {
        title: '布局与运转控制',
        desc: '底部「布局」调节轨道间距并可随时复位；点击「暂停运转」一键定格画面。',
        tags: ['轨道间距', '暂停运转']
      },
      {
        title: '层级树状导图',
        desc: '切换单双向分支与连线样式，支持按层折叠、双击编辑与拖拽重挂接。',
        tags: ['层级导图', '拖拽重挂']
      },
      {
        title: '跨模块卫星直达',
        desc: '关联的人物、大纲、章节与灵感以卫星环绕呈现，双击直跳目标模块。',
        tags: ['双击跳转', '跨模块']
      }
    ]
  },

  relations: {
    id: 'relations',
    groupId: 'advanced',
    groupLabel: '进阶与拓展功能',
    icon: 'link',
    title: '跨模块双向关联与下钻',
    subtitle: '用条目关系、视觉连线与 [[关系链接]] 把整部作品织成一张活网。',
    keywords: '双向关联 关系 设定 人物 织网 虚线 实线 跨集 详情页 双击 下钻 双链 预览窗 钉住',
    lineLegends: [
      {
        style: 'dashed',
        title: '条目织网（虚线）',
        desc: '呈现同一设定集内部的层级结构与条目脉络。'
      },
      {
        style: 'solid-intra',
        title: '集内关系（实线）',
        desc: '同设定集内手动建立的语义关联，点击可看双向说明。'
      },
      {
        style: 'solid-cross',
        title: '跨集关系（实线）',
        desc: '跨越不同设定集的高阶联系，总览星系中一眼可见。'
      }
    ],
    cards: [
      {
        title: '双向关系建立',
        desc: '右键条目点「设置关系…」，填写正反向关系名后两端自动同步展示。',
        tags: ['设定 ↔ 设定', '设定 ↔ 人物']
      },
      {
        title: '双击进入详情页',
        desc: '双击设定条目打开专属详情页，集中查看正文、关系网与子条目树。',
        tags: ['双击详情', '子条目树']
      },
      {
        title: '全书文内双链',
        desc: '在正文、大纲、设定或小传中键入 [[ 插链，目标改名自动跟随不断链。',
        tags: ['[[关系链接]]', '改名不断链']
      },
      {
        title: '预览窗钉住对比',
        desc: '悬停双链弹出预览窗，拖动标题栏即可钉在屏幕任意处，双击恢复跟随。',
        tags: ['拖动钉住', '双击恢复']
      }
    ],
    callout: {
      badge: '技巧',
      title: '双链与批注可在同一句话里共存',
      items: [
        '文内关系链接呈贴字点状下划线，正文批注呈偏下实线与淡底色，两者叠加互不遮挡，各自响应点击与悬停。'
      ],
      keys: ['[[', '右键添加关系链接', '拖动预览标题栏']
    }
  },

  power: {
    id: 'power',
    groupId: 'advanced',
    groupLabel: '进阶与拓展功能',
    icon: 'sliders',
    title: '效率与生态拓展',
    subtitle: '把权重体系、导入导出、外观定制与快捷键收入囊中，长篇写作更顺手。',
    keywords: '权重 核心 关键 点缀 末节 导入 导出 Word docx ZIP Markdown TXT 拆窗 实体锁 字体 流动背景 快捷键 全局搜索',
    weights: [
      { id: 'core', label: '核心', desc: '世界观支柱，星系最内圈常驻高亮' },
      { id: 'key', label: '关键', desc: '重要规则与主线要素，中内圈呈现' },
      { id: 'standard', label: '标准', desc: '常规设定条目，默认均衡层级' },
      { id: 'accent', label: '点缀', desc: '风物细节与补充说明，拉近渐显' },
      { id: 'trivial', label: '末节', desc: '零星彩蛋与备忘，最外圈轻量收录' }
    ],
    cards: [
      {
        title: '多格式导入导出',
        desc: '导入多格式书稿与层级设定；正文按阈值逐章导出、合并或打 ZIP 包。',
        tags: ['TXT/MD/DOCX/PDF/EPUB', 'Word / ZIP']
      },
      {
        title: '独立拆窗与实体锁',
        desc: '各模块均可拆窗并排对照，他窗正编辑的条目主窗自动只读保护。',
        tags: ['多窗并排', '防冲突覆盖']
      },
      {
        title: '幻流外观与字库',
        desc: '定制深浅面板、封面取色流动背景与 9 款随包离线字体，支持字号微调。',
        tags: ['0–2× 流速', '13–24px']
      },
      {
        title: '全库检索与设置搜',
        desc: '跨正文、大纲、人物、设定与灵感全库高亮检索，设置项亦支持关键词过滤。',
        tags: ['Ctrl + Shift + F', '设置速查']
      }
    ],
    shortcuts: [
      {
        group: '全局与书架',
        items: [
          { keys: ['← / →'], desc: '书架切换选中作品' },
          { keys: ['Enter'], desc: '打开当前选中的作品' },
          { keys: ['Ctrl + Shift + F'], desc: '跨模块全局搜索' },
          { keys: ['Ctrl + S'], desc: '立即保存正文或设置偏好' },
          { keys: ['Esc'], desc: '关闭弹窗、搜索或逐级退出阅读' }
        ]
      },
      {
        group: '大纲画布与幕布',
        items: [
          { keys: ['Ctrl + K'], desc: '画布全层级搜索并定位节点' },
          { keys: ['方向键', 'Shift + 方向键'], desc: '微移 / 大步长移动画布模块' },
          { keys: ['Enter', 'Shift + Enter'], desc: '幕布新建同级节点 / 节点内换行' },
          { keys: ['Tab', 'Shift + Tab'], desc: '幕布缩进子节点 / 提升层级' },
          { keys: ['Alt + ↑ / ↓'], desc: '幕布上移 / 下移当前节点' }
        ]
      }
    ]
  },

  safety: {
    id: 'safety',
    groupId: 'system',
    groupLabel: '数据安全与系统',
    icon: 'shield',
    title: '本地优先保障',
    subtitle: '你的故事始终留在自己硬盘上，离线可用、随时落盘。',
    keywords: '本地 安全 离线 不上传 自动保存 防丢稿 单实例 并发 实体锁',
    pillars: [
      {
        icon: 'lock',
        title: '纯本地存储',
        desc: '稿件、大纲、人物、设定与统计全部存于本机硬盘，不联网、不主动上传任何创作内容。'
      },
      {
        icon: 'save',
        title: '编辑即存零丢稿',
        desc: '输入停顿 1 秒自动落盘、30 秒定时兜底，切换章节、窗口失焦或关闭前自动强制存盘。'
      },
      {
        icon: 'layers',
        title: '防并发冲突保护',
        desc: '同一数据目录仅建议运行一个主实例；拆窗时由主进程实体锁仲裁，避免多窗双写覆盖。'
      }
    ],
    callout: {
      badge: '说明',
      title: '关于「实验性功能」开关',
      items: [
        '「恍然梦」创作助手、模型设置与知识库模型默认保持隐藏，不会干扰日常离线写作。',
        '如需尝鲜，可在「设置 → 实验性功能」按需开启，随时可关闭恢复纯净模式。'
      ]
    }
  },

  backup: {
    id: 'backup',
    groupId: 'system',
    groupLabel: '数据安全与系统',
    icon: 'archive',
    title: '备份、迁移与版本',
    subtitle: '换机迁移、误删恢复与版本更新，一处集中管理。',
    keywords: '备份 恢复 JSON 迁移 存储位置 回收站 版本号 更新 开发者 路径 APPDATA npm profile',
    cards: [
      {
        title: '全库备份与恢复',
        desc: '在「备份与数据」导出完整 JSON 快照，恢复前先预览核对内容规模。',
        tags: ['建议每周备份', '恢复前预览']
      },
      {
        title: '存储目录一键迁移',
        desc: '查看当前作品库目录，一键迁往其他磁盘文件夹或在文件管理器打开。',
        tags: ['桌面版迁移', '原位可清理']
      },
      {
        title: '分类回收站兜底',
        desc: '删除的章节、人物、设定与灵感先进回收站，确认无用后再彻底清除。',
        tags: ['防误删', '随时还原']
      },
      {
        title: '版本与应用更新',
        desc: '在「帮助与关于」查看版本号并检查官方更新，支持应用内校验下载。',
        tags: ['SHA-512 校验', '版本速查']
      }
    ],
    devAccordion: {
      title: '本地路径与开发者说明',
      hint: '默认收起 · 面向源码运行、调试隔离与进阶排障',
      rows: [
        { mode: '正式安装版', entry: 'novel-studio-setup-x.x.x.exe', purpose: '日常创作与分发', path: '%APPDATA%\\小说工坊' },
        { mode: '生产源码启动', entry: 'npm start', purpose: '本地源码运行正式端', path: '%APPDATA%\\小说工坊' },
        { mode: '开发调试版', entry: 'npm run dev', purpose: '热更新调试（与正式库隔离）', path: '%APPDATA%\\小说工坊-dev' },
        { mode: '多开独立目录', entry: '--profile=自定义名称', purpose: '多实例隔离运行防锁库', path: '%APPDATA%\\小说工坊-自定义名称' }
      ],
      tips: [
        { label: '优雅退出调试进程', code: 'npm run stop', desc: '退出所有开发实例并释放 5173 端口，确保本地数据完整落盘。' },
        { label: '遇 DatabaseClosedError', code: '--profile=名称', desc: '同一数据目录已有实例运行时会锁库，关闭旧窗重开或附加独立 profile。' },
        { label: 'dev 与正式版书目不同', code: '小说工坊-dev', desc: '设计如此：开发调试库与正式作品库严格隔离，防止测试数据污染真实稿件。' }
      ]
    }
  }
}

export const MANUAL_SECTION_LIST = MANUAL_GROUPS.flatMap((group) =>
  group.sections.map((item) => ({
    ...item,
    groupId: group.id,
    groupLabel: group.label,
    section: MANUAL_SECTIONS[item.id]
  }))
)

function collectSearchText(section) {
  const parts = [section.title, section.subtitle, section.groupLabel, section.keywords]
  if (section.pipeline) {
    for (const p of section.pipeline) parts.push(p.badge, p.name, p.role)
  }
  if (section.steps) {
    for (const s of section.steps) parts.push(s.title, s.desc, ...(s.chips || []))
  }
  if (section.viewModes) {
    for (const v of section.viewModes) parts.push(v.name, v.badge, v.scene, v.desc, ...(v.chips || []))
  }
  if (section.cards) {
    for (const c of section.cards) parts.push(c.title, c.desc, ...(c.tags || []))
  }
  if (section.callout) {
    parts.push(section.callout.title, ...(section.callout.items || []), ...(section.callout.keys || []))
  }
  if (section.interactions) {
    for (const g of section.interactions) {
      parts.push(g.category)
      for (const r of g.rows) parts.push(...r.keys, r.action, r.note)
    }
  }
  if (section.lineLegends) {
    for (const l of section.lineLegends) parts.push(l.title, l.desc)
  }
  if (section.weights) {
    for (const w of section.weights) parts.push(w.label, w.desc)
  }
  if (section.shortcuts) {
    for (const g of section.shortcuts) {
      parts.push(g.group)
      for (const it of g.items) parts.push(...it.keys, it.desc)
    }
  }
  if (section.pillars) {
    for (const p of section.pillars) parts.push(p.title, p.desc)
  }
  if (section.devAccordion) {
    parts.push(section.devAccordion.title)
    for (const r of section.devAccordion.rows) parts.push(r.mode, r.entry, r.purpose, r.path)
    for (const t of section.devAccordion.tips) parts.push(t.label, t.code, t.desc)
  }
  return parts.filter(Boolean).join(' ').toLocaleLowerCase()
}

const SECTION_SEARCH_INDEX = new Map(
  MANUAL_SECTION_LIST.map((item) => [item.id, collectSearchText(item.section)])
)

/**
 * 按关键词过滤手册目录与条目，支持多关键词空格分词（全部命中才返回）。
 * 返回匹配的 section 列表及对应命中的精简预览摘要。
 */
export function searchManual(rawQuery) {
  const tokens = String(rawQuery || '')
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean)
  if (!tokens.length) return []

  const results = []
  for (const item of MANUAL_SECTION_LIST) {
    const haystack = SECTION_SEARCH_INDEX.get(item.id) || ''
    if (!tokens.every((t) => haystack.includes(t))) continue

    const sec = item.section
    let snippet = sec.subtitle
    const candidates = [
      ...(sec.cards || []).map((c) => `${c.title}：${c.desc}`),
      ...(sec.viewModes || []).map((v) => `${v.name}：${v.desc}`),
      ...(sec.steps || []).map((s) => `${s.title}：${s.desc}`),
      ...(sec.pillars || []).map((p) => `${p.title}：${p.desc}`),
      ...(sec.interactions || []).flatMap((g) => g.rows.map((r) => `${r.keys.join(' / ')} — ${r.action}：${r.note}`)),
      ...(sec.shortcuts || []).flatMap((g) => g.items.map((it) => `${it.keys.join(' / ')} — ${it.desc}`)),
      ...(sec.devAccordion?.tips || []).map((t) => `${t.label}：${t.desc}`)
    ]
    const hit = candidates.find((text) => tokens.some((t) => text.toLocaleLowerCase().includes(t)))
    if (hit) snippet = hit

    results.push({
      id: item.id,
      title: item.title,
      groupId: item.groupId,
      groupLabel: item.groupLabel,
      icon: item.icon,
      snippet
    })
  }
  return results
}
