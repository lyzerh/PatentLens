import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { experimentReport, reportMarkdown } from "../src/pilot/thermal-experiment.ts";
import { validateFrozenThermalDataset } from "../src/pilot/thermal.ts";

const dataPath=fileURLToPath(new URL("../data/smart-device-thermal-v1.3.json",import.meta.url));
const reportBase=fileURLToPath(new URL("../reports/smart-device-thermal-experiment-offline",import.meta.url));
const dataset=JSON.parse(await readFile(dataPath,"utf8"));
validateFrozenThermalDataset(dataset);
const report=experimentReport(dataset,{});
await writeFile(reportBase+".json",JSON.stringify(report,null,2)+"\n");
await writeFile(reportBase+".md",reportMarkdown(report));
console.log(JSON.stringify({json:reportBase+".json",markdown:reportBase+".md",baselines:report.baselineSummary,fixed:report.fixedFirstFive.map(x=>x.publicationNumber)},null,2));
