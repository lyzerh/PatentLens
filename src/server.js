import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { AppError } from "./errors.js";
import { searchPatents, getPatent } from "./retrieval.js";
import { runExperiment, listModels, prepareBrowserExperiment, completeBrowserExperiment } from "./llm.js";
import { diagnoseXai } from "./diagnostics.js";
import { buildPrompt, prepareInput } from "./extraction.js";
import { loadRetrievalNetwork, createRetrievalTransport } from "./network.js";
import { createPilotService } from "./pilot/service.ts";
import { createThermalService } from "./pilot/thermal-service.ts";
import { createThermalAnnotationService } from "./pilot/thermal-annotation.ts";
import { createPatentFeatureService } from "./pilot/patent-features.ts";
import { createPatentComparisonService } from "./pilot/patent-comparison.ts";
import { createPatentRepositoryService } from "./pilot/patent-repository.ts";
import { createPatentCollectionService } from "./pilot/patent-collections.ts";
import { createFeatureLlmService } from "./pilot/feature-llm-service.ts";
import { createXaiKeySession } from "./xai-key-session.js";

export const APP_VERSION = "0.6.0";

const PUBLIC = new URL("../public/", import.meta.url);
const staticFiles = new Map([["/", ["workspace.html", "text/html; charset=utf-8"]], ["/workspace", ["workspace.html", "text/html; charset=utf-8"]], ["/workspace.js", ["workspace.js", "text/javascript; charset=utf-8"]], ["/workspace-nav.js", ["workspace-nav.js", "text/javascript; charset=utf-8"]], ["/workspace.css", ["workspace.css", "text/css; charset=utf-8"]], ["/patent-search", ["index.html", "text/html; charset=utf-8"]], ["/app.js", ["app.js", "text/javascript; charset=utf-8"]], ["/browser-xai.js", ["browser-xai.js", "text/javascript; charset=utf-8"]], ["/model-presets.js", ["model-presets.js", "text/javascript; charset=utf-8"]], ["/style.css", ["style.css", "text/css; charset=utf-8"]], ["/pilot", ["pilot.html", "text/html; charset=utf-8"]], ["/pilot.js", ["pilot.js", "text/javascript; charset=utf-8"]], ["/pilot.css", ["pilot.css", "text/css; charset=utf-8"]], ["/pilot-v3", ["pilot-v3.html", "text/html; charset=utf-8"]], ["/pilot-v3.js", ["pilot-v3.js", "text/javascript; charset=utf-8"]], ["/pilot-v3.css", ["pilot-v3.css", "text/css; charset=utf-8"]], ["/pilot-thermal", ["pilot-thermal.html", "text/html; charset=utf-8"]], ["/pilot-thermal.js", ["pilot-thermal.js", "text/javascript; charset=utf-8"]], ["/pilot-thermal.css", ["pilot-thermal.css", "text/css; charset=utf-8"]]]);
for (const [route,file,type] of [["/review-thermal","review-thermal.html","text/html; charset=utf-8"],["/review-thermal.js","review-thermal.js","text/javascript; charset=utf-8"],["/review-thermal.css","review-thermal.css","text/css; charset=utf-8"]]) staticFiles.set(route,[file,type]);
for (const [route,file,type] of [["/patent-features","patent-features.html","text/html; charset=utf-8"],["/patent-features.js","patent-features.js","text/javascript; charset=utf-8"],["/patent-features.css","patent-features.css","text/css; charset=utf-8"],["/claim-coverage.js","claim-coverage.js","text/javascript; charset=utf-8"]]) staticFiles.set(route,[file,type]);
for (const [route,file,type] of [["/patent-compare","patent-compare.html","text/html; charset=utf-8"],["/patent-compare.js","patent-compare.js","text/javascript; charset=utf-8"],["/patent-compare.css","patent-compare.css","text/css; charset=utf-8"]]) staticFiles.set(route,[file,type]);
for (const [route,file,type] of [["/patent-repository","patent-repository.html","text/html; charset=utf-8"],["/patent-repository.js","patent-repository.js","text/javascript; charset=utf-8"],["/patent-repository.css","patent-repository.css","text/css; charset=utf-8"],["/patent-repository-audit.js","patent-repository-audit.js","text/javascript; charset=utf-8"]]) staticFiles.set(route,[file,type]);
for (const file of ["ui-lab.js", "ui-metrics.js"]) staticFiles.set("/" + file, [file, "text/javascript; charset=utf-8"]);
for (const file of ["index.js", "zh-CN.js", "en.js", "zh-static.js", "en-static.js", "static-source.js", "pilot.js", "v3.js", "search.js", "review.js", "features.js", "compare.js", "repository.js", "workspace.js"]) staticFiles.set("/i18n/"+file,["i18n/"+file,"text/javascript; charset=utf-8"]);
staticFiles.set("/i18n/i18n.css",["i18n/i18n.css","text/css; charset=utf-8"]);
function send(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(value));
}
export const isLoopbackAddress = address => ["127.0.0.1", "::ffff:127.0.0.1", "::1"].includes(address);
async function readBody(req, maxBytes = 1500000) {
  if (!(req.headers["content-type"] ?? "").startsWith("application/json")) throw new AppError("INVALID_CONTENT_TYPE", "API 请求需要 JSON。", 415);
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new AppError("BODY_TOO_LARGE", "请求过大。", 413);
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body;
  } catch { throw new AppError("INVALID_JSON", "请求格式不是 JSON 对象。"); }
}

