import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { mockSearchPhones } from "../src/modules/mindx360/fixtures/mock-search-scenarios.js";

describe("GET /api/v1/search", () => {
  const app = createApp();

  it.each([
    ["missing", "/api/v1/search"],
    ["blank", "/api/v1/search?phone=%20%20"],
    ["repeated", "/api/v1/search?phone=0000000000&phone=0000000004"],
  ])("rejects a %s phone query", async (_caseName, path) => {
    const response = await request(app).get(path);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      code: "INVALID_REQUEST",
      message: "Query parameter 'phone' must be one non-empty string",
      retryable: false,
    });
  });

  it("returns a sanitized internal error when the search use case rejects", async () => {
    const failingApp = createApp({
      searchByPhoneService: {
        searchByPhone: async () => {
          throw new Error("sensitive internal detail");
        },
      },
    });

    const response = await request(failingApp)
      .get("/api/v1/search")
      .query({ phone: mockSearchPhones.oneParentOneStudent });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      code: "UNKNOWN",
      message: "Search request failed unexpectedly",
      retryable: false,
    });
    expect(JSON.stringify(response.body)).not.toContain(
      "sensitive internal detail",
    );
  });

  it("returns the one Lead and one Student fixture", async () => {
    const response = await request(app)
      .get("/api/v1/search")
      .query({ phone: mockSearchPhones.oneParentOneStudent });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("success");
    expect(response.body.sources.crm.data).toHaveLength(1);
    expect(response.body.sources.lms.data).toHaveLength(1);
  });

  it("preserves every Lead and Student in the multiple-results fixture", async () => {
    const response = await request(app)
      .get("/api/v1/search")
      .query({ phone: mockSearchPhones.manyLeadsManyStudents });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("success");
    expect(
      response.body.sources.crm.data.map(
        (lead: { crmLeadId: string }) => lead.crmLeadId,
      ),
    ).toEqual(["crm:lead:mock-041", "crm:lead:mock-042"]);
    expect(
      response.body.sources.lms.data.map(
        (student: { lmsStudentId: string }) => student.lmsStudentId,
      ),
    ).toEqual(["lms:student:mock-041", "lms:student:mock-042"]);
  });

  it("returns empty without reporting an API error", async () => {
    const response = await request(app)
      .get("/api/v1/search")
      .query({ phone: mockSearchPhones.empty });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      status: "empty",
      sources: {
        crm: { status: "empty" },
        lms: { status: "empty" },
      },
    });
  });

  it("keeps LMS data when the CRM mock source fails", async () => {
    const response = await request(app)
      .get("/api/v1/search")
      .query({ phone: mockSearchPhones.crmError });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("partial");
    expect(response.body.sources.crm).toMatchObject({
      status: "unavailable",
      error: { code: "UNAVAILABLE", source: "crm" },
    });
    expect(response.body.sources.lms.status).toBe("success");
    expect(response.body.sources.lms.data).toHaveLength(1);
  });

  it("keeps CRM data when the LMS mock source fails", async () => {
    const response = await request(app)
      .get("/api/v1/search")
      .query({ phone: mockSearchPhones.lmsError });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("partial");
    expect(response.body.sources.crm.status).toBe("success");
    expect(response.body.sources.crm.data).toHaveLength(1);
    expect(response.body.sources.lms).toMatchObject({
      status: "unavailable",
      error: { code: "UNAVAILABLE", source: "lms" },
    });
  });

  it("returns an aggregate error when both mock sources fail", async () => {
    const response = await request(app)
      .get("/api/v1/search")
      .query({ phone: mockSearchPhones.bothError });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("error");
    expect(response.body.sources.crm.status).toBe("unavailable");
    expect(response.body.sources.lms.status).toBe("unavailable");
  });
});
