import { defineApp } from './sdk/app-contract/server-client.js';
import { createRepository, registerSaveRoutes } from './save-repository.js';
import { createAnalysisService, registerAnalysisRoutes } from './analysis-engine.js';

export const name = 'manman-island';

export default defineApp(async sdk => {
  const repository = createRepository(sdk.storage.global);
  const analysis = await createAnalysisService(sdk, repository);
  await sdk.routes.register(app => {
    registerSaveRoutes(app, repository);
    registerAnalysisRoutes(app, analysis);
  });
  await sdk.logger.info('慢慢岛 1.0.0 已载入：单岛归属；思考/工作仅在用户点击后读取本 Agent 最近7天会话并调用宿主模型。');
});
