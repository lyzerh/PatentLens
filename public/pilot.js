import {t,onLanguageChange,initializeI18n} from './i18n/index.js';
initializeI18n();
const $ = id => document.getElementById(id);
const fieldKeys = ['publicationNumber','title','abstract','assignees','inventors','priorityDate','filingDate','publicationDate','jurisdiction','cpc','ipc','familyId','legalStatus','independentClaims'];
const domains = ["Battery Management", "Wireless Charging", "Thermal Management", "Display Technology", "Communication Technology", "Other", "Unknown"];
let state = null, selectedId = null, checked = new Set(), lastRun = null;
const node = (tag, text = "", className = "") => { const el = document.createElement(tag); el.textContent = text; if (className) el.className = className; return el; };
const notice = (message, error = false) => { $("notice").textContent = message; $("notice").classList.toggle("error", error); };
const money = v => v == null ? t('common.unknown') : "$" + Number(v).toFixed(6);
const pct = v => v == null ? t('pilot.notCalculable') : (v * 100).toFixed(1) + "%";
const current = () => state?.records.find(r => r.id === selectedId) ?? null;
async function api(action, body = {}) {
  const response = await fetch("/api/pilot/" + action, { method: "POST", headers: { "Content-Type": "application/json", "X-Patent-Client": "workbench" }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || result.message || t('pilot.requestFailed',{status:response.status}));
  return result;
}
async function task(message, action) {
  notice(message);
  try { await action(); } catch (e) { notice(e.message || t('common.operationFailed'), true); }
}
async function refresh() {
  state = await api("state");
  if (!current()) selectedId = state.records[0]?.id ?? null;
  checked = new Set([...checked].filter(id => state.records.some(r => r.id === id)));
  $("record-total").textContent = state.records.length;
  $("registry-count").textContent = t('pilot.recordCount',{count:state.records.length});
  $("key-state").textContent = t(state.keyConfigured?'pilot.keyReady':'pilot.keyMissing');
  renderRegistry(); renderDetail(); renderModels(); renderBenchmark();
  await refreshDashboard();
}
function renderRegistry() {
  const list = $("registry-list"); list.replaceChildren();
  if (!state.records.length) { list.append(node("p", t('pilot.emptyRegistry'), "empty")); return; }
  for (const r of state.records) {
    const row = node("div", "", "record" + (r.id === selectedId ? " active" : ""));
    const check = document.createElement("input"); check.type = "checkbox"; check.checked = checked.has(r.id); check.setAttribute("aria-label", t('pilot.selectForComparison',{patentId:r.publicationNumber}));
    check.onchange = () => { check.checked ? checked.add(r.id) : checked.delete(r.id); $("batch-status").textContent = t('pilot.selected',{count:checked.size}); };
    const pick = node("button"); pick.type = "button"; pick.append(node("strong", r.publicationNumber), node("span", r.title || t('pilot.titleMissing')), node("small", [r.jurisdiction || t('pilot.jurisdictionUnknown'), r.sourceKind, r.classification?.validationStatus || t('pilot.unclassified')].join(" · ")));
    pick.onclick = () => { selectedId = r.id; renderRegistry(); renderDetail(); $("detail").scrollIntoView({ behavior: "smooth" }); };
    row.append(check, pick); list.append(row);
  }
}
let dashboard=null;
async function refreshDashboard() {
  const filters = { domain: $("filter-domain").value, assignee: $("filter-assignee").value.trim(), jurisdiction: $("filter-jurisdiction").value.trim().toUpperCase(), from: $("filter-from").value, to: $("filter-to").value };
  dashboard=await api("dashboard", { filters });renderDashboard();
}
function renderDashboard(){const p=dashboard;if(!p)return;
  $("stat-records").textContent = p.total; $("stat-families").textContent = p.familyCount; $("stat-validated").textContent = p.reviewed; $("stat-pending").textContent = p.pending;
  $("portfolio-method").textContent = t('pilot.portfolioMethod',{method:p.method,total:p.total,verified:p.verifiedSourceRecords,ratio:p.verifiedSourceRatio==null?t('pilot.notCalculableShort'):(p.verifiedSourceRatio*100).toFixed(1)+'%',pending:p.pendingSourceRecords,sources:Object.entries(p.sourceKinds).map(([name,n])=>name+' '+n).join('、'),from:p.importedFrom?.slice(0,10)||t('common.none'),to:p.importedTo?.slice(0,10)||t('common.none'),families:p.familyUnknownRecords,incomplete:p.incomplete});
  for (const [id, entries] of [["dist-domains", p.domainDistribution], ["dist-years", p.filingYears], ["dist-applicants", p.applicants], ["dist-jurisdictions", p.jurisdictions], ["missing-fields", p.missingByField]]) {
    const box = $(id); box.replaceChildren();
    const items = Object.entries(entries).filter(([, count]) => id !== "missing-fields" || count > 0).sort((a, b) => b[1] - a[1]);
    if (!items.length) { box.append(node("p", t('pilot.noStats'))); continue; }
    for (const [key, count] of items) { const row = node("div"); row.append(node("span",fieldKeys.includes(key)?t('pilot.field.'+key):key), node("strong", String(count))); box.append(row); }
  }
}
function renderDetail() {
  const r = current(), box = $("record-detail"); box.replaceChildren();
  if (!r) { box.append(node("p", t('pilot.selectRecord'), "empty")); return; }
  const heading = node("h3", r.publicationNumber + " · " + (r.title || t('pilot.titleMissing'))); box.append(heading);
  const research=node('a',t('pilot.openWorkspace'));research.href='/workspace?registry='+encodeURIComponent(r.id);box.append(research);
  box.append(node("p", t('pilot.coverage',{coverage:r.coverage,date:r.importedAt,source:r.sourceKind}), "hint"));
  if (r.sourceUrl) { const a = node("a", t('pilot.sourceLink')); a.href = r.sourceUrl; a.target = "_blank"; a.rel = "noopener noreferrer"; box.append(a); }
  const grid = node("div", "", "fact-grid");
  for (const key of fieldKeys) {
    const v = r[key], fact = r.fields[key], item = node("div", "", "fact");
    item.append(node("span", t('pilot.field.'+key)), node("strong", Array.isArray(v) ? (v.join("；") || t('common.notProvided')) : (v || t('common.notProvided'))), node("small", fact ? t('pilot.provenance.'+fact.status) + " · " + fact.observedAt.slice(0, 10) : t('pilot.noSource')));
    if(r.metadataCorrections?.some(x=>x.field===key))item.append(node('small',t('pilot.metadataCorrected')));
    if (fact?.sourceUrl) { const a = node("a", t('pilot.fieldSource')); a.href = fact.sourceUrl; a.target = "_blank"; a.rel = "noopener noreferrer"; item.append(a); }
    if (fact && fact.status !== "manually_reviewed") { const b = node("button", t('pilot.verifyField'), "quiet"); b.onclick = () => task(t('pilot.reviewing'), async () => { await api("review-field", { recordId: r.id, field: key }); await refresh(); notice(t('pilot.reviewSaved')); }); item.append(b); }
    grid.append(item);
  }
  box.append(grid);
  const editable=['title','assignees','priorityDate','filingDate','publicationDate','jurisdiction','cpc','ipc'];
  const edit=document.createElement('details');edit.className='review-box';edit.append(node('summary',t('pilot.metadataEdit')));
  const select=document.createElement('select');select.setAttribute('aria-label',t('pilot.metadataField'));for(const key of editable){const option=new Option(t('pilot.field.'+key),key);select.append(option);}
  const value=document.createElement('input');value.setAttribute('aria-label',t('pilot.metadataValue'));value.maxLength=2000;
  const editor=document.createElement('input');editor.setAttribute('aria-label',t('pilot.metadataEditor'));editor.placeholder=t('pilot.metadataEditor');editor.maxLength=100;
  const reason=document.createElement('textarea');reason.setAttribute('aria-label',t('pilot.metadataReason'));reason.placeholder=t('pilot.metadataReason');reason.maxLength=1000;
  const fill=()=>{const old=r[select.value];value.value=Array.isArray(old)?old.join('; '):old??'';};select.onchange=fill;fill();
  const save=node('button',t('pilot.metadataSave'));save.type='button';save.onclick=()=>task(t('pilot.metadataSaving'),async()=>{if(!confirm(t('pilot.metadataConfirm')))return;await api('correct-metadata',{recordId:r.id,field:select.value,value:value.value,editor:editor.value,reason:reason.value,expectedVersion:r.metadataVersion??0});await refresh();notice(t('pilot.metadataSaved'));});
  edit.append(node('p',t('pilot.metadataIdentityNotice')),select,value,editor,reason,save);box.append(edit);
  const history=document.createElement('details');history.className='review-box';history.append(node('summary',t('pilot.metadataHistory',{count:r.metadataCorrections?.length??0})));
  history.append(node('p',t('pilot.metadataVersion',{version:r.metadataVersion??0})));
  for(const entry of r.metadataCorrections??[]){const line=node('div','', 'fact');line.append(node('strong',`#${entry.revision} · ${t('pilot.field.'+entry.field)} · ${entry.at}`),node('p',`${JSON.stringify(entry.before)} → ${JSON.stringify(entry.after)}`),node('small',`${t('pilot.metadataEditor')}: ${entry.editor} · ${t('pilot.metadataReason')}: ${entry.reason}`));if(entry.originalSourceUrl){const link=node('a',t('pilot.fieldSource'));link.href=entry.originalSourceUrl;link.target='_blank';link.rel='noopener noreferrer';line.append(link);}history.append(line);}
  if(r.originalImportMetadata)history.append(node('p',t('pilot.metadataOriginal')+': '+JSON.stringify(r.originalImportMetadata)));
  box.append(history);
  const baseline = state.ruleBaselines?.find(b => b.recordId === r.id);
  if (baseline) box.append(node("p", t('pilot.ruleBaseline',{version:baseline.version,label:baseline.label,reason:baseline.reason}), "hint"));
  const gold = state.gold[r.id];
  const goldSection = node("div", "", "review-box"); goldSection.append(node("h3", t('pilot.humanGold')));
  if (gold) goldSection.append(node("p", gold.label + " · "+t('pilot.reviewer')+' '+ gold.reviewer + " · " + gold.reviewedAt.slice(0, 10)));
  else if (state.runs.some(run => run.recordId === r.id)) goldSection.append(node("p", t('pilot.goldAfterRun'), "hint"));
  else {
    const select = document.createElement("select"); for (const d of [...domains, "uncertain"]) select.append(new Option(d, d));
    const reviewer = document.createElement("input"); reviewer.placeholder = t('pilot.reviewerName'); reviewer.setAttribute("aria-label", t('pilot.reviewer'));
    const b = node("button", t('pilot.saveGold')); b.onclick = () => task(t('pilot.saveGold'), async () => { await api("gold", { recordId: r.id, label: select.value, reviewer: reviewer.value }); await refresh(); notice(t('pilot.goldSaved')); });
    goldSection.append(select, reviewer, b, node("small", t('pilot.goldWarning')));
  }
  box.append(goldSection);
  if (r.classification) {
    const output = r.classification.output;
    const compare = node("div", "", "fact-grid"); box.append(node("h3", t('pilot.compare')));
    const references = new Map((output.evidence || []).map(e => [e.evidence_id, e]));
    for (const [name, assertion] of [[t('pilot.field.domain'), output.classification?.technical_domain], [t('pilot.field.subdomain'), output.classification?.technical_subdomain], [t('pilot.field.primaryFunction'), output.technical_summary?.primary_function], [t('pilot.field.problem'), output.technical_summary?.technical_problem], [t('pilot.field.summary'), output.technical_summary?.short_management_summary]]) {
      const item = node("div", "", "fact"); item.append(node("span", name), node("strong", assertion?.value || t('pilot.unknownInference')));
      const spans = (assertion?.evidence_ids || []).map(id => references.get(id)).filter(Boolean).map(e => e.section + ": “" + e.source_span + "”");
      item.append(node("small", spans.join("；") || t('pilot.noCitation'))); compare.append(item);
    }
    box.append(compare, classificationCard(output, { status: r.classification.validationStatus }, r, true));
  }
}
function classificationCard(output, validation, r, review = false) {
  const box = node("div", "", "result"); box.append(node("h3", t('pilot.classification',{status:validation?.status || t('common.unknown')})));
  if (!output) { box.append(node("p", t('pilot.noOutput'), "empty")); return box; }
  const grid = node("div", "", "result-grid");
  const entries = [[t('pilot.field.domain'), output.classification?.technical_domain], [t('pilot.field.subdomain'), output.classification?.technical_subdomain], [t('pilot.field.primaryFunction'), output.technical_summary?.primary_function], [t('pilot.field.problem'), output.technical_summary?.technical_problem], [t('pilot.field.summary'), output.technical_summary?.short_management_summary]];
  for (const [label, assertion] of entries) { const item = node("div"); item.append(node("small", label), node("p", assertion?.value || t('pilot.insufficient')), node("small", t('pilot.basis',{ids:assertion?.evidence_ids?.join(', ') || t('common.none'),support:assertion?.support_type || t('common.unknown')}))); grid.append(item); }
  box.append(grid); box.append(node("h3", t('pilot.potential')));
  box.append(node("p", output.potential_applications?.map(a => a.value).filter(Boolean).join("；") || t('pilot.notInferred')));
  box.append(node("h3", t('pilot.evidence')));
  for (const ev of output.evidence || []) box.append(node("div", ev.evidence_id + " · " + ev.section + " · “" + ev.source_span + "”", "evidence"));
  for (const issue of validation?.errors || []) box.append(node("div", issue.code + " · " + issue.message, "issue"));
  for (const u of output.uncertainties || []) box.append(node("div", t('pilot.uncertainty',{value:u}), "hint"));
  if (review && r.classification?.validationStatus === "needs_review") {
    for (const [decision, label] of [["validated", t('pilot.accept')], ["rejected", t('pilot.reject')]]) { const b = node("button", label); b.onclick = () => task(t('pilot.reviewDecision'), async () => { await api("review-classification", { recordId: r.id, decision }); await refresh(); notice(t('pilot.reviewDecisionSaved')); }); box.append(b); }
  }
  return box;
}
function renderModels() {
  const model = $("model"), previous = model.value;
  model.replaceChildren(); for (const m of state.modelChoices) model.append(new Option(m, m)); model.value = state.modelChoices.includes(previous) ? previous : state.defaultModel;
  const checks = $("benchmark-models"); checks.replaceChildren();
  for (const m of state.modelChoices) { const label = node("label"); const input = document.createElement("input"); input.type = "checkbox"; input.value = m; input.checked = m === state.defaultModel; label.append(input, node("span", m)); checks.append(label); }
  const filter = $("filter-domain"), selected = filter.value; filter.replaceChildren(new Option(t('pilot.all'), "")); for (const d of domains) filter.append(new Option(d, d)); filter.value = selected;
}
function renderBenchmark() {
  const box = $("benchmark-table"); box.replaceChildren();
  if (!state.benchmark.length) { box.append(node("p", t('pilot.noBenchmark'), "empty")); return; }
  const table = document.createElement("table"), tr = document.createElement("tr");
  for (const key of ['tableModel','tableTasks','tableGoldAccuracy','tableTraceability','tableSchema','tableTotalCost','tablePerConfirmed','tableLatency','tableErrors']) tr.append(node('th',t(`pilot.${key}`)));
  table.append(tr);
  for (const row of state.benchmark) { const line = document.createElement("tr"); for (const value of [row.model, row.tasks, pct(row.classificationAccuracy), pct(row.evidenceSupportRate), pct(row.schemaSuccessRate), money(row.totalCostUsd), money(row.costPerValidatedUsd), row.medianLatencyMs == null ? t('common.unknown') : row.medianLatencyMs + "ms", Object.entries(row.errors).map(([k, n]) => k + " " + n).join("、") || t('pilot.noErrors')]) line.append(node("td", String(value))); table.append(line); }
  box.append(table);
}
function runOptions(mock) { return { recordId: selectedId, model: $("model").value, mock, taskBudgetUsd: Number($("task-budget").value), maxOutputTokens: Number($("max-output").value), allowRepeat: $("repeat").checked }; }
function checkedModels() { return [...$("benchmark-models").querySelectorAll("input:checked")].map(x => x.value); }
function downloadJson(name, value) { const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }), url = URL.createObjectURL(blob), link = document.createElement("a"); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
$("import-button").onclick = () => task(t('pilot.readingImport'), async () => { const file = $("import-file").files[0]; if (!file) throw new Error(t('pilot.noFile')); if (file.size > 1_000_000) throw new Error(t('pilot.fileLarge')); const format = file.name.toLowerCase().endsWith(".csv") ? "csv" : "json"; const result = await api("import", { format, text: await file.text() }); await refresh(); notice(t('pilot.imported',{added:result.added,duplicates:result.duplicates})); });
$("epo-import").onclick = () => task(t('pilot.readingEpo'), async () => { const result = await api("import-source", { source: "epo", publicationNumber: $("epo-id").value.trim() }); await refresh(); selectedId = result.recordId; renderRegistry(); renderDetail(); notice(t(result.duplicate?'pilot.sourceDuplicate':'pilot.sourceAdded')); });
$("collect-sample").onclick = () => task(t('pilot.collecting'), async () => { const result = await api("collect-sample"); await refresh(); notice(t('pilot.sampleAdded',{added:result.added,errors:result.errors.length,advice:result.errors.length?t('pilot.sampleAdvice'):''}),result.errors.length > 0); });
$("select-all").onclick = () => { checked = new Set(state.records.map(r => r.id)); renderRegistry(); $("batch-status").textContent = t('pilot.selected',{count:checked.size}); };
$("apply-filters").onclick = () => task(t('pilot.updatingStats'), async () => { await refreshDashboard(); notice(t('pilot.filtersUpdated')); });
$("estimate").onclick = () => task(t('pilot.estimating'), async () => { if (!current()) throw new Error(t('pilot.chooseFirst')); const result = await api("estimate", runOptions(false)); $("estimate-output").textContent = t('pilot.estimated',{input:result.inputTokensEstimate,output:result.outputTokensLimit,cost:money(result.estimatedMaxUsd),version:result.priceVersion}); notice(t('pilot.estimateDone')); });
function renderLastRun(){if(!lastRun)return;const run=lastRun,box=$("classification-output");box.replaceChildren(node("p",t('pilot.runStatus',{model:run.model,mode:run.mode,status:run.status,cache:run.cached?t('pilot.cached'):'',cost:money(run.apiCostUsd),kind:run.costKind,latency:run.latencyMs})));if(run.errorType)box.append(node('div',t('pilot.runError',{error:run.errorType}),'issue'));box.append(classificationCard(run.output,run.validation,current()));}
for (const [id, mock] of [["run-mock", true], ["run-api", false]]) $(id).onclick = () => task(t(mock?'pilot.runningMock':'pilot.callingXai'), async () => { if (!current()) throw new Error(t('pilot.chooseFirst')); if (!mock && !state.keyConfigured) throw new Error(t('pilot.notConfigured')); const run = await api("classify", runOptions(mock)); lastRun = run;renderLastRun(); await refresh(); notice(t(mock?'pilot.mockDone':'pilot.realDone')); });
$("check-models").onclick = () => task(t('pilot.checkingModels'), async () => { const result = await api("models"); notice(result.configured?t('pilot.modelsAvailable',{models:result.available.join(', ')||t('pilot.noModel')}):t('pilot.keyMissing')); });
$("batch-estimate").onclick = () => task(t('pilot.estimatingBatch'), async () => { const ids = [...checked], models = checkedModels(); if (!ids.length || !models.length) throw new Error(t('pilot.selectBatch')); let total = 0; for (const id of ids) { const record = state.records.find(r => r.id === id); for (const model of models) total += (await api("estimate", { recordId: record.id, model, maxOutputTokens: Number($("max-output").value) })).estimatedMaxUsd; } $("batch-status").textContent = t('pilot.batchEstimate',{count:ids.length*models.length,cost:money(total)}); notice(t('pilot.batchEstimateDone')); });
$("batch-run").onclick = () => task(t('pilot.runningBatch'), async () => { const ids = [...checked], models = checkedModels(), mock = $("batch-mode").value === "mock"; if (!ids.length || !models.length) throw new Error(t('pilot.selectBatch')); if (!mock && !state.keyConfigured) throw new Error(t('pilot.notConfigured')); if (!mock && !confirm(t('pilot.batchConfirm',{count:ids.length*models.length}))) return; const result = await api("batch", { recordIds: ids, models, mock, batchBudgetUsd: Number($("batch-budget").value), taskBudgetUsd: Number($("task-budget").value), maxOutputTokens: Number($("max-output").value), allowRepeat: $("repeat").checked }); await refresh(); $("batch-status").textContent = t('pilot.batchResult',{count:result.runs.length,blocked:result.stoppedEarly?t('pilot.batchBlocked'):'',cost:money(result.spentOrReservedUsd)}); notice(t('pilot.batchDone')); });
$("export-report").onclick = () => task(t('pilot.exporting'), async () => { downloadJson("patentlens-pilot-report-" + new Date().toISOString().slice(0, 10) + ".json", await api("report")); notice(t('pilot.exportDone')); });
onLanguageChange(()=>{if(!state)return;const values=Object.fromEntries(['filter-assignee','filter-jurisdiction','filter-from','filter-to','filter-domain','model','task-budget','max-output','batch-budget','batch-mode','repeat'].map(id=>[id,$(id).type==='checkbox'?$(id).checked:$(id).value])),models=checkedModels();renderRegistry();renderDetail();renderModels();renderBenchmark();renderDashboard();renderLastRun();for(const [id,value] of Object.entries(values)){if($(id).type==='checkbox')$(id).checked=value;else $(id).value=value;}for(const input of $("benchmark-models").querySelectorAll('input'))input.checked=models.includes(input.value);$("registry-count").textContent=t('pilot.recordCount',{count:state.records.length});$("key-state").textContent=t(state.keyConfigured?'pilot.keyReady':'pilot.keyMissing');});
task(t('pilot.loadingRegistry'), async () => { await refresh();const requested=new URLSearchParams(location.search).get('record');if(requested&&state.records.some(r=>r.id===requested)){selectedId=requested;renderRegistry();renderDetail();}notice(t('pilot.ready')); });
