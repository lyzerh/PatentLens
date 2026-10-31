import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { PilotV3State } from "./value-data.ts";

export type Provenance = "source_verified" | "imported_unverified" | "llm_generated" | "manually_reviewed";
export type FactName = "publicationNumber" | "title" | "abstract" | "assignees" | "inventors" | "priorityDate" | "filingDate" | "publicationDate" | "jurisdiction" | "cpc" | "ipc" | "familyId" | "legalStatus" | "independentClaims";
export type FieldSource = { status: Provenance; sourceUrl: string | null; observedAt: string; reviewedAt: string | null };
export const CORRECTABLE_METADATA = ["title", "assignees", "priorityDate", "filingDate", "publicationDate", "jurisdiction", "cpc", "ipc"] as const;
export type CorrectableMetadata = typeof CORRECTABLE_METADATA[number];
export type MetadataCorrection = { revision: number; field: CorrectableMetadata; before: string | string[] | null; after: string | string[] | null; editor: string; reason: string; at: string; originalSourceUrl: string | null };
export interface PatentRecord {
  id: string; publicationNumber: string; title: string | null; abstract: string | null; assignees: string[]; inventors: string[];
  priorityDate: string | null; filingDate: string | null; publicationDate: string | null; jurisdiction: string | null;
  cpc: string[]; ipc: string[]; familyId: string | null; legalStatus: string | null; legalStatusCheckedAt: string | null;
  independentClaims: string[]; sourceUrl: string | null; importedAt: string; sourceKind: string; coverage: string; sampleSetVersion: string | null;
  fields: Record<FactName, FieldSource | null>;
  metadataVersion?: number; originalImportMetadata?: Record<CorrectableMetadata, string | string[] | null>; metadataCorrections?: MetadataCorrection[];
  classification: null | { output: unknown; validationStatus: "needs_review" | "validated" | "rejected" | "insufficient_evidence"; reviewedAt: string | null; taskId: string };
}
export interface PilotState { version: 1; records: PatentRecord[]; runs: Record<string, unknown>[]; gold: Record<string, { label: string | "uncertain"; setVersion: string; reviewer: string; reviewedAt: string }>; pilotV3?: PilotV3State }
const FACTS: FactName[] = ["publicationNumber", "title", "abstract", "assignees", "inventors", "priorityDate", "filingDate", "publicationDate", "jurisdiction", "cpc", "ipc", "familyId", "legalStatus", "independentClaims"];
const emptyState = (): PilotState => ({ version: 1, records: [], runs: [], gold: {} });
const str = (v: unknown): string | null => typeof v === "string" && v.trim() ? v.trim() : null;
const array = (v: unknown): string[] => Array.isArray(v) ? v.map(str).filter((x): x is string => Boolean(x)) : str(v)?.split(/[;|]/).map(s => s.trim()).filter(Boolean) ?? [];
const field = (row: Record<string, unknown>, ...keys: string[]): unknown => keys.map(k => row[k]).find(v => v !== undefined && v !== null && v !== "");
const date = (v: unknown, key: string): string | null => { const s = str(v); if (!s) return null; if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s)) || new Date(s + "T00:00:00Z").toISOString().slice(0, 10) !== s) throw new Error(key + " 日期无效"); return s; };
const safeUrl = (v: unknown): string | null => { const s = str(v); if (!s) return null; const u = new URL(s); if (u.protocol !== "https:" || u.username || u.password) throw new Error("sourceUrl 必须是无认证信息的 HTTPS 地址"); return u.href; };
const hasValue = (v: unknown): boolean => Array.isArray(v) ? v.length > 0 : v !== null && v !== "";

