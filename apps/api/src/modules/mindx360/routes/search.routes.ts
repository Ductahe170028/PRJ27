import { Router } from "express";

import { createSearchController } from "../controllers/search.controller.js";
import type { SearchByPhoneService } from "../services/search-by-phone.service.js";

export function createSearchRouter(searchService: SearchByPhoneService): Router {
  const router = Router();

  router.get("/", createSearchController(searchService));

  return router;
}
