import { classifyThermal, evidenceIsExact, type ThermalDataset, type ThermalDocument } from "./thermal.ts";
import type { ThermalGold } from "./thermal-benchmark.ts";

const codeRules:[RegExp,string][]=[
  [/^G01K/,"Temperature Sensing & Monitoring"],[/^C0[89]K/,"Thermal Materials & Interfaces"],
  [/^H01M 10\/6/,"Active Cooling"],[/^B60[HK]/,"Active Cooling"],
  [/^F28D|^F28F|^H05K 7\/20|^G06F 1\/20|^H10W 40\/7|^H01L 23\/427/,"Passive Cooling Structure"],
  [/^H04W 52\/|^H04M 1\/725/,"Power-Thermal Coordination"]
];
const ratio=(n:number,d:number)=>({numerator:n,denominator:d,value:d?n/d:null});
const codes=(doc:ThermalDocument,source:"CPC"|"IPC")=>source==="CPC"?doc.cpc:doc.cpc.length?doc.cpc:doc.ipc;
export function baselineRow(doc:ThermalDocument,arm:"A1"|"A2"|"A3") {
  const source=doc.cpc.length?"CPC":arm==="A1"?null:doc.ipc.length?"IPC":null;
  const used=source?codes(doc,source):[];
  const matched=[...new Set(used.flatMap(code=>codeRules.filter(([re])=>re.test(code)).map(([,label])=>label)))];
  const rule=arm==="A3"?classifyThermal(doc):null;
  const technology=arm==="A3"?rule?.primaryTechnologyCategory??null:matched[0]??null;
  return {publicationNumber:doc.publicationNumber,inputHash:doc.contentHash,arm,codeSource:source,applicable:arm==="A3"||Boolean(source),classified:Boolean(technology&&technology!=="Uncertain"),technology,scope:rule?.scope??null,productApplication:rule?.potentialProductApplication??null,conflict:matched.length>1||(arm==="A3"&&matched.length>0&&rule?.primaryTechnologyCategory!=="Other"&&!matched.includes(rule!.primaryTechnologyCategory)),matchedCategories:matched};
}
export function evaluateBaselines(dataset:ThermalDataset,gold:Record<string,ThermalGold>={}) {
  return Object.fromEntries((["A1","A2","A3"] as const).map(arm=>{
    const rows=dataset.entries.map(d=>baselineRow(d,arm));
    const applicable=rows.filter(r=>r.applicable),classified=rows.filter(r=>r.classified);
    const verified=classified.filter(r=>{const g=gold[r.publicationNumber];return g?.status==="verified_gold"&&g.datasetVersion===dataset.version&&g.contentHash===r.inputHash;});
    const correct=verified.filter(r=>r.technology===gold[r.publicationNumber].primaryTechnologyCategory);
    return [arm,{applicable:applicable.length,classified:classified.length,unclassified:rows.length-classified.length,conflicts:rows.filter(r=>r.conflict).length,coverage:ratio(classified.length,rows.length),verifiedComparison:ratio(correct.length,verified.length),rows}];
  }));
}
export const FIRST_FIVE=[
  ["EP3149425B1","in_scope: Claim 1 明确提到 mobile computing device 与 vapor chamber"],
  ["EP4498205A1","in_scope: 笔记本电脑及主动冷却结构，检查 CPC 泛码与 IPC 回退"],
  ["EP4761489A1","boundary_case: 手机语境仅出现在说明书"],
  ["EP4015272B1","out_of_scope: 汽车热管理，测试跨行业排除"],
  ["EP4476289B1","uncertain: 通用相变界面材料，无确定产品场景"]
] as const;
const audits:Record<string,string>={
  EP4761489A1:"Claim 1 主张均热板结构，摘要为电子设备；手机例子仅在说明书，不能视为手机专利已确认。",
  EP4697879A1:"Claim 1 为电子设备用均热板；CPC 包含便携计算设备散热，但分类码及说明书示例不足以证明权利要求限定手机。",
  EP4015272B1:"Claim 1 明确为 automobile 的制冷剂、电机液冷与空调循环；属于汽车，不进入智能终端核心组合。",
  EP4793571A3:"题名与摘要指向 photovoltaic module / solar collector；Claim 1 缺失，应保留缺失标记，现有文本足以排除核心组合。",
  EP4823254A1:"Claim 1 明确为 Marx generator 的冷却板与开关元件；散热技术相关，但用途是脉冲发生器。",
  EP4231797A1:"Claim 1 为带均热板的 electronic device；虽有 H04M 分类，主张文本没有明确手机，保持待定。",
  EP4476289B1:"Claim 1 主张相变热界面材料配方，没有智能终端或特定产品；不能从可能用途推断实际应用。",
  EP4464131B1:"德文 Claim 1 为电子元件用微通道热管散热体；没有明确智能终端，语言与产品语境均需人工核对。",
  EP4822824A1:"Claim 1 为电池单体/模组浸没冷却装置；未确认电池所属产品，不能自动归为手机或汽车。",
  EP3149425B1:"抽查范围内样本：Claim 1 明确 mobile computing device 与 vapor chamber；仍须人工确认具体产品标签。",
  EP4498205A1:"抽查范围内样本：Claim 1 明确 notebook computer；技术类别应结合冷却结构原文核查，不能仅靠 Y02D CPC。"
};
export function fixedSample(dataset:ThermalDataset){return FIRST_FIVE.map(([id,reason])=>{const d=dataset.entries.find(x=>x.publicationNumber===id);if(!d)throw new Error("固定试验样本缺失："+id);return {publicationNumber:id,inputHash:d.contentHash,scopeAtSelection:d.scope,reason};});}
export function referencePackets(dataset:ThermalDataset){return dataset.entries.map(d=>{
  const ev=d.supportingSourceSpan.filter(x=>evidenceIsExact(d,x));
  const primary=d.independentClaims[0]??d.abstract??d.title??"来源未提供";
  const complex=d.scope!=="in_scope";
  const sourceLevel=d.independentClaims.length?"Claim 1":d.abstract?"abstract":d.title?"title":"none";
  const issue=audits[d.publicationNumber]??(d.scope==="in_scope"?"抽查范围内样本，确认主张文本的产品语境及技术功能。":"未在主张文本中确认智能终端；技术可移植性不能代替产品证据。");
  return {publicationNumber:d.publicationNumber,contentHash:d.contentHash,sourceUrl:d.sourceUrl,originalDescription:primary,sourceLevel,industryScopeCandidate:d.scope,technologyCandidate:d.primaryTechnologyCategory,productApplicationCandidate:d.potentialProductApplication,evidence:ev,dispute:issue,dataCompleteness:{abstract:Boolean(d.abstract),claim1:Boolean(d.independentClaims.length),cpc:Boolean(d.cpc.length),ipc:Boolean(d.ipc.length)},reviewStatus:complex&&d.scope==="uncertain"?"insufficient_evidence":"provisional_reference",humanGold:false};
});}
export function experimentReport(dataset:ThermalDataset,gold:Record<string,ThermalGold>={}){
  const baselines=evaluateBaselines(dataset,gold),references=referencePackets(dataset),sample=fixedSample(dataset);
  const verified=Object.values(gold).filter(g=>g.status==="verified_gold"&&g.datasetVersion===dataset.version).length;
  return {title:"PatentLens thermal pilot — offline experimental readiness",datasetVersion:dataset.version,datasetHash:dataset.datasetHash,taxonomyVersion:dataset.taxonomyVersion,patents:dataset.entries.map(d=>({publicationNumber:d.publicationNumber,sourceUrl:d.sourceUrl,contentHash:d.contentHash})),completeness:Object.fromEntries(["abstract","independentClaims","cpc","ipc"].map(k=>[k,dataset.entries.filter(d=>{const v=d[k as keyof ThermalDocument];return Array.isArray(v)?v.length:Boolean(v);}).length])),verifiedGold:verified,validatedClassificationAccuracy:verified?"see verified comparisons":"unavailable",baselineSummary:Object.fromEntries(Object.entries(baselines).map(([k,v])=>[k,(({rows,...rest})=>rest)(v)])),fixedFirstFive:sample,references,realXaiBenchmark:"not executed",realApiCalls:0,modelOutputQuality:"unavailable",evidenceErrors:"not measured",totalApiCostUsd:0,medianLatencyMs:null,typicalCases:{inScope:["EP3149425B1","EP4498205A1"],boundary:["EP4761489A1","EP4697879A1"],outOfScope:["EP4015272B1","EP4793571A3","EP4823254A1"],uncertain:["EP4231797A1","EP4476289B1","EP4464131B1","EP4822824A1"]},workflowComparison:{ruleOnly:{processed:dataset.entries.length,humanReviewCount:null,actualMinutes:null},llmAssisted:{processed:0,humanReviewCount:null,actualMinutes:null}},managementValue:"unmeasured; independent Gold and actual workflow time required",limitations:["Real xAI benchmark not executed.","Validated classification accuracy unavailable.","Reference packets are not independent human Gold.","No actual human review time recorded."],nextStep:"Independent reviewer validates a subset and records time; then user may authorize the fixed five real-model comparison."};
}
export function reportMarkdown(report:ReturnType<typeof experimentReport>){const b=report.baselineSummary;return `# ${report.title}\n\nDataset: ${report.datasetVersion} (${report.datasetHash})\nTaxonomy: ${report.taxonomyVersion}\nPatents: ${report.patents.length}; Gold: ${report.verifiedGold}\n\n## Data completeness\n${Object.entries(report.completeness).map(([k,v])=>`- ${k}: ${v}/${report.patents.length}`).join("\n")}\n\n## Baselines\n${Object.entries(b).map(([k,v])=>`- ${k}: applicable ${v.applicable}, classified ${v.classified}, unclassified ${v.unclassified}, conflicts ${v.conflicts}, coverage ${v.coverage.numerator}/${v.coverage.denominator}, verified accuracy ${v.verifiedComparison.value??"unavailable"}`).join("\n")}\n\n## Fixed first five\n${report.fixedFirstFive.map(x=>`- ${x.publicationNumber} (${x.inputHash}): ${x.reason}`).join("\n")}\n\n## Patent sources and review packets\n${report.references.map(x=>`### ${x.publicationNumber}\nSource: ${x.sourceUrl}\nScope candidate: ${x.industryScopeCandidate}; technology: ${x.technologyCandidate}; product: ${x.productApplicationCandidate.join(", ")}\nDescription (${x.sourceLevel}): ${x.originalDescription}\nIssue: ${x.dispute}\nEvidence: ${x.evidence.map(e=>`${e.section}: ${e.sourceSpan}`).join(" | ")}\nCompleteness: ${JSON.stringify(x.dataCompleteness)}; status: ${x.reviewStatus}\n`).join("\n")}\n## Model and cost\nReal xAI benchmark not executed. Real API calls: 0; cost: $0; latency and model quality unavailable.\n\n## Workflow and business value\nRule-only processed ${report.workflowComparison.ruleOnly.processed}; LLM-assisted processed 0. Human review counts and actual time remain unmeasured. Business incremental value unmeasured.\n\n## Limits and next step\nValidated classification accuracy unavailable. These reference packets are provisional, not human Gold. ${report.nextStep}\n`;}
