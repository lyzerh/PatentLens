import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { formatReport, runPipeline } from "./pipeline.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = async (name) => JSON.parse(await readFile(path.join(here, "..", "fixtures", name), "utf8"));

const rawPatent = await fixture("raw-patent.json");
const goodOutput = await fixture("mock-llm-output.good.json");
const badOutput = await fixture("mock-llm-output.bad.json");

console.log("=== Good mock output ===");
console.log(formatReport(runPipeline({ rawPatent, structuredOutput: goodOutput })));
console.log("\n=== Bad mock output ===");
console.log(formatReport(runPipeline({ rawPatent, structuredOutput: badOutput })));
