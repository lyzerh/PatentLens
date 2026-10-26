import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createThermalDocument,freezeThermalDataset} from '../src/pilot/thermal.ts';
import {createPatentFeatureService,extractRuleFeatures,validateFeatureCandidate,mockFeatureProvider,disabledLlmFeatureProvider} from '../src/pilot/patent-features.ts';
import {createApp} from '../src/server.js';

// Entirely synthetic: IDs exercise the EP source-version gate and text is invented.
const make=(id,claim,description='[0001] Synthetic description only.')=>{
  const [,number,kind]=id.match(/^EP(\d+)([A-Z]\d)$/);
  return createThermalDocument({publicationNumber:id,title:'Synthetic thermal patent',abstract:'Synthetic mock data.',claims:[{number:'1',text:claim}],description,
    sourceUrl:`https://data.epo.org/publication-server/rest/v1.2/patents/EP${number}NW${kind}/document.xml`,fetchedAt:'2026-01-01T00:00:00.000Z'},['synthetic_mock_fixture']);
};
const material=make('EP4476289B1','A thermal interface material, comprising:\na non-silicone resin comprising a phase change material;\na plasticizer present at between 25 and 50 percent by weight of the non-silicone resin;\nthermally conductive particulate filler wettable by the plasticizer and having a particle size of less than 25 µm,\nwherein the thermal interface material exhibits a thermal impedance of less than 0.5 °C * cm2/W, a melting point of between 40 and 80 °C, and a melt viscosity of less than 105 Pa*s.');
const apparatus=make('EP4498205A1','A cooling apparatus comprising: a cooling fan; a temperature sensor connected to a controller; an unrecognized helicoidal bracket.');
const docs=[material,apparatus];
async function fixture(){await mkdir(resolve('data'),{recursive:true});const dir=await mkdtemp(join(resolve('data'),'patent-features-synthetic-'));const datasetPath=join(dir,'dataset.json'),storePath=join(dir,'feature-state.json');
  await writeFile(datasetPath,JSON.stringify(freezeThermalDataset(docs,[],[],'synthetic-feature-v1')));return {dir,datasetPath,storePath,service:createPatentFeatureService({datasetPath,storePath})};}
const clone=x=>structuredClone(x);

