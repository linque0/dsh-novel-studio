import { chatStream } from "./provider";
import { TOOL_REGISTRY, executeTool } from "./tools";
import { fitBlocks, estimate, copy } from "./presets";
import {
  checkAbort,
  chapterHash,
  entityHash,
  resolveEvidence,
  namesOf,
} from "./contracts";
import { taskProfile, assertTaskTool } from './task-profiles.js';
import { TASK_OUTPUT_TOOLS, taskEvidence, workflowProposal } from './task-proposals.js';
import { directionProposal } from './writing-directions.js';
import { creativeProposal } from './creative-proposals.js';

const functionTool = (name, description, properties, required = []) => ({
  type: "function",
  function: {
    name,
    description,
    parameters: {
      type: "object",
      properties,
      required,
      additionalProperties: false,
    },
  },
});
const text = { type: "string" },
  number = { type: "integer", minimum: 0 },
  queryProps = {
    query: text,
    limit: { ...number, maximum: 50 },
    cursor: number,
  };
export function dialogueTools(task = null) {
  const schemas = {
    search_book:{...queryProps,sourceType:text},
    read_document:{docId:text,cursor:number},
    get_book_coverage:queryProps,
    get_related_entities:{entityId:text,depth:{...number,maximum:2},...queryProps},
    get_entity_state:{entityId:text,...queryProps},
    search_chapters: queryProps,
    read_chapter: { chapterId: text, cursor: number },
    get_character: { name: text, characterId: text },
    get_outline_subtree: { nodeId: text, title: text, cursor: number },
    get_lore_subtree: { nodeId: text, title: text, cursor: number },
    list_recent_chapters: { limit: number, cursor: number },
    search_kb: { ...queryProps, kind: text, asOfChapterId: text },
    get_foreshadows: { status: text, asOfChapterId: text, cursor: number },
    get_char_timeline: {
      characterId: text,
      asOfChapterId: text,
      cursor: number,
    },
    locate_evidence: { sourceType: text, sourceId: text, quote: text },
  };
  const readonly = [
    ...Object.entries(TOOL_REGISTRY).filter(([name]) => !task || !taskProfile(task.type).extraction || !['get_outline_subtree','search_kb','get_foreshadows','get_char_timeline','get_entity_state','list_recent_chapters'].includes(name)).map(([name, t]) =>
      functionTool(name, t.description, schemas[name]),
    ),
  ];
  if (!task) return readonly;
  const output = taskProfile(task.type).outputTool;
  const descriptions = {
    submit_chapter_plan:'提交 data={title,scenes:[{id,goal,pov,characters:[姓名],conflict,turn,ending,targetWords}]}。仅计划，不生成正文。',
    submit_review:'提交 data={items:[{id,category,severity:"error|warning|suggestion|pass",problem,expected,quote,start?,evidence:[{sourceType,sourceId,quote,start?}]}]}。quote 来自 draftSource 的连续原文；重复引文须指定 start。外部事实冲突附来源证据；predecessor 证据用 sourceType=candidate、sourceId=其ID，只证明未采纳分支内的衔接。证据不足标为待核实。',
    submit_recheck:'提交 data={items:[{id:原清单ID,status:"resolved|unresolved",quote:修订稿连续原文,start?,explanation}]}。恰好覆盖 confirmedReview.items；修法未落实原问题或缺少证据均 unresolved。',
    submit_plot_directions:'提交剧情方向，data={directions:[{id:唯一短ID,title:方向标题,development:起因到行动冲突转折和结束状态的简短剧情演变}]}。数量严格等于本次 directionCount，每项在行动、冲突或结局上实质不同；不得提交正文或写回作品。',
    submit_chapter:'提交目标章正文草稿：text正文、title标题、summary说明、evidence来源摘引、warnings冲突与缺口、review对大纲/设定/人物/因果的核查。仅生成待确认草稿。',
    submit_outline_plan:'提交未来大纲：nodes:[{title,points,chapterId?,children:[],evidence:[]}], evidence:[],warnings:[],review。仅生成待确认计划。',
    submit_written_outline:'从指定正文反推已写内容纲：nodes:[{title,points,chapterId,children:[],evidence:[{sourceType:"chapter",sourceId,quote,start?}]}], evidence:[],warnings:[],review。父节点可归并成卷纲，叶节点必须关联章节并附原文依据。',
    submit_lore:'提交设定：entries:[{id?（仅修订选定条目）,text,evidence:[]}],evidence:[],warnings:[],review。原创可无证据；提取必须逐项提供原文证据。',
    submit_characters:'人物与关系联合提案：characters:[{key:临时ID,id?（已有人物ID）,name,fields:{字段:字符串},aliases:[],bio,evidence:[]}],relations:[{id?（修改已有关系）,from:人物ID或临时ID,to:人物ID或临时ID,label,chapterId?,knownBy,evidence:[]}],states:[{character:人物ID或临时ID,chapterId,dimension:"伤势|能力|情感|立场|关系",change,evidence:[]}],evidence:[],warnings:[],review。状态须来自正文。设计人物不能提交状态；阶段状态任务仅提交 states。不得把共现视为关系。',
    submit_inspiration:'灵感卡：items:[{title,content,knownFacts:已知事实,newIdea:新创意,evidence:[],links:[{type:"character|lore|outline",id}]}],evidence:[],warnings:[],review。作者可选是否保存关联。',
    submit_memory:'章节记忆：summary摘要,facts:[{kind:"event|charstate|foreshadow",title,body:{...},characterId?（人物状态）,evidence:[]}],evidence:[],warnings:[],review。charstate body={dimension:"伤势|能力|情感|立场|关系",change}; foreshadow body={action:"set",content}。全部证据须来自目标章。',
  };
  return [...readonly, functionTool(output,descriptions[output],output==='submit_chapter'?{text,title:text,summary:text,evidence:{type:'array',items:{type:'object'}},warnings:{type:'array',items:text},review:text}:{data:{type:'object',additionalProperties:true}},output==='submit_chapter'?['text']:['data'])];
}
export function makeDraft(
  text,
  frozen,
  { runId, messageId, title = "正文草稿", summary = "", complete = true } = {},
) {
  if (typeof text !== "string" || !text.trim() || text.length > 200000)
    throw new Error("草稿为空或超过20万字");
  return {
    id: crypto.randomUUID(),
    kind: "draft",
    task: "plot",
    taskType: frozen.taskRequest?.type || null,
    text,
    opening: text,
    title,
    summary,
    workId: frozen.workId,
    anchorId: frozen.chapterId,
    anchorLabel: frozen.chapterTitle,
    sourceHash: frozen.sourceHash,
    source: copy(frozen),
    original: frozen.selection || "",
    runId,
    messageId,
    complete,
    status: "pending",
    createdAt: Date.now(),
  };
}
export function proposalFromTool(args, work, frozen, runId) {
  const { type, targetId, data } = args;
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new Error("提案 data 必须为对象");
  const rows = {
    outline: work.olnodes,
    character: work.characters,
    lore: work.mubu,
  }[type];
  const target = rows?.find((r) => r.id === targetId && !r.deletedAt);
  if (!target) throw new Error("提案目标不存在，新增实体必须单独确认");
  const evidence = (data.evidence || []).map((ref) => {
    if (
      ref.sourceType === "chapter" &&
      !frozen.allowedIds.includes(ref.sourceId)
    )
      throw new Error("依据越过本轮章节范围");
    const result = resolveEvidence(ref, work);
    if (!result) throw new Error("依据无法定位");
    return result;
  });
  const base = {
    id: crypto.randomUUID(),
    task: type,
    anchorId: targetId,
    anchorLabel: target.name || target.title || target.text?.slice(0, 30),
    sourceHash: entityHash(target),
    workId: frozen.workId,
    source: copy(frozen),
    runId,
    evidence,
    originalProposals: data.originalProposals || [],
    warnings: [],
    status: "pending",
  };
  if (
    !Array.isArray(base.originalProposals) ||
    base.originalProposals.length > 10 ||
    base.originalProposals.some(
      (p) =>
        !p?.name || !["人物", "设定", "character", "lore"].includes(p.type),
    )
  )
    throw new Error("原创实体格式无效");
  if (type === "outline") {
    if (
      !Array.isArray(data.nodes) ||
      !data.nodes.length ||
      data.nodes.length > 30 ||
      data.nodes.some(
        (n) =>
          !n.title ||
          !["", "cause", "foreshadow", "conflict"].includes(n.edge ?? ""),
      )
    )
      throw new Error("大纲节点或连线无效");
    return {
      ...base,
      kind: "plan",
      name: String(data.name || "大纲建议"),
      idea: String(data.idea || ""),
      nodes: data.nodes.map((n) => ({
        ...n,
        edge: n.edge || "",
        points: String(n.points || ""),
      })),
    };
  }
  if (type === "character") {
    const fields = data.fields || {},
      aliases = data.aliases || [],
      relations = data.relations || [];
    if (
      typeof fields !== "object" ||
      Array.isArray(fields) ||
      Object.values(fields).some((v) => typeof v !== "string") ||
      !Array.isArray(aliases) ||
      aliases.some((v) => typeof v !== "string") ||
      aliases.length > 5 ||
      !Array.isArray(relations) ||
      relations.length > 20
    )
      throw new Error("人物字段格式无效");
    if (
      relations.some(
        (r) =>
          !r.label ||
          work.characters.filter(
            (c) => !c.deletedAt && namesOf(c).includes(r.name),
          ).length !== 1,
      )
    )
      throw new Error("关系人物未登记或有歧义，请单独提出新增实体");
    return {
      ...base,
      kind: "diff",
      subject: "character",
      fields,
      aliases,
      relations,
      bio: String(data.bio || ""),
    };
  }
  if (!["add", "expand"].includes(data.mode)) throw new Error("设定 mode 无效");
  let count = 0;
  const tree = (n, depth = 0) => {
    if (
      !n ||
      typeof n.text !== "string" ||
      depth > 8 ||
      ++count > 200 ||
      (n.children && !Array.isArray(n.children))
    )
      throw new Error("设定树无效");
    return {
      text: n.text,
      children: (n.children || []).map((c) => tree(c, depth + 1)),
    };
  };
  if (data.mode === "expand" && !data.revised)
    throw new Error("替换设定文本为空");
  return {
    ...base,
    kind: "diff",
    subject: "lore",
    mode: data.mode,
    tree: data.mode === "add" ? tree(data.tree) : null,
    revised: String(data.revised || ""),
    note: String(data.note || ""),
  };
}
export async function runDialogue({
  compiled,
  work,
  frozen,
  opts,
  onDelta,
  onUsage,
  onNotice,
  onCard,
  runId,
  messageId,
}) {
  const task = frozen.taskRequest;
  const schemas = compiled.tools ? dialogueTools(task) : [],
    cache = new Map(),
    groups = [],
    cards = [],
    reports = [];
  let tools = schemas,
    answer = "",
    result,
    base = compiled.blocks.map((b) => ({ ...b }));
  const toolCost = estimate(JSON.stringify(schemas));
  if (
    compiled.opts.toolReserve == null &&
    toolCost +
      estimate(
        JSON.stringify(
          base.filter((b) => b.protected || b.blockId === "chapterAnchor"),
        ),
      ) >
      Math.min(
        compiled.opts.inputBudget,
        compiled.opts.contextWindow || Infinity,
      ) -
        compiled.opts.maxTokens -
        128
  ) {
    tools = [];
    onNotice?.("完整请求预算不足以包含工具，使用普通对话；可将回复转为草稿");
  }
  if (task && !tools.length) throw new Error('专用任务需要工具调用，请提高上下文预算或换用支持工具的模型');
  const readProgress = new Map();
  const roundLimit = task ? 24 : 6;
  let charged=0;
  for (let round = 0; round < roundLimit; round++) {
    checkAbort(opts.signal);
    const finalRound = round === roundLimit - 1;
    const toolReserve = tools.length ? toolCost : 0;
    const fitted = fitBlocks([...base, ...groups.flat()], {
      ...compiled.opts,
      toolReserve,
    });
    reports.push({
      round: round + 1,
      ...fitted.tokens,
      toolDefinitionReserve: toolReserve,
      dropped: fitted.dropped,
    });
    const liability=fitted.tokens.used+toolReserve+(compiled.opts.maxTokens||2048);
    if(Number.isFinite(opts.rootRemaining)&&charged+liability>opts.rootRemaining)throw new Error('本阶段剩余批次预算不足，已在请求前暂停');
    try {
      result = await chatStream(
        {
          ...opts,
          ...compiled.opts,
          messages: fitted.messages,
          tools,
          toolChoice: finalRound ? "none" : "auto",
        },
        (d) => {
          checkAbort(opts.signal);
          answer += d;
          onDelta?.(d);
        },
      );
    } catch (e) {
      if(Number.isFinite(opts.rootRemaining)) {charged+=liability;onUsage?.({total_tokens:liability,estimated:true});}
      checkAbort(opts.signal);
      if (
        compiled.continuationPrefill &&
        [400, 422].includes(e.status) &&
        /assistant|prefill|last.*message/i.test(
          String(e.message) + String(e.detail),
        )
      ) {
        compiled.continuationPrefill = false;
        base.push({
          role: "system",
          content: compiled.continueNudge,
          protected: true,
          kind: "prompt",
          blockId: "prefillFallback",
        });
        onNotice?.("服务商不支持 assistant prefill，已降级为续写提示");
        round--;
        continue;
      }
      if (
        tools.length &&
        [400, 422].includes(e.status) &&
        /tool|function/i.test(String(e.message) + String(e.detail))
      ) {
        if (task) throw new Error('当前模型拒绝专用任务工具，未生成可应用结果：' + e.message);
        tools = [];
        onNotice?.(
          "当前服务商不支持工具，使用普通对话；可选择回复转为正文草稿",
        );
        result = await chatStream(
          { ...opts, ...compiled.opts, messages: fitted.messages },
          (d) => {
            checkAbort(opts.signal);
            answer += d;
            onDelta?.(d);
          },
        );
      } else throw e;
    }
    charged+=Number(result.usage?.total_tokens)||fitted.tokens.used+toolReserve+estimate(result.text)+estimate(JSON.stringify(result.toolCalls||[]));
    onUsage?.(
      result.usage || {
        prompt_tokens: fitted.tokens.used + (tools.length ? toolReserve : 0),
        completion_tokens:
          estimate(result.text) +
          estimate(JSON.stringify(result.toolCalls || [])),
        total_tokens:
          fitted.tokens.used +
          (tools.length ? toolReserve : 0) +
          estimate(result.text) +
          estimate(JSON.stringify(result.toolCalls || [])),
        estimated: true,
      },
    );
    checkAbort(opts.signal);
    if (result.finishReason === "length") {
      for (const call of result.toolCalls || [])
        if (task?.type.startsWith('chapter.') && call.function?.name === 'submit_chapter') {
          try {
            const args = JSON.parse(call.function.arguments);
            const card = makeDraft(args.text, frozen, {
              runId,
              messageId,
              title: args.title,
              summary: args.summary,
              complete: false,
            });
            cards.push(card);
            onCard?.(card);
          } catch {
            /* incomplete raw arguments remain visible in the conversation */
          }
        }
      break;
    }
    if (!result.toolCalls?.length || finalRound) break;
    if (result.toolCalls.length > 8) throw new Error("单轮工具请求超过8次");
    const group = [
      {
        role: "assistant",
        content: result.text || "",
        tool_calls: result.toolCalls,
        protected: true,
      },
    ];
    for (const call of result.toolCalls) {
      checkAbort(opts.signal);
      let response;
      try {
        const args = JSON.parse(call.function.arguments || "{}"),
          name = call.function.name;
        if (!schemas.some(s => s.function.name === name)) throw new Error('工具未在本任务授权范围内');
        assertTaskTool(task,name,TASK_OUTPUT_TOOLS);
        if (task && name === taskProfile(task.type).outputTool && taskProfile(task.type).extraction && task.chapterIds.some(id=>readProgress.get(id)?.complete!==true)) throw new Error('尚未顺序读完全部任务章节，请继续分页读取');
        if (name === "submit_chapter") {
          const draft = makeDraft(args.text, frozen, {
            runId,
            messageId,
            title: args.title,
            summary: args.summary,
          });
          draft.evidence = taskEvidence(args.evidence,work,frozen);
          draft.warnings = Array.isArray(args.warnings)?args.warnings.map(String):[];
          draft.review = String(args.review || '未提供语义核查，请作者检查。');
          cards.push(draft);
          onCard?.(draft);
          response = {
            ok: true,
            draftId: draft.id,
            status: "等待作者确认，尚未保存",
          };
        } else if(['submit_chapter_plan','submit_review','submit_recheck'].includes(name)) {
          const card=creativeProposal(args.data,work,frozen,{runId,messageId});cards.push(card);onCard?.(card)
          response={ok:true,status:'阶段产物，尚未写回作品'}
        } else if(name==='submit_plot_directions') {
          const card=directionProposal(args.data,frozen,{runId,messageId});cards.push(card);onCard?.(card)
          response={ok:true,status:'剧情草案，等待作者编辑与选择'}
        } else if (task && name === taskProfile(task.type).outputTool) {
          const card = workflowProposal(args.data, work, frozen, runId, messageId);
          cards.push(card);
          onCard?.(card);
          response = { ok: true, proposalId: card.id, status: "待作者确认" };
        } else {
          const key = JSON.stringify([name, args]);
          response = cache.get(key);
          if (!response) {
            response = await executeTool(name, args, {
              work,
              privacy: opts.privacy,
              asOfChapterId: frozen.asOfChapterId,
              allowedIds: frozen.allowedIds,
              authorProfiles: !!task?.type.startsWith('chapter.'),
              planScope: task && taskProfile(task.type).extraction ? 'none' : 'all',
              sourceRevision: frozen.bookRevision,
              writingBoundary:frozen.writingBoundary,
              signal:opts.signal,
              retrievalOptions:{embeddings:opts.embeddings,opts:{...opts,signal:opts.signal,onUsage},taskType:task?.type,anchorId:task?.targetId||frozen.chapterId},
            });
            if (['read_chapter','read_document'].includes(name) && response.sourceType==='chapter' && response.citation && !response.error && !response.withheld) {
              const progress=readProgress.get(response.sourceId)||{end:0,complete:false};
              if(response.citation.start===progress.end){progress.end=response.citation.end;progress.complete=response.nextCursor===null;readProgress.set(response.sourceId,progress);}
            }
            cache.set(key, response);
            for (const version of [...(response.items || []), response].flatMap((item)=>item.sourceVersions || []))
              if (!frozen.sourceVersions.some((v)=>v.table===version.table&&v.id===version.id)) frozen.sourceVersions.push(version);
            for (const item of [...(response.items || []), response])
              for (const id of [item.id, item.chapterId, item.sourceId].filter(
                Boolean,
              )) {
                for (const table of [
                  "chapters",
                  "characters",
                  "mubu",
                  "olnodes",
                  "snippets", "annotations", "relations", "outlines", "lore", "lorecats", "volumes",
                ]) {
                  const row = work[table]?.find((r) => r.id === id);
                  if (
                    row &&
                    !frozen.sourceVersions.some(
                      (v) => v.table === table && v.id === id,
                    )
                  )
                    frozen.sourceVersions.push({
                      table,
                      id,
                      hash:
                        table === "chapters"
                          ? chapterHash(row)
                          : entityHash(row),
                    });
                }
              }
          }
        }
      } catch (e) {
        response = { error: e.message };
      }
      group.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(response),
        protected: true,
      });
    }
    groups.push(group);
    if (task && cards.length) { result={...result,finishReason:'stop'}; break; }
    // Evict entire old tool turns, keeping call/result pairs intact.
    const cap =
      Math.min(
        compiled.opts.inputBudget,
        compiled.opts.contextWindow || Infinity,
      ) -
      compiled.opts.maxTokens -
      toolCost -
      128;
    const cost = () => estimate(JSON.stringify([...base, ...groups.flat()]));
    while (cost() > cap && groups.length > 1) {
      groups.shift();
      onNotice?.("已裁剪较早的完整工具轮次");
    }
    if (cost() > cap) {
      base = base.filter((b) => b.protected || b.blockId === "chapterAnchor");
      if (cost() > cap) {
        groups.length = 0;
        tools = [];
        onNotice?.("工具结果超过预算，结束检索并使用已装配材料回答");
      }
    }
  }
  checkAbort(opts.signal);
  const complete = result?.finishReason === "stop";
  if (task && !cards.length && complete) throw new Error('模型没有提交本任务的结构化提案；可重新生成，普通回复尚未写回');
  // Length-limited final answers must never produce applicable partial cards.
  if (!complete)
    cards.forEach((c) => {
      c.complete = false;
      c.status = "incomplete";
    });
  return {
    answer: answer || (cards.length ? "已生成折叠提案，请展开查看。" : ""),
    cards,
    complete,
    finishReason: result?.finishReason,
    reports,
    preset: compiled.presetSnapshot,
  };
}
