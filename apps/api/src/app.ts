import express, { type Express } from "express";

import { MockCrmSearchClient } from "./modules/crm/clients/mock-crm-search-client.js";
import { MockLmsSearchClient } from "./modules/lms/clients/mock-lms-search-client.js";
import {
  createMockCrmSearchScenarios,
  createMockLmsSearchScenarios,
} from "./modules/mindx360/fixtures/mock-search-scenarios.js";
import { createSearchRouter } from "./modules/mindx360/routes/search.routes.js";
import {
  SearchByPhoneService,
  type SearchByPhoneUseCase,
} from "./modules/mindx360/services/search-by-phone.service.js";

export interface AppDependencies {
  readonly searchByPhoneService?: SearchByPhoneUseCase;
}

function createDefaultSearchService(): SearchByPhoneUseCase {
  return new SearchByPhoneService(
    new MockCrmSearchClient(createMockCrmSearchScenarios()),
    new MockLmsSearchClient(createMockLmsSearchScenarios()),
  );
}

export function createApp(dependencies: AppDependencies = {}): Express {
  const app = express();
  const searchService =
    dependencies.searchByPhoneService ?? createDefaultSearchService();

  app.get("/health", (_request, response) => {
    response.status(200).json({ status: "ok" });
  });

  app.use("/api/v1/search", createSearchRouter(searchService));

  return app;
}
