import { readFile, writeFile } from "node:fs/promises";
import { classifyThermal, freezeThermalDataset } from "../src/pilot/thermal.ts";

const previous = JSON.parse(await readFile(new URL("../data/smart-device-thermal-v1.2.json",import.meta.url),"utf8"));
if (previous.name !== "smart-device-thermal-v1" || previous.version !== "smart-device-thermal-v1.2-2026-10-24") throw new Error("前一专题冻结集版本不符");
const entries = previous.entries.map(entry => ({...entry,...classifyThermal(entry)}));
const revised = freezeThermalDataset(entries,previous.searchLog,previous.candidates,"smart-device-thermal-v1.3-2026-10-24",previous.version);
if (revised.datasetHash !== previous.datasetHash || revised.entries.some((e,i)=>e.contentHash!==previous.entries[i].contentHash)) throw new Error("分类修订不得改变冻结的专利输入");
await writeFile(new URL("../data/smart-device-thermal-v1.3.json",import.meta.url),JSON.stringify(revised,null,2),{flag:"wx"});
process.stdout.write(JSON.stringify({version:revised.version,parent:revised.parentVersion,count:entries.length,inputHash:revised.datasetHash,classificationHash:revised.classificationHash,scopes:Object.fromEntries(["in_scope","boundary_case","out_of_scope","uncertain"].map(s=>[s,entries.filter(e=>e.scope===s).length]))})+"\n");
