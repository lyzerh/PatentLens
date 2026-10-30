import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { buildSyntheticDemoDataset } from './start-portfolio-demo.js';
import { createApp } from '../src/server.js';
import { createPatentCollectionService } from '../src/pilot/patent-collections.ts';

const browserPath = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
].find(path => path && existsSync(path));
if (!browserPath) throw new Error('Chrome or Edge is required; set CHROME_PATH to its executable.');

await mkdir(resolve('data'), { recursive: true });
const dir = await mkdtemp(join(resolve('data'), 'portfolio-download-'));
const paths = {
  thermalDatasetPath: join(dir, 'dataset.json'),
  featureStorePath: join(dir, 'features.json'),
  repositoryStorePath: join(dir, 'repository.json'),
  collectionStorePath: join(dir, 'collections.json'),
  comparisonStorePath: join(dir, 'comparisons.json'),
  featureLlmStorePath: join(dir, 'llm-audit.json')
};
await writeFile(paths.thermalDatasetPath, JSON.stringify(buildSyntheticDemoDataset()));
const app = createApp({
  ...paths,
  getXaiKey: () => null,
  fetchImpl: async () => { throw new Error('External network is forbidden in download acceptance'); }
});
await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
const port = app.address().port;
let browser;
try {
  browser = await chromium.launch({ executablePath: browserPath, headless: true, downloadsPath: dir });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico')) errors.push(message.text()); });
  await page.goto(`http://127.0.0.1:${port}/patent-repository`);
  await page.locator('#documents input[value="EP9000002A1"]').waitFor();
  await page.locator('#documents input[value="EP9000001A1"]').check();
  await page.locator('#documents input[value="EP9000002A1"]').check();
  await page.locator('#preview').click();
  await page.locator('#run').click();
  try { await page.locator('#results .row').filter({ hasText: 'EP9000002A1' }).waitFor({ timeout: 5000 }); }
  catch { throw new Error(JSON.stringify({ message: await page.locator('#message').innerText(), batch: await page.locator('#batch-results').innerText(), errors })); }
  await page.locator('#collection-title').fill('Synthetic download acceptance');
  await page.locator('#collection-description').fill('Synthetic/mock browser download test.');
  await page.locator('#collection-create').click();
  for (const id of ['EP9000001A1', 'EP9000002A1'])
    await page.locator('#results .row').filter({ hasText: id }).getByRole('button', { name: /加入集合|Add to collection/ }).click();
  await page.waitForFunction(() => document.querySelector('#collection-list')?.selectedOptions[0]?.textContent?.includes('· 2'));
  const collectionId = await page.locator('#collection-list').inputValue();
  assert.ok(collectionId);
  const service = createPatentCollectionService({
    datasetPath: paths.thermalDatasetPath, featureStorePath: paths.featureStorePath,
    repositoryStorePath: paths.repositoryStorePath, storePath: paths.collectionStorePath
  });
  const expected = await service.exportCollection(collectionId);
  for (const [format, button, extension] of [
    ['markdown', '#collection-md', '.md'],
    ['json', '#collection-json', '.json']
  ]) {
    const event = page.waitForEvent('download', { timeout: 15000 });
    await page.locator(button).click();
    const download = await event;
    assert.equal(download.suggestedFilename(), `patent-research-collection-${collectionId}${extension}`);
    const path = join(dir, download.suggestedFilename());
    await download.saveAs(path);
    const value = new TextDecoder('utf-8', { fatal: true }).decode(await readFile(path));
    if (format === 'markdown') {
      assert.equal(value, expected.markdown);
      for (const snapshot of expected.json.featureSnapshots) {
        assert.ok(value.includes(snapshot.publicationNumber));
        assert.ok(value.includes(snapshot.featureRecordId));
        assert.ok(value.includes(snapshot.reviewStatus));
      }
      assert.ok(value.includes('Evidence: claims / Claim 1'));
      assert.ok(value.includes('non-silicone resin'));
    } else {
      assert.deepEqual(JSON.parse(value), expected.json);
    }
    console.log(`${format}: ${path} (${value.length} characters)`);
  }
  assert.deepEqual(errors, []);
  console.log('Browser downloads, snapshot identity, UTF-8, and console: passed');
} finally {
  await browser?.close();
  await new Promise(resolve => app.close(resolve));
}