test('synthetic material: negative limit, ratio basis, units, bounds and ambiguous encoding',()=>{
  const c=extractRuleFeatures(material),v=validateFeatureCandidate(c,material);
  assert.equal(c.technicalSubject.type,'Material / Composition');assert.equal(v.schemaValid,true);assert.equal(v.accepted,true);
  assert.ok(c.elements.some(x=>x.elementName==='resin'));
  assert.ok(c.limitations.some(x=>x.originalText==='non-silicone resin'&&x.limitationType==='Material Constraint'));
  const ratio=c.limitations.find(x=>x.limitationType==='Composition Ratio');assert.deepEqual([ratio.lowerBound,ratio.upperBound,ratio.referenceBasis,ratio.unit],[25,50,'non-silicone resin','percent by weight']);
  const particle=c.limitations.find(x=>x.unit==='µm');assert.equal(particle.upperBound,25);assert.equal(particle.upperInclusive,false);
  const viscosity=c.limitations.find(x=>x.originalText.includes('melt viscosity'));assert.equal(viscosity.numericStatus,'ambiguous');assert.equal(viscosity.upperBound,null);
  const subject=c.elements.find(x=>x.elementName==='thermal interface material');assert.ok(subject);
  for(const unit of ['°C * cm2/W','°C','Pa*s'])assert.equal(c.limitations.find(x=>x.unit===unit).modifiesElementId,subject.elementId);
  assert.equal(ratio.modifiesElementId,c.elements.find(x=>x.elementName==='plasticizer').elementId);
  assert.equal(particle.modifiesElementId,c.elements.find(x=>x.elementName==='particulate filler').elementId);
  assert.ok(c.unresolvedSpans.some(x=>x.reason.includes('exponent')));assert.ok(c.relationships.some(x=>x.relationType==='contains'));
  assert.ok(c.relationships.some(x=>x.originalText.includes('wettable by')));
  assert.ok(v.coverageItems.some(x=>x.status==='partial'&&x.unresolvedReasons.some(reason=>reason.includes('exponent'))));
  for(const element of c.elements)assert.equal(element.evidence.publicationNumber,material.publicationNumber);
});
test('synthetic apparatus has distinct subject, components, relationship and unresolved content',()=>{
  const c=extractRuleFeatures(apparatus),v=validateFeatureCandidate(c,apparatus);
  assert.equal(c.technicalSubject.type,'Apparatus');assert.ok(c.elements.some(x=>x.elementName==='cooling fan'));
  assert.ok(c.elements.some(x=>x.elementName==='temperature sensor'));
  assert.ok(c.relationships.some(x=>x.relationType==='connected_to'));
  assert.ok(c.unresolvedSpans.some(x=>x.sourceSpan.includes('helicoidal bracket')));
  assert.equal(v.accepted,true);assert.equal(v.coverage.unresolved,1);
});
test('schema, fabricated evidence, numeric drift, ratio basis and relation endpoints are independently rejected',()=>{
  const c=extractRuleFeatures(material);
  for(const mutate of [x=>x.schemaVersion='other',x=>x.elements[0].evidence.sourceSpan='invented',x=>x.identity.documentHash='wrong',
    x=>x.limitations.find(y=>y.limitationType==='Composition Ratio').upperBound=60,
    x=>x.limitations.find(y=>y.limitationType==='Composition Ratio').referenceBasis='total composition',
    x=>x.limitations.find(y=>y.numericStatus==='ambiguous').unit='Nm',
    x=>x.elements[0].evidence.locator='Description [0001]',
    x=>x.elements[0].evidence.publicationNumber='EP0000000A1',
    x=>x.relationships[0].toElementId='missing']){
    const bad=clone(c);mutate(bad);const report=validateFeatureCandidate(bad,material);assert.equal(report.accepted,false);
  }
  const bad=clone(c);bad.descriptionFindings.push({findingId:'fake',kind:'described_effect',text:'Synthetic claim',evidence:{section:'claims',sourceSpan:'Synthetic claim',sourceUrl:material.sourceUrl,documentHash:material.contentHash,locator:'Claim 1'},claimLimitation:false,semanticSupport:'not_assessed'});
  assert.equal(validateFeatureCandidate(bad,material).accepted,false);
  const missingType=clone(c);delete missingType.elements[0].elementType;assert.equal(validateFeatureCandidate(missingType,material).schemaValid,false);
  const human=clone(c);human.relationships[0].semanticSupport='unsupported';
  assert.equal(validateFeatureCandidate(human,material).accepted,false);
  assert.equal(validateFeatureCandidate(human,material,true).accepted,true);
});
test('mock provider runs offline and paid adapter refuses without any key',async()=>{
  const c=await mockFeatureProvider.extract(material);assert.equal(c.extractionMode,'mock_llm');assert.equal(validateFeatureCandidate(c,material).accepted,true);
  await assert.rejects(disabledLlmFeatureProvider.extract(material),/PAID_FEATURE_EXTRACTION_DISABLED/);
});
test('separate store preserves immutable machine output and append-only human revisions',async()=>{
  const f=await fixture();try{
    const taxonomyPath=join(f.dir,'taxonomy-v2-state.json'),taxonomySentinel='{"syntheticMock":true,"reviewStatus":"draft"}';
    await writeFile(taxonomyPath,taxonomySentinel);
    const machine=await f.service.create(material.publicationNumber);assert.equal(machine.revisions.length,0);
    assert.equal(machine.machineStatus,'machine_generated_unreviewed');assert.equal(machine.machineOutput.extractionMode,'rules');
    assert.equal(await readFile(taxonomyPath,'utf8'),taxonomySentinel);
    await assert.rejects(f.service.create(material.publicationNumber),/ALREADY_EXISTS/);
    const edited=clone(machine.machineOutput);edited.elements[0].elementName='resin (human candidate)';
    const first=await f.service.saveReview(material.publicationNumber,machine.recordId,'Synthetic Reviewer','draft',edited);
    const second=await f.service.saveReview(material.publicationNumber,machine.recordId,'Synthetic Reviewer','reviewed',{...edited,reviewStatus:'reviewed'});
    assert.equal(second.revisions.length,2);assert.equal(second.machineOutput.elements[0].elementName,machine.machineOutput.elements[0].elementName);
    const restarted=createPatentFeatureService({datasetPath:f.datasetPath,storePath:f.storePath});
    assert.equal((await restarted.load(material.publicationNumber)).revisions.length,2);
    await assert.rejects(f.service.saveReview(material.publicationNumber,'wrong','Synthetic Reviewer','draft',edited),/VERSION_CONFLICT/);
    await assert.rejects(f.service.saveReview(material.publicationNumber,machine.recordId,'Synthetic Reviewer','verified_gold',edited),/INVALID_REVIEW_STATUS/);
    const bad=clone(edited);bad.reviewStatus='reviewed';bad.elements[0].evidence.sourceSpan='invented';await assert.rejects(f.service.saveReview(material.publicationNumber,machine.recordId,'Synthetic Reviewer','reviewed',bad),/VALIDATION_FAILED/);
    const exported=await f.service.exportRecord(material.publicationNumber);assert.equal(exported.json.revisions.length,2);assert.match(exported.markdown,/not Verified Gold/);
    assert.equal(JSON.parse(await readFile(f.storePath,'utf8')).schemaVersion,'patent-feature-v1');
  }finally{await rm(f.dir,{recursive:true,force:true});}
});
test('feature API is same-origin/CSRF only, loads synthetic data and never touches provider',async()=>{
  const f=await fixture();let network=0;const app=createApp({thermalDatasetPath:f.datasetPath,featureStorePath:f.storePath,fetchImpl:async()=>{network++;throw new Error('external forbidden');}});
  await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));const root=`http://127.0.0.1:${app.address().port}`;
  try{const csrf=(await(await fetch(root+'/api/xai/settings/csrf')).json()).csrfToken;
    const post=(action,body={},headers={})=>fetch(root+'/api/patent-features/'+action,{method:'POST',headers:{'Content-Type':'application/json','X-Patent-Client':'workbench',Origin:root,'X-Patent-CSRF':csrf,...headers},body:JSON.stringify(body)});
    assert.equal((await fetch(root+'/patent-features')).status,200);
    assert.equal((await post('list',{}, {'X-Patent-CSRF':'wrong'})).status,403);
    assert.equal((await post('list',{}, {Origin:'https://evil.example'})).status,403);
    assert.equal((await post('extract',{publicationNumber:material.publicationNumber,mode:'llm_candidate'})).status,400);
    const extracted=await(await post('extract',{publicationNumber:material.publicationNumber})).json();assert.equal(extracted.validation.accepted,true);
    const saved=await(await post('create',{publicationNumber:material.publicationNumber})).json();assert.equal(saved.machineOutput.identity.publicationNumber,material.publicationNumber);
    assert.equal(network,0);
  }finally{app.closeAllConnections();await new Promise(resolve=>app.close(resolve));await rm(f.dir,{recursive:true,force:true});}
});
test('feature page shares bilingual i18n and has no paid execution control',async()=>{
  const html=await readFile(new URL('../public/patent-features.html',import.meta.url),'utf8');const js=await readFile(new URL('../public/patent-features.js',import.meta.url),'utf8');
  const locale=(await import('../public/i18n/features.js')).default;
  for(const key of ['features.title','features.elements','features.numeric','features.saveReviewed'])assert.ok(locale.zh[key]&&locale.en[key]);
  assert.match(html,/id="extract"/);assert.match(html,/id="editor"/);assert.doesNotMatch(js,/api\.x\.ai|smoke-run|smoke-authorize/);
});
