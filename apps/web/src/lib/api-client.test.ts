import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ApiRequestError } from "./api-client.ts";
import type { ApiError } from "../types/api.ts";

// Runs with `node --test` (node strips types). Covers the error wrapper only — no network here.
describe("ApiRequestError", () => {
  it("uses the server message when an ApiError body is present", () => {
    const body: ApiError = {
      timestamp: new Date().toISOString(),
      status: 403,
      code: "FORBIDDEN",
      message: "Not a deal participant",
      path: "/api/v1/deals/1",
    };
    const error = new ApiRequestError(403, body);
    assert.equal(error.message, "Not a deal participant");
    assert.equal(error.status, 403);
  });

  it("falls back to a generic message without a body", () => {
    assert.equal(new ApiRequestError(500, null).message, "Request failed with status 500");
  });
});
