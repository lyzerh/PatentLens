// Preloaded by CI for the public tests. The tests may contact their own
// loopback HTTP servers, but no external service is needed.
import { Socket } from "node:net";

const originalFetch = globalThis.fetch;
const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

// Catch lower-level HTTP clients too, including clients that import undici
// directly instead of using global fetch.
const originalConnect = Socket.prototype.connect;
Socket.prototype.connect = function guardedConnect(...args) {
  const options = args[0];
  const host = typeof options === "object" && options !== null
    ? options.host ?? options.hostname ?? "localhost"
    : typeof args[1] === "string" ? args[1] : "localhost";
  if (!loopbackHosts.has(host)) {
    process.exitCode = 1;
    console.error(`CI_NETWORK_BLOCKED: external socket target ${host}`);
    throw new Error("CI_NETWORK_BLOCKED: external socket is prohibited in public tests");
  }
  return originalConnect.apply(this, args);
};

globalThis.fetch = function guardedFetch(input, init) {
  let url;
  try {
    url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  } catch {
    process.exitCode = 1;
    throw new Error("CI_NETWORK_BLOCKED: invalid fetch target");
  }
  if (!loopbackHosts.has(url.hostname) || !["http:", "https:"].includes(url.protocol)) {
    process.exitCode = 1;
    console.error(`CI_NETWORK_BLOCKED: external fetch target ${url.hostname}`);
    throw new Error("CI_NETWORK_BLOCKED: external fetch is prohibited in public tests");
  }
  return originalFetch.call(this, input, init);
};