export function normalizePatent(row: Record<string, unknown>, options: { sourceVerified?: boolean; sourceKind?: string; observedAt?: string } = {}): PatentRecord {
  if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("记录必须是对象");
  const publicationNumber = str(field(row, "publicationNumber", "publication_number", "patentNumber", "patent_number"))?.replace(/[\s,.-]/g, "").toUpperCase();
  if (!publicationNumber || !/^[A-Z]{2}\d{4,12}[A-Z]?\d{0,2}$/.test(publicationNumber)) throw new Error("缺少有效的公开文献号");
  const sourceUrl = safeUrl(field(row, "sourceUrl", "source_url"));
  const importedAt = options.observedAt ?? new Date().toISOString();
  const sourceKind = options.sourceKind ?? "local_import";
  const values = {
    publicationNumber, title: str(row.title), abstract: str(row.abstract), assignees: array(field(row, "assignees", "assignee", "applicants")), inventors: array(row.inventors),
    priorityDate: date(field(row, "priorityDate", "priority_date"), "priorityDate"), filingDate: date(field(row, "filingDate", "filing_date"), "filingDate"),
    publicationDate: date(field(row, "publicationDate", "publication_date"), "publicationDate"), jurisdiction: str(field(row, "jurisdiction", "country"))?.toUpperCase() ?? publicationNumber.slice(0, 2),
    cpc: array(row.cpc), ipc: array(row.ipc), familyId: str(row.familyId), legalStatus: str(row.legalStatus),
    independentClaims: array(field(row, "independentClaims", "independent_claims"))
  };
  const status: Provenance = options.sourceVerified ? "source_verified" : "imported_unverified";
  const fields = Object.fromEntries(FACTS.map(k => [k, hasValue(values[k]) ? { status, sourceUrl, observedAt: importedAt, reviewedAt: null } : null])) as PatentRecord["fields"];
  const checkedAt = date(row.legalStatusCheckedAt, "legalStatusCheckedAt");
  if (values.legalStatus && !checkedAt) throw new Error("法律状态需要 legalStatusCheckedAt 核验日期；否则请留空");
  return { id: createHash("sha256").update(publicationNumber).digest("hex").slice(0, 20), ...values, sourceUrl, importedAt,
    sourceKind, coverage: str(row.coverage) ?? "imported_fields", sampleSetVersion: str(row.sampleSetVersion), legalStatusCheckedAt: values.legalStatus ? checkedAt : null, fields, classification: null };
}

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []; let row: string[] = [], cell = "", quoted = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) { if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c; }
    else if (c === '"') { if (cell) throw new Error("CSV 引号位置无效"); quoted = true; }
    else if (c === ',') { row.push(cell); cell = ""; }
    else if (c === '\n') { row.push(cell.replace(/\r$/, "")); if (row.some(Boolean)) rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (quoted) throw new Error("CSV 引号未闭合");
  row.push(cell.replace(/\r$/, "")); if (row.some(Boolean)) rows.push(row);
  if (rows.length < 2) throw new Error("CSV 需要表头和至少一条记录");
  const headers = rows.shift()!.map(x => x.trim());
  if (new Set(headers).size !== headers.length || !headers.some(x => ["publicationNumber", "publication_number", "patentNumber"].includes(x))) throw new Error("CSV 表头缺少公开文献号或存在重复列");
  return rows.map((cells, i) => { if (cells.length !== headers.length) throw new Error("CSV 第 " + (i + 2) + " 行列数不一致"); return Object.fromEntries(headers.map((h, j) => [h, cells[j]])); });
}

export function parseImport(format: "csv" | "json", text: string): Record<string, unknown>[] {
  if (typeof text !== "string" || text.length > 1_000_000) throw new Error("导入内容过大");
  const rows: unknown = format === "csv" ? parseCsv(text) : format === "json" ? JSON.parse(text) : null;
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 500 || rows.some(x => !x || typeof x !== "object" || Array.isArray(x))) throw new Error("需要 1–500 条 JSON 对象或 CSV 记录");
  return rows as Record<string, unknown>[];
}

