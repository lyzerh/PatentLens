import { MODEL_PRESETS, modelNotice, isXaiUrl } from "./model-presets.js";
import { browserBase, browserJson, runBrowserExperiment, diagnoseBrowserXai } from "./browser-xai.js";
import { setupUiLab } from "./ui-lab.js";
import {t,term,onLanguageChange,initializeI18n} from './i18n/index.js';
initializeI18n();
const $ = (id) => document.getElementById(id);
const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const state = { records: [], selected: null, lastSearch: null, searchHistory: [], report: null, page: 0,
  sourceCoverage: "manual", runController: null, lastSearchInput: null, searchBusy: false, documentBusy: false };

async function api(path, body, signal) {
  const response = await fetch("/api/" + path, { method: "POST", headers: { "Content-Type": "application/json", "X-Patent-Client": "workbench" }, body: JSON.stringify(body), signal });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message ?? t('common.operationFailed'));
  return result;
}
function message(text, error = false, target = "global-message") {
  const box = $(target);
  box.textContent = text; box.classList.remove("hidden"); box.classList.toggle("error", error);
}
function switchTab(name) {
  // Original text stays visible above all experiment results in the vertical workflow.
  if (name === "source") name = "analysis";
  for (const tab of document.querySelectorAll(".tab")) {
    const selected = tab.dataset.tab === name;
    tab.classList.toggle("active", selected); tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
  for (const view of document.querySelectorAll(".tab-view")) view.classList.toggle("hidden", view.id !== "view-" + name);
}
for (const tab of document.querySelectorAll(".tab")) tab.addEventListener("click", () => switchTab(tab.dataset.tab));
document.querySelector(".tablist").addEventListener("keydown", (event) => {
  const tabs = [...document.querySelectorAll(".tab")];
  const i = tabs.indexOf(document.activeElement);
  if (i < 0 || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const index = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (i + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  switchTab(tabs[index].dataset.tab); tabs[index].focus();
});
function searchInput(page = 0) {
  return { query: $("query").value, source: $("source").value, assignee: $("assignee").value,
    country: $("country").value, after: $("after").value, before: $("before").value,
    page, searchKey: $("search-key").value };
}
function updateSource() {
  const epo = $("source").value === "epo";
  $("search-key-wrap").classList.toggle("hidden", $("source").value !== "serpapi");
  $("source-attribution").classList.toggle("hidden", !epo);
  $("query").placeholder = t(epo?'search.queryEpo':'search.queryGeneral');
  $("search-notice").textContent = sourceHint($("source").value);
  $("search-details").textContent = "";
}
function sourceHint(source) {
  return t(source==='seed'?'search.hintSeed':source==='epo'?'search.hintEpo':source==='google'?'search.hintGoogle':'search.hintSerp');
}
$("source").addEventListener("change", updateSource);
function refreshResultCards() {
  $("results").innerHTML = state.records.length ? state.records.map((r, index) =>
    '<button class="result-card' + (state.selected?.publicationNumber === r.publicationNumber ? " selected" : "") + '" aria-pressed="' + String(state.selected?.publicationNumber === r.publicationNumber) + '" data-index="' + index + '">' +
    '<div class="result-id"><span>' + escape(r.publicationNumber) + '</span><span class="country">' + escape(r.country) + '</span></div>' +
    '<div class="result-title">' + escape(r.title) + '</div><div class="result-meta">' + escape(r.assignee || t('search.applicantUnavailable')) +
    '<br>'+t('search.published',{date:escape(r.publicationDate || t('common.unknown'))}) + '</div><p class="result-snippet">' + escape(r.snippet) + '</p></button>').join("")
    : `<p class="empty compact">${t('search.noMatches')}</p>`;
}
async function search(page = 0, suppliedInput) {
  if (state.searchBusy || state.runController) return;
  state.searchBusy = true;
  $("search-button").disabled = true; $("search-button").textContent = t('search.searching');
  $("previous-page").disabled = true; $("next-page").disabled = true;
  $("global-message").classList.add("hidden");
  const input = suppliedInput ?? searchInput(page);
  try {
    const result = await api("search", input);
    state.records = result.records; state.page = result.page; state.lastSearch = result;
    state.lastSearchInput = { ...input, searchKey: undefined };
    state.searchHistory.push({ ...state.lastSearchInput, searchedAt: new Date().toISOString(), result });
    refreshResultCards();
    $("result-count").textContent = String(result.records.length) + (result.total !== null ? " / " + result.total : "");
    $("page-label").textContent = t('search.page',{page:result.page+1});
    $("previous-page").disabled = result.page === 0; $("next-page").disabled = !result.hasNext;
    $("search-notice").textContent = sourceHint(result.source) + (result.cache ? t(result.cache.hit?'search.cacheHit':'search.sourceFetched') : "");
    $("search-details").textContent = result.notice;
    $("source-attribution").classList.toggle("hidden", result.source !== "epo");
    $("pagination").classList.toggle("hidden", result.page === 0 && !result.hasNext);
    $("result-actions").classList.remove("hidden");
    $("search-external").href = result.searchUrl; $("search-external").classList.remove("hidden");
    $("export-search").disabled = false;
  } catch (error) {
    state.records = []; state.lastSearch = null; state.lastSearchInput = null; $("result-count").textContent = "—";
    $("results").innerHTML = `<p class="empty compact">${t('search.searchFailed')}</p>`;
    $("pagination").classList.add("hidden");
    $("result-actions").classList.remove("hidden");
    $("export-search").disabled = state.searchHistory.length === 0;
    message(error.message, true);
    state.searchHistory.push({ ...input, searchKey: undefined, searchedAt: new Date().toISOString(), error: error.message });
    $("export-search").disabled = false;
    const url = new URL("https://patents.google.com/"); url.searchParams.set("q", input.query);
    if (input.assignee) url.searchParams.set("assignee", input.assignee);
    if (input.country) url.searchParams.set("country", input.country);
    if (input.after) url.searchParams.set("after", "publication:" + input.after.replaceAll("-", ""));
    if (input.before) url.searchParams.set("before", "publication:" + input.before.replaceAll("-", ""));
    url.searchParams.set("dups", "language"); url.searchParams.set("type", "PATENT");
    url.searchParams.set("page", String(input.page ?? 0));
    $("search-external").href = input.source === "epo" ? "https://data.epo.org/linked-data/sparql-query" : url.href; $("search-external").classList.remove("hidden");
  } finally { state.searchBusy = false; $("search-button").disabled = false; $("search-button").textContent = t('search.search'); }
}
$("search-form").addEventListener("submit", (e) => { e.preventDefault(); search(); });
function pageInput(page) { return { ...state.lastSearchInput, page, searchKey: $("search-key").value }; }
$("previous-page").addEventListener("click", () => search(state.page - 1, pageInput(state.page - 1)));
$("next-page").addEventListener("click", () => search(state.page + 1, pageInput(state.page + 1)));
$("results").addEventListener("click", (e) => { const button = e.target.closest("[data-index]"); if (button) selectPatent(state.records[Number(button.dataset.index)]); });

function clearReport() {
  state.report = null; $("export-run").disabled = true; $("analysis-badge").textContent = "";
  for (const view of ["analysis", "evidence", "raw"]) $("view-" + view).innerHTML = `<p class="empty">${t('search.inputChanged')}</p>`;
}
function setDocument(patent) {
  state.selected = patent; state.sourceCoverage = patent.coverage ?? "manual";
  $("document-id").textContent = patent.publicationNumber || t('search.manualInput');
  $("document-title").textContent = patent.title || t('search.manualPatent');
  $("document-meta").textContent = [patent.assignee, patent.publicationDate && t('search.published',{date:patent.publicationDate}), patent.language && t('search.sourceLanguage',{language:patent.language.toUpperCase()}), patent.fetchedAt && t('search.retrieved',{time:patent.fetchedAt})].filter(Boolean).join(" · ");
  $("input-publication").value = patent.publicationNumber ?? ""; $("input-title").value = patent.title ?? "";
  $("text-claims").value = (patent.claims ?? []).map((c) => c.text).join("\n\n");
  $("text-abstract").value = patent.abstract ?? ""; $("text-description").value = patent.description ?? "";
  $("claim-selection").innerHTML = `<option value="all">${t('search.allClaims')}</option>` + (patent.claims ?? []).map((c, index) => '<option value="' + index + '">Claim ' + escape(c.number) + '</option>').join("");
  const notice = patent.source === "epo" && patent.sectionAvailability
    ? "EPO XML · " + Object.entries(patent.sectionLanguages ?? {}).map(([section, lang]) => term('section',section) + " " + String(lang).toUpperCase()).join(" / ") +
      t(Object.values(patent.sectionAvailability).every(Boolean)?'search.sourceOriginal':'search.sourcePartial')
    : patent.notice || "";
  $("document-notice").textContent = notice; $("document-notice").classList.toggle("hidden", !notice);
  $("patent-external").classList.toggle("hidden", !patent.sourceUrl);
  if (patent.sourceUrl) $("patent-external").href = patent.sourceUrl;
  $("fetch-live").classList.toggle("hidden", !patent.publicationNumber || patent.source === "manual");
  clearReport(); switchTab("source"); updateCount(); refreshResultCards();
}
async function selectPatent(record) {
  if (state.documentBusy || state.runController) return;
  state.documentBusy = true;
  message(t('search.loading',{patentId:record.publicationNumber}));
  try {
    const patent = await api("patent", { publicationNumber: record.publicationNumber, source: record.source, searchKey: $("search-key").value });
    setDocument(patent); $("global-message").classList.add("hidden");
    $("read-stage").scrollIntoView({ behavior: document.body.dataset.motion === "off" ? "instant" : "smooth", block: "start" });
  } catch (error) {
    setDocument({ ...record, claims: [], abstract: "", description: "", notice: t('search.sourceFailure') });
    message(error.message, true);
  } finally { state.documentBusy = false; }
}
$("fetch-live").addEventListener("click", () => {
  if (state.selected) selectPatent({ ...state.selected, source: state.selected.source === "epo" ? "epo" : $("source").value === "epo" ? "epo" : $("source").value === "serpapi" ? "serpapi" : "google" });
});
$("manual-input").addEventListener("click", () => {
  setDocument({ source: "manual", claims: [], coverage: "manual", notice: t('search.manualNotice') }); $("text-claims").focus();
});
$("claim-selection").addEventListener("change", () => {
  const i = $("claim-selection").value;
  $("text-claims").value = i === "all" ? (state.selected?.claims ?? []).map((c) => c.text).join("\n\n") : state.selected?.claims?.[Number(i)]?.text ?? "";
  clearReport(); updateCount();
});
function testInput() {
  return { publicationNumber: $("input-publication").value, title: $("input-title").value, coverage: state.sourceCoverage,
    sections: Object.fromEntries(["claims", "abstract", "description"].map((s) => [s, $("include-" + s).checked ? $("text-" + s).value : ""])) };
}
function updateCount() {
  const size = Object.values(testInput().sections).reduce((sum, s) => sum + s.trim().length, 0);
  $("input-count").textContent = t('search.count',{count:size.toLocaleString()});
}
for (const section of ["claims", "abstract", "description"]) {
  $("text-" + section).addEventListener("input", () => {
    state.sourceCoverage = "manual_modified";
    $("document-notice").textContent = t('search.edited');
    $("document-notice").classList.remove("hidden"); clearReport(); updateCount();
  });
  $("include-" + section).addEventListener("change", () => { clearReport(); updateCount(); });
}
for (const name of ["input-publication", "input-title"]) $(name).addEventListener("input", clearReport);

function config() {
  return { protocol: $("protocol").value, baseUrl: $("base-url").value, apiKey: $("api-key").value,
    model: $("model").value, format: $("output-format").value, maxOutputTokens: Number($("max-tokens").value), tokenParameter: $("token-parameter").value, reasoningEffort: $("reasoning-effort").value };
}
function updateModelNotice() {
  $("model-notice").textContent = modelNotice($("base-url").value.trim(), $("model").value.trim());
  $("token-parameter-wrap").classList.toggle("hidden", $("protocol").value !== "chat");
}
$("connection-preset").addEventListener("change", () => {
  const preset = MODEL_PRESETS[$("connection-preset").value];
  if (!preset) { updateModelNotice(); return; }
  // Do not carry credentials from another service into the xAI preset.
  if (!isXaiUrl($("base-url").value)) $("api-key").value = "";
  for (const [id, field] of [["base-url", "baseUrl"], ["protocol", "protocol"], ["model", "model"], ["output-format", "format"], ["max-tokens", "maxOutputTokens"], ["token-parameter", "tokenParameter"], ["reasoning-effort", "reasoningEffort"]]) $(id).value = preset[field];
  $("model-list").innerHTML = Object.values(MODEL_PRESETS).map((p) => '<option value="' + escape(p.model) + '"></option>').join("");
  $("settings-message").classList.add("hidden"); updateModelNotice(); applySettings();
});
for (const id of ["base-url", "model", "protocol", "reasoning-effort"]) $(id).addEventListener("input", () => { $("connection-preset").value = "custom"; updateModelNotice(); });
function applySettings() {
  const ready = Boolean($("api-key").value.trim());
  $("connection-state").textContent = ready ? $("model").value : t('search.apiMissing');
  $("test-mode").textContent = ready ? $("model").value + " · " + t($("transport").value === "browser"?'search.directBrowser':'search.localBackend') : t('search.apiMissing');
  $("test-help").textContent = t('search.testHelp');
  $("transport-notice").textContent = $("transport").value === "browser"
    ? t('search.directNotice')
    : t('search.backendNotice');
}
$("transport").addEventListener("change", applySettings);
$("settings-open").addEventListener("click", () => $("settings-dialog").showModal());
$("protocol").addEventListener("change", updateModelNotice);
$("settings-close").addEventListener("click", () => $("settings-dialog").close());
$("settings-form").addEventListener("submit", (e) => { e.preventDefault(); applySettings(); $("settings-dialog").close(); });
$("toggle-key").addEventListener("click", () => { const show = $("api-key").type === "password"; $("api-key").type = show ? "text" : "password"; $("toggle-key").textContent = t(show?'search.hide':'search.show'); });
$("clear-key").addEventListener("click", () => { $("api-key").value = ""; $("search-key").value = ""; $("api-key").type = "password"; $("toggle-key").textContent = t('search.show'); applySettings(); message(t('search.keyCleared'), false, "settings-message"); });
$("check-api").addEventListener("click", async () => {
  $("check-api").disabled = true;
  try {
    const current = config();
    const result = $("transport").value === "browser"
      ? await browserJson(browserBase(current.baseUrl) + "/models", current.apiKey).then((data) => {
        if (!Array.isArray(data.data)) throw new Error(t('search.modelsMalformed'));
        return { models: data.data.map((item) => item.id).filter((id) => typeof id === "string").sort() };
      }) : await api("models", current);
    $("model-list").innerHTML = result.models.map((m) => '<option value="' + escape(m) + '"></option>').join("");
    message(t('search.modelsConnected',{count:result.models.length}), false, "settings-message");
  } catch (error) { message(error.message, true, "settings-message"); }
  finally { $("check-api").disabled = false; }
});
$("network-diagnose").addEventListener("click", async () => {
  $("network-diagnose").disabled = true;
  $("network-report").textContent = t('search.networkChecking');
  try {
    const checks = await Promise.allSettled([diagnoseBrowserXai(), api("diagnostics", {})]);
    const lines = checks.map((entry, index) => {
      const label = t(index === 0 ? 'search.networkBrowser' : 'search.networkBackend');
      if (entry.status !== "fulfilled") return t('search.networkFailed',{place:label});
      const result = entry.value;
      return t('search.networkLine',{place:label,result:result.reachedHttp?t('search.networkHttp',{status:result.httpStatus}):t('search.networkNoResponse',{error:result.errorCode}),seconds:(result.latencyMs / 1000).toFixed(2),note:result.note});
    });
    $("network-report").textContent = lines.join("\n\n") + "\n\n"+t('search.networkFooter');
  } finally { $("network-diagnose").disabled = false; }
});
$("prompt-preview").addEventListener("click", async () => {
  try { const result = await api("prompt", testInput()); $("prompt-text").textContent = result.prompt; $("prompt-dialog").showModal(); }
  catch (error) { message(error.message, true); }
});
$("prompt-close").addEventListener("click", () => $("prompt-dialog").close());

const refs = (ids) => (ids ?? []).map((id) => '<button class="evidence-ref" data-evidence="' + escape(id) + '">' + escape(id) + '</button>').join("");
function renderReport(report) {
  const { output, evaluation: ev, run } = report;
  const metrics = ev.metrics;
  const rate = metrics.groundingRate === null ? "—" : Math.round(metrics.groundingRate * 100) + "%";
  const status = t(ev.status === "needs_revision" ? 'search.validationNeedsRevision' : 'search.validationNeedsReview');
  let html = '<div class="test-status"><span class="status-tag' + (ev.errors.length ? " error" : "") + '">' + status + '</span><span class="mono">' + escape(run.model) + (run.mock ? " · MOCK" : "") + '</span></div>' +
    '<div class="metrics"><div><strong>' + metrics.errorCount + '</strong>'+t('search.errors')+'</div><div><strong>' + metrics.groundedEvidenceCount + " / " + metrics.evidenceCount + '</strong>'+t('search.quoteMatches')+'</div><div><strong>' + rate + '</strong>'+t('search.matchRate')+'</div><div><strong>' + (run.latencyMs / 1000).toFixed(2) + 's</strong>'+t('search.latency')+'</div></div>';
  html += '<p class="small-note">'+t('search.groundingNote')+'</p>';
  for (const err of ev.errors) html += '<div class="issue"><code>' + escape(err.type) + '</code> · ' + escape(err.path) + '<br>' + escape(err.message) + '</div>';
  if (ev.schemaValid && output) {
    for (const [field, key] of [["problem", "search.problem"], ["mechanism", "search.mechanism"], ["technicalEffect", "search.effect"]]) {
      html += '<section class="analysis-block"><h3>' + t(key) + '</h3><p>' + escape(output[field].value ?? t('search.noExtract')) + refs(output[field].evidenceIds) + '</p></section>';
    }
    html += '<section class="analysis-block"><h3>'+t('search.claimElements')+'</h3>';
    html += output.claimElements.length ? output.claimElements.map((el) => '<p><span class="mono">' + escape(el.elementId) + ' · Claim ' + escape(el.claimNumber) + '</span><br>' + escape(el.text) + refs(el.evidenceIds) + '</p>').join("<hr>") : '<p>'+t('search.noElements')+'</p>';
    html += '</section><section class="analysis-block"><h3>'+t('search.features')+'</h3>' + (output.technicalFeatures.map((f) => '<p>' + escape(f.text) + refs(f.evidenceIds) + '</p>').join("<hr>") || '<p>'+t('search.noFeatures')+'</p>') + '</section>';
    html += '<section class="analysis-block"><h3>'+t('search.categories')+'</h3>' + output.technologyCategories.map((c) => '<span class="category-tag">' + escape(c.label) + refs(c.evidenceIds) + '</span>').join("") + '</section>';
    if (output.uncertainties.length) html += '<section class="analysis-block"><h3>'+t('search.uncertainties')+'</h3>' + output.uncertainties.map((u) => '<p>' + escape(u) + '</p>').join("") + '</section>';
  }
  if (ev.warnings.length) html += '<details class="validation-notes"><summary>'+t('search.validationLimits')+'</summary><p class="small-note">' + ev.warnings.map(escape).join("<br>") + '</p></details>';
  $("view-analysis").innerHTML = html;
  $("analysis-badge").textContent = ev.errors.length ? "(" + ev.errors.length + ")" : "✓";
  $("view-evidence").innerHTML = ev.evidenceChecks.length ? ev.evidenceChecks.map((check, i) => {
    const original = report.input.sections[check.section];
    const found = check.offset !== null;
    const context = found ? escape(original.slice(Math.max(0, check.offset - 70), check.offset)) + "<mark>" + escape(check.quote) + "</mark>" + escape(original.slice(check.offset + check.quote.length, check.offset + check.quote.length + 70)) : "";
    return '<article class="evidence-card" id="evidence-' + i + '"><div class="evidence-heading"><span>' + escape(check.evidenceId) + " · " + escape(check.section) + '</span><span class="' + (check.match === "not_found" ? "unmatched" : "matched") + '">' +
      t(check.match === "exact" ? 'search.evidenceExact' : check.match === "whitespace_normalized" ? 'search.evidenceNormalized' : 'search.evidenceMissing') +
      '</span></div><blockquote>' + escape(check.quote) + '</blockquote>' +
      (context ? '<div class="source-context">' + context + '</div>' : "") +
      '<p class="small-note">'+t('search.location',{location:escape(check.location),offset:found?t('search.offset',{offset:check.offset}):''})+'</p></article>';
  }).join("") : '<div class="empty"><h3>'+t('search.noEvidence')+'</h3><p>'+t('search.reviewErrors')+'</p></div>';
  const usage = run.usage ? JSON.stringify(run.usage) : t('search.usageMissing');
  $("view-raw").innerHTML = '<div class="raw-meta">'+t('search.rawModel')+'：' + escape(run.model) + '<br>'+t('search.rawProtocol')+'：' + escape(run.protocol) + '<br>'+t('search.rawTime')+'：' + escape(run.createdAt) +
    '<br>'+t('search.rawRoute')+'：' + escape(run.transport ?? "backend") + '<br>'+t('search.rawOrigin')+'：' + escape(run.responseOrigin ?? t('search.olderRecord')) +
    '<br>'+t('search.rawReasoning')+'：' + escape(run.reasoningEffort ?? t('search.providerDefault')) + '<br>'+t('search.rawResolved')+'：' + escape(run.resolvedModel ?? t('search.providerUnavailable')) +
    '<br>Prompt：' + escape(run.promptVersion) + '<br>Schema：' + escape(run.schemaVersion) + '<br>'+t('search.rawHash')+'：' + escape(run.inputHash) +
    '<br>'+t('search.rawUsage')+'：' + escape(usage) + '</div><details class="raw-block" open><summary>'+t('search.rawOutput')+'</summary><pre>' + escape(report.outputText) +
    '</pre></details><details class="raw-block"><summary>'+t('search.rawResponse')+'</summary><pre>' + escape(JSON.stringify(report.rawResponse, null, 2)) +
    '</pre></details><details class="raw-block"><summary>'+t('search.rawPrompt')+'</summary><pre>' + escape(report.prompt) + '</pre></details>';
}
document.querySelector(".detail-panel").addEventListener("click", (e) => {
  const ref = e.target.closest("[data-evidence]");
  if (!ref || !state.report) return;
  switchTab("evidence"); const index = state.report.evaluation.evidenceChecks.findIndex((c) => c.evidenceId === ref.dataset.evidence);
  $("evidence-" + index)?.scrollIntoView({ behavior: document.body.dataset.motion === "off" ? "instant" : "smooth", block: "center" });
});
function busy(value) {
  for (const id of ["run-test", "run-mock", "manual-input", "fetch-live", "search-button", "settings-open", "claim-selection"]) $(id).disabled = value;
  for (const section of ["claims", "abstract", "description"]) { $("text-" + section).disabled = value; $("include-" + section).disabled = value; }
  $("input-publication").disabled = value; $("input-title").disabled = value;
  $("export-run").disabled = value || !state.report;
  $("cancel-test").classList.toggle("hidden", !value);
  $("run-test").textContent = t(value?'search.running':'search.run');
}
async function run(mock, bad = false) {
  if (state.runController || state.documentBusy) return;
  if (!mock && !$("api-key").value.trim()) { $("settings-dialog").showModal(); message(t('search.keyRequired'), true, "settings-message"); return; }
  const input = testInput();
  if (Object.values(input.sections).join("").trim().length < 20) { message(t('search.sourceRequired'), true); switchTab("source"); return; }
  const controller = new AbortController(); state.runController = controller; busy(true);
  try {
    const report = !mock && $("transport").value === "browser"
      ? await runBrowserExperiment(input, config(), { api, signal: controller.signal })
      : await api("test", { input, config: mock ? { protocol: "mock", bad } : config() }, controller.signal);
    state.report = report; renderReport(report); switchTab("analysis");
    $("verify-stage").scrollIntoView({ behavior: document.body.dataset.motion === "off" ? "instant" : "smooth", block: "start" });
    message(t(mock?'search.mockDone':'search.realDone'));
  } catch (error) { message(error.name === "AbortError" ? t('search.aborted') : error.message, error.name !== "AbortError"); }
  finally { state.runController = null; busy(false); }
}
$("run-test").addEventListener("click", () => run(false));
$("run-mock").addEventListener("click", (e) => run(true, e.shiftKey));
$("cancel-test").addEventListener("click", () => state.runController?.abort());
function download(name, value) {
  // No settings or keys are included. Files are created only at the user's export action.
  let text = JSON.stringify(value, null, 2);
  for (const key of [$("api-key").value, $("search-key").value].filter(Boolean)) text = text.split(JSON.stringify(key).slice(1, -1)).join("[REDACTED]");
  const url = URL.createObjectURL(new Blob([text], { type: "application/json;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}
$("export-run").addEventListener("click", () => {
  if (!state.report) return;
  const report = state.selected?.source === "epo" ? { ...state.report, sourceProvenance: { source: "epo", sourceUrl: state.selected.sourceUrl,
    attribution: state.selected.attribution, language: state.selected.language, sectionLanguages: state.selected.sectionLanguages, fetchedAt: state.selected.fetchedAt, coverage: state.sourceCoverage } } : state.report;
  download("patent-experiment-" + state.report.run.createdAt.replace(/[:.]/g, "-") + ".json", report);
});
$("export-search").addEventListener("click", () => download("patent-search-log.json", state.searchHistory));
onLanguageChange(()=>{
  const patent=state.selected;
  if(state.records.length)refreshResultCards();
  if(state.lastSearch){$("page-label").textContent=t('search.page',{page:state.page+1});$("search-notice").textContent=sourceHint(state.lastSearch.source);}
  else {$("result-count").textContent=t('search.notSearched');if(!state.searchBusy&&!state.records.length)$("results").innerHTML=`<p class="empty compact">${t('search.idle')}</p>`;}
  if(patent){
    $("document-id").textContent=patent.publicationNumber||t('search.manualInput');
    $("document-title").textContent=patent.title||t('search.manualPatent');
    $("document-meta").textContent=[patent.assignee,patent.publicationDate&&t('search.published',{date:patent.publicationDate}),patent.language&&t('search.sourceLanguage',{language:patent.language.toUpperCase()}),patent.fetchedAt&&t('search.retrieved',{time:patent.fetchedAt})].filter(Boolean).join(' · ');
    $("claim-selection").options[0].textContent=t('search.allClaims');
  }
  if(state.report)renderReport(state.report);
  updateCount();applySettings();
  $("toggle-key").textContent=t($("api-key").type==='password'?'search.show':'search.hide');
});
updateSource(); updateModelNotice(); applySettings(); updateCount();
setupUiLab();
fetch("/api/health", { cache: "no-store" }).then((response) => response.json()).then((health) => {
  const network = health.retrievalNetwork;
  $("retrieval-network").textContent = network?.mode === "proxy"
    ? t('search.networkProxy',{url:network.proxyUrl})
    : t('search.networkDirect');
}).catch(() => { $("retrieval-network").textContent = t('search.networkMissing'); });
