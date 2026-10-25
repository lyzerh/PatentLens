import type { PilotState, PatentRecord, FactName } from "./records.ts";
import { CANDIDATES, PRODUCT_CATEGORIES, SIBLING_SOURCES, ensureV3, ruleOnly, type AuditedField, type FieldObservation, type MissingReason, type SourceAudit, type GoldCandidate } from "./value-data.ts";
import { TAXONOMY_VERSION } from "./classification.ts";

export const CRITICAL_FIELDS = ["publicationNumber", "title", "assignees", "priorityDate", "publicationDate", "abstract", "independentClaims", "cpc", "ipc", "sourceUrl"] as const;
type CriticalField = typeof CRITICAL_FIELDS[number];
const provided = (value: unknown): boolean => Array.isArray(value) ? value.length > 0 : typeof value === "string" ? Boolean(value.trim()) : value !== null && value !== undefined;
const canonical = (value: unknown): string => JSON.stringify(Array.isArray(value) ? value.map(x => String(x).replace(/\s+/g," ").trim().toLowerCase()).sort() : typeof value === "string" ? value.replace(/\s+/g," ").trim().toLowerCase() : value);
const sameValue = (oldValue: unknown, newValue: unknown, field: CriticalField): boolean => canonical(oldValue) === canonical(newValue) || field === "abstract" && typeof oldValue === "string" && typeof newValue === "string" && canonical(newValue).includes(canonical(oldValue));
function reasonFromError(error: unknown): MissingReason {
  const code = String((error as { code?: unknown } | null)?.code ?? "");
  if (code.includes("MISMATCH")) return "identifier_mismatch";
  if (code.includes("ENCODING") || code.includes("FORMAT")) return "unsupported_format";
  if (code.includes("TEXT_UNAVAILABLE")) return "source_not_provided";
  return "retrieval_failed";
}
export function sourceFailure(state: PilotState, publicationNumber: string, error: unknown) {
  const record = state.records.find(r => r.publicationNumber === publicationNumber);
  if (!record || !CANDIDATES.some(c => c.publicationNumber === publicationNumber)) throw new Error("文献不在固定10条样本中");
  const v3 = ensureV3(state), reason = reasonFromError(error), attemptedAt = new Date().toISOString();
  const fields = Object.fromEntries(CRITICAL_FIELDS.map(field => [field, { observations: [], conflictFlag: false, missingReason: provided(record[field]) ? null : reason, status: !provided(record[field]) ? "missing" : field !== "sourceUrl" && record.fields[field as FactName]?.status === "imported_unverified" ? "imported_unverified" : "source_verified" }])) as unknown as Record<CriticalField, AuditedField>;
  v3.sourceAudit ??= {}; v3.sourceAudit[publicationNumber] = { publicationNumber, attemptedAt, retrievalStatus: "failed", failureCode: String((error as { code?: unknown } | null)?.code ?? "RETRIEVAL_FAILED"), fields };
  return v3.sourceAudit[publicationNumber];
}
export function sourceAudit(state: PilotState, publicationNumber: string, patent: Record<string, unknown>): SourceAudit {
  const record = state.records.find(r => r.publicationNumber === publicationNumber);
  if (!record || !CANDIDATES.some(c => c.publicationNumber === publicationNumber)) throw new Error("文献不在固定10条样本中");
  if (patent.publicationNumber !== publicationNumber) throw new Error("官方 XML 文献号与预定样本不符");
  const v3 = ensureV3(state), retrievedAt = String(patent.fetchedAt ?? new Date().toISOString()), sourceUrl = String(patent.sourceUrl ?? record.sourceUrl ?? "");
  const claim1 = Array.isArray(patent.claims) ? patent.claims.filter(c => c && typeof c === "object" && String((c as { number?: unknown }).number) === "1").map(c => String((c as { text?: unknown }).text ?? "")).filter(Boolean) : [];
  const incoming: Record<CriticalField, string | string[] | null> = { publicationNumber, title: typeof patent.title === "string" ? patent.title : null, assignees: typeof patent.assignee === "string" ? patent.assignee.split(";").map(x=>x.trim()).filter(Boolean) : [], priorityDate: typeof patent.priorityDate === "string" ? patent.priorityDate : null,
    publicationDate: typeof patent.publicationDate === "string" ? patent.publicationDate : null, abstract: typeof patent.abstract === "string" ? patent.abstract : null, independentClaims: claim1, cpc: Array.isArray(patent.cpc) ? patent.cpc.map(String) : [], ipc: Array.isArray(patent.ipc) ? patent.ipc.map(String) : [], sourceUrl: sourceUrl || null };
  const diagnostics = patent.classificationDiagnostics as { cpc?: { rawCount?: number; unparsed?: string[] }; ipc?: { rawCount?: number; unparsed?: string[] } } | undefined;
  const fields = {} as Record<CriticalField, AuditedField>;
  for (const field of CRITICAL_FIELDS) {
    const oldValue = record[field] as string | string[] | null, newValue = incoming[field], hadOld = provided(oldValue), hasNew = provided(newValue);
    const oldFact = field === "sourceUrl" ? null : record.fields[field as FactName];
    const priorXmlCapture = Boolean(oldFact?.observedAt && oldFact.observedAt > record.importedAt);
    const oldSource = field === "sourceUrl" ? "epo_index_metadata" : priorXmlCapture ? "epo_publication_xml_prior_capture" : record.sourceKind || "existing_registry";
    const oldObservation: FieldObservation | null = hadOld ? { value: oldValue, source: oldSource, sourceUrl: oldFact?.sourceUrl ?? record.sourceUrl, retrievedAt: oldFact?.observedAt ?? record.importedAt, verificationStatus: oldFact?.status === "imported_unverified" ? "imported_unverified" : "source_verified", conflictFlag: false, sourceVersion: record.coverage || "registry-v1" } : null;
    const newObservation: FieldObservation | null = hasNew ? { value: newValue, source: "epo_publication_xml", sourceUrl, retrievedAt, verificationStatus: "source_verified", conflictFlag: false, sourceVersion: "ep-publication-xml-v1.2" } : null;
    const conflictFlag = Boolean(hadOld && hasNew && !sameValue(oldValue, newValue, field));
    if (oldObservation) oldObservation.conflictFlag = conflictFlag;
    if (newObservation) newObservation.conflictFlag = conflictFlag;
    let missingReason: MissingReason | null = null;
    if (!hasNew) missingReason = (field === "cpc" || field === "ipc") && (diagnostics?.[field]?.rawCount ?? 0) > 0 ? "parser_failed" : "source_not_provided";
    fields[field] = { observations: [oldObservation, newObservation].filter((x): x is FieldObservation => Boolean(x)), conflictFlag, missingReason,
      status: conflictFlag ? "needs_review" : hasNew ? "source_verified" : hadOld ? oldObservation?.verificationStatus ?? "imported_unverified" : "missing" };
    if (hasNew && !conflictFlag && (!hadOld || field === "abstract" && typeof oldValue === "string" && typeof newValue === "string" && newValue.length > oldValue.length)) {
      (record as unknown as Record<string, unknown>)[field] = newValue;
      if (field !== "sourceUrl") record.fields[field as FactName] = { status: "source_verified", sourceUrl, observedAt: retrievedAt, reviewedAt: null };
    }
  }
  record.coverage = `epo_xml_v0.3.1:abstract=${Boolean(record.abstract)};claims=${Boolean(record.independentClaims.length)};cpc=${Boolean(record.cpc.length)};ipc=${Boolean(record.ipc.length)};conflicts=${Object.values(fields).filter(x=>x.conflictFlag).length}`;
  v3.sourceAudit ??= {}; return v3.sourceAudit[publicationNumber] = { publicationNumber, attemptedAt: retrievedAt, retrievalStatus: "ok", failureCode: null, fields };
}
export function supplementSource(state: PilotState, targetId: string, siblingId: string, patent: Record<string, unknown>): SourceAudit {
  if (SIBLING_SOURCES[targetId] !== siblingId || patent.publicationNumber !== siblingId || targetId.match(/^EP\d+/)?.[0] !== siblingId.match(/^EP\d+/)?.[0]) throw new Error("补充公布版本与预定同号文献不匹配");
  const record = state.records.find(r=>r.publicationNumber===targetId), v3 = ensureV3(state), audit = v3.sourceAudit?.[targetId];
  if (!record || !audit || audit.retrievalStatus !== "ok") throw new Error("目标文献尚未完成官方来源审计");
  const retrievedAt = String(patent.fetchedAt ?? new Date().toISOString()), sourceUrl = String(patent.sourceUrl ?? "");
  const fields = {
    abstract: typeof patent.abstract === "string" ? patent.abstract : null,
    independentClaims: Array.isArray(patent.claims) ? patent.claims.filter(c=>c && typeof c==="object" && String((c as { number?: unknown }).number)==="1").map(c=>String((c as { text?: unknown }).text??"")).filter(Boolean) : []
  };
  for (const [field, value] of Object.entries(fields) as ["abstract" | "independentClaims", string | string[] | null][]) {
    const current = record[field], info = audit.fields[field];
    if (!info) throw new Error("来源审计字段缺失");
    const hasNew = provided(value), hasOld = provided(current), conflict = Boolean(hasNew && hasOld && !sameValue(current, value, field));
    if (hasNew) info.observations.push({ value, source: "epo_sibling_publication_xml", sourceUrl, retrievedAt, verificationStatus: "source_verified", conflictFlag: conflict, sourceVersion: siblingId });
    info.conflictFlag ||= conflict;
    info.status = info.conflictFlag ? "needs_review" : hasOld || hasNew ? "source_verified" : "missing";
    if (!hasNew && !hasOld) info.missingReason = "source_not_provided";
    if (hasNew && !hasOld) {
      (record as unknown as Record<string, unknown>)[field] = value;
      record.fields[field] = { status: "source_verified", sourceUrl, observedAt: retrievedAt, reviewedAt: null };
      info.missingReason = null;
    }
  }
  record.coverage = `epo_xml_v0.3.2:abstract=${Boolean(record.abstract)};claims=${Boolean(record.independentClaims.length)};cpc=${Boolean(record.cpc.length)};ipc=${Boolean(record.ipc.length)};sibling=${siblingId}`;
  audit.supplementedFrom ??= []; if (!audit.supplementedFrom.includes(siblingId)) audit.supplementedFrom.push(siblingId);
  audit.supplementAttempts ??= []; audit.supplementAttempts.push({ siblingId, status: "ok", attemptedAt: retrievedAt, failureCode: null });
  audit.attemptedAt = retrievedAt; return audit;
}
export function supplementFailure(state: PilotState, targetId: string, siblingId: string, error: unknown): SourceAudit {
  const audit = ensureV3(state).sourceAudit?.[targetId];if(!audit)throw new Error("目标文献来源审计缺失");
  audit.supplementAttempts ??= [];audit.supplementAttempts.push({ siblingId,status:"failed",attemptedAt:new Date().toISOString(),failureCode:String((error as {code?:unknown}|null)?.code??"RETRIEVAL_FAILED") });
  return audit;
}
function coverage(entries: { snapshot: PatentRecord }[]) {
  const total = entries.length;
  const item = (field: CriticalField) => ({ numerator: entries.filter(e => provided(e.snapshot[field])).length, denominator: total,
    records: entries.map(e => ({ publicationNumber: e.snapshot.publicationNumber, present: provided(e.snapshot[field]) })) });
  return Object.fromEntries(CRITICAL_FIELDS.map(field => [field, item(field)]));
}
export function readinessReport(state: PilotState, keyConfigured: boolean) {
  const v3 = ensureV3(state), current = v3.dataset, original = v3.datasetHistory?.[0] ?? current;
  const audit = v3.sourceAudit ?? {};
  const missing = (current?.entries ?? []).flatMap(e => CRITICAL_FIELDS.filter(field => !provided(e.snapshot[field])).map(field => ({ publicationNumber: e.publicationNumber, field, reason: audit[e.publicationNumber]?.fields[field]?.missingReason ?? "unknown", sourceUrl: e.sourceUrl })));
  const conflicts = Object.values(audit).flatMap(doc => Object.entries(doc.fields).filter(([, info]) => info.conflictFlag).map(([field, info]) => ({ publicationNumber: doc.publicationNumber, field, observations: info.observations, status: "needs_review" })));
  const verified = (current?.entries ?? []).flatMap(e => CRITICAL_FIELDS.filter(field => field !== "sourceUrl" && e.snapshot.fields[field as FactName]?.status === "source_verified").map(field => ({ publicationNumber: e.publicationNumber, field })));
  return { generatedAt: new Date().toISOString(), datasetVersion: current?.version ?? null, parentVersion: current?.parentVersion ?? null, totalDocuments: current?.entries.length ?? 0, before: original ? { version: original.version, coverage: coverage(original.entries) } : null,
    after: current ? { version: current.version, coverage: coverage(current.entries) } : null, sourceVerifiedFields: { count: verified.length, records: verified }, conflictingFields: { count: conflicts.length, records: conflicts },
    stages: [...(v3.datasetHistory ?? []), ...(current ? [current] : [])].map(dataset=>({ version: dataset.version, createdAt: dataset.createdAt, parentVersion: dataset.parentVersion ?? null, coverage: coverage(dataset.entries) })),
    missingCriticalFields: { count: missing.length, records: missing }, sourceAudits: audit, goldReadiness: { verified: Object.values(v3.gold).filter(g=>g.status==="human_verified").length, required: current?.entries.length ?? 0, frozen: Boolean(v3.goldFrozenAt), candidates: Object.keys(v3.goldCandidates ?? {}).length },
    benchmarkReadiness: { datasetFrozen: Boolean(current), goldFrozen: Boolean(v3.goldFrozenAt), serverKeyConfigured: keyConfigured, realApiRuns: v3.runs.filter(r=>r.mode==="api").length, canRunPaid: Boolean(current && v3.goldFrozenAt && keyConfigured), note: "真实调用仅由 UI 明确授权；预算预留不是账单硬上限。" },
    taxonomyVersion: TAXONOMY_VERSION, productCategories: PRODUCT_CATEGORIES, sourceCrossCheck: "EPO publication XML 与既有 EPO 索引快照逐字段比对；Google Patents 未用于自动覆盖，访问/条件未验证。" };
}
export function generateGoldCandidates(state: PilotState): Record<string, GoldCandidate> {
  const v3 = ensureV3(state), ds = v3.dataset;
  if (!ds) throw new Error("先冻结测试集");
  if (v3.runs.some(r=>r.mode==="api")) throw new Error("已有真实模型结果，不能事后生成独立 Gold 候选");
  const generated = Object.fromEntries(ds.entries.map(entry => {
    const rule = ruleOnly(entry), r = entry.snapshot, audit = v3.sourceAudit?.[entry.publicationNumber];
    const evidence = (r.abstract ? { section: "abstract" as const, sourceSpan: r.abstract.slice(0, 180) } : r.independentClaims[0] ? { section: "claims" as const, sourceSpan: r.independentClaims[0].slice(0, 180) } : r.title ? { section: "title" as const, sourceSpan: r.title } : null);
    const reasons = [entry.ambiguousCandidate ? "preselected_cross_domain_candidate" : null, rule.label === "Unknown" ? "rule_cannot_classify" : null,
      Object.values(audit?.fields ?? {}).some(f=>f.conflictFlag) ? "source_conflict" : null, !r.abstract && !r.independentClaims.length ? "insufficient_technical_text" : null].filter((x):x is string=>Boolean(x));
    const candidate: GoldCandidate = { recordId: entry.recordId, publicationNumber: entry.publicationNumber, technicalDomain: rule.label, potentialProductCategories: ["Unknown"], status: reasons.length ? "needs_review" : "provisional", evidence: evidence ? [evidence] : [], reasons,
      source: "deterministic_rule_and_official_codes", generatedAt: new Date().toISOString(), taxonomyVersion: TAXONOMY_VERSION };
    return [entry.recordId, candidate];
  })) as Record<string, GoldCandidate>;
  v3.goldCandidates = generated; return generated;
}
