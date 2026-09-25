#!/usr/bin/env node
/**
 * Tiny static server for the mock AWS fixture pages.
 *
 *   node fixtures/mock-aws/serve.mjs [--port 4173]
 *
 * Serves the directory it lives in on http://127.0.0.1:<port>/.
 * The Chrome extension's host permissions cover http://127.0.0.1/*.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const argIndex = process.argv.indexOf("--port");
const port = argIndex >= 0 ? Number(process.argv[argIndex + 1]) : Number(process.env.PORT || 4173);

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    const rel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const safe = normalize(rel).replace(/^(\.\.[/\\])+/, "");
    if (safe.includes("..")) {
      res.writeHead(400).end("Bad path");
      return;
    }
    const body = await readFile(join(root, safe));
    res.writeHead(200, { "content-type": types[extname(safe)] ?? "application/octet-stream" });
    res.end(body);
    console.log(`[fixture] 200 ${url.pathname}`);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
    console.log(`[fixture] 404 ${req.url}`);
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Mock AWS fixture on http://127.0.0.1:${port}/`);
  console.log("Pages: / (DynamoDB home) -> /create-table.html -> /created.html?name=remora-demo");
});
