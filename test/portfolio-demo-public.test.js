import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSyntheticDemoDataset } from '../scripts/start-portfolio-demo.js';
import { validateFrozenThermalDataset } from '../src/pilot/thermal.ts';
import { extractRuleFeatures } from '../src/pilot/patent-features.ts';
import { compareFeatureSources } from '../src/pilot/patent-comparison.ts';

test('public synthetic portfolio demo runs Rules and evidence-backed comparison without a provider', () => {
  const dataset = buildSyntheticDemoDataset();
  validateFrozenThermalDataset(dataset);
  assert.equal(dataset.entries.length, 4);
  assert.ok(dataset.entries.every(doc => doc.title.startsWith('Synthetic mock') && doc.discoveryQueries.includes('synthetic_mock_demo')));
  const [a, b] = dataset.entries.slice(0, 2).map(doc => ({ doc, candidate: extractRuleFeatures(doc), recordId: null, revisionId: null }));
  const result = compareFeatureSources(a, b);
  assert.ok(result.alignments.length > 0);
  assert.ok(result.diagnostics.every(item => item.pass));
  assert.ok(result.alignments.every(item => item.semanticSupport === 'not_assessed' && item.comparisonResult === 'undetermined'));
  assert.ok(result.limitationComparisons.some(item => item.referenceBasisA !== item.referenceBasisB));
});
