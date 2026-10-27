import { spawnSync } from "node:child_process";

// Explicit allowlist: no local frozen dataset or historical xAI response is read.
const files = [
  "test/browser-transport.test.js",
  "test/epo.test.js",
  "test/i18n.test.js",
  "test/pilot-v3.test.js",
  "test/pilot.test.js",
  "test/pipeline.test.js",
  "test/retrieval-network.test.js",
  "test/thermal-public-safety.test.js",
  "test/thermal-annotation-public.test.js",
  "test/patent-features-public.test.js",
  "test/patent-comparison-public.test.js",
  "test/thermal-smoke-ui.test.js",
  "test/ui-lab.test.js",
  "test/workbench.test.js"
];
const result = spawnSync(process.execPath, ["--test", ...files], {
  stdio: "inherit",
  env: {
    ...process.env,
    XAI_API_KEY: "",
    PATENT_PILOT_DATA: "",
    PATENT_THERMAL_DATA: "",
    ...(process.env.PATENT_CI_NETWORK_GUARD === "1"
      ? { NODE_OPTIONS: "--import=./scripts/ci-network-guard.js" }
      : {})
  }
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
