import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { findGitRoot, parseGitRoot, resolveSourceTreeApp, resolveStreeCli } from "./sourcetree.ts";

describe("resolveSourceTreeApp", () => {
  it("returns the first installed candidate", () => {
    assert.equal(
      resolveSourceTreeApp(
        ["/Applications/SourceTree.app", "/Applications/Sourcetree.app"],
        (candidate) => candidate.endsWith("Sourcetree.app"),
      ),
      "/Applications/Sourcetree.app",
    );
  });

  it("returns undefined when SourceTree is missing", () => {
    assert.equal(resolveSourceTreeApp(["/missing/SourceTree.app"], () => false), undefined);
  });
});

describe("resolveStreeCli", () => {
  it("points at the bundled stree executable", () => {
    assert.equal(
      resolveStreeCli("/Applications/SourceTree.app"),
      "/Applications/SourceTree.app/Contents/Resources/stree",
    );
  });
});

describe("parseGitRoot", () => {
  it("trims the working tree path", () => {
    assert.equal(parseGitRoot("/repo/root\n"), "/repo/root");
  });

  it("rejects a relative path", () => {
    assert.equal(parseGitRoot("relative/path\n"), undefined);
  });
});

describe("findGitRoot", () => {
  it("returns the repository root from a nested directory", async () => {
    const dir = await realpath(await mkdtemp(path.join(tmpdir(), "sourcetree-launcher-")));
    const nested = path.join(dir, "src", "nested");
    try {
      await mkdir(nested, { recursive: true });
      await execFileAsync("/usr/bin/git", ["init", "-q", dir]);
      assert.equal(await findGitRoot(nested), dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns undefined outside a repository", async () => {
    const dir = await realpath(await mkdtemp(path.join(tmpdir(), "sourcetree-launcher-")));
    try {
      assert.equal(await findGitRoot(dir), undefined);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns undefined for a relative start path", async () => {
    assert.equal(await findGitRoot("relative/path"), undefined);
  });
});

function execFileAsync(file: string, args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(file, args, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
