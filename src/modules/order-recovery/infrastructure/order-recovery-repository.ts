import { and, asc, eq, gt, lte } from 'drizzle-orm';
import type { Database } from '../../../db/client.js';
import {
  fulfillments,
  inventory,
  inventoryReservations,
  orderItems,
  orders,
  processorPayments,
  recoveryPlans,
  webhookEvents,
} from '../../../db/schema.js';
import type { OrderRecoveryRepository } from '../application/investigate-order.js';
import {
  PendingRecoveryPlanConflictError,
  type PrepareRecoveryPlanRepository,
} from '../application/prepare-recovery-plan.js';
import type { OrderSnapshot } from '../domain/order-snapshot.js';
import type {
  CreateRecoveryPlanInput,
  RecoveryPlan,
  RecoveryPlannedChanges,
} from '../domain/recovery-plan.js';

export function createOrderRecoveryRepository(
  database: Database,
): OrderRecoveryRepository & PrepareRecoveryPlanRepository {
  return {
    findSnapshotByOrderNumber: (orderNumber) =>
      getOrderSnapshot(database, orderNumber),
    findActivePendingPlanByOrderId: (orderId, now) =>
      findActivePendingPlanByOrderId(database, orderId, now),
    markExpiredPendingPlansByOrderId: (orderId, now) =>
      markExpiredPendingPlansByOrderId(database, orderId, now),
    invalidatePendingPlan: (planId, reason) =>
      invalidatePendingPlan(database, planId, reason),
    createRecoveryPlan: (input) => createRecoveryPlan(database, input),
  };
}

function mapRecoveryPlanRow(row: {
  id: string;
  orderId: string;
  orderNumber: string;
  expectedOrderVersion: number;
  status: RecoveryPlan['status'];
  plannedChanges: Record<string, unknown>;
  createdAt: Date;
  expiresAt: Date;
  appliedAt: Date | null;
  invalidatedReason: string | null;
}): RecoveryPlan {
  return {
    ...row,
    plannedChanges: row.plannedChanges as unknown as RecoveryPlannedChanges,
  };
}

export async function findActivePendingPlanByOrderId(
  database: Database,
  orderId: string,
  now: Date,
): Promise<RecoveryPlan | null> {
  const [row] = await database
    .select({
      id: recoveryPlans.id,
      orderId: recoveryPlans.orderId,
      orderNumber: orders.orderNumber,
      expectedOrderVersion: recoveryPlans.expectedOrderVersion,
      status: recoveryPlans.status,
      plannedChanges: recoveryPlans.plannedChanges,
      createdAt: recoveryPlans.createdAt,
      expiresAt: recoveryPlans.expiresAt,
      appliedAt: recoveryPlans.appliedAt,
      invalidatedReason: recoveryPlans.invalidatedReason,
    })
    .from(recoveryPlans)
    .innerJoin(orders, eq(recoveryPlans.orderId, orders.id))
    .where(
      and(
        eq(recoveryPlans.orderId, orderId),
        eq(recoveryPlans.status, 'pending'),
        gt(recoveryPlans.expiresAt, now),
      ),
    )
    .limit(1);

  return row ? mapRecoveryPlanRow(row) : null;
}

export async function markExpiredPendingPlansByOrderId(
  database: Database,
  orderId: string,
  now: Date,
): Promise<void> {
  await database
    .update(recoveryPlans)
    .set({ status: 'expired' })
    .where(
      and(
        eq(recoveryPlans.orderId, orderId),
        eq(recoveryPlans.status, 'pending'),
        lte(recoveryPlans.expiresAt, now),
      ),
    );
}

export async function invalidatePendingPlan(
  database: Database,
  planId: string,
  reason: string,
): Promise<void> {
  await database
    .update(recoveryPlans)
    .set({
      status: 'invalidated',
      invalidatedReason: reason,
    })
    .where(
      and(eq(recoveryPlans.id, planId), eq(recoveryPlans.status, 'pending')),
    );
}

function isPendingPlanUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const databaseError = error as {
    code?: unknown;
    constraint?: unknown;
    cause?: unknown;
  };

  if (
    databaseError.code === '23505' &&
    databaseError.constraint === 'recovery_plans_one_pending_per_order_idx'
  ) {
    return true;
  }

  return isPendingPlanUniqueViolation(databaseError.cause);
}

export async function createRecoveryPlan(
  database: Database,
  input: CreateRecoveryPlanInput,
): Promise<RecoveryPlan> {
  let row:
    | (Omit<RecoveryPlan, 'orderNumber' | 'plannedChanges'> & {
        plannedChanges: Record<string, unknown>;
      })
    | undefined;

  try {
    [row] = await database
      .insert(recoveryPlans)
      .values({
        orderId: input.orderId,
        expectedOrderVersion: input.expectedOrderVersion,
        plannedChanges: { ...input.plannedChanges },
        expiresAt: input.expiresAt,
      })
      .returning({
        id: recoveryPlans.id,
        orderId: recoveryPlans.orderId,
        expectedOrderVersion: recoveryPlans.expectedOrderVersion,
        status: recoveryPlans.status,
        plannedChanges: recoveryPlans.plannedChanges,
        createdAt: recoveryPlans.createdAt,
        expiresAt: recoveryPlans.expiresAt,
        appliedAt: recoveryPlans.appliedAt,
        invalidatedReason: recoveryPlans.invalidatedReason,
      });
  } catch (error) {
    if (isPendingPlanUniqueViolation(error)) {
      throw new PendingRecoveryPlanConflictError();
    }

    throw error;
  }

  if (!row) {
    throw new Error('The recovery plan insert did not return a row.');
  }

  return mapRecoveryPlanRow({
    ...row,
    orderNumber: input.orderNumber,
  });
}

