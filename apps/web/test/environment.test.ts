import { describe, expect, it } from "vitest";

describe("frontend test environment", () => {
  it("provides a jsdom document", () => {
    const element = document.createElement("div");
    element.textContent = "MindX 360";

    document.body.append(element);

    expect(document.body.textContent).toContain("MindX 360");
    expect(window.document).toBe(document);
  });
});
