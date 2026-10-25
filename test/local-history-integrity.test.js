import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

test('local frozen patent dataset and three paid experiment records retain their original bytes',async()=>{
  const files=[
    ['smart-device-thermal-v1.3.json','7200d6b669d4423732f1619f380764c766ef8e0a7fd250e2a97134a48c58b7aa'],
    ['smart-device-thermal-smoke.json','8e1cd05e4ffb56383940ee7adb7a92893cd2ccf029002d04c8a4ad1213af5434']
  ];
  for(const [name,expected] of files){
    const raw=await readFile(new URL(`../data/${name}`,import.meta.url));
    assert.equal(createHash('sha256').update(raw).digest('hex'),expected,name);
    if(name.includes('smoke')) assert.equal(JSON.parse(raw.toString('utf8')).runs.length,3);
  }
});
