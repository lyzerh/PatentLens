import { createHash } from "node:crypto";
import { validateThermalOutput, thermalPrompt, thermalInput } from "./thermal-benchmark.ts";
import type { ThermalDataset } from "./thermal.ts";

type SavedSmoke={id:string;datasetVersion:string;publicationNumber:string;inputHash:string;inputSnapshot?:ReturnType<typeof thermalInput>;inputSnapshotHash?:string;promptText?:string;promptHash?:string;rawText:string|null;output:unknown;validator:unknown};
export function replayThermalSmoke(dataset:ThermalDataset,run:SavedSmoke){
  const doc=dataset.entries.find(x=>x.publicationNumber===run.publicationNumber);
  if(!doc)throw new Error("Smoke Test 文献不在冻结集");
  const datasetVersionMatch=run.datasetVersion===dataset.version,inputHashMatch=run.inputHash===doc.contentHash;
  if(!datasetVersionMatch||!inputHashMatch)throw new Error("历史响应与冻结数据版本或输入哈希不符，不能离线重放");
  let rawResponseMatchesSavedOutput=false;
  try{rawResponseMatchesSavedOutput=JSON.stringify(JSON.parse(run.rawText??""))===JSON.stringify(run.output);}catch{}
  const snapshot=run.inputSnapshot,snapshotHashMatch=snapshot?createHash("sha256").update(JSON.stringify(snapshot)).digest("hex")===run.inputSnapshotHash:null;
  if(snapshot&&!snapshotHashMatch)throw new Error("Smoke Test 输入快照哈希不符，不能离线重放");
  const promptHashMatch=run.promptText?createHash("sha256").update(run.promptText).digest("hex")===run.promptHash:null;
  if(run.promptText&&!promptHashMatch)throw new Error("Smoke Test Prompt 哈希不符，不能离线重放");
  if(snapshot&&run.promptText!==thermalPrompt({...doc,...snapshot},"C"))throw new Error("Smoke Test Prompt 与输入快照不符，不能离线重放");
  const replayed=validateThermalOutput(snapshot?{...doc,...snapshot}:doc,run.output);
  return {runId:run.id,publicationNumber:run.publicationNumber,datasetVersionMatch,inputHashMatch,inputSnapshotHashMatch:snapshotHashMatch,promptHashMatch,rawResponseMatchesSavedOutput,exactRequestBytesVerifiable:Boolean(snapshot&&run.promptText),requestSnapshotNote:snapshot?"按保存的实际发送输入快照重放 D；Prompt 与快照哈希已核验。":"历史记录未保存完整请求体；根据冻结数据版本、输入哈希及当时服务代码重建原文分区。",originalValidator:run.validator,replayedValidator:replayed,strictBefore:(run.validator as {accepted?:boolean}|null)?.accepted??null,strictAfter:replayed.accepted,semanticSupport:"not_assessed" as const};
}
