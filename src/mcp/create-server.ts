import { McpServer } from '@modelcontextprotocol/server';
import { drizzle } from 'drizzle-orm/node-postgres';
import { withDatabaseClient } from '../db/client.js';
import type { Env } from '../env.js';
import { createInvestigateOrder } from '../modules/order-recovery/application/investigate-order.js';
import { createOrderRecoveryRepository } from '../modules/order-recovery/infrastructure/order-recovery-repository.js';
import { registerInvestigateOrderTool } from '../modules/order-recovery/mcp/investigate-order.tool.js';

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
  };

  const investigateOrder = createInvestigateOrder(repository);
  registerInvestigateOrderTool(server, investigateOrder);

  return server;
}
