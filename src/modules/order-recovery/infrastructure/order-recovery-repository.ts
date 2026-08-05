import { and, asc, eq, gt, gte, inArray, lte, sql } from 'drizzle-orm';
import type { Database } from '../../../db/client.js';
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
} from '../../../db/schema.js';
import type {
  ApplyRecoveryRepository,
  ApplyRecoveryTransactionInput,
  ApplyRecoveryTransactionResult,
} from '../application/apply-recovery.js';
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
import {
  buildRecoveryPlannedChanges,
  recoveryPlannedChangesMatch,
} from '../domain/recovery-plan.js';
import { evaluateRecoveryEligibility } from '../domain/recovery-policy.js';

type OrderRecoveryTransaction = Parameters<
  Parameters<Database['transaction']>[0]
>[0];

type SuccessfulApplyRecoveryResult = Extract<
  ApplyRecoveryTransactionResult,
  { applied: true }
>;

type InitialApplyRecoveryFailureCode = Extract<
  ApplyRecoveryTransactionResult,
  { applied: false }
>['code'];

function createApplyFailure(
  planId: string,
  code: InitialApplyRecoveryFailureCode,
  message: string,
): ApplyRecoveryTransactionResult {
  return {
    applied: false,
    code,
    planId,
    message,
    idempotentReplay: false,
    commerceStateChangedByThisInvocation: false,
  };
}

function createReplayResult(
  storedResult: SuccessfulApplyRecoveryResult,
): SuccessfulApplyRecoveryResult {
  return {
    ...storedResult,
    idempotentReplay: true,
    commerceStateChangedByThisInvocation: false,
  };
}

export function createOrderRecoveryRepository(
  database: Database,
): OrderRecoveryRepository &
  PrepareRecoveryPlanRepository &
  ApplyRecoveryRepository {
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
    applyRecoveryTransaction: (input) =>
      applyRecoveryTransaction(database, input),
  };
}

async function findLockedRecoverySnapshotByOrderId(
  tx: OrderRecoveryTransaction,
  orderId: string,
): Promise<OrderSnapshot | null> {
  const [orderRow] = await tx
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      localPaymentStatus: orders.localPaymentStatus,
      orderStatus: orders.orderStatus,
      version: orders.version,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1)
    .for('update');

  if (!orderRow) {
    return null;
  }

  const itemRows = await tx
    .select({
      id: orderItems.id,
      sku: orderItems.sku,
      quantity: orderItems.quantity,
      unitPriceMinor: orderItems.unitPriceMinor,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId))
    .orderBy(asc(orderItems.createdAt), asc(orderItems.id))
    .for('update');

  const itemIds = itemRows.map((item) => item.id);
  const skus = [...new Set(itemRows.map((item) => item.sku))];

  const inventoryRows =
    skus.length > 0
      ? await tx
          .select({
            sku: inventory.sku,
            onHand: inventory.onHand,
            reserved: inventory.reserved,
          })
          .from(inventory)
          .where(inArray(inventory.sku, skus))
          .for('update')
      : [];

  const reservationRows =
    itemIds.length > 0
      ? await tx
          .select({
            id: inventoryReservations.id,
            orderItemId: inventoryReservations.orderItemId,
            quantity: inventoryReservations.quantity,
          })
          .from(inventoryReservations)
          .where(inArray(inventoryReservations.orderItemId, itemIds))
          .for('update')
      : [];

  const [paymentRow] = await tx
    .select({
      id: processorPayments.id,
      processorPaymentId: processorPayments.processorPaymentId,
      amountMinor: processorPayments.amountMinor,
      currency: processorPayments.currency,
      status: processorPayments.status,
      capturedAt: processorPayments.capturedAt,
    })
    .from(processorPayments)
    .where(eq(processorPayments.orderId, orderId))
    .limit(1)
    .for('update');

  const webhookRows = paymentRow
    ? await tx
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
        .for('update')
    : [];

  const [fulfillmentRow] = await tx
    .select({
      id: fulfillments.id,
      status: fulfillments.status,
      blockedReason: fulfillments.blockedReason,
    })
    .from(fulfillments)
    .where(eq(fulfillments.orderId, orderId))
    .limit(1)
    .for('update');

  const inventoryBySku = new Map(inventoryRows.map((row) => [row.sku, row]));
  const reservationByItemId = new Map(
    reservationRows.map((row) => [row.orderItemId, row]),
  );

  return {
    order: orderRow,
    items: itemRows.map((item) => {
      const inventoryRow = inventoryBySku.get(item.sku);

      if (!inventoryRow) {
        throw new Error(`Inventory is missing for order item ${item.id}.`);
      }

      const reservation = reservationByItemId.get(item.id);

      return {
        ...item,
        inventory: {
          onHand: inventoryRow.onHand,
          reserved: inventoryRow.reserved,
          available: inventoryRow.onHand - inventoryRow.reserved,
        },
        reservation: reservation
          ? { id: reservation.id, quantity: reservation.quantity }
          : null,
      };
    }),
    payment: paymentRow ?? null,
    webhookEvents: webhookRows,
    fulfillment: fulfillmentRow ?? null,
  };
}

