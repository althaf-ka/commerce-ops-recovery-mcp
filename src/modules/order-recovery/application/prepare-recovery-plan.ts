import type { OrderSnapshot } from '../domain/order-snapshot.js';
import type {
  CreateRecoveryPlanInput,
  RecoveryPlan,
  RecoveryPlannedChanges,
} from '../domain/recovery-plan.js';
import {
  evaluateRecoveryEligibility,
  type RecoveryEligibilityResult,
} from '../domain/recovery-policy.js';

const RECOVERY_PLAN_TTL_MS = 15 * 60 * 1000;

export interface PrepareRecoveryPlanRepository {
  findSnapshotByOrderNumber(orderNumber: string): Promise<OrderSnapshot | null>;

  findActivePendingPlanByOrderId(
    orderId: string,
    now: Date,
  ): Promise<RecoveryPlan | null>;

  markExpiredPendingPlansByOrderId(orderId: string, now: Date): Promise<void>;

  invalidatePendingPlan(planId: string, reason: string): Promise<void>;

  createRecoveryPlan(input: CreateRecoveryPlanInput): Promise<RecoveryPlan>;
}

export interface PrepareRecoveryPlanResult {
  plan: RecoveryPlan;
  createdPlanRecord: boolean;
  reusedExistingPlan: boolean;
}

export class PendingRecoveryPlanConflictError extends Error {
  constructor() {
    super('A pending recovery plan already exists for this order.');
    this.name = 'PendingRecoveryPlanConflictError';
  }
}

export type PrepareRecoveryPlanErrorCode =
  | 'ORDER_NOT_FOUND'
  | 'RECOVERY_NOT_ELIGIBLE';

export class PrepareRecoveryPlanError extends Error {
  readonly code: PrepareRecoveryPlanErrorCode;
  readonly eligibility?: RecoveryEligibilityResult;

  constructor(
    code: PrepareRecoveryPlanErrorCode,
    message: string,
    eligibility?: RecoveryEligibilityResult,
  ) {
    super(message);
    this.name = 'PrepareRecoveryPlanError';
    this.code = code;
    this.eligibility = eligibility;
  }
}

export interface PrepareRecoveryPlanOptions {
  now?: () => Date;
  planTtlMs?: number;
}

function buildPlannedChanges(snapshot: OrderSnapshot): RecoveryPlannedChanges {
  return {
    localPayment: {
      from: 'pending',
      to: 'paid',
    },
    order: {
      from: 'awaiting_payment',
      to: 'ready_for_fulfillment',
    },
    fulfillment: {
      from: 'blocked_awaiting_payment',
      to: 'ready_to_fulfill',
    },
    inventoryReservations: snapshot.items.map((item) => ({
      orderItemId: item.id,
      sku: item.sku,
      quantity: item.quantity,
    })),
  };
}

function plannedChangesMatch(
  left: RecoveryPlannedChanges,
  right: RecoveryPlannedChanges,
): boolean {
  return (
    left.localPayment.from === right.localPayment.from &&
    left.localPayment.to === right.localPayment.to &&
    left.order.from === right.order.from &&
    left.order.to === right.order.to &&
    left.fulfillment.from === right.fulfillment.from &&
    left.fulfillment.to === right.fulfillment.to &&
    left.inventoryReservations.length === right.inventoryReservations.length &&
    left.inventoryReservations.every((reservation, index) => {
      const other = right.inventoryReservations[index];

      return (
        other !== undefined &&
        reservation.orderItemId === other.orderItemId &&
        reservation.sku === other.sku &&
        reservation.quantity === other.quantity
      );
    })
  );
}

export function createPrepareRecoveryPlan(
  repository: PrepareRecoveryPlanRepository,
  options: PrepareRecoveryPlanOptions = {},
) {
  const now = options.now ?? (() => new Date());
  const planTtlMs = options.planTtlMs ?? RECOVERY_PLAN_TTL_MS;

  if (!Number.isFinite(planTtlMs) || planTtlMs <= 0) {
    throw new RangeError('Recovery plan TTL must be a positive number.');
  }

  return async function prepareRecoveryPlan(
    orderNumber: string,
  ): Promise<PrepareRecoveryPlanResult> {
    const snapshot = await repository.findSnapshotByOrderNumber(orderNumber);

    if (!snapshot) {
      throw new PrepareRecoveryPlanError(
        'ORDER_NOT_FOUND',
        `No order was found with order number ${orderNumber}.`,
      );
    }

    const eligibility = evaluateRecoveryEligibility(snapshot);

    if (!eligibility.recoverable) {
      throw new PrepareRecoveryPlanError(
        'RECOVERY_NOT_ELIGIBLE',
        `Order ${snapshot.order.orderNumber} is not recoverable: ${eligibility.reason}.`,
        eligibility,
      );
    }

    const currentTime = now();
    const plannedChanges = buildPlannedChanges(snapshot);
    const existingPlan = await repository.findActivePendingPlanByOrderId(
      snapshot.order.id,
      currentTime,
    );

    if (
      existingPlan &&
      existingPlan.expectedOrderVersion === snapshot.order.version &&
      plannedChangesMatch(existingPlan.plannedChanges, plannedChanges)
    ) {
      return {
        plan: existingPlan,
        createdPlanRecord: false,
        reusedExistingPlan: true,
      };
    }

    if (existingPlan) {
      await repository.invalidatePendingPlan(
        existingPlan.id,
        'The order version or planned changes no longer match the current order state.',
      );
    }

    await repository.markExpiredPendingPlansByOrderId(
      snapshot.order.id,
      currentTime,
    );

    const input: CreateRecoveryPlanInput = {
      orderId: snapshot.order.id,
      orderNumber: snapshot.order.orderNumber,
      expectedOrderVersion: snapshot.order.version,
      plannedChanges,
      expiresAt: new Date(currentTime.getTime() + planTtlMs),
    };

    try {
      const plan = await repository.createRecoveryPlan(input);

      return {
        plan,
        createdPlanRecord: true,
        reusedExistingPlan: false,
      };
    } catch (error) {
      if (!(error instanceof PendingRecoveryPlanConflictError)) {
        throw error;
      }

      const concurrentlyCreatedPlan =
        await repository.findActivePendingPlanByOrderId(
          snapshot.order.id,
          currentTime,
        );

      if (!concurrentlyCreatedPlan) {
        throw error;
      }

      return {
        plan: concurrentlyCreatedPlan,
        createdPlanRecord: false,
        reusedExistingPlan: true,
      };
    }
  };
}
