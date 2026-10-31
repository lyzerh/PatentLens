export async function loadRegistryContext(recordId,csrf){
  const post=async(path,body)=>{const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-Patent-Client':'workbench',...(csrf?{'X-Patent-CSRF':csrf}:{})},body:JSON.stringify(body)});if(!response.ok)throw new Error(`${path}: ${response.status}`);return response.json();};
  const state=await post('/api/pilot/state',{}),record=state.records.find(x=>x.id===recordId);
  if(!record)throw new Error('REGISTRY_RECORD_NOT_FOUND');
  let source=null;
  try{source=await post('/api/patent-features/source',{publicationNumber:record.publicationNumber});}catch{}
  const linked=Boolean(source?.documentHash&&record.sourceUrl&&source.sourceUrl===record.sourceUrl&&record.independentClaims?.[0]&&record.independentClaims[0]===source.claim1);
  return {record,source,linked};
}
