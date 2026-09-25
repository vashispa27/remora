#!/usr/bin/env node
/**
 * esbuild bundler for the Remora Chrome extension.
 *
 *   node build.mjs            one-shot build into dist/
 *   node build.mjs --watch    rebuild on change (JS entry points only)
 *
 * Bundles the three extension entry points as IIFEs (Chrome 120 target) with
 * inline source maps and copies the static manifest/popup assets into dist/.
 */
import { build, context } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, "dist");
const watch = process.argv.includes("--watch");

/** @type {import("esbuild").BuildOptions} */
const options = {
  entryPoints: {
    "background/service-worker": join(root, "src/background/service-worker.ts"),
    "content/content-script": join(root, "src/content/content-script.ts"),
    "popup/popup": join(root, "src/popup/popup.ts"),
  },
  outdir: dist,
  bundle: true,
  format: "iife",
  target: "chrome120",
  platform: "browser",
  sourcemap: "inline",
  logLevel: "info",
  legalComments: "none",
  // Import local files with a .js extension in source; resolve them to the
  // corresponding .ts file during bundling.
  resolveExtensions: [".ts", ".tsx", ".mjs", ".js", ".json"],
};

async function copyStatic() {
  await mkdir(join(dist, "popup"), { recursive: true });
  await cp(join(root, "manifest.json"), join(dist, "manifest.json"));
  await cp(join(root, "src/popup/popup.html"), join(dist, "popup/popup.html"));
  await cp(join(root, "src/popup/popup.css"), join(dist, "popup/popup.css"));
}

async function main() {
  await rm(dist, { recursive: true, force: true });

  if (watch) {
    const ctx = await context(options);
    await copyStatic();
    await ctx.watch();
    console.log("[remora] extension build watching for changes");
    return;
  }

  await build(options);
  await copyStatic();
  console.log(`[remora] extension built -> ${dist}`);
}

main().catch((error) => {
  console.error("[remora] extension build failed");
  console.error(error);
  process.exitCode = 1;
});
