import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { diagnoseThermalEvidence, thermalPrompt, validateThermalOutput } from "../src/pilot/thermal-benchmark.ts";
import { replayThermalSmoke } from "../src/pilot/thermal-replay.ts";

const dataset=JSON.parse(await readFile(new URL("../data/smart-device-thermal-v1.3.json",import.meta.url),"utf8"));
const smokePath=new URL("../data/smart-device-thermal-smoke.json",import.meta.url);
const savedBytes=await readFile(smokePath);
const saved=JSON.parse(savedBytes.toString("utf8")).runs.find(x=>x.publicationNumber==="EP3149425B1"&&x.model==="grok-4.3");
const doc=dataset.entries.find(x=>x.publicationNumber==="EP3149425B1");

test("saved Grok response replays offline against same frozen version and input hash",async()=>{
  const before=createHash("sha256").update(savedBytes).digest("hex"),replay=replayThermalSmoke(dataset,saved);
  assert.equal(saved.inputHash,doc.contentHash);assert.equal(replay.datasetVersionMatch,true);assert.equal(replay.inputHashMatch,true);assert.equal(replay.rawResponseMatchesSavedOutput,true);
  assert.equal(replay.strictBefore,false);assert.equal(replay.strictAfter,false);assert.deepEqual(replay.replayedValidator.errors,["EVIDENCE_NOT_EXACT"]);
  assert.equal(replay.replayedValidator.semanticSupportRate,null);assert.equal(replay.exactRequestBytesVerifiable,false);
  assert.equal(createHash("sha256").update(await readFile(smokePath)).digest("hex"),before);
});

test("four saved evidence items have separate text and source-reference diagnoses",()=>{
  const v=validateThermalOutput(doc,saved.output),e=v.evidenceDiagnostics;assert.equal(e.length,4);
  assert.deepEqual(e.map(x=>x.section),["title","claims","description","description"]);
  assert.deepEqual(e.map(x=>x.span_exact_match),[true,false,true,false]);
  assert.deepEqual(e.map(x=>x.normalized_match),[false,true,false,false]);
  assert.deepEqual(e.map(x=>x.source_reference_match),[false,false,false,false]);
  assert.ok(e.every(x=>x.input_section_available&&x.failure_reason.includes("PUBLICATION_NUMBER_IS_NOT_SOURCE_URL")&&x.semantic_support==="not_assessed"));
  assert.match(e[1].failure_reason,/WHITESPACE_OR_NEWLINE_DIFFERENCE/);assert.match(e[3].failure_reason,/SPAN_NOT_IN_SECTION/);
  assert.ok(!doc.description.includes(saved.output.evidence[3].sourceSpan));assert.ok(doc.description.includes("The vapor chamber 506 may be configured to absorb heat from the heat source 508"));
});

test("strict matching uses the declared section and keeps normalization separate",()=>{
  const claimOnly=doc.independentClaims[0].slice(0,55);const wrong=diagnoseThermalEvidence(doc,{section:"description",sourceSpan:claimOnly,sourceUrl:doc.sourceUrl});assert.equal(wrong.span_exact_match,false);assert.deepEqual(wrong.exact_other_sections,["claims"]);assert.match(wrong.failure_reason,/SPAN_IN_OTHER_SECTION/);
  const exact=diagnoseThermalEvidence(doc,{section:"description",sourceSpan:saved.output.evidence[2].sourceSpan,sourceUrl:doc.sourceUrl});assert.equal(exact.span_exact_match,true);assert.equal(exact.source_reference_match,true);assert.equal(exact.failure_reason,null);
  const unicodeDoc={...doc,description:"Café—device\nmodule"};const unicode=diagnoseThermalEvidence(unicodeDoc,{section:"description",sourceSpan:"Café—device module",sourceUrl:doc.sourceUrl});assert.equal(unicode.span_exact_match,false);assert.equal(unicode.normalized_match,true);
  const caseOnly=diagnoseThermalEvidence({...doc,description:"Thermal Module"},{section:"description",sourceSpan:"thermal module",sourceUrl:doc.sourceUrl});assert.equal(caseOnly.normalized_match,false);assert.match(caseOnly.failure_reason,/CASE_DIFFERENCE/);
});

test("future structured prompt supplies the exact full source URL without changing frozen data",()=>{
  const prompt=thermalPrompt(doc,"C");assert.ok(prompt.includes(JSON.stringify(doc.sourceUrl)));assert.match(prompt,/do not replace it with the publication number/);assert.equal(dataset.datasetHash,"59b22b37b2b7a44bd79940e9df83e3b1972a322906359597ee2949193d6ebf37");
});

test("third historical response replays against its sent excerpt without claiming semantic support or accuracy",()=>{
  const third=JSON.parse(savedBytes.toString("utf8")).runs.find(x=>x.publicationNumber==="EP4761489A1");
  assert.ok(third);assert.equal(third.kind,"engineering_smoke_test");assert.equal(third.accuracy,null);
  const replay=replayThermalSmoke(dataset,third);assert.equal(replay.inputSnapshotHashMatch,true);assert.equal(replay.promptHashMatch,true);assert.equal(replay.rawResponseMatchesSavedOutput,true);
  assert.equal(replay.strictAfter,true);assert.equal(replay.semanticSupport,"not_assessed");assert.equal(replay.replayedValidator.evidenceDiagnostics.length,3);
  assert.ok(replay.replayedValidator.evidenceDiagnostics.every(x=>x.span_exact_match&&x.source_reference_match&&x.semantic_support==="not_assessed"));
  assert.equal(third.inputSnapshot.description.includes("a mobile phone, a tablet, or a computer"),true);
});
