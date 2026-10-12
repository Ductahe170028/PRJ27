import { Router } from "express";

import { createSearchController } from "../controllers/search.controller.js";
import type { SearchByPhoneUseCase } from "../services/search-by-phone.service.js";

export function createSearchRouter(searchUseCase: SearchByPhoneUseCase): Router {
  const router = Router();

  router.get("/", createSearchController(searchUseCase));

  return router;
}
