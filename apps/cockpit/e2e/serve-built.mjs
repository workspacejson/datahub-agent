/**
 * The built artifact, served under this repo's own `vercel.json`.
 *
 * `vite preview` used to serve this origin, and it answers *every* path with
 * `index.html` at 200. That was close enough while `vercel.json` did the same
 * thing, and it stopped being close enough the moment the rewrite was narrowed
 * so unmatched paths could reach `404.html` with a real status: under preview
 * every test would have passed on a build where the status was still 200.
 *
 * So the rules come from `vercel.json` itself rather than from a copy of them
 * here. What this implements is the subset that file uses -- `trailingSlash`,
 * literal `rewrites`, the filesystem, and the `404.html` fallback -- and it
 * refuses to start on any rewrite syntax it does not model, so a config that
 * grows a wildcard fails loudly instead of being quietly under-served.
 *
 * What it does not do is claim to be Vercel. Header rules are not applied; the
 * platform owns those, and asserting them here would be asserting this file.
 * `deployment-routing.test.ts` checks the config's own shape.
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { extname, join, normalize, resolve, sep } from "node:path";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const config = JSON.parse(await readFile(join(REPO_ROOT, "vercel.json"), "utf8"));
const OUTPUT = resolve(REPO_ROOT, config.outputDirectory ?? "public");

const rewrites = config.rewrites ?? [];
for (const rule of rewrites) {
  if (/[(*:[]/.test(rule.source)) {
    throw new Error(
      `serve-built.mjs models literal rewrite sources only, and vercel.json now carries ` +
      `\`${rule.source}\`. Teach this server the pattern syntax before relying on the e2e ` +
      "suite to describe the deployment, because an unmodelled source is served as a 404 here " +
      "and as a rewrite in production.",
    );
  }
}
const rewriteFor = (pathname) => rewrites.find((rule) => rule.source === pathname)?.destination ?? null;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

/** Reads a file from the output directory, refusing anything outside it. */
async function readOutput(relative) {
  const target = resolve(OUTPUT, `.${normalize(relative)}`);
  if (target !== OUTPUT && !target.startsWith(OUTPUT + sep)) return null;
  try {
    if (!(await stat(target)).isFile()) return null;
  } catch {
    return null;
  }
  return { body: await readFile(target), type: TYPES[extname(target)] ?? "application/octet-stream" };
}

const port = Number(process.argv[2] ?? 4185);

createServer(async (request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${port}`);
  const pathname = decodeURIComponent(url.pathname);

  // `trailingSlash: false` redirects `/receipts/` to `/receipts`. A route is not
  // a different route for a slash, and a 404 there would be one this repo made
  // up rather than one the reader earned.
  if (config.trailingSlash === false && pathname.length > 1 && pathname.endsWith("/")) {
    response.writeHead(308, { Location: pathname.replace(/\/+$/, "") + url.search });
    return response.end();
  }

  const file = pathname === "/"
    ? await readOutput("/index.html")
    : (await readOutput(pathname)) ?? (rewriteFor(pathname) ? await readOutput(rewriteFor(pathname)) : null);

  if (file) {
    response.writeHead(200, { "Content-Type": file.type });
    return response.end(file.body);
  }

  // Nothing matched. This is the whole reason the server exists: the status is
  // 404, and the body is the document the build prerendered.
  const notFound = await readOutput("/404.html");
  response.writeHead(404, { "Content-Type": notFound ? TYPES[".html"] : TYPES[".txt"] });
  response.end(notFound ? notFound.body : `No 404.html in ${OUTPUT}`);
}).listen(port, "127.0.0.1", () => {
  console.log(`serving ${OUTPUT} under vercel.json rules on http://127.0.0.1:${port}`);
});
