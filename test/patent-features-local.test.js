import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {extractRuleFeatures,validateFeatureCandidate} from '../src/pilot/patent-features.ts';

test('frozen EP4476289B1 Claim 1 is expressible without writing any private record',async()=>{
  const data=JSON.parse(await readFile(new URL('../data/smart-device-thermal-v1.3.json',import.meta.url),'utf8'));
  const doc=data.entries.find(x=>x.publicationNumber==='EP4476289B1');assert.ok(doc);
  const c=extractRuleFeatures(doc),v=validateFeatureCandidate(c,doc);
  assert.equal(c.identity.documentHash,doc.contentHash);assert.equal(c.technicalSubject.type,'Material / Composition');
  for(const name of ['resin','phase change material','plasticizer','elastomeric agent','particulate filler'])assert.ok(c.elements.some(x=>x.elementName===name));
  const ratio=c.limitations.find(x=>x.limitationType==='Composition Ratio');assert.deepEqual([ratio.lowerBound,ratio.upperBound,ratio.referenceBasis],[25,50,'non-silicone resin']);
  assert.ok(c.limitations.some(x=>x.originalText==='non-silicone resin'));
  assert.ok(c.limitations.some(x=>x.unit==='µm'&&x.upperBound===25));
  assert.ok(c.limitations.some(x=>x.unit==='°C * cm2/W'&&x.upperBound===0.5));
  assert.ok(c.limitations.some(x=>x.unit==='°C'&&x.lowerBound===40&&x.upperBound===80));
  assert.ok(c.limitations.some(x=>x.unit==='Pa*s'&&x.numericStatus==='ambiguous'&&x.upperBound===null));
  const subject=c.elements.find(x=>x.elementName==='thermal interface material');assert.ok(subject);
  for(const unit of ['°C * cm2/W','°C','Pa*s'])assert.equal(c.limitations.find(x=>x.unit===unit).modifiesElementId,subject.elementId);
  assert.ok(v.coverageItems.some(x=>x.status==='partial'&&x.unresolvedReasons.some(reason=>reason.includes('exponent'))));
  assert.equal(c.descriptionFindings.every(x=>x.claimLimitation===false&&x.evidence.section==='description'),true);
  assert.equal(v.schemaValid,true);assert.equal(v.accepted,true);assert.ok(v.coverage.unresolved>0);
});
