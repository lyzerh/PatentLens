import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createThermalDocument, freezeThermalDataset, validateFrozenThermalDataset } from '../src/pilot/thermal.ts';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const demoDir = join(root, 'data', 'portfolio-synthetic-demo');
const datasetPath = join(demoDir, 'dataset.json');

export function buildSyntheticDemoDataset() {
  const claims = [
    ['EP9000001A1', 'Synthetic mock thermal interface material A', 'A thermal interface material, comprising: a non-silicone resin comprising a phase change material; a plasticizer present at between 25 and 50 percent by weight of the non-silicone resin; and a thermally conductive particulate filler having a particle size of less than 25 µm.'],
    ['EP9000002A1', 'Synthetic mock thermal interface material B', 'A thermal interface material, comprising: a non-silicone resin comprising a phase change material; a plasticizer present at between 30 and 55 percent by weight of the total composition; and a thermally conductive particulate filler having a particle size of less than 20 µm.'],
    ['EP9000003A1', 'Synthetic mock cooling apparatus A', 'A cooling apparatus comprising: a vapor chamber thermally coupled to a heat pipe; a cooling fan; a temperature sensor connected to a controller.'],
    ['EP9000004A1', 'Synthetic mock cooling apparatus B', 'A cooling apparatus comprising: a heat pipe thermally coupled to a cooling fan; a temperature sensor connected to a controller.']
  ];
  const docs = claims.map(([id, title, claim]) => createThermalDocument({
    publicationNumber: id, title, abstract: 'Synthetic mock demonstration only. No real patent or commercial implementation is represented.',
    claims: [{ number: '1', text: claim }], description: '[0001] Synthetic mock description for the PatentLens local demonstration.',
    sourceUrl: `https://data.epo.org/publication-server/rest/v1.2/patents/${id.slice(0, -2)}NW${id.slice(-2)}/document.xml`,
    fetchedAt: '2026-01-01T00:00:00.000Z'
  }, ['synthetic_mock_demo']));
  return freezeThermalDataset(docs, [], [], 'synthetic-portfolio-demo-v1');
}

async function start() {
  await mkdir(demoDir, { recursive: true });
  try { await writeFile(datasetPath, JSON.stringify(buildSyntheticDemoDataset(), null, 2), { flag: 'wx' }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const dataset = JSON.parse(await readFile(datasetPath, 'utf8'));
  validateFrozenThermalDataset(dataset);
  if (dataset.version !== 'synthetic-portfolio-demo-v1') throw new Error('The demo dataset path contains another dataset.');
  const env = { ...process.env, XAI_API_KEY: '', PATENT_PORT: process.env.PATENT_DEMO_PORT || '4323', PATENT_THERMAL_DATA: datasetPath,
    PATENT_FEATURE_STORE: join(demoDir, 'features.json'), PATENT_REPOSITORY_STORE: join(demoDir, 'repository.json'),
    PATENT_COMPARISON_STORE: join(demoDir, 'comparisons.json'), PATENT_COLLECTION_STORE: join(demoDir, 'collections.json'),
    PATENT_FEATURE_LLM_AUDIT_STORE: join(demoDir, 'llm-audit.json') };
  console.log(`Synthetic/mock portfolio demo: http://127.0.0.1:${env.PATENT_PORT}/patent-repository`);
  const child = spawn(process.execPath, ['src/server.js'], { cwd: root, env, stdio: 'inherit' });
  child.once('exit', code => { process.exitCode = code ?? 1; });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await start();
