import { inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';
import {
  auditEvents,
  fulfillments,
  idempotencyRecords,
  inventory,
  inventoryReservations,
  orderItems,
  orders,
  processorPayments,
  recoveryPlans,
  webhookEvents,
} from '../src/db/schema.js';
import {
  demoOrderNumbers,
  demoScenarios,
  demoSkus,
  demoTimestamp,
} from './seed-data.js';

const databaseUrl =
  process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE;

if (!databaseUrl) {
  throw new Error(
    'CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE is required',
  );
}

const client = new Client({ connectionString: databaseUrl });
const database = drizzle(client);
const timestamp = new Date(demoTimestamp);

const orderIds = database
  .select({ id: orders.id })
  .from(orders)
  .where(inArray(orders.orderNumber, demoOrderNumbers));

const planIds = database
  .select({ id: recoveryPlans.id })
  .from(recoveryPlans)
  .where(inArray(recoveryPlans.orderId, orderIds));

const paymentIds = database
  .select({ id: processorPayments.id })
  .from(processorPayments)
  .where(inArray(processorPayments.orderId, orderIds));

const orderItemIds = database
  .select({ id: orderItems.id })
  .from(orderItems)
  .where(inArray(orderItems.orderId, orderIds));

const withTimestamps = <Row extends object>(row: Row) => ({
  ...row,
  createdAt: timestamp,
  updatedAt: timestamp,
});

async function seed(): Promise<void> {
  await client.connect();

  try {
    await database.transaction(async (transaction) => {
      await transaction
        .delete(auditEvents)
        .where(inArray(auditEvents.orderId, orderIds));
      await transaction
        .delete(idempotencyRecords)
        .where(inArray(idempotencyRecords.planId, planIds));
      await transaction
        .delete(recoveryPlans)
        .where(inArray(recoveryPlans.orderId, orderIds));
      await transaction
        .delete(webhookEvents)
        .where(inArray(webhookEvents.paymentId, paymentIds));
      await transaction
        .delete(inventoryReservations)
        .where(inArray(inventoryReservations.orderItemId, orderItemIds));
      await transaction
        .delete(fulfillments)
        .where(inArray(fulfillments.orderId, orderIds));
      await transaction
        .delete(processorPayments)
        .where(inArray(processorPayments.orderId, orderIds));
      await transaction
        .delete(orderItems)
        .where(inArray(orderItems.orderId, orderIds));
      await transaction.delete(orders).where(inArray(orders.id, orderIds));
      await transaction
        .delete(inventory)
        .where(inArray(inventory.sku, demoSkus));

      const scenarios = Object.values(demoScenarios);

      await transaction
        .insert(inventory)
        .values(scenarios.map((scenario) => scenario.inventory));
      await transaction
        .insert(orders)
        .values(scenarios.map((scenario) => withTimestamps(scenario.order)));
      await transaction.insert(orderItems).values(
        scenarios.map((scenario) => ({
          ...scenario.orderItem,
          createdAt: timestamp,
        })),
      );
      await transaction.insert(processorPayments).values(
        scenarios.map((scenario) => ({
          ...scenario.payment,
          capturedAt: timestamp,
          createdAt: timestamp,
        })),
      );
      await transaction.insert(webhookEvents).values(
        scenarios.map((scenario) => ({
          ...scenario.webhook,
          receivedAt: timestamp,
        })),
      );
      await transaction
        .insert(fulfillments)
        .values(
          scenarios.map((scenario) => withTimestamps(scenario.fulfillment)),
        );
      await transaction.insert(inventoryReservations).values({
        ...demoScenarios.alreadyRecovered.reservation,
        createdAt: timestamp,
      });

      const [{ count }] = await transaction
        .select({ count: sql<number>`count(*)::integer` })
        .from(orders)
        .where(inArray(orders.orderNumber, demoOrderNumbers));

      if (count !== scenarios.length) {
        throw new Error('Seed verification failed: expected three demo orders');
      }
    });
  } finally {
    await client.end();
  }
}

await seed();

process.stdout.write(`Seed completed.

Created:
- ORD-DEMO-1042: recoverable
- ORD-DEMO-2042: insufficient inventory
- ORD-DEMO-3042: already recovered
`);
