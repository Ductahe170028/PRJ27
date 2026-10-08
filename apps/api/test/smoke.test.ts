import { describe, expect, it } from "vitest";

describe("backend test environment", () => {
  it("runs TypeScript tests in Node.js", () => {
    const values: readonly number[] = [1, 2, 3];

    expect(values.reduce((total, value) => total + value, 0)).toBe(6);
    expect(process.release.name).toBe("node");
  });
});

