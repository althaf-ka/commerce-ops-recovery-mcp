import { inArray, sql } from 'drizzle-orm';
import type { Database } from '../../src/db/client.js';
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
} from '../../src/db/schema.js';
import {
  DEMO_ORDER_NUMBERS,
  DEMO_SCENARIOS,
} from '../../src/demo/demo-scenarios.js';

export type DemoDatabaseExecutor = Parameters<
  Parameters<Database['transaction']>[0]
>[0];

export class DemoSeedConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DemoSeedConflictError';
  }
}

const demoTimestamp = new Date('2026-08-05T10:42:00.000Z');

const scenarioSpecifications = [
  { metadata: DEMO_SCENARIOS[0], suffix: '1042', kind: 'recovered' },
  { metadata: DEMO_SCENARIOS[1], suffix: '1043', kind: 'eligible' },
  { metadata: DEMO_SCENARIOS[2], suffix: '1044', kind: 'eligible' },
  { metadata: DEMO_SCENARIOS[3], suffix: '1045', kind: 'insufficient' },
] as const;

function buildScenario(specification: (typeof scenarioSpecifications)[number]) {
  const recovered = specification.kind === 'recovered';
  const insufficient = specification.kind === 'insufficient';
  const quantity = recovered ? 1 : insufficient ? 3 : 2;
  const unitPriceMinor = recovered ? 15_000 : insufficient ? 30_000 : 25_000;
  const orderId = `00000000-0000-4000-8000-00000000${specification.suffix}`;
  const itemId = `00000000-0000-4000-8000-00000001${specification.suffix}`;
  const paymentId = `00000000-0000-4000-8000-00000002${specification.suffix}`;
  const sku = `DEMO-SKU-${specification.suffix}`;

  return {
    order: {
      id: orderId,
      orderNumber: specification.metadata.orderNumber,
      localPaymentStatus: recovered ? ('paid' as const) : ('pending' as const),
      orderStatus: recovered
        ? ('ready_for_fulfillment' as const)
        : ('awaiting_payment' as const),
      version: recovered ? 2 : 1,
      createdAt: demoTimestamp,
      updatedAt: demoTimestamp,
    },
    inventory: {
      sku,
      onHand: insufficient ? 1 : 10,
      reserved: recovered ? quantity : 0,
    },
    orderItem: {
      id: itemId,
      orderId,
      sku,
      quantity,
      unitPriceMinor,
      createdAt: demoTimestamp,
    },
    payment: {
      id: paymentId,
      orderId,
      processorPaymentId: `pay_demo_${specification.suffix}`,
      amountMinor: quantity * unitPriceMinor,
      currency: 'INR',
      status: 'captured' as const,
      capturedAt: demoTimestamp,
      createdAt: demoTimestamp,
    },
    webhook: {
      id: `00000000-0000-4000-8000-00000003${specification.suffix}`,
      paymentId,
      eventType: 'payment.captured',
      deliveryStatus: 'failed' as const,
      payload: {
        paymentId: `pay_demo_${specification.suffix}`,
        orderNumber: specification.metadata.orderNumber,
        status: 'captured',
      },
      errorMessage: 'Synthetic database timeout while updating local state',
      receivedAt: demoTimestamp,
      processedAt: null,
    },
    fulfillment: {
      id: `00000000-0000-4000-8000-00000004${specification.suffix}`,
      orderId,
      status: recovered
        ? ('ready_to_fulfill' as const)
        : ('blocked_awaiting_payment' as const),
      blockedReason: recovered ? null : 'local_payment_pending',
      createdAt: demoTimestamp,
      updatedAt: demoTimestamp,
    },
    reservation: recovered
      ? {
          id: `00000000-0000-4000-8000-00000005${specification.suffix}`,
          orderItemId: itemId,
          quantity,
          createdAt: demoTimestamp,
        }
      : null,
  };
}

const seedScenarios = scenarioSpecifications.map(buildScenario);
export const DEMO_SKUS = seedScenarios.map(({ inventory: row }) => row.sku);

export async function seedDemoScenarios(
  database: DemoDatabaseExecutor,
): Promise<boolean> {
  const existingOrders = await database
    .select({ orderNumber: orders.orderNumber })
    .from(orders)
    .where(inArray(orders.orderNumber, DEMO_ORDER_NUMBERS));

  if (existingOrders.length === seedScenarios.length) {
    return false;
  }

  if (existingOrders.length > 0) {
    throw new DemoSeedConflictError(
      'Some demo orders already exist, but the complete four-scenario set is not present.',
    );
  }

  const existingInventory = await database
    .select({ sku: inventory.sku })
    .from(inventory)
    .where(inArray(inventory.sku, DEMO_SKUS));

  if (existingInventory.length > 0) {
    throw new DemoSeedConflictError(
      'Demo inventory already exists without the complete demo-order set.',
    );
  }

  await database
    .insert(inventory)
    .values(seedScenarios.map((row) => row.inventory));
  await database.insert(orders).values(seedScenarios.map((row) => row.order));
  await database
    .insert(orderItems)
    .values(seedScenarios.map((row) => row.orderItem));
  await database
    .insert(processorPayments)
    .values(seedScenarios.map((row) => row.payment));
  await database
    .insert(webhookEvents)
    .values(seedScenarios.map((row) => row.webhook));
  await database
    .insert(fulfillments)
    .values(seedScenarios.map((row) => row.fulfillment));

  const reservations = seedScenarios.flatMap((row) =>
    row.reservation ? [row.reservation] : [],
  );
  await database.insert(inventoryReservations).values(reservations);

  const [{ count }] = await database
    .select({ count: sql<number>`count(*)::integer` })
    .from(orders)
    .where(inArray(orders.orderNumber, DEMO_ORDER_NUMBERS));

  if (count !== seedScenarios.length) {
    throw new Error('Demo seed verification failed.');
  }

  return true;
}

export async function removeDemoScenarios(
  database: DemoDatabaseExecutor,
): Promise<void> {
  const orderIds = database
    .select({ id: orders.id })
    .from(orders)
    .where(inArray(orders.orderNumber, DEMO_ORDER_NUMBERS));
  const planIds = database
    .select({ id: recoveryPlans.id })
    .from(recoveryPlans)
    .where(inArray(recoveryPlans.orderId, orderIds));
  const paymentIds = database
    .select({ id: processorPayments.id })
    .from(processorPayments)
    .where(inArray(processorPayments.orderId, orderIds));
  const itemIds = database
    .select({ id: orderItems.id })
    .from(orderItems)
    .where(inArray(orderItems.orderId, orderIds));

  await database
    .delete(auditEvents)
    .where(inArray(auditEvents.orderId, orderIds));
  await database
    .delete(idempotencyRecords)
    .where(inArray(idempotencyRecords.planId, planIds));
  await database
    .delete(recoveryPlans)
    .where(inArray(recoveryPlans.orderId, orderIds));
  await database
    .delete(webhookEvents)
    .where(inArray(webhookEvents.paymentId, paymentIds));
  await database
    .delete(inventoryReservations)
    .where(inArray(inventoryReservations.orderItemId, itemIds));
  await database
    .delete(fulfillments)
    .where(inArray(fulfillments.orderId, orderIds));
  await database
    .delete(processorPayments)
    .where(inArray(processorPayments.orderId, orderIds));
  await database
    .delete(orderItems)
    .where(inArray(orderItems.orderId, orderIds));
  await database.delete(orders).where(inArray(orders.id, orderIds));
  await database.delete(inventory).where(inArray(inventory.sku, DEMO_SKUS));
}
