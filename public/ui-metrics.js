export const APPEARANCES = Object.freeze({ glass: "液态玻璃", light: "轻量磨砂", solid: "纯净实底" });

export function resolveAppearance(requested, { blur = true, reducedTransparency = false, forcedColors = false } = {}) {
  if (!blur || reducedTransparency || forcedColors) return "solid";
  return Object.hasOwn(APPEARANCES, requested) ? requested : "light";
}

export function summarizeFrames(intervals) {
  const values = intervals.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (!values.length) return { samples: 0, meanMs: null, p95Ms: null, maxMs: null, gapsOver50Ms: 0 };
  const round = (value) => Math.round(value * 100) / 100;
  return { samples: values.length, meanMs: round(values.reduce((sum, value) => sum + value, 0) / values.length),
    p95Ms: round(values[Math.ceil(values.length * .95) - 1]), maxMs: round(values.at(-1)),
    gapsOver50Ms: values.filter((value) => value > 50).length };
}

export function syntheticFixture() {
  return { cards: Array.from({ length: 120 }, (_, index) => ({ id: "SYNTHETIC-" + String(index + 1).padStart(3, "0"),
    title: "合成文献 / Workload-aware voltage and frequency control",
    snippet: "仅用于本地 UI 压力测试，不是专利文献，不调用检索或模型服务。" })),
    description: "[TEST] 合成正文，用于比较滚动与绘制，不作为研究输入。\n".repeat(2000).slice(0, 60000) };
}

export function buildUiReport(environment, runs) {
  // Explicit allowlist: never include DOM contents, patent inputs, API settings or error text.
  return { type: "ui-benchmark", version: "1.0", createdAt: new Date().toISOString(), synthetic: true,
    externalRequests: 0, methodology: "120 synthetic cards + 60000 synthetic characters; 500 ms warmup, 4500 ms rAF sampling per mode; scrolling preview under sticky material control",
    environment: { viewport: { width: environment.viewport?.width, height: environment.viewport?.height }, pixelRatio: environment.pixelRatio, userAgent: environment.userAgent,
      blurSupported: environment.blurSupported, reducedMotion: environment.reducedMotion, reducedTransparency: environment.reducedTransparency,
      forcedColors: environment.forcedColors, motionSetting: environment.motionSetting, longTasksSupported: environment.longTasksSupported },
    runs: runs.map((run) => ({ requestedMode: run.requestedMode, effectiveMode: run.effectiveMode,
      elapsedMs: run.elapsedMs, frames: { samples: run.frames.samples, meanMs: run.frames.meanMs, p95Ms: run.frames.p95Ms, maxMs: run.frames.maxMs, gapsOver50Ms: run.frames.gapsOver50Ms },
      longTasks: run.longTasks ? { count: run.longTasks.count, totalMs: run.longTasks.totalMs } : null, pageErrors: run.pageErrors,
      heapBeforeBytes: run.heapBeforeBytes, heapAfterBytes: run.heapAfterBytes })),
    limits: ["Frame scheduling is not GPU load, power consumption or real INP.", "Heap snapshots are non-standard and do not prove or disprove a memory leak.",
      "Results depend on hardware, viewport, browser and other tabs; repeat before drawing conclusions.", "No patent data, credentials or raw error messages are collected."] };
}
