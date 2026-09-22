const esbuild = require("esbuild");
const path = require("node:path");
const { spawn } = require("node:child_process");

const watch = process.argv.includes("--watch");
const production = process.argv.includes("--production");

const tailwindBin = path.join(__dirname, "node_modules", ".bin", "tailwindcss");

function runTailwind(extraArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      tailwindBin,
      ["-i", "webview/src/styles.css", "-o", "dist/webview/main.css", ...extraArgs],
      { stdio: "inherit" }
    );
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`tailwindcss exited with code ${code}`));
    });
  });
}

/** @type {import('esbuild').BuildOptions} */
const extensionConfig = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "cjs",
  outfile: "dist/extension.js",
  // @anthropic-ai/claude-agent-sdk is ESM-only and calls createRequire(import.meta.url)
  // internally; esbuild can't preserve import.meta.url when bundling ESM into a single
  // CJS file (it becomes undefined), which crashes that call. Keep it external and load
  // it via dynamic import() at runtime instead, so Node resolves the real .mjs file.
  external: ["vscode", "@anthropic-ai/claude-agent-sdk"],
  sourcemap: !production,
  minify: production,
};

/** @type {import('esbuild').BuildOptions} */
const webviewConfig = {
  entryPoints: ["webview/src/main.tsx"],
  bundle: true,
  platform: "browser",
  format: "iife",
  outfile: "dist/webview/main.js",
  sourcemap: !production,
  minify: production,
};

async function run() {
  if (watch) {
    const [extCtx, webCtx] = await Promise.all([
      esbuild.context(extensionConfig),
      esbuild.context(webviewConfig),
    ]);
    await Promise.all([extCtx.watch(), webCtx.watch()]);
    // Tailwind's own --watch runs indefinitely; don't await it alongside the others.
    runTailwind(["--watch"]).catch((err) => console.error("tailwind watch error:", err));
    console.log("watching for changes...");
  } else {
    await Promise.all([
      esbuild.build(extensionConfig),
      esbuild.build(webviewConfig),
      runTailwind(production ? ["--minify"] : []),
    ]);
    console.log("build complete");
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
