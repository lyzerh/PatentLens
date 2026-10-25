import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../src/server.js";

// Explicit, isolated browser acceptance fixture. It never forwards requests to xAI.
const dir=await mkdtemp(join(tmpdir(),"patentlens-safety-browser-"));
const history=await readFile(new URL("../data/smart-device-thermal-smoke.json",import.meta.url));
await writeFile(join(dir,"smoke.json"),history);
const dataset=JSON.parse(await readFile(new URL("../data/smart-device-thermal-v1.3.json",import.meta.url),"utf8"));
const doc=dataset.entries.find(x=>x.publicationNumber==="EP4476289B1");
let mockPaidCalls=0;
const fetchImpl=async(url,options={})=>{
  if(String(url)==="https://api.x.ai/v1/models"&&options.method==="GET")return new Response(JSON.stringify({data:[{id:"grok-4.3"}]}),{headers:{"Content-Type":"application/json"}});
  if(String(url)==="https://api.x.ai/v1/responses"&&options.method==="POST"){
    mockPaidCalls++;
    const output={industryScope:"uncertain",primaryTechnologyCategory:doc.primaryTechnologyCategory,secondaryTechnologyCategories:[],productApplication:[],technicalRelevance:true,potentialProductApplication:[],verifiedCommercialImplementation:"unknown",evidence:[{section:"title",sourceSpan:doc.title,sourceUrl:doc.sourceUrl}]};
    return new Response(JSON.stringify({model:"grok-4.3",status:"completed",usage:{input_tokens:1000,output_tokens:100,cost_in_usd_ticks:10000000},output:[{content:[{type:"output_text",text:JSON.stringify(output)}]}]}),{headers:{"Content-Type":"application/json"}});
  }
  throw new Error("Mock browser fixture blocks external network requests");
};
const app=createApp({pilotPath:join(dir,"pilot.json"),thermalSmokePath:join(dir,"smoke.json"),thermalReviewPath:join(dir,"reviews.json"),getXaiKey:()=>"mock-only-browser-key",fetchImpl});
const port=Number(process.env.PATENT_MOCK_PORT??4333);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error("Invalid PATENT_MOCK_PORT");
app.on("close",()=>rm(dir,{recursive:true,force:true}).catch(()=>{}));
app.listen(port,"127.0.0.1",()=>console.log(`MOCK ONLY: http://127.0.0.1:${port}/pilot-thermal`));
