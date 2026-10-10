import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveFeishuApp } from "./feishuApp.ts";

describe("resolveFeishuApp", () => {
  it("prefers the first existing candidate", () => {
    assert.equal(
      resolveFeishuApp(
        ["/Applications/Lark.app", "/Applications/Feishu.app"],
        (path) => path === "/Applications/Lark.app",
      ),
      "/Applications/Lark.app",
    );
  });

  it("falls back to Feishu.app", () => {
    assert.equal(
      resolveFeishuApp(
        ["/Applications/Lark.app", "/Applications/Feishu.app"],
        (path) => path === "/Applications/Feishu.app",
      ),
      "/Applications/Feishu.app",
    );
  });

  it("returns undefined when nothing is installed", () => {
    assert.equal(resolveFeishuApp(["/missing.app"], () => false), undefined);
  });
});
