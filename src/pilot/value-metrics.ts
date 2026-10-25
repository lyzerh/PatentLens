import { DOMAINS } from "./classification.ts";
import { ensureV3, ruleOnly, type Dataset, type PilotV3State, type V3Run } from "./value-data.ts";
import type { PilotState } from "./records.ts";

export type Fraction = { numerator: number; denominator: number; value: number | null; note?: string };
const fraction = (n: number, d: number, note?: string): Fraction => ({ numerator: n, denominator: d, value: d ? n / d : null, ...(note ? { note } : {}) });
const median = (values: number[]): number | null => { if (!values.length) return null; const a = [...values].sort((x, y) => x - y); return (a[Math.floor((a.length - 1) / 2)] + a[Math.floor(a.length / 2)]) / 2; };
function macroF1(truths: string[], predictions: string[]): number | null {
  if (!truths.length) return null;
  const labels = DOMAINS.filter(x => x !== "Unknown" && truths.includes(x));
  if (labels.length < 2) return null;
  return labels.reduce((sum, label) => { const tp = truths.filter((x, i) => x === label && predictions[i] === label).length;
    const fp = predictions.filter((x, i) => x === label && truths[i] !== label).length, fn = truths.filter((x, i) => x === label && predictions[i] !== label).length;
    return sum + (2 * tp + fp + fn ? 2 * tp / (2 * tp + fp + fn) : 0); }, 0) / labels.length;
}
export function budgetStatus(v3: PilotV3State) {
  const known = v3.runs.filter(r => r.mode === "api").reduce((sum, r) => sum + (r.apiCostUsd ?? 0), 0);
  const unknown = v3.runs.filter(r => r.mode === "api" && r.apiCostUsd === null).length;
  const outstanding = v3.reservations.reduce((sum, r) => sum + r.reservedUsd, 0);
  return { capUsd: v3.budgetCapUsd, settledKnownUsd: known, unknownCostRequests: unknown, outstandingReservationsUsd: outstanding, availableForNewReservationsUsd: Math.max(0, v3.budgetCapUsd - known - outstanding), hardGuarantee: false };
}
function latestRuns(v3: PilotV3State, variant: "B" | "C", model: string): Map<string, V3Run> {
  const map = new Map<string, V3Run>(); for (const r of v3.runs) if (r.variant === variant && r.model === model && r.mode === "api" && r.datasetVersion === v3.dataset?.version) map.set(r.recordId, r); return map;
}
export function evaluateVariant(state: PilotState, variant: "A" | "B" | "C" | "D", model?: string) {
  const v3 = ensureV3(state), dataset = v3.dataset, formal = Boolean(dataset && v3.goldFrozenAt);
  if (!dataset) return { variant, model: model ?? null, available: false, formal: false, reason: "DATASET_NOT_FROZEN" };
  const entries = dataset.entries;
  const runs = variant === "A" ? new Map<string, V3Run>() : latestRuns(v3, variant === "D" ? "C" : variant, model ?? "");
  const rows = entries.map(entry => {
    const run = runs.get(entry.recordId), rule = ruleOnly(entry);
    const prediction = variant === "A" ? rule.label : variant === "D" && run?.validation?.status !== "needs_review" ? null : run?.mappedDomain ?? null;
    const gold = formal ? v3.gold[entry.recordId] : null;
    const assess = run ? v3.assessments[run.taskId] : null;
    return { recordId: entry.recordId, publicationNumber: entry.publicationNumber, inputHash: entry.inputHash, prediction, goldDomain: gold?.technicalDomain ?? null,
      goldEligible: Boolean(gold && !gold.ambiguousOrUncertain && gold.technicalDomain !== "Unknown"),
      correct: gold && !gold.ambiguousOrUncertain && gold.technicalDomain !== "Unknown" ? prediction === gold.technicalDomain : null,
      covered: Boolean(prediction && prediction !== "Unknown"), runStatus: run?.errorType ?? run?.mappingError ?? run?.validation?.status ?? (variant === "A" ? rule.reason : "not_run"),
      source: variant === "A" ? rule.basis : run?.mode ?? null, machineEvidenceTraceable: run?.validation?.evidenceValid ?? null,
      assessment: assess ?? null, costUsd: variant === "D" ? 0 : run?.apiCostUsd ?? null, sharedRunTaskId: run?.taskId ?? null };
  });
  const eligible = rows.filter(r => r.goldEligible);
  const accuracy = formal ? fraction(eligible.filter(r => r.correct).length, eligible.length, "缺运行或被 D 拒绝按未命中计；uncertain Gold 排除") : fraction(0, 0, "Gold 未冻结，不能宣称准确率");
  const acceptedEligible = variant === "D" ? eligible.filter(r => r.covered) : [];
  const acceptedAccuracy = variant === "D" && formal ? fraction(acceptedEligible.filter(r => r.correct).length, acceptedEligible.length, "仅 D 保留记录的准确率；必须同时查看拒绝数和覆盖率") : null;
  const domainTruth = eligible.map(r => r.goldDomain!), domainPred = eligible.map(r => r.prediction ?? "Unknown");
  const attempted = variant === "A" ? entries.length : [...runs.values()].length;
  const apiRuns = [...runs.values()], knownCosts = apiRuns.filter(r => r.apiCostUsd !== null), totalCostUsd = variant === "A" ? 0 : knownCosts.length === apiRuns.length ? knownCosts.reduce((s, r) => s + r.apiCostUsd!, 0) : null;
  const assessments = rows.filter(r => r.assessment), evidenceAssessed = assessments.filter(r => r.assessment?.evidenceSupports !== null);
  const validatorJudged = variant === "D" ? assessments.filter(r => r.assessment?.validatorShouldAccept !== null) : [];
  const falseAcceptance = fraction(validatorJudged.filter(r => r.covered && r.assessment?.validatorShouldAccept === false).length, validatorJudged.filter(r => r.assessment?.validatorShouldAccept === false).length, "人工认为应拒绝者中，D 仍接受的比例");
  const falseRejection = fraction(validatorJudged.filter(r => !r.covered && r.assessment?.validatorShouldAccept === true).length, validatorJudged.filter(r => r.assessment?.validatorShouldAccept === true).length, "人工认为应接受者中，D 错误拒绝的比例");
  const validatedCorrect = variant === "D" ? rows.filter(r => r.correct && r.covered && r.assessment?.evidenceSupports === true).length : 0;
  const errors = Object.fromEntries([...new Set(apiRuns.map(r => r.errorType ?? r.mappingError).filter(Boolean))].map(code => [code, apiRuns.filter(r => (r.errorType ?? r.mappingError) === code).length]));
  return { variant, model: model ?? null, available: true, formal, datasetVersion: dataset.version, sampleSize: entries.length, attempted,
    accuracy, acceptedAccuracy, macroF1: formal ? macroF1(domainTruth, domainPred) : null, coverage: fraction(rows.filter(r => r.covered).length, entries.length),
    schemaValidity: variant === "A" || variant === "B" ? null : fraction(apiRuns.filter(r => r.validation?.schemaValid).length, attempted),
    machineEvidenceTraceability: variant === "A" || variant === "B" ? null : fraction(apiRuns.filter(r => r.validation?.evidenceValid).length, attempted),
    humanEvidenceSupport: fraction(evidenceAssessed.filter(r => r.assessment?.evidenceSupports === true).length, evidenceAssessed.length, "只对独立人工已评分记录计算"),
    falseAcceptance, falseRejection, medianLatencyMs: variant === "A" ? 0 : median(apiRuns.map(r => r.latencyMs)),
    totalCostUsd, costKind: variant === "D" ? "shared_with_C_no_new_call" : variant === "A" ? "none" : apiRuns.some(r => r.costKind === "unknown") ? "incomplete" : apiRuns.some(r => r.costKind === "estimated") ? "estimated_or_mixed" : "actual",
    costPerValidatedCorrectUsd: variant === "D" && validatedCorrect && totalCostUsd !== null ? totalCostUsd / validatedCorrect : null,
    validatedCorrectCount: validatedCorrect, rejectedCount: variant === "D" ? rows.filter(r => r.sharedRunTaskId && !r.covered).length : null,
    reviewedFunction: fraction(assessments.filter(r => r.assessment?.functionCorrect === true).length, assessments.filter(r => r.assessment?.functionCorrect !== null).length),
    reviewedProductCategory: fraction(assessments.filter(r => r.assessment?.productCategoryCorrect === true).length, assessments.filter(r => r.assessment?.productCategoryCorrect !== null).length),
    errors, rows };
}
export function evaluateAll(state: PilotState) {
  const v3 = ensureV3(state), models = [...new Set(v3.runs.filter(r => r.mode === "api").map(r => r.model))];
  return { datasetVersion: v3.dataset?.version ?? null, goldFrozen: Boolean(v3.goldFrozenAt), budget: budgetStatus(v3), variants: [evaluateVariant(state, "A"), ...models.flatMap(model => [evaluateVariant(state, "B", model), evaluateVariant(state, "C", model), evaluateVariant(state, "D", model)])] };
}
