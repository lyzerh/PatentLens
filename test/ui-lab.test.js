import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { load } from "cheerio";
import { APPEARANCES, resolveAppearance, summarizeFrames, syntheticFixture, buildUiReport } from "../public/ui-metrics.js";
import { createApp } from "../src/server.js";

const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const appSource = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const labSource = await readFile(new URL("../public/ui-lab.js", import.meta.url), "utf8");
const css = await readFile(new URL("../public/style.css", import.meta.url), "utf8");

test("vertical UI has no sidebar, unique IDs, all existing controls, and permanently visible source region", () => {
  const $ = load(html), ids = $("[id]").map((_, el) => $(el).attr("id")).get();
  assert.equal($("aside, .sidebar").length, 0);
  assert.equal(new Set(ids).size, ids.length);
  for (const [, id] of appSource.matchAll(/\$\("([a-z-]+)"\)/g)) assert.equal($("#" + id).length, 1, "Missing UI contract: " + id);
  assert.equal($("#view-source.tab-view").length, 0);
  assert.equal($("#view-source").attr("role"), "region");
  assert.equal($(".tab[role=tab]").length, 3);
  assert.equal($(".flow-nav a").length, 3);
  assert.equal($("#read-stage #view-source").length, 1);
  assert.equal($("#verify-stage #view-analysis").length, 1);
});

test("frame metrics handle empty input, invalid intervals, percentiles and slow gaps without claiming GPU or FPS", () => {
  assert.deepEqual(summarizeFrames([]), { samples: 0, meanMs: null, p95Ms: null, maxMs: null, gapsOver50Ms: 0 });
  assert.deepEqual(summarizeFrames([10, 20, 30, 60, NaN, Infinity, -1, 0]), { samples: 4, meanMs: 30, p95Ms: 60, maxMs: 60, gapsOver50Ms: 1 });
  assert.equal(summarizeFrames(Array(100).fill(16).concat([80])).p95Ms, 16);
  assert.equal(summarizeFrames([50]).gapsOver50Ms, 0);
});

test("three appearance modes honor browser support, reduced transparency and forced colors", () => {
  assert.deepEqual(Object.keys(APPEARANCES), ["glass", "light", "solid"]);
  for (const mode of Object.keys(APPEARANCES)) {
    assert.equal(resolveAppearance(mode), mode);
    assert.equal(resolveAppearance(mode, { blur: false }), "solid");
    assert.equal(resolveAppearance(mode, { reducedTransparency: true }), "solid");
    assert.equal(resolveAppearance(mode, { forcedColors: true }), "solid");
  }
  assert.equal(resolveAppearance("invalid"), "light");
});

test("synthetic benchmark has fixed deterministic local workload, explicitly not patent records", () => {
  const fixture = syntheticFixture();
  assert.equal(fixture.cards.length, 120); assert.equal(fixture.description.length, 60000);
  assert.ok(fixture.cards.every((card) => card.id.startsWith("SYNTHETIC-") && card.title.includes("合成")));
  assert.deepEqual(fixture, syntheticFixture());
});

test("performance export is deeply allowlisted and does not copy secrets, patent text or raw errors", () => {
  const secret = "fake-key-do-not-export", frames = summarizeFrames([16, 17]);
  const report = buildUiReport({ viewport: { width: 1280, height: 800, secret }, pixelRatio: 1, apiKey: secret, input: secret },
    [{ requestedMode: "glass", effectiveMode: "glass", elapsedMs: 5000, frames: { ...frames, secret }, longTasks: { count: 0, totalMs: 0, secret }, pageErrors: 0, heapBeforeBytes: null, heapAfterBytes: null, rawError: secret }]);
  assert.ok(!JSON.stringify(report).includes(secret));
  assert.equal(report.externalRequests, 0); assert.equal(report.synthetic, true);
  assert.deepEqual(report.runs[0].frames, frames);
});

test("benchmark is opt-in, has cleanup/cancellation, no network or storage and bounded lifetime", () => {
  assert.doesNotMatch(labSource, /\bfetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|setInterval|api-key|text-claims/);
  for (const cleanup of ["cancelAnimationFrame", "clearTimeout", "observer?.disconnect()", "replaceChildren()", 'removeEventListener("resize"', 'signal.removeEventListener("abort"']) assert.ok(labSource.includes(cleanup));
  assert.ok(labSource.includes('document.addEventListener("visibilitychange"'));
  assert.ok(labSource.includes("setTimeout(abort, 12000)"));
});

test("glass CSS is progressive and responsive, respects reduced effects without animated filters", () => {
  assert.match(css, /@supports not/); assert.match(css, /prefers-reduced-transparency/); assert.match(css, /prefers-reduced-motion/); assert.match(css, /forced-colors/);
  assert.match(css, /max-width:480px/); assert.doesNotMatch(css, /@keyframes|filter:url|will-change/);
  assert.doesNotMatch(css, /transition:[^;}]*backdrop-filter/);
});

test("all material modes retain square corners and bold typography", () => {
  const radii = [...css.matchAll(/border-radius\s*:\s*([^;}]+)/g)];
  assert.ok(radii.length > 20);
  assert.ok(radii.every((match) => match[1].trim() === "0"));
  const weights = [...css.matchAll(/font-weight\s*:\s*(\d+)/g)];
  assert.ok(weights.every((match) => Number(match[1]) >= 700));
  assert.match(css, /h1,h2,h3\{font-weight:800\}/);
  for (const [, shorthand] of css.matchAll(/(?:^|[;{])font:([^;}]+)/g)) {
    assert.ok(shorthand === "inherit" || /\b700\b/.test(shorthand), shorthand);
  }
  assert.doesNotMatch(html, /orbital-mark|orbit-one|orbit-two|orbit-three/);
  assert.doesNotMatch(css, /rotate\(/);
});

test("running HTTP surface serves the UI lab modules and preserves CSP without external requests", async (t) => {
  let external = 0;
  const server = createApp({ fetchImpl: async () => { external++; throw new Error("network forbidden"); } });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const base = "http://127.0.0.1:" + server.address().port;
  for (const route of ["/", "/ui-lab.js", "/ui-metrics.js", "/style.css"]) {
    const response = await fetch(base + route); assert.equal(response.status, 200);
    assert.match(response.headers.get("content-security-policy"), /default-src 'self'/);
    assert.ok((await response.text()).length > 10);
  }
  assert.equal(external, 0);
});
