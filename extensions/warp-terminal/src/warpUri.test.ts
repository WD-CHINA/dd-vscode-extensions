import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildWarpUri } from "./warpUri.ts";

describe("buildWarpUri", () => {
  it("opens a tab at an absolute path", () => {
    assert.equal(
      buildWarpUri("/Applications/work/dd-vscode-extensions", "tab"),
      "warp://action/new_tab?path=%2FApplications%2Fwork%2Fdd-vscode-extensions",
    );
  });

  it("encodes spaces and opens a window", () => {
    assert.equal(
      buildWarpUri("/tmp/我的 项目", "window"),
      `warp://action/new_window?path=${encodeURIComponent("/tmp/我的 项目")}`,
    );
  });

  it("rejects a relative path", () => {
    assert.throws(() => buildWarpUri("relative/path", "tab"), /绝对路径/);
  });
});
