import test from 'node:test';
import assert from 'node:assert/strict';
import {createThermalDocument} from '../src/pilot/thermal.ts';
import {extractRuleFeatures,validateFeatureCandidate} from '../src/pilot/patent-features.ts';
import {reviewCoverage,compareCoverage} from '../public/claim-coverage.js';

// Entirely synthetic claims; no frozen patent text, private snapshot, provider or network.
function make(id,claim){const [,number,kind]=id.match(/^EP(\d+)([A-Z]\d)$/);return createThermalDocument({publicationNumber:id,title:'Synthetic mock invention',abstract:'Synthetic mock data',claims:[{number:'1',text:claim}],description:'[0001] Synthetic mock description.',sourceUrl:`https://data.epo.org/publication-server/rest/v1.2/patents/EP${number}NW${kind}/document.xml`,fetchedAt:'2026-01-01T00:00:00.000Z'},['synthetic_mock_fixture']);}
const cases=[
  make('EP7000001A1','A thermal interface material, comprising:\na non-silicone resin comprising a phase change material;\na plasticizer present at between 25 and 50 percent by weight of the non-silicone resin;\nthermally conductive particulate filler wettable by the plasticizer and having a particle size of less than 25 µm,\nwherein the thermal interface material exhibits a melt viscosity of less than 105 Pa*s.'),
  make('EP7000002A1','A cooling apparatus comprising: a cooling fan; a temperature sensor connected to a controller; an unusual hinged frame.'),
  make('EP7000003A1','A method comprising: sensing a temperature; adjusting a cooling signal; an unexplained calibration operation.')
];
const source=doc=>({publicationNumber:doc.publicationNumber,documentHash:doc.contentHash,sourceUrl:doc.sourceUrl,claim1:doc.independentClaims[0]});
const snapshot=doc=>{const candidate=extractRuleFeatures(doc);return {candidate,validation:validateFeatureCandidate(candidate,doc)};};

test('synthetic material, apparatus and control claims map to grounded segments and expose unresolved text',()=>{
  for(const doc of cases){const s=snapshot(doc),rows=reviewCoverage(source(doc),s.candidate,s.validation);assert.ok(rows.length);assert.ok(rows.some(x=>x.fields.length));assert.ok(rows.every(x=>source(doc).claim1.includes(x.sourceSpan)));}
  const material=reviewCoverage(source(cases[0]),...Object.values(snapshot(cases[0])));assert.ok(material.some(x=>x.issues.some(i=>i.startsWith('ambiguous:'))));
  const apparatus=reviewCoverage(source(cases[1]),...Object.values(snapshot(cases[1])));assert.ok(apparatus.some(x=>x.issues.some(i=>i.startsWith('unresolved:'))));
});

test('missing binding, missing evidence, unmapped text and candidate-only differences are review hints',()=>{
  const doc=cases[0],rules=snapshot(doc),grok=structuredClone(rules);
  const numeric=grok.candidate.limitations.find(x=>x.numericStatus==='parsed');numeric.modifiesElementId=null;
  grok.candidate.relationships=[];grok.candidate.limitations=grok.candidate.limitations.filter(x=>!x.originalText.includes('non-silicone resin')||x.limitationType==='Composition Ratio');
  const rows=reviewCoverage(source(doc),grok.candidate,grok.validation);assert.ok(rows.some(x=>x.issues.some(i=>i.startsWith('unbound:'))));
  const differences=compareCoverage(source(doc),rules,grok);assert.ok(differences.some(x=>x.rulesOnly.length));
  const bad=structuredClone(grok);bad.candidate.elements[0].evidence=null;assert.ok(reviewCoverage(source(doc),bad.candidate,bad.validation).some(x=>x.issues.some(i=>i.startsWith('missing_evidence:'))));
  const empty=structuredClone(grok);empty.candidate.elements=[];empty.candidate.limitations=[];empty.candidate.relationships=[];assert.ok(reviewCoverage(source(doc),empty.candidate,empty.validation).some(x=>x.status==='potential_gap'));
  assert.equal(rules.candidate.limitations.find(x=>x.numericStatus==='parsed').modifiesElementId!==null,true,'analysis did not mutate Rules snapshot');
});

test('document identity mismatch and mixed versions are rejected before comparison',()=>{
  const one=snapshot(cases[0]),two=snapshot(cases[1]);
  assert.throws(()=>reviewCoverage(source(cases[1]),one.candidate,one.validation),/COVERAGE_SOURCE_CONFLICT/);
  assert.throws(()=>compareCoverage(source(cases[0]),one,two),/COVERAGE_SOURCE_CONFLICT/);
  const changed=structuredClone(one);changed.candidate.identity.documentHash='other';assert.throws(()=>compareCoverage(source(cases[0]),one,changed),/COVERAGE_SOURCE_CONFLICT/);
});

test('bilingual UI strings and read-only browser module have no paid action',async()=>{
  const locale=(await import('../public/i18n/features.js')).default;
  for(const key of ['features.coverageReview','features.coverage.status.mapped','features.coverage.status.potential_gap','features.coverage.status.needs_review','features.coverage.onlyHere'])assert.ok(locale.zh[key]&&locale.en[key]);
  const {readFile}=await import('node:fs/promises');const html=await readFile(new URL('../public/patent-features.html',import.meta.url),'utf8');const js=await readFile(new URL('../public/claim-coverage.js',import.meta.url),'utf8');assert.match(html,/id="coverage-review"/);assert.doesNotMatch(js,/fetch\(|api\.x\.ai|llm-execute/);
});