export function portfolio(records: PatentRecord[], filters: { domain?: string; assignee?: string; jurisdiction?: string; from?: string; to?: string } = {}) {
  const domainOf = (r: PatentRecord): string | null => r.classification?.validationStatus === "validated" ? (r.classification.output as { classification?: { technical_domain?: { value?: string } } }).classification?.technical_domain?.value ?? null : null;
  const selected = records.filter(r => (!filters.domain || domainOf(r) === filters.domain)
    && (!filters.assignee || r.assignees.some(a => a.toLowerCase().includes(filters.assignee!.toLowerCase())))
    && (!filters.jurisdiction || r.jurisdiction === filters.jurisdiction)
    && (!filters.from || Boolean(r.filingDate && r.filingDate >= filters.from)) && (!filters.to || Boolean(r.filingDate && r.filingDate <= filters.to)));
  const dist = (values: (string | null)[]) => Object.fromEntries([...new Set(values.filter((x): x is string => Boolean(x)))].sort().map(x => [x, values.filter(v => v === x).length]));
  const knownFamilies = selected.filter(r => r.familyId && ["source_verified", "manually_reviewed"].includes(r.fields.familyId?.status ?? ""));
  const missing = (r: PatentRecord) => FACTS.filter(k => !hasValue(r[k]));
  const verifiedSourceRecords = selected.filter(r => ["source_verified", "manually_reviewed"].includes(r.fields.publicationNumber?.status ?? "")).length;
  return { total: selected.length, familyCount: new Set(knownFamilies.map(r => r.familyId)).size, familyUnknownRecords: selected.length - knownFamilies.length,
    domainDistribution: dist(selected.map(domainOf)),
    filingYears: dist(selected.map(r => r.filingDate?.slice(0, 4) ?? null)), applicants: dist(selected.flatMap(r => r.assignees)), jurisdictions: dist(selected.map(r => r.jurisdiction)),
    reviewed: selected.filter(r => r.classification?.validationStatus === "validated").length, pending: selected.filter(r => r.classification?.validationStatus !== "validated").length,
    incomplete: selected.filter(r => missing(r).length > 0).length, missingByField: Object.fromEntries(FACTS.map(k => [k, selected.filter(r => !hasValue(r[k])).length])),
    verifiedSourceRecords, pendingSourceRecords: selected.length - verifiedSourceRecords, verifiedSourceRatio: selected.length ? verifiedSourceRecords / selected.length : null,
    sourceKinds: dist(selected.map(r => r.sourceKind)), importedFrom: selected.length ? selected.map(r => r.importedAt).sort()[0] : null,
    importedTo: selected.length ? selected.map(r => r.importedAt).sort().at(-1) : null,
    recordIds: selected.map(r => r.id), filters, method: "公开文献记录数；族数仅统计有可信 familyId 的唯一值；技术领域仅统计人工验证分类；申请年份仅使用 filingDate；未知值排除各分布分母。",
    generatedAt: new Date().toISOString() };
}

export class PilotStore {
  private chain: Promise<unknown> = Promise.resolve();
  readonly path: string;
  constructor(path: string) { this.path = path; }
  async read(): Promise<PilotState> { try { const parsed = JSON.parse(await readFile(this.path, "utf8")); if (parsed.version !== 1 || !Array.isArray(parsed.records) || !Array.isArray(parsed.runs) || !parsed.gold) throw new Error("存储格式不兼容"); return parsed; } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return emptyState(); throw e; } }
  transaction<T>(update: (state: PilotState) => T | Promise<T>): Promise<T> {
    const operation = this.chain.then(async () => { const state = await this.read(); const value = await update(state); await mkdir(dirname(this.path), { recursive: true }); const temp = this.path + "." + randomUUID() + ".tmp"; await writeFile(temp, JSON.stringify(state, null, 2), { flag: "wx" }); await rename(temp, this.path); return value; });
    this.chain = operation.catch(() => undefined); return operation;
  }
}
