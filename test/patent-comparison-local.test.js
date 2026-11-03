import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {extractRuleFeatures,validateFeatureCandidate} from '../src/pilot/patent-features.ts';
import {compareFeatureSources} from '../src/pilot/patent-comparison.ts';
import {buildComparisonReview} from '../public/claim-coverage.js';

const source=doc=>{const candidate=extractRuleFeatures(doc),validation=validateFeatureCandidate(candidate,doc);return {doc,candidate,recordId:null,revisionId:null,validation};};

test('UAT-02 frozen Rules pair keeps the known element, limitation and relation coverage visible',async()=>{
  const dataset=JSON.parse(await readFile(new URL('../data/smart-device-thermal-v1.3.json',import.meta.url),'utf8'));
  const docA=dataset.entries.find(x=>x.publicationNumber==='EP4761489A1'),docB=dataset.entries.find(x=>x.publicationNumber==='EP4231797A1');
  assert.ok(docA&&docB);
  const left=source(docA),right=source(docB),comparison=compareFeatureSources(left,right);
  const reviewA=buildComparisonReview('a',left,comparison),reviewB=buildComparisonReview('b',right,comparison);
  assert.deepEqual([left.candidate.elements.length,left.candidate.limitations.length,left.candidate.relationships.length],[12,5,9]);
  assert.deepEqual([right.candidate.elements.length,right.candidate.limitations.length,right.candidate.relationships.length],[14,8,4]);
  assert.equal(comparison.alignments.length,1);assert.equal(comparison.limitationComparisons.length,0);assert.equal(comparison.relationComparisons.length,0);
  assert.equal(reviewA.elements.length,12);assert.equal(reviewA.unpairedLimitations.length,5);assert.equal(reviewA.unpairedRelationships.length,9);
  assert.equal(reviewB.elements.length,14);assert.equal(reviewB.unpairedLimitations.length,8);assert.equal(reviewB.unpairedRelationships.length,4);
  assert.ok(reviewA.limitations.some(x=>x.originalText.includes('electrically connected')&&x.originalText.includes('away from the accommodating cavity')));
  assert.ok(reviewB.limitations.some(x=>x.originalText.includes('second width less than the first width')));
  assert.ok(reviewB.unresolvedSpans.some(x=>x.sourceSpan.includes('closed space')&&docB.independentClaims[0].includes(x.sourceSpan)));
  assert.ok(reviewB.coverage.some(x=>x.status==='potential_gap'&&x.sourceSpan.includes('closed space')));
});
