import assert from "node:assert/strict";
import test from "node:test";

test("the package root resolves through its exports map", async () => {
  const contracts = await import("@mindx-360/contracts");

  assert.deepEqual(Object.keys(contracts), []);
});