export async function getOrderSnapshot(
  database: Database,
  orderNumber: string,
): Promise<OrderSnapshot | null> {
  const [orderRow] = await database
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      localPaymentStatus: orders.localPaymentStatus,
      orderStatus: orders.orderStatus,
      version: orders.version,
    })
    .from(orders)
    .where(eq(orders.orderNumber, orderNumber))
    .limit(1);

  if (!orderRow) {
    return null;
  }

  const itemRows = await database
    .select({
      id: orderItems.id,
      sku: orderItems.sku,
      quantity: orderItems.quantity,
      unitPriceMinor: orderItems.unitPriceMinor,
      inventoryOnHand: inventory.onHand,
      inventoryReserved: inventory.reserved,
      reservationId: inventoryReservations.id,
      reservationQuantity: inventoryReservations.quantity,
    })
    .from(orderItems)
    .innerJoin(inventory, eq(orderItems.sku, inventory.sku))
    .leftJoin(
      inventoryReservations,
      eq(inventoryReservations.orderItemId, orderItems.id),
    )
    .where(eq(orderItems.orderId, orderRow.id))
    .orderBy(asc(orderItems.createdAt), asc(orderItems.id));

  const paymentRows = await database
    .select({
      id: processorPayments.id,
      processorPaymentId: processorPayments.processorPaymentId,
      amountMinor: processorPayments.amountMinor,
      currency: processorPayments.currency,
      status: processorPayments.status,
      capturedAt: processorPayments.capturedAt,
    })
    .from(processorPayments)
    .where(eq(processorPayments.orderId, orderRow.id))
    .limit(1);

  const fulfillmentRows = await database
    .select({
      id: fulfillments.id,
      status: fulfillments.status,
      blockedReason: fulfillments.blockedReason,
    })
    .from(fulfillments)
    .where(eq(fulfillments.orderId, orderRow.id))
    .limit(1);

  const paymentRow = paymentRows[0] ?? null;
  const fulfillmentRow = fulfillmentRows[0] ?? null;

  const webhookRows = paymentRow
    ? await database
        .select({
          id: webhookEvents.id,
          eventType: webhookEvents.eventType,
          deliveryStatus: webhookEvents.deliveryStatus,
          errorMessage: webhookEvents.errorMessage,
          receivedAt: webhookEvents.receivedAt,
          processedAt: webhookEvents.processedAt,
        })
        .from(webhookEvents)
        .where(eq(webhookEvents.paymentId, paymentRow.id))
        .orderBy(asc(webhookEvents.receivedAt), asc(webhookEvents.id))
    : [];

  return {
    order: {
      id: orderRow.id,
      orderNumber: orderRow.orderNumber,
      localPaymentStatus: orderRow.localPaymentStatus,
      orderStatus: orderRow.orderStatus,
      version: orderRow.version,
    },
    items: itemRows.map((itemRow) => ({
      id: itemRow.id,
      sku: itemRow.sku,
      quantity: itemRow.quantity,
      unitPriceMinor: itemRow.unitPriceMinor,
      inventory: {
        onHand: itemRow.inventoryOnHand,
        reserved: itemRow.inventoryReserved,
        available: itemRow.inventoryOnHand - itemRow.inventoryReserved,
      },
      reservation:
        itemRow.reservationId !== null && itemRow.reservationQuantity !== null
          ? {
              id: itemRow.reservationId,
              quantity: itemRow.reservationQuantity,
            }
          : null,
    })),
    payment: paymentRow
      ? {
          id: paymentRow.id,
          processorPaymentId: paymentRow.processorPaymentId,
          amountMinor: paymentRow.amountMinor,
          currency: paymentRow.currency,
          status: paymentRow.status,
          capturedAt: paymentRow.capturedAt,
        }
      : null,
    webhookEvents: webhookRows.map((webhookRow) => ({
      id: webhookRow.id,
      eventType: webhookRow.eventType,
      deliveryStatus: webhookRow.deliveryStatus,
      errorMessage: webhookRow.errorMessage,
      receivedAt: webhookRow.receivedAt,
      processedAt: webhookRow.processedAt,
    })),
    fulfillment: fulfillmentRow
      ? {
          id: fulfillmentRow.id,
          status: fulfillmentRow.status,
          blockedReason: fulfillmentRow.blockedReason,
        }
      : null,
  };
}
