import { APPEARANCES, resolveAppearance, summarizeFrames, syntheticFixture, buildUiReport } from "./ui-metrics.js";

export function setupUiLab() {
  const $ = (id) => document.getElementById(id);
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const transparency = matchMedia("(prefers-reduced-transparency: reduce)");
  const forced = matchMedia("(forced-colors: active)");
  const blurSupported = CSS.supports("backdrop-filter", "blur(1px)") || CSS.supports("-webkit-backdrop-filter", "blur(1px)");
  const longTasksSupported = typeof PerformanceObserver === "function" && PerformanceObserver.supportedEntryTypes?.includes("longtask");
  const buttons = [...document.querySelectorAll("button[data-appearance]")];
  let requestedMode = "glass", lastReport = null, running = null, pageErrors = 0;
  const constraints = () => ({ blur: blurSupported, reducedTransparency: transparency.matches, forcedColors: forced.matches });
  const applyMode = (mode) => {
    requestedMode = Object.hasOwn(APPEARANCES, mode) ? mode : "light";
    const effective = resolveAppearance(requestedMode, constraints());
    document.body.dataset.appearance = effective;
    for (const button of buttons) button.setAttribute("aria-pressed", String(button.dataset.appearance === effective));
    $("appearance-note").textContent = effective !== requestedMode
      ? "已按浏览器或系统限制切换为实底。"
      : APPEARANCES[effective] + " · " + (effective === "solid" ? "无模糊" : effective === "light" ? "8px 模糊" : "22px 模糊");
  };
  const applyMotion = () => {
    const setting = $("reduce-motion").checked || motion.matches ? "off" : "on";
    document.body.dataset.motion = setting; document.documentElement.dataset.motion = setting;
  };
  $("reduce-motion").checked = motion.matches;
  $("reduce-motion").addEventListener("change", applyMotion);
  motion.addEventListener("change", () => { if (motion.matches) $("reduce-motion").checked = true; applyMotion(); running?.abort(); });
  transparency.addEventListener("change", () => { applyMode(requestedMode); running?.abort(); });
  forced.addEventListener("change", () => { applyMode(requestedMode); running?.abort(); });
  for (const button of buttons) button.addEventListener("click", () => applyMode(button.dataset.appearance));
  applyMode(requestedMode); applyMotion();
  window.addEventListener("error", () => { pageErrors++; });
  window.addEventListener("unhandledrejection", () => { pageErrors++; });
  document.addEventListener("visibilitychange", () => { if (document.hidden) running?.abort(); });
  window.addEventListener("pagehide", () => running?.abort());

  const links = [...document.querySelectorAll(".flow-nav a")];
  const activate = (id) => { for (const link of links) { const active = link.hash === "#" + id; link.classList.toggle("active", active); if (active) link.setAttribute("aria-current", "step"); else link.removeAttribute("aria-current"); } };
  for (const link of links) link.addEventListener("click", () => activate(link.hash.slice(1)));
  if (typeof IntersectionObserver === "function") {
    const observer = new IntersectionObserver((entries) => { for (const entry of entries) if (entry.isIntersecting) activate(entry.target.parentElement.id); }, { rootMargin: "-12% 0px -65% 0px" });
    for (const link of links) { const heading = document.querySelector(link.hash + " > .stage-heading"); if (heading) observer.observe(heading); }
  }
  const status = (text) => { $("benchmark-status").textContent = text; };
  const makeFixture = () => {
    const fixture = syntheticFixture(), fragment = document.createDocumentFragment(), cards = document.createElement("div");
    cards.className = "stress-cards";
    for (const item of fixture.cards) {
      const card = document.createElement("article"); card.className = "stress-card";
      for (const [tag, text] of [["small", item.id], ["h3", item.title], ["p", item.snippet]]) { const el = document.createElement(tag); el.textContent = text; card.append(el); }
      cards.append(card);
    }
    const paragraph = document.createElement("p"); paragraph.className = "stress-document"; paragraph.textContent = fixture.description;
    fragment.append(cards, paragraph); $("benchmark-fixture").replaceChildren(fragment);
  };
  const heap = () => Number.isFinite(performance.memory?.usedJSHeapSize) ? performance.memory.usedJSHeapSize : null;
  function sample(mode, signal) {
    return new Promise((resolve, reject) => {
      const intervals = [], longTasks = [], viewport = $("benchmark-viewport");
      let frame = 0, first = null, previous = null, observer = null, timedOut = null;
      let measureStart = Infinity;
      const beforeErrors = pageErrors, beforeHeap = heap();
      applyMode(mode); viewport.scrollTop = 0;
      const maxScroll = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
      const clean = () => { cancelAnimationFrame(frame); clearTimeout(timedOut); observer?.disconnect(); signal.removeEventListener("abort", abort); };
      const abort = () => { clean(); reject(new DOMException("Sampling cancelled", "AbortError")); };
      if (signal.aborted) { abort(); return; }
      signal.addEventListener("abort", abort, { once: true });
      if (longTasksSupported) {
        try { observer = new PerformanceObserver((list) => { for (const entry of list.getEntries()) if (entry.startTime >= measureStart) longTasks.push(entry.duration); }); observer.observe({ type: "longtask", buffered: false }); } catch { observer = null; }
      }
      timedOut = setTimeout(abort, 12000);
      const tick = (now) => {
        if (document.hidden || signal.aborted) { abort(); return; }
        first ??= now;
        const elapsed = now - first;
        if (elapsed >= 500 && measureStart === Infinity) measureStart = now;
        if (elapsed >= 500 && previous !== null && previous >= measureStart) intervals.push(now - previous);
        previous = now;
        // Same bounded trajectory and data in every mode; only this synthetic pane moves.
        viewport.scrollTop = maxScroll * (.5 - .5 * Math.cos(Math.min(elapsed / 5000, 1) * Math.PI * 2));
        if (elapsed < 5000) { frame = requestAnimationFrame(tick); return; }
        if (observer) for (const entry of observer.takeRecords()) if (entry.startTime >= measureStart) longTasks.push(entry.duration);
        const result = { requestedMode: mode, effectiveMode: document.body.dataset.appearance, elapsedMs: Math.round(elapsed),
          frames: summarizeFrames(intervals), longTasks: observer ? { count: longTasks.length, totalMs: Math.round(longTasks.reduce((sum, x) => sum + x, 0)) } : null,
          pageErrors: pageErrors - beforeErrors, heapBeforeBytes: beforeHeap, heapAfterBytes: heap() };
        clean(); resolve(result);
      };
      frame = requestAnimationFrame(tick);
    });
  }
  const render = (report) => {
    const last = report.runs.at(-1);
    $("perf-frame").textContent = last.frames.meanMs === null ? "无样本" : last.frames.meanMs + " ms";
    $("perf-p95").textContent = last.frames.p95Ms === null ? "无样本" : last.frames.p95Ms + " ms";
    $("perf-long").textContent = last.longTasks?.count ?? "不支持";
    $("perf-errors").textContent = String(last.pageErrors);
    const table = document.createElement("table"), head = table.createTHead().insertRow();
    for (const text of ["模式 / 实际效果", "样本数", "平均间隔", "P95 间隔", ">50ms 间隔", "长任务", "页面错误"]) { const th = document.createElement("th"); th.scope = "col"; th.textContent = text; head.append(th); }
    const tbody = table.createTBody();
    for (const run of report.runs) {
      const row = tbody.insertRow();
      const values = [APPEARANCES[run.requestedMode] + (run.requestedMode !== run.effectiveMode ? " → " + APPEARANCES[run.effectiveMode] : ""), run.frames.samples,
        run.frames.meanMs === null ? "无样本" : run.frames.meanMs + " ms", run.frames.p95Ms === null ? "无样本" : run.frames.p95Ms + " ms", run.frames.gapsOver50Ms, run.longTasks?.count ?? "不支持", run.pageErrors];
      for (const value of values) row.insertCell().textContent = String(value);
    }
    $("benchmark-results").replaceChildren(table); $("benchmark-results").classList.remove("hidden"); $("benchmark-export").disabled = false;
  };
  async function benchmark(compare) {
    if (running || document.hidden) return;
    const controller = new AbortController(); running = controller;
    const originalMode = requestedMode, originalMotion = document.body.dataset.motion;
    const controlButtons = [$("benchmark-start"), $("benchmark-compare"), $("reduce-motion"), ...buttons];
    const onResize = () => controller.abort(); window.addEventListener("resize", onResize, { once: true });
    for (const button of controlButtons) button.disabled = true;
    $("benchmark-cancel").classList.remove("hidden"); document.body.classList.add("benchmark-running");
    try {
      makeFixture(); $("benchmark-preview").classList.remove("hidden");
      const reduced = document.body.dataset.motion === "off";
      $("benchmark-preview").scrollIntoView({ behavior: reduced ? "instant" : "smooth", block: "center" });
      const runs = [], modes = compare ? Object.keys(APPEARANCES) : [originalMode];
      for (const mode of modes) {
        status("正在测试「" + APPEARANCES[mode] + "」…请保持页面前台、窗口大小不变；可随时停止。");
        runs.push(await sample(mode, controller.signal));
      }
      lastReport = buildUiReport({ viewport: { width: innerWidth, height: innerHeight }, pixelRatio: devicePixelRatio, userAgent: navigator.userAgent,
        blurSupported, reducedMotion: motion.matches, reducedTransparency: transparency.matches, forcedColors: forced.matches, motionSetting: originalMotion, longTasksSupported: Boolean(longTasksSupported) }, runs);
      render(lastReport); status("已完成 " + runs.length + " 档测试，恢复原设置。");
    } catch (error) {
      status(error.name === "AbortError" ? "测试中止：手动停止、页面 / 窗口变化或超时。未保存不完整结果。" : "测试失败，已恢复设置。");
    } finally {
      applyMode(originalMode); applyMotion(); document.body.classList.remove("benchmark-running");
      $("benchmark-fixture").replaceChildren(); $("benchmark-preview").classList.add("hidden"); $("benchmark-viewport").scrollTop = 0;
      for (const button of controlButtons) button.disabled = false;
      $("benchmark-cancel").classList.add("hidden"); window.removeEventListener("resize", onResize); running = null;
    }
  }
  $("benchmark-start").addEventListener("click", () => benchmark(false));
  $("benchmark-compare").addEventListener("click", () => benchmark(true));
  $("benchmark-cancel").addEventListener("click", () => running?.abort());
  $("ui-lab").addEventListener("toggle", () => { if (!$("ui-lab").open) running?.abort(); });
  $("benchmark-export").addEventListener("click", () => {
    if (!lastReport) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(lastReport, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "patent-ui-benchmark-" + lastReport.createdAt.replace(/[:.]/g, "-") + ".json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  });
}
