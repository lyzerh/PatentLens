// Display-only projection of persisted fields. Never changes record or review state.
export function featureTrust(record){
  const revision=record?.currentRevisionId??record?.revisions?.at(-1)?.revisionId??null;
  const status=record?.reviewStatus??record?.revisions?.at(-1)?.status;
  return revision ? status==='reviewed'?'reviewed':'revised' : 'machine';
}
export function evidenceTrust(validation){
  if(!validation)return 'unknown';
  const rows=validation.diagnostics?.filter(x=>x.dimension==='source_exact')??[];
  return rows.length ? rows.every(x=>x.pass)?'evidencePass':'evidenceFail' : 'unknown';
}
export function trustBadge(t,kind,params={}){
  if(kind==='machine'&&params.method===undefined)params={...params,method:t('trust.unknown')};
  const node=document.createElement('span');node.className='trust-status';node.textContent=t('trust.'+kind,params);
  node.title=t('trust.'+(['schemaPass','schemaFail','evidencePass','evidenceFail'].includes(kind)?'validation':kind)+'.help',params);
  return node;
}