export async function applyRecoveryTransaction(
  database: Database,
  input: ApplyRecoveryTransactionInput,
): Promise<ApplyRecoveryTransactionResult> {
  return database.transaction(async (tx) => {
    async function findIdempotencyRecord() {
      const [record] = await tx
        .select({
          requestHash: idempotencyRecords.requestHash,
          resultJson: idempotencyRecords.resultJson,
        })
        .from(idempotencyRecords)
        .where(eq(idempotencyRecords.idempotencyKey, input.idempotencyKey))
        .limit(1);

      return record ?? null;
    }

    function resolveExistingRequest(record: {
      requestHash: string;
      resultJson: Record<string, unknown>;
    }): ApplyRecoveryTransactionResult {
      if (record.requestHash !== input.requestHash) {
        return createApplyFailure(
          input.planId,
          'IDEMPOTENCY_KEY_CONFLICT',
          'The idempotency key was already used for a different request.',
        );
      }

      if (!record.resultJson) {
        throw new Error(
          'The idempotency record does not contain a completed result.',
        );
      }

      return createReplayResult(
        record.resultJson as unknown as SuccessfulApplyRecoveryResult,
      );
    }

    const existingRequestBeforeLock = await findIdempotencyRecord();

    if (existingRequestBeforeLock) {
      return resolveExistingRequest(existingRequestBeforeLock);
    }

    const [plan] = await tx
      .select({
        id: recoveryPlans.id,
        orderId: recoveryPlans.orderId,
        expectedOrderVersion: recoveryPlans.expectedOrderVersion,
        status: recoveryPlans.status,
        plannedChanges: recoveryPlans.plannedChanges,
        expiresAt: recoveryPlans.expiresAt,
      })
      .from(recoveryPlans)
      .where(eq(recoveryPlans.id, input.planId))
      .limit(1)
      .for('update');

    if (!plan) {
      return createApplyFailure(
        input.planId,
        'PLAN_NOT_FOUND',
        'No recovery plan was found with this plan ID.',
      );
    }

    const existingRequestAfterLock = await findIdempotencyRecord();

    if (existingRequestAfterLock) {
      return resolveExistingRequest(existingRequestAfterLock);
    }

    if (plan.status === 'applied') {
      return createApplyFailure(
        input.planId,
        'PLAN_ALREADY_APPLIED',
        'This recovery plan has already been applied.',
      );
    }

    if (plan.status !== 'pending') {
      return createApplyFailure(
        input.planId,
        'PLAN_NOT_PENDING',
        `This recovery plan cannot be applied because its status is ${plan.status}.`,
      );
    }

    if (plan.expiresAt.getTime() <= input.now.getTime()) {
      await tx
        .update(recoveryPlans)
        .set({ status: 'expired' })
        .where(
          and(
            eq(recoveryPlans.id, plan.id),
            eq(recoveryPlans.status, 'pending'),
          ),
        );

      return createApplyFailure(
        input.planId,
        'PLAN_EXPIRED',
        'This recovery plan has expired. Prepare and approve a fresh recovery plan.',
      );
    }

    const snapshot = await findLockedRecoverySnapshotByOrderId(
      tx,
      plan.orderId,
    );

    if (!snapshot) {
      return createApplyFailure(
        input.planId,
        'RECOVERY_NOT_ELIGIBLE',
        'The order state required by this recovery plan no longer exists.',
      );
    }

    if (snapshot.order.version !== plan.expectedOrderVersion) {
      return createApplyFailure(
        input.planId,
        'STALE_ORDER_VERSION',
        `The recovery plan expected order version ${plan.expectedOrderVersion}, but the current version is ${snapshot.order.version}.`,
      );
    }

    const eligibility = evaluateRecoveryEligibility(snapshot);

    if (!eligibility.recoverable) {
      return createApplyFailure(
        input.planId,
        'RECOVERY_NOT_ELIGIBLE',
        `The order is no longer recoverable: ${eligibility.reason}.`,
      );
    }

    const currentPlannedChanges = buildRecoveryPlannedChanges(snapshot);

    if (
      !recoveryPlannedChangesMatch(
        plan.plannedChanges as unknown as RecoveryPlannedChanges,
        currentPlannedChanges,
      )
    ) {
      return createApplyFailure(
        input.planId,
        'PLANNED_CHANGES_MISMATCH',
        'The current recovery actions no longer match the approved plan.',
      );
    }

    if (!snapshot.fulfillment) {
      throw new Error(
        'The validated recovery snapshot does not contain a fulfillment.',
      );
    }

    const approvedChanges =
      plan.plannedChanges as unknown as RecoveryPlannedChanges;
    const newOrderVersion = snapshot.order.version + 1;

    for (const reservation of approvedChanges.inventoryReservations) {
      const [updatedInventory] = await tx
        .update(inventory)
        .set({
          reserved: sql`${inventory.reserved} + ${reservation.quantity}`,
        })
        .where(
          and(
            eq(inventory.sku, reservation.sku),
            gte(
              sql`${inventory.onHand} - ${inventory.reserved}`,
              reservation.quantity,
            ),
          ),
        )
        .returning({ sku: inventory.sku });

      if (!updatedInventory) {
        throw new Error(
          `Inventory is no longer sufficient for SKU ${reservation.sku}.`,
        );
      }

      await tx.insert(inventoryReservations).values({
        orderItemId: reservation.orderItemId,
        quantity: reservation.quantity,
        createdAt: input.now,
      });
    }

    const [updatedOrder] = await tx
      .update(orders)
      .set({
        localPaymentStatus: approvedChanges.localPayment.to,
        orderStatus: approvedChanges.order.to,
        version: newOrderVersion,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(orders.id, snapshot.order.id),
          eq(orders.localPaymentStatus, approvedChanges.localPayment.from),
          eq(orders.orderStatus, approvedChanges.order.from),
          eq(orders.version, plan.expectedOrderVersion),
        ),
      )
      .returning({ id: orders.id, version: orders.version });

    if (!updatedOrder || updatedOrder.version !== newOrderVersion) {
      throw new Error(
        'The order changed before the recovery update could be completed.',
      );
    }

    const [updatedFulfillment] = await tx
      .update(fulfillments)
      .set({
        status: approvedChanges.fulfillment.to,
        blockedReason: null,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(fulfillments.id, snapshot.fulfillment.id),
          eq(fulfillments.status, approvedChanges.fulfillment.from),
        ),
      )
      .returning({ id: fulfillments.id });

    if (!updatedFulfillment) {
      throw new Error(
        'The fulfillment record was not in the expected blocked state.',
      );
    }

    const [appliedPlan] = await tx
      .update(recoveryPlans)
      .set({
        status: 'applied',
        appliedAt: input.now,
      })
      .where(
        and(eq(recoveryPlans.id, plan.id), eq(recoveryPlans.status, 'pending')),
      )
      .returning({ id: recoveryPlans.id });

    if (!appliedPlan) {
      throw new Error('The recovery plan could not be marked as applied.');
    }

    const successResult: SuccessfulApplyRecoveryResult = {
      applied: true,
      code: 'RECOVERY_APPLIED',
      planId: plan.id,
      orderNumber: snapshot.order.orderNumber,
      orderVersion: newOrderVersion,
      message: 'The approved recovery was applied successfully.',
      idempotentReplay: false,
      commerceStateChangedByThisInvocation: true,
    };

    await tx.insert(auditEvents).values({
      orderId: plan.orderId,
      planId: plan.id,
      eventType: 'order_recovery_applied',
      beforeState: {
        localPaymentStatus: snapshot.order.localPaymentStatus,
        orderStatus: snapshot.order.orderStatus,
        orderVersion: snapshot.order.version,
        fulfillmentStatus: snapshot.fulfillment.status,
        inventoryReservations: [],
      },
      afterState: {
        localPaymentStatus: approvedChanges.localPayment.to,
        orderStatus: approvedChanges.order.to,
        orderVersion: newOrderVersion,
        fulfillmentStatus: approvedChanges.fulfillment.to,
        inventoryReservations: approvedChanges.inventoryReservations.map(
          (reservation) => ({ ...reservation }),
        ),
      },
      reason:
        'Applied an explicitly approved recovery plan; operator identity was not independently verified.',
      createdAt: input.now,
    });

    await tx.insert(idempotencyRecords).values({
      idempotencyKey: input.idempotencyKey,
      planId: plan.id,
      requestHash: input.requestHash,
      resultJson: { ...successResult },
      createdAt: input.now,
    });

    return successResult;
  });
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
