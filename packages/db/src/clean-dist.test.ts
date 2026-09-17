import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { cleanPackageDist } from "../../../scripts/clean-dist.mjs";

describe("cleanPackageDist", () => {
  it("removes a stale file under a package dist directory and leaves siblings", async () => {
    const root = await mkdtemp(join(tmpdir(), "notional-clean-dist-"));
    const dist = join(root, "dist");
    await mkdir(dist);
    const stale = join(dist, "stale-should-not-survive.js");
    const keep = join(root, "package.json");
    await writeFile(stale, "stale\n");
    await writeFile(keep, "{}\n");

    await cleanPackageDist(root);

    expect(existsSync(stale)).toBe(false);
    expect(existsSync(dist)).toBe(false);
    expect(existsSync(keep)).toBe(true);
  });
});
