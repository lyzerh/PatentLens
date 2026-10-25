import http from "node:http";
import { access } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRuntimeApp, APP_VERSION } from "../src/server.js";

export function probeWorkbench(port) {
  return new Promise((resolve) => {
    const request = http.get({ hostname: "127.0.0.1", port, path: "/api/health", timeout: 1000 }, (response) => {
      let text = "";
      response.on("data", (chunk) => { text += chunk; if (text.length > 8192) response.destroy(); });
      response.on("end", () => {
        try {
          const data = JSON.parse(text);
          resolve(response.statusCode === 200 && data.app === "patent-intelligence-workbench" && data.version === APP_VERSION && data.browserDirect === true);
        } catch { resolve(false); }
      });
      response.on("error", () => resolve(false));
    });
    request.on("timeout", () => request.destroy());
    request.on("error", () => resolve(false));
  });
}

export async function startLocal({ startPort = 4317, probe = probeWorkbench, appFactory = createRuntimeApp } = {}) {
  if (!Number.isInteger(startPort) || startPort < 1024 || startPort > 65525) throw new Error("Invalid PATENT_PORT");
  for (let port = startPort; port < startPort + 10; port++) {
    if (await probe(port)) return { port, reused: true, server: null };
    const server = await appFactory();
    try {
      await new Promise((resolve, reject) => {
        const failed = (error) => reject(error);
        server.once("error", failed);
        server.listen(port, "127.0.0.1", () => { server.off("error", failed); resolve(); });
      });
      return { port, reused: false, server };
    } catch (error) { if (error.code !== "EADDRINUSE") throw error; }
  }
  throw new Error("No free local port. Existing services were not stopped.");
}

async function openEdge(url) {
  const candidates = [process.env["PROGRAMFILES(X86)"], process.env.PROGRAMFILES, process.env.LOCALAPPDATA]
    .filter(Boolean).map((root) => root + "\\Microsoft\\Edge\\Application\\msedge.exe");
  for (const executable of candidates) {
    try { await access(executable); } catch { continue; }
    const child = spawn(executable, [url], { shell: false, detached: true, stdio: "ignore", windowsHide: true });
    child.on("error", () => console.error("Please open the displayed local URL in Edge manually."));
    child.unref();
    return;
  }
  console.log("Edge was not found in its standard installation folders. Open the local URL manually.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = await startLocal({ startPort: Number(process.env.PATENT_PORT ?? 4317) });
    const page = process.argv.includes("--pilot-thermal") ? "/pilot-thermal" : "/";
    const url = "http://127.0.0.1:" + result.port + page;
    console.log("Patent Intelligence v" + APP_VERSION + ": " + url);
    console.log(result.reused ? "Reusing the current workbench. Keep its original server window open." : "Keep this window open. Ctrl+C stops this server only.");
    if (!process.argv.includes("--no-browser")) await openEdge(url);
  } catch (error) { console.error("Local startup failed: " + error.message); process.exitCode = 1; }
}
