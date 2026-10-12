import type { ApiError } from "@mindx-360/contracts";
import type { RequestHandler } from "express";

import type { SearchByPhoneService } from "../services/search-by-phone.service.js";

const invalidPhoneError: ApiError = {
  code: "INVALID_REQUEST",
  message: "Query parameter 'phone' must be one non-empty string",
  retryable: false,
};

const internalError: ApiError = {
  code: "UNKNOWN",
  message: "Search request failed unexpectedly",
  retryable: false,
};

export function createSearchController(
  searchService: SearchByPhoneService,
): RequestHandler {
  return async (request, response) => {
    const rawPhone = request.query.phone;
    if (typeof rawPhone !== "string" || rawPhone.trim().length === 0) {
      response.status(400).json(invalidPhoneError);
      return;
    }

    try {
      const result = await searchService.searchByPhone(rawPhone.trim());
      response.status(200).json(result);
    } catch {
      response.status(500).json(internalError);
    }
  };
}
