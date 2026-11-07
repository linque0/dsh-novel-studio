(() => {
  const end='2026-11-07', day=(date,n)=>{const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)}
  const works=[
    {id:'fog',title:'雾港纪年',genre:'悬疑长篇',mark:'雾',color:'#b9d8c6',note:'旧港的航路，会在凌晨重新出现。'},
    {id:'night',title:'长夜将明',genre:'幻想长篇',mark:'夜',color:'#cab9de',note:'守夜人背着一盏不会熄灭的灯。'},
    {id:'north',title:'北纬档案',genre:'短篇集',mark:'北',color:'#e2baab',note:'三封没有寄出的信，留下坐标。'},
    {id:'empty',title:'无名新稿',genre:'新建作品',mark:'稿',color:'#aca3b9',note:'还没有正式章节。'}
  ]
  const source=[
    ['fog','f1','潮声初起',[['初雪的钟声',4860,'done'],['海雾之下',5430,'done'],['失物招领处',3880,'revise'],['第七座灯塔',5160,'done']]],
    ['fog','f2','向北的潮线',[['涨潮以前',6240,'done'],['逆风而行',4100,'revise'],['潮汐的背面',5750,'draft'],['留在旧栈桥的人',4370,'draft']]],
    ['fog','f3','无名归港',[['夜航不点灯',3270,'draft'],['一封未寄出的信',2840,'draft'],['归港',0,'draft']]],
    ['night','n1','灯火未灭',[['守夜人',4780,'done'],['封印里的风',3520,'revise'],['黑塔来客',4100,'done'],['逆行的星',2650,'draft']]],
    ['night','n2','拂晓之前',[['无名誓约',5270,'draft'],['灰烬以外',3180,'draft'],['将明',1850,'draft']]],
    ['north','b1','沿岸通信',[['向雪地投递',2800,'done'],['第三封信',3220,'revise'],['海岸经线',3780,'draft']]]
  ]
  const volumes=source.map(([work,id,title])=>({work,id,title}))
  const chapters=source.flatMap(([work,volume,_,rows])=>rows.map(([title,words,status],i)=>({work,volume,id:volume+'-'+(i+1),title,words,status})))
  const logs=[]
  for(const [j,work] of ['fog','night','north'].entries()){
    const list=chapters.filter(c=>c.work===work&&c.words)
    for(let i=89;i>=0;i--){
      if(work==='fog'&&i<=6)continue
      if((i*7+j*11)%13>(j===0?8:j===1?6:4))continue
      const date=day(end,-i), delta=(i%9===1?-1:1)*(130+(i*97+j*211)%1160)
      logs.push({id:work+'-log-'+i,work,chapter:list[(i+j)%list.length].id,date,delta})
    }
  }
  const recent=[[6,'f2-1',872],[5,'f2-2',416],[4,'f2-2',182],[4,'f2-2',-182],[3,'f2-2',-273],[1,'f2-3',1080],[0,'f2-3',1248],[0,'f2-2',-180]]
  for(const [i,[ago,chapter,delta]] of recent.entries())logs.push({id:'fog-tail-'+i,work:'fog',chapter,date:day(end,-ago),delta})
  const versions=[
    ['fog','f2-3','2026-11-07','潮线改稿',5570,'汽笛在涨潮前响了一次。她把灯举到窗前，等雾里那个人回答。'],
    ['fog','f2-2','2026-11-04','删去旧港的回忆',4280,'栈桥上还留着昨夜的湿痕。她沿着它走到灯塔脚下。'],
    ['fog','f2-2','2026-11-03','初次保存转场',4553,'她隔着舷窗看见那条街，想起旧港已经停航三年。'],
    ['fog','f1-3','2026-10-29','整理线索顺序',3760,'失物招领处的柜台上，摆着一张没有日期的船票。'],
    ['fog','f2-1','2026-11-01','涨潮场景存档',5368,'潮水刚淹过石阶，他的脚步却没有停。'],
    ['night','n1-2','2026-11-05','黑塔会谈存档',3320,'风钻过窄窗，将灯火压得只剩一线。'],
    ['north','b1-2','2026-10-31','信末的地名',3020,'纸背有一条铅笔画出的经线。']
  ].map(([work,chapter,date,title,words,text],i)=>({id:'version-'+i,work,chapter,date,title,words,text}))
  const outline=source.map(([work,id,title,rows])=>({id:'outline-'+id,work,title,events:rows.map(([t,_,status],i)=>({id:'event-'+id+i,title:t,status:status==='draft'?(i%2?'planned':'writing'):status}))}))
  const lore=[
    ['fog','l1','潮汐与地理',['雾港北岸','第七灯塔','旧栈桥','无名岛','低潮航线','海雾季']],
    ['fog','l2','行会与契约',['远行者公会','雾灯守护人','不点灯的夜航']],
    ['fog','l3','信件与物件',['船票','铜钥匙','未寄出的信','钟声记录']],
    ['night','l4','黑塔遗迹',['塔下封印','守夜誓词','灰烬地带','拂晓灯塔']],
    ['north','l5','沿岸坐标',['北纬四十七度','旧邮局','边境站']]
  ].map(([work,id,title,nodes])=>({work,id,title,nodes}))
  const people=[
    ['fog','p1','叶回','主角','沿着旧航线寻找第七灯塔的绘图师。'],['fog','p2','纪白','配角','在旧栈桥值夜，掌握一张未登记的航图。'],['fog','p3','迟灯','对手','控制北岸行会的向导。'],['fog','p4','陆棠','配角','经营海岸的失物招领处。'],
    ['night','p5','明徵','主角','带着灯进入黑塔。'],['night','p6','简宁','导师','上一代守夜人。'],['night','p7','迟昀','配角','替黑塔传信。'],
    ['north','p8','林溯','主角','一位寻找信件收件人的邮差。'],['north','p9','顾榆','配角','看守废弃的边境邮局。']
  ].map(([work,id,title,role,text])=>({work,id,title,role,text}))
  const relations=[['fog','p1','p2','同行'],['fog','p1','p3','契约'],['fog','p2','p4','旧识'],['night','p5','p6','师徒'],['night','p6','p7','委托'],['north','p8','p9','通信']].map(([work,from,to,label])=>({work,from,to,label}))
  const snippets=[
    ['fog','2026-11-07','退潮时出现的码头',['场景','伏笔'],'码头木板只在落潮半刻露出，守灯的人可辨认踩上去的脚步声。'],
    ['fog','2026-11-05','窗上没有落雪',['意象'],'灯室窗内有热汽，窗外却是干燥的盐。'],
    ['fog','2026-11-01','给第七座灯塔一封信',['伏笔'],'收信人写成守灯人，回执却来自旧栈桥。'],
    ['fog','2026-10-23','船票背面',['物件'],'票背印着北岸行会的刻度。'],
    ['night','2026-11-06','风从封印里来',['场景'],'把烛火方向写反，以提示密室里的气流。'],
    ['night','2026-10-31','灯火传给下一任守夜人',['伏笔'],'不写继任礼，先写一只换手的灯。'],
    ['north','2026-11-03','寄错地址的空信封',['物件','伏笔'],'寄件人和收件人写了同一个名字。']
  ].map(([work,date,title,tags,text],i)=>({work,date,title,tags,text,id:'snippet-'+i}))
  globalThis.StudioDemo={end,day,works,volumes,chapters,logs,versions,outline,lore,people,relations,snippets}
})()
