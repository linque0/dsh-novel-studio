export default {
  "title": "长夜将明",
  "nodes": [
    {
      "id": "geography",
      "title": "地理与场所",
      "parentId": null,
      "isSet": true,
      "kind": "place",
      "tags": [],
      "order": 0
    },
    {
      "id": "factions",
      "title": "组织与势力",
      "parentId": null,
      "isSet": true,
      "kind": "faction",
      "tags": [],
      "order": 100
    },
    {
      "id": "rules",
      "title": "规则与禁忌",
      "parentId": null,
      "isSet": true,
      "kind": "rule",
      "tags": [],
      "order": 200
    },
    {
      "id": "history",
      "title": "历史与纪年",
      "parentId": null,
      "isSet": true,
      "kind": "history",
      "tags": [],
      "order": 300
    },
    {
      "id": "objects",
      "title": "物件与线索",
      "parentId": null,
      "isSet": true,
      "kind": "object",
      "tags": [],
      "order": 400
    },
    {
      "id": "beliefs",
      "title": "民俗与信仰",
      "parentId": null,
      "isSet": true,
      "kind": "belief",
      "tags": [],
      "order": 500
    },
    {
      "id": "lighthouse",
      "parentId": "geography",
      "title": "雾港灯塔",
      "kind": "place",
      "tags": [
        "地点",
        "关键场景"
      ],
      "body": "雾港最北端的白色石塔，建在退潮后才露出的黑礁上。每到凌晨三点，灯光会向没有航线的海域转过一圈。\n\n它不只为归航者指路，也替某些人守住不能被看见的东西。镇上的人习惯在入夜前离开堤岸，没有人公开谈论那一束逆着潮汐的光。",
      "order": 0
    },
    {
      "id": "harbor",
      "parentId": "geography",
      "title": "旧港与栈桥",
      "kind": "place",
      "tags": [
        "地点",
        "雾港"
      ],
      "body": "旧港已经停用七年，仍有人在午夜修补栈桥。来港的第一班渡轮，会在这里多停留三分钟。",
      "order": 100
    },
    {
      "id": "market",
      "parentId": "geography",
      "title": "潮汐集市",
      "kind": "place",
      "tags": [
        "地点",
        "生活"
      ],
      "body": "只在大潮退去的清晨开市。摊主用没有日期的潮汐表记账，出售被海水送回来的旧物。",
      "order": 200
    },
    {
      "id": "keepers",
      "parentId": "factions",
      "title": "守灯人协会",
      "kind": "faction",
      "tags": [
        "组织",
        "守望"
      ],
      "body": "由历代守灯人组成的松散协会，名册上永远只有七个名字。协会负责维护灯塔，也决定哪些船可以在夜里靠岸。",
      "order": 300
    },
    {
      "id": "shipping",
      "parentId": "factions",
      "title": "北岸航运局",
      "kind": "faction",
      "tags": [
        "组织",
        "调查"
      ],
      "body": "掌管雾港的航线与进出记录。三年前风暴当夜的航海日志，至今封存在没有编号的柜子里。",
      "order": 400
    },
    {
      "id": "society",
      "parentId": "factions",
      "title": "拾潮社",
      "kind": "faction",
      "tags": [
        "组织",
        "民间"
      ],
      "body": "沿海渔民自发组成的互助团体。他们寻找失踪者，收留潮汐带回的姓名与物件。",
      "order": 500
    },
    {
      "id": "pact",
      "parentId": "rules",
      "title": "熄灯之约",
      "kind": "rule",
      "tags": [
        "禁忌",
        "关键线索"
      ],
      "body": "当灯塔在凌晨三点熄灭，岸上的人必须保持安静，直到第一声钟响。打破约定的人，会在第二天忘记一个重要的名字。",
      "order": 600
    },
    {
      "id": "tide-law",
      "parentId": "rules",
      "title": "返潮规律",
      "kind": "rule",
      "tags": [
        "规则",
        "潮汐"
      ],
      "body": "每隔十九天，退潮会比潮汐表早到七分钟。只有旧港的钟仍准确记录着这段空白。",
      "order": 700
    },
    {
      "id": "names",
      "parentId": "rules",
      "title": "归名仪式",
      "kind": "rule",
      "tags": [
        "规则",
        "记忆"
      ],
      "body": "失踪者的名字被写在薄木片上，沿堤岸放入海中。若木片在黎明前回来，家人便不再等待。",
      "order": 800
    },
    {
      "id": "storm",
      "parentId": "history",
      "title": "三年前的风暴",
      "kind": "history",
      "tags": [
        "历史",
        "关键线索"
      ],
      "body": "一场没有气象记录的风暴让七艘船失去联系。灯塔的值班记录显示，那一夜有人提前接过了钥匙。",
      "order": 900
    },
    {
      "id": "founding",
      "parentId": "history",
      "title": "第一任守灯人",
      "kind": "history",
      "tags": [
        "历史",
        "守望"
      ],
      "body": "建塔的人没有留下名字，只在石阶最底层刻了一道向海的箭头。第一本值班册从第二页开始。",
      "order": 1000
    },
    {
      "id": "closure",
      "parentId": "history",
      "title": "旧港封航令",
      "kind": "history",
      "tags": [
        "历史",
        "调查"
      ],
      "body": "七年前，航运局宣布旧港水深不足。封航令的签发日期，比最后一艘船离开的日子早了一周。",
      "order": 1100
    },
    {
      "id": "logbook",
      "parentId": "objects",
      "title": "无编号航海日志",
      "kind": "object",
      "tags": [
        "物件",
        "关键线索"
      ],
      "body": "封皮被海水浸成灰蓝色，最后一页撕去了一半。每次在灯塔内翻开，纸页上都会多出一行尚未发生的记录。",
      "order": 1200
    },
    {
      "id": "key",
      "parentId": "objects",
      "title": "第七把铜钥匙",
      "kind": "object",
      "tags": [
        "物件",
        "守望"
      ],
      "body": "协会共有六把登记过的钥匙。林照保管的第七把，比其他钥匙更旧，齿纹却没有任何磨损。",
      "order": 1300
    },
    {
      "id": "letter",
      "parentId": "objects",
      "title": "迟到三年的来信",
      "kind": "object",
      "tags": [
        "物件",
        "调查"
      ],
      "body": "沈砚收到父亲寄出的信，邮戳停在风暴发生的前一天。信纸里夹着一张去往雾港的单程船票。",
      "order": 1400
    },
    {
      "id": "bell",
      "parentId": "beliefs",
      "title": "三点钟声",
      "kind": "belief",
      "tags": [
        "民俗",
        "潮汐"
      ],
      "body": "人们说，钟声为仍在海上的人报时。实际上，雾港的钟楼早在七年前就拆除了钟锤。",
      "order": 1500
    },
    {
      "id": "lantern",
      "parentId": "beliefs",
      "title": "引潮灯",
      "kind": "belief",
      "tags": [
        "民俗",
        "生活"
      ],
      "body": "每个离港的人都要在窗前留一盏小灯。灯可以熄灭，但不能被主动带走。",
      "order": 1600
    },
    {
      "id": "festival",
      "parentId": "beliefs",
      "title": "无名者之夜",
      "kind": "belief",
      "tags": [
        "民俗",
        "记忆"
      ],
      "body": "入冬后的第一个无月之夜，居民用旧名字互相称呼。有人因此想起再也没有回来的人。",
      "order": 1700
    },
    {
      "id": "architecture",
      "parentId": "lighthouse",
      "title": "建筑与空间",
      "kind": "entry",
      "tags": [],
      "body": "塔身有七十二级台阶。顶层灯室朝北开窗，西侧是一间没有门牌的值班室。",
      "order": 0
    },
    {
      "id": "watch",
      "parentId": "lighthouse",
      "title": "守灯规程",
      "kind": "entry",
      "tags": [],
      "body": "交班前清点钥匙；三点前不独自进入灯室；风暴中不得向旧港发出信号。",
      "order": 100
    },
    {
      "id": "secret",
      "parentId": "watch",
      "title": "未记入册的第七条",
      "kind": "entry",
      "tags": [],
      "body": "如果有人从海上呼唤你的名字，不要回头。",
      "order": 200
    },
    {
      "id": "trace",
      "parentId": "lighthouse",
      "title": "故事中的线索",
      "kind": "entry",
      "tags": [],
      "body": "林照在灯室发现了父亲的旧笔迹。她认出了落款，却没有告诉沈砚。",
      "order": 300
    },
    {
      "id": "ledger",
      "parentId": "keepers",
      "title": "名册与职责",
      "kind": "entry",
      "tags": [],
      "body": "协会以轮值的方式维护灯塔，每次交班都需要两名见证人。",
      "order": 400
    },
    {
      "id": "cost",
      "parentId": "pact",
      "title": "违约的代价",
      "kind": "entry",
      "tags": [],
      "body": "被遗忘的名字不会从纸上消失，只会从所有人的记忆中退去。",
      "order": 500
    },
    {
      "id": "lin",
      "title": "林照",
      "kind": "person",
      "parentId": null,
      "tags": [
        "人物",
        "守灯人"
      ],
      "body": "雾港灯塔的现任守灯人。她从不在三点前离开灯室，知道父亲失踪的另一种说法。"
    },
    {
      "id": "shen",
      "title": "沈砚",
      "kind": "person",
      "parentId": null,
      "tags": [
        "人物",
        "调查"
      ],
      "body": "带着父亲迟到的来信来到雾港。他试图确认那场风暴里，究竟有哪些人从未离开。"
    }
  ],
  "relations": [
    {
      "id": "rel1",
      "to": "keepers",
      "label": "由其维护",
      "reverseLabel": "负责维护",
      "from": "lighthouse"
    },
    {
      "id": "rel2",
      "to": "pact",
      "label": "遵循",
      "reverseLabel": "约束",
      "from": "lighthouse"
    },
    {
      "id": "rel3",
      "to": "lighthouse",
      "label": "驻守",
      "reverseLabel": "守灯人",
      "from": "lin"
    },
    {
      "id": "rel4",
      "to": "harbor",
      "label": "眺望",
      "reverseLabel": "灯光来自",
      "from": "lighthouse"
    },
    {
      "id": "rel5",
      "to": "logbook",
      "label": "藏有",
      "reverseLabel": "发现于",
      "from": "lighthouse"
    },
    {
      "id": "rel6",
      "to": "lighthouse",
      "label": "调查",
      "reverseLabel": "调查者",
      "from": "shen"
    },
    {
      "id": "rel7",
      "to": "key",
      "label": "保管",
      "reverseLabel": "由其保管",
      "from": "keepers"
    },
    {
      "id": "rel8",
      "to": "keepers",
      "label": "成员",
      "reverseLabel": "成员",
      "from": "lin"
    },
    {
      "id": "rel9",
      "to": "bell",
      "label": "以此为界",
      "reverseLabel": "标记",
      "from": "pact"
    },
    {
      "id": "rel10",
      "to": "storm",
      "label": "记录",
      "reverseLabel": "记录于",
      "from": "logbook"
    },
    {
      "id": "rel11",
      "to": "letter",
      "label": "收到",
      "reverseLabel": "收信人",
      "from": "shen"
    },
    {
      "id": "rel12",
      "to": "closure",
      "label": "受其影响",
      "reverseLabel": "关闭",
      "from": "harbor"
    },
    {
      "id": "rel13",
      "to": "tide-law",
      "label": "遵循",
      "reverseLabel": "影响",
      "from": "market"
    }
  ]
}
