import { McpServer } from '@modelcontextprotocol/server';
import { drizzle } from 'drizzle-orm/node-postgres';
import { withDatabaseClient } from '../db/client.js';
import { checkDatabaseConnectivity } from '../db/connectivity.js';
import type { Env } from '../env.js';
import { createGetDemoGuide } from '../modules/demo-guide/application/get-demo-guide.js';
import { registerGetDemoGuideTool } from '../modules/demo-guide/mcp/get-demo-guide.tool.js';
import {
  type ApplyRecoveryTransactionInput,
  createApplyRecovery,
} from '../modules/order-recovery/application/apply-recovery.js';
import { createInvestigateOrder } from '../modules/order-recovery/application/investigate-order.js';
import { createPrepareRecoveryPlan } from '../modules/order-recovery/application/prepare-recovery-plan.js';
import type { CreateRecoveryPlanInput } from '../modules/order-recovery/domain/recovery-plan.js';
import { createOrderRecoveryRepository } from '../modules/order-recovery/infrastructure/order-recovery-repository.js';
import { registerApplyRecoveryTool } from '../modules/order-recovery/mcp/apply-recovery.tool.js';
import { registerInvestigateOrderTool } from '../modules/order-recovery/mcp/investigate-order.tool.js';
import { registerPrepareRecoveryPlanTool } from '../modules/order-recovery/mcp/prepare-recovery-plan.tool.js';

export function createMcpServer(env: Env): McpServer {
  const server = new McpServer({
    name: 'commerce-ops-recovery',
    version: '0.1.0',
  });

  const repository = {
    findSnapshotByOrderNumber: (orderNumber: string) =>
      withDatabaseClient(env, (client) => {
        const database = drizzle(client);
        return createOrderRecoveryRepository(
          database,
        ).findSnapshotByOrderNumber(orderNumber);
      }),
    findActivePendingPlanByOrderId: (orderId: string, now: Date) =>
      withDatabaseClient(env, (client) => {
        const database = drizzle(client);
        return createOrderRecoveryRepository(
          database,
        ).findActivePendingPlanByOrderId(orderId, now);
      }),
    markExpiredPendingPlansByOrderId: (orderId: string, now: Date) =>
      withDatabaseClient(env, async (client) => {
        const database = drizzle(client);
        await createOrderRecoveryRepository(
          database,
        ).markExpiredPendingPlansByOrderId(orderId, now);
      }),
    invalidatePendingPlan: (planId: string, reason: string) =>
      withDatabaseClient(env, async (client) => {
        const database = drizzle(client);
        await createOrderRecoveryRepository(database).invalidatePendingPlan(
          planId,
          reason,
        );
      }),
    createRecoveryPlan: (input: CreateRecoveryPlanInput) =>
      withDatabaseClient(env, (client) => {
        const database = drizzle(client);
        return createOrderRecoveryRepository(database).createRecoveryPlan(
          input,
        );
      }),
    applyRecoveryTransaction: (input: ApplyRecoveryTransactionInput) =>
      withDatabaseClient(env, (client) => {
        const database = drizzle(client);
        return createOrderRecoveryRepository(database).applyRecoveryTransaction(
          input,
        );
      }),
  };

  const investigateOrder = createInvestigateOrder(repository);
  const prepareRecoveryPlan = createPrepareRecoveryPlan(repository);
  const applyRecovery = createApplyRecovery(repository);
  const getDemoGuide = createGetDemoGuide({
    repositoryUrl: env?.PROJECT_REPOSITORY_URL,
    checkDatabaseConnectivity: async () => {
      await checkDatabaseConnectivity(env);
    },
  });

  registerGetDemoGuideTool(server, { getDemoGuide });
  registerInvestigateOrderTool(server, investigateOrder);
  registerPrepareRecoveryPlanTool(server, prepareRecoveryPlan);
  registerApplyRecoveryTool(server, { applyRecovery });

  return server;
}