export function createApp({ fetchImpl = fetch, retrievalFetchImpl = fetchImpl, retrievalNetwork = { mode: "direct", proxyUrl: null, source: "injected", scope: "patent_retrieval_only" }, pilotPath, thermalDatasetPath, thermalReviewPath, thermalSmokePath, thermalAnnotationPath, featureStorePath, comparisonStorePath, repositoryStorePath, collectionStorePath, featureLlmStorePath, featureLlmProvider, getXaiKey } = {}) {
  const keySession = createXaiKeySession({ fetchImpl, getEnvironmentKey: getXaiKey });
  const pilot = createPilotService({ path: pilotPath, fetchImpl, retrievalFetchImpl, getKey: keySession.getKey });
  const thermal = createThermalService({ datasetPath: thermalDatasetPath, reviewPath: thermalReviewPath, smokePath: thermalSmokePath, legacyPath: pilotPath, fetchImpl, getKey: keySession.getKey });
  const annotation = createThermalAnnotationService({ datasetPath: thermalDatasetPath, storePath: thermalAnnotationPath });
  const features = createPatentFeatureService({datasetPath:thermalDatasetPath,storePath:featureStorePath});
  const comparisons = createPatentComparisonService({datasetPath:thermalDatasetPath,featureStorePath,repositoryStorePath,storePath:comparisonStorePath});
  const repository = createPatentRepositoryService({datasetPath:thermalDatasetPath,featureStorePath,storePath:repositoryStorePath});
  const collections = createPatentCollectionService({datasetPath:thermalDatasetPath,featureStorePath,repositoryStorePath,storePath:collectionStorePath});
  const featureLlm = createFeatureLlmService({datasetPath:thermalDatasetPath,featureStorePath,repositoryStorePath,storePath:featureLlmStorePath,provider:featureLlmProvider,fetchImpl,getKey:keySession.getKey});
  return http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' https://api.x.ai https://us.api.x.ai; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const expectedHost = "127.0.0.1:" + req.socket.localPort;
    if (![expectedHost, "localhost:" + req.socket.localPort].includes(req.headers.host)) return send(res, 403, { error: { code: "INVALID_HOST", message: "仅允许本机访问。" } });
    const origin = req.headers.origin;
    if (origin && origin !== "http://" + req.headers.host) return send(res, 403, { error: { code: "INVALID_ORIGIN", message: "禁止跨站 API 请求。" } });
    const controller = new AbortController();
    res.on("close", () => { if (!res.writableEnded) controller.abort(); });
    try {
      const pathname = new URL(req.url, "http://" + expectedHost).pathname;
      if (pathname.startsWith("/api/xai/settings/")) {
        if (!isLoopbackAddress(req.socket.remoteAddress)) throw new AppError("LOCAL_ONLY", "API 设置仅限本机访问。", 403);
        if (req.method === "GET" && pathname === "/api/xai/settings/status") return send(res, 200, keySession.status());
        if (req.method === "GET" && pathname === "/api/xai/settings/csrf") return send(res, 200, { csrfToken: keySession.csrfToken() });
        if (origin !== "http://" + req.headers.host) throw new AppError("INVALID_ORIGIN", "API 设置需要同源页面请求。", 403);
        if (req.headers["x-patent-client"] !== "workbench" || !keySession.checkCsrf(req.headers["x-patent-csrf"])) throw new AppError("INVALID_CSRF", "页面验证已失效，请刷新后重试。", 403);
        if (req.method === "POST" && pathname === "/api/xai/settings/key") { const value = await readBody(req); try { return send(res, 200, keySession.save(value.apiKey)); } catch { throw new AppError("INVALID_API_KEY", "API Key 格式无效；请检查输入。", 400); } }
        if (req.method === "POST" && pathname === "/api/xai/settings/test") { await readBody(req); return send(res, 200, await keySession.test(controller.signal)); }
        if (req.method === "DELETE" && pathname === "/api/xai/settings/key") return send(res, 200, keySession.clear());
        throw new AppError("NOT_FOUND", "接口不存在。", 404);
      }
      if (req.method === "GET" && pathname === "/api/health") return send(res, 200, { ok: true, app: "patent-intelligence-workbench", version: APP_VERSION, mode: "local", browserDirect: true, retrievalNetwork });
      if (req.method === "GET" && staticFiles.has(pathname)) {
        const [file, type] = staticFiles.get(pathname);
        const bytes = await readFile(new URL(file, PUBLIC));
        res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" }); res.end(bytes); return;
      }
      if (req.method === "GET" && pathname === "/pilot-v3-taxonomy") {
        const bytes = await readFile(new URL("../docs/pilot-v3-taxonomy-v0.3.1.md", import.meta.url));
        res.writeHead(200, { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "no-store" }); res.end(bytes); return;
      }
      if (req.method !== "POST") throw new AppError("NOT_FOUND", "接口不存在。", 404);
      if (req.headers["x-patent-client"] !== "workbench") throw new AppError("INVALID_CLIENT", "需要同源工作台请求。", 403);
      if (pathname.startsWith("/api/review-thermal/")) {
        if (!isLoopbackAddress(req.socket.remoteAddress)) throw new AppError("LOCAL_ONLY", "审核工作台仅限本机访问。", 403);
        if (origin !== "http://" + req.headers.host) throw new AppError("INVALID_ORIGIN", "审核工作台需要同源请求。", 403);
        if (!keySession.checkCsrf(req.headers["x-patent-csrf"])) throw new AppError("INVALID_CSRF", "页面验证已失效，请刷新后重试。", 403);
        const value = await readBody(req,100000);
        try {
          if (pathname === "/api/review-thermal/tasks") return send(res,200,await annotation.tasks());
          if (pathname === "/api/review-thermal/source") return send(res,200,await annotation.source(value.publicationNumber));
          if (pathname === "/api/review-thermal/load") return send(res,200,await annotation.load(value.reviewer));
          if (pathname === "/api/review-thermal/save") return send(res,200,await annotation.save(value));
          if (pathname === "/api/review-thermal/export") return send(res,200,await annotation.exportAnnotations(value.reviewer));
          throw new AppError("NOT_FOUND", "接口不存在。", 404);
        } catch(e) { throw e instanceof AppError ? e : new AppError("ANNOTATION_ERROR", e instanceof Error ? e.message : "审核操作失败", 400); }
      }
      if (pathname.startsWith("/api/patent-features/")) {
        if (!isLoopbackAddress(req.socket.remoteAddress)) throw new AppError("LOCAL_ONLY", "特征解析仅限本机访问。", 403);
        if (origin !== "http://" + req.headers.host) throw new AppError("INVALID_ORIGIN", "特征解析需要同源请求。", 403);
        if (!keySession.checkCsrf(req.headers["x-patent-csrf"])) throw new AppError("INVALID_CSRF", "页面验证已失效，请刷新后重试。", 403);
        const value=await readBody(req,150000);
        try {
          if(pathname==="/api/patent-features/list")return send(res,200,await features.list());
          if(pathname==="/api/patent-features/source")return send(res,200,await features.source(value.publicationNumber));
          if(pathname==="/api/patent-features/extract")return send(res,200,await features.extract(value.publicationNumber,value.mode));
          if(pathname==="/api/patent-features/create")return send(res,200,await features.create(value.publicationNumber,value.mode));
          if(pathname==="/api/patent-features/load")return send(res,200,await features.load(value.publicationNumber));
          if(pathname==="/api/patent-features/review")return send(res,200,await features.saveReview(value.publicationNumber,value.recordId,value.reviewer,value.status,value.candidate));
          if(pathname==="/api/patent-features/export")return send(res,200,await features.exportRecord(value.publicationNumber));
          throw new AppError("NOT_FOUND","接口不存在。",404);
        } catch(e){throw e instanceof AppError?e:new AppError("FEATURE_ERROR",e instanceof Error?e.message:"特征解析失败",400);}
      }
      if (pathname.startsWith("/api/patent-compare/")) {
        if (!isLoopbackAddress(req.socket.remoteAddress)) throw new AppError("LOCAL_ONLY", "专利比较仅限本机访问。", 403);
        if (origin !== "http://" + req.headers.host) throw new AppError("INVALID_ORIGIN", "专利比较需要同源请求。", 403);
        if (!keySession.checkCsrf(req.headers["x-patent-csrf"])) throw new AppError("INVALID_CSRF", "页面验证已失效，请刷新后重试。", 403);
        const value=await readBody(req,150000);
        try {
          if(pathname==="/api/patent-compare/list")return send(res,200,await comparisons.list());
          if(pathname==="/api/patent-compare/source")return send(res,200,await comparisons.source(value.publicationNumber,value.ref));
          if(pathname==="/api/patent-compare/generate")return send(res,200,await comparisons.generate(value.patentA,value.patentB,value.refA,value.refB));
          if(pathname==="/api/patent-compare/create")return send(res,200,await comparisons.create(value.patentA,value.patentB,value.refA,value.refB));
          if(pathname==="/api/patent-compare/history")return send(res,200,await comparisons.listHistory());
          if(pathname==="/api/patent-compare/load")return send(res,200,await comparisons.load(value.comparisonId));
          if(pathname==="/api/patent-compare/review")return send(res,200,await comparisons.review(value.comparisonId,value.reviewer,value.status,value.alignments,value.rationale,value.expectedRevisionId));
          if(pathname==="/api/patent-compare/export")return send(res,200,await comparisons.exportRecord(value.comparisonId));
          throw new AppError("NOT_FOUND","接口不存在。",404);
        } catch(e){throw e instanceof AppError?e:new AppError("COMPARISON_ERROR",e instanceof Error?e.message:"专利比较失败",400);}
      }
      if (pathname.startsWith("/api/patent-repository/") || pathname.startsWith("/api/patent-collections/")) {
        if (!isLoopbackAddress(req.socket.remoteAddress)) throw new AppError("LOCAL_ONLY", "特征库仅限本机访问。", 403);
        if (origin !== "http://" + req.headers.host) throw new AppError("INVALID_ORIGIN", "特征库需要同源请求。", 403);
        if (!keySession.checkCsrf(req.headers["x-patent-csrf"])) throw new AppError("INVALID_CSRF", "页面验证已失效，请刷新后重试。", 403);
        const value=await readBody(req,150000);
        try {
          if(pathname==="/api/patent-repository/manifest")return send(res,200,await repository.manifest());
          if(pathname==="/api/patent-repository/preview")return send(res,200,await repository.preview(value.publicationNumbers));
          if(pathname==="/api/patent-repository/run-batch")return send(res,200,await repository.runBatch(value.publicationNumbers));
          if(pathname==="/api/patent-repository/search")return send(res,200,await repository.search(value.query??{}));
          if(pathname==="/api/patent-repository/record")return send(res,200,await repository.get(value.extractionRecordId));
          if(pathname==="/api/patent-repository/llm-state")return send(res,200,await featureLlm.publicState());
          if(pathname==="/api/patent-repository/llm-preflight")return send(res,200,await featureLlm.preflight(value.publicationNumbers));
          if(pathname==="/api/patent-repository/llm-authorize")return send(res,200,await featureLlm.authorize(value));
          if(pathname==="/api/patent-repository/llm-execute")return send(res,200,await featureLlm.execute(value));
          if(pathname==="/api/patent-repository/llm-inspect")return send(res,200,await featureLlm.inspect(value.attemptId));
          if(pathname==="/api/patent-collections/list")return send(res,200,await collections.list());
          if(pathname==="/api/patent-collections/create")return send(res,200,await collections.create(value.title,value.description,value.optionalNotes));
          if(pathname==="/api/patent-collections/load")return send(res,200,await collections.get(value.collectionId));
          if(pathname==="/api/patent-collections/edit")return send(res,200,await collections.edit(value.collectionId,value.title,value.description,value.optionalNotes));
          if(pathname==="/api/patent-collections/add")return send(res,200,await collections.add(value.collectionId,value.extractionRecordId,value.revisionId));
          if(pathname==="/api/patent-collections/remove")return send(res,200,await collections.remove(value.collectionId,value.publicationNumber));
          if(pathname==="/api/patent-collections/export")return send(res,200,await collections.exportCollection(value.collectionId));
          throw new AppError("NOT_FOUND","接口不存在。",404);
        } catch(e){throw e instanceof AppError?e:new AppError("REPOSITORY_ERROR",e instanceof Error?e.message:"特征库操作失败",400);}
      }
      if (["/api/thermal/smoke-preflight","/api/thermal/smoke-authorize","/api/thermal/smoke-run"].includes(pathname)) {
        if (!isLoopbackAddress(req.socket.remoteAddress)) throw new AppError("LOCAL_ONLY", "Smoke Test 仅限本机访问。", 403);
        if (origin !== "http://" + req.headers.host) throw new AppError("INVALID_ORIGIN", "Smoke Test 需要同源页面请求。", 403);
        if (!keySession.checkCsrf(req.headers["x-patent-csrf"])) throw new AppError("INVALID_CSRF", "页面验证已失效，请刷新后重试。", 403);
      }
      const body = await readBody(req);
      const options = { fetchImpl, signal: controller.signal };
      if (pathname.startsWith("/api/thermal/")) {
        try { return send(res, 200, await thermal.handle(pathname.slice("/api/thermal/".length), body, controller.signal)); }
        catch (e) { throw new AppError("THERMAL_ERROR", e instanceof Error ? e.message : "专题操作失败", 400); }
      }
      if (pathname.startsWith("/api/pilot/")) {
        try { return send(res, 200, await pilot.handle(pathname.slice("/api/pilot/".length), body, controller.signal)); }
        catch (e) { throw e instanceof AppError ? e : new AppError("PILOT_ERROR", e instanceof Error ? e.message : "Pilot 操作失败", 400); }
      }
      if (pathname === "/api/diagnostics") return send(res, 200, await diagnoseXai(options));
      if (pathname === "/api/browser-prepare") return send(res, 200, prepareBrowserExperiment(body.input, body.config));
      if (pathname === "/api/browser-result") return send(res, 200, completeBrowserExperiment(body.input, body.config, body.rawResponse, body.timing));
      if (pathname === "/api/search") return send(res, 200, await searchPatents(body, { ...options, fetchImpl: retrievalFetchImpl }));
      if (pathname === "/api/patent") return send(res, 200, await getPatent(body, { ...options, fetchImpl: retrievalFetchImpl }));
      if (pathname === "/api/models") return send(res, 200, await listModels(body, options));
      if (pathname === "/api/prompt") return send(res, 200, { prompt: buildPrompt(prepareInput(body)) });
      if (pathname === "/api/test") return send(res, 200, await runExperiment(body.input, body.config, options));
      throw new AppError("NOT_FOUND", "接口不存在。", 404);
    } catch (error) {
      if (res.destroyed) return;
      const safe = error instanceof AppError ? error : new AppError("INTERNAL_ERROR", "操作失败，请检查输入或重新启动工作台。", 500);
      send(res, safe.status, { error: { code: safe.code, message: safe.message } });
    }
  });
}

export async function createRuntimeApp() {
  const transport = createRetrievalTransport(await loadRetrievalNetwork());
  const app = createApp({ retrievalFetchImpl: transport.fetchImpl, retrievalNetwork: transport.metadata });
  app.once("close", () => { transport.close().catch(() => {}); });
  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PATENT_PORT ?? 4317);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid PATENT_PORT");
  const app = await createRuntimeApp();
  app.on("error", (e) => { console.error(e.code === "EADDRINUSE" ? "端口已被占用。请设置 PATENT_PORT 后重启。" : "工作台启动失败：" + e.code); process.exitCode = 1; });
  app.listen(port, "127.0.0.1", () => console.log("Patent Intelligence Workbench: http://127.0.0.1:" + port));
}
