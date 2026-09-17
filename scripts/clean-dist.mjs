import { rm } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** @param {string} packageRoot */
export async function cleanPackageDist(packageRoot) {
  const root = resolve(packageRoot);
  const dist = resolve(root, "dist");
  const rel = relative(root, dist);

  if (basename(dist) !== "dist" || rel !== "dist") {
    throw new Error(`refusing to clean ${dist}; only this package's dist directory is allowed`);
  }

  await rm(dist, { recursive: true, force: true });
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(resolve(entry)).href) {
  await cleanPackageDist(process.cwd());
}
