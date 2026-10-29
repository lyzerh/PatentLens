// Read-only, source-grounded coverage hints. This is not a semantic completeness test.
export function reviewCoverage(source, candidate, validation) {
  if (!source?.claim1 || !candidate || !validation) return [];
  if (candidate.identity?.publicationNumber !== source.publicationNumber ||
      candidate.identity?.documentHash !== source.documentHash ||
      candidate.identity?.sourceUrl !== source.sourceUrl) throw new Error('COVERAGE_SOURCE_CONFLICT');
  const elements = new Map(candidate.elements.map(x => [x.elementId, x]));
  const fields = [
    ...candidate.elements.map(x => ({kind:'element', id:x.elementId, item:x})),
    ...candidate.limitations.map(x => ({kind:'limitation', id:x.limitationId, item:x})),
    ...candidate.relationships.map(x => ({kind:'relationship', id:x.relationId, item:x}))
  ];
  const firstSegment = span => validation.coverageItems.find(x => x.sourceSpan.includes(span))?.claimSegment;
  return validation.coverageItems.map(segment => {
    if (!source.claim1.includes(segment.sourceSpan)) throw new Error('COVERAGE_SEGMENT_CONFLICT');
    const related = fields.filter(({item}) => {
      const span=item.evidence?.sourceSpan || item.originalText;
      return typeof span==='string' && span && source.claim1.includes(span) && firstSegment(span)===segment.claimSegment;
    });
    const mapped = related.filter(({item}) => item.evidence?.section === 'claims' &&
      item.evidence.publicationNumber === source.publicationNumber &&
      item.evidence.documentHash === source.documentHash &&
      item.evidence.sourceUrl === source.sourceUrl && item.evidence.sourceSpan);
    const issues = [];
    if (!mapped.length) issues.push('unmapped');
    for (const {id,item} of related) if (!mapped.some(x=>x.id===id)) issues.push('missing_evidence:'+id);
    for (const {kind,id,item} of mapped) {
      if (kind === 'limitation') {
        if (!item.modifiesElementId) issues.push('unbound:'+id);
        else if (!elements.has(item.modifiesElementId)) issues.push('invalid_target:'+id);
        if (item.numericStatus === 'ambiguous') issues.push('ambiguous:'+id);
      }
      if (kind === 'relationship' && (!elements.has(item.fromElementId) || !elements.has(item.toElementId))) issues.push('invalid_endpoints:'+id);
    }
    for (const reason of segment.unresolvedReasons) issues.push('unresolved:'+reason);
    // A field without source evidence cannot be mapped to a particular clause.
    const status = !mapped.length ? 'potential_gap' : issues.length ? 'needs_review' : 'mapped';
    return {claimSegment:segment.claimSegment, sourceSpan:segment.sourceSpan, status, fields:mapped.map(({kind,id,item}) => ({kind,id,label:item.elementName ?? item.originalText,sourceSpan:item.evidence.sourceSpan})), issues};
  });
}

export function compareCoverage(source, rules, grok) {
  if (!rules || !grok) return [];
  const left=reviewCoverage(source,rules.candidate,rules.validation);
  const right=reviewCoverage(source,grok.candidate,grok.validation);
  return left.map((item,index) => {
    const other=right[index];
    if (!other || other.sourceSpan !== item.sourceSpan) throw new Error('COVERAGE_SEGMENT_CONFLICT');
    const norm=x=>x.toLowerCase().replace(/^(?:a|an|the)\s+/,'').trim();
    const overlaps=(a,b)=>a.kind===b.kind&&(norm(a.sourceSpan).includes(norm(b.sourceSpan))||norm(b.sourceSpan).includes(norm(a.sourceSpan)));
    const rulesOnly=item.fields.filter(f=>!other.fields.some(g=>overlaps(f,g)));
    const grokOnly=other.fields.filter(f=>!item.fields.some(g=>overlaps(f,g)));
    const grouped=item.fields.some(f=>other.fields.filter(g=>overlaps(f,g)).length>1)||other.fields.some(g=>item.fields.filter(f=>overlaps(f,g)).length>1);
    return {claimSegment:item.claimSegment,rulesOnly,grokOnly,grouped};
  });
}
