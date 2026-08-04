import { describe, expect, it, vi } from 'vitest';
import {
  createPrepareRecoveryPlan,
  PendingRecoveryPlanConflictError,
  type PrepareRecoveryPlanError,
} from '../../../../src/modules/order-recovery/application/prepare-recovery-plan.js';
import type { OrderSnapshot } from '../../../../src/modules/order-recovery/domain/order-snapshot.js';
import type { RecoveryPlan } from '../../../../src/modules/order-recovery/domain/recovery-plan.js';

function createSnapshot(): OrderSnapshot {
  return {
    order: {
      id: 'order-1',
      orderNumber: 'ORD-DEMO-1042',
      localPaymentStatus: 'pending',
      orderStatus: 'awaiting_payment',
      version: 3,
    },
    items: [
      {
        id: 'item-1',
        sku: 'SKU-DEMO',
        quantity: 2,
        unitPriceMinor: 25000,
        inventory: { onHand: 10, reserved: 0, available: 10 },
        reservation: null,
      },
    ],
    payment: {
      id: 'payment-1',
      processorPaymentId: 'processor-1',
      amountMinor: 50000,
      currency: 'INR',
      status: 'captured',
      capturedAt: new Date('2026-01-01T00:00:00.000Z'),
    },
    webhookEvents: [
      {
        id: 'webhook-1',
        eventType: 'payment.captured',
        deliveryStatus: 'failed',
        errorMessage: 'Synthetic failure',
        receivedAt: new Date('2026-01-01T00:00:01.000Z'),
        processedAt: null,
      },
    ],
    fulfillment: {
      id: 'fulfillment-1',
      status: 'blocked_awaiting_payment',
      blockedReason: 'Local payment is pending',
    },
  };
}

function createPlan(): RecoveryPlan {
  return {
    id: 'plan-1',
    orderId: 'order-1',
    orderNumber: 'ORD-DEMO-1042',
    expectedOrderVersion: 3,
    status: 'pending',
    plannedChanges: {
      localPayment: { from: 'pending', to: 'paid' },
      order: {
        from: 'awaiting_payment',
        to: 'ready_for_fulfillment',
      },
      fulfillment: {
        from: 'blocked_awaiting_payment',
        to: 'ready_to_fulfill',
      },
      inventoryReservations: [
        { orderItemId: 'item-1', sku: 'SKU-DEMO', quantity: 2 },
      ],
    },
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: new Date('2026-01-01T00:15:00.000Z'),
    appliedAt: null,
    invalidatedReason: null,
  };
}

describe('prepareRecoveryPlan', () => {
  it('stores exact planned changes with a 15-minute expiry', async () => {
    const snapshot = createSnapshot();
    const plan = createPlan();
    const createRecoveryPlan = vi.fn(async () => plan);
    const repository = {
      findSnapshotByOrderNumber: vi.fn(async () => snapshot),
      findActivePendingPlanByOrderId: vi.fn(async () => null),
      markExpiredPendingPlansByOrderId: vi.fn(async () => undefined),
      invalidatePendingPlan: vi.fn(async () => undefined),
      createRecoveryPlan,
    };
    const prepare = createPrepareRecoveryPlan(repository, {
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });

    await expect(prepare('ORD-DEMO-1042')).resolves.toEqual({
      plan,
      createdPlanRecord: true,
      reusedExistingPlan: false,
    });
    expect(createRecoveryPlan).toHaveBeenCalledWith({
      orderId: 'order-1',
      orderNumber: 'ORD-DEMO-1042',
      expectedOrderVersion: 3,
      expiresAt: new Date('2026-01-01T00:15:00.000Z'),
      plannedChanges: plan.plannedChanges,
    });
  });

  it('returns an existing pending plan without creating another', async () => {
    const plan = createPlan();
    const createRecoveryPlan = vi.fn();
    const prepare = createPrepareRecoveryPlan({
      findSnapshotByOrderNumber: vi.fn(async () => createSnapshot()),
      findActivePendingPlanByOrderId: vi.fn(async () => plan),
      markExpiredPendingPlansByOrderId: vi.fn(async () => undefined),
      invalidatePendingPlan: vi.fn(async () => undefined),
      createRecoveryPlan,
    });

    await expect(prepare('ORD-DEMO-1042')).resolves.toEqual({
      plan,
      createdPlanRecord: false,
      reusedExistingPlan: true,
    });
    expect(createRecoveryPlan).not.toHaveBeenCalled();
  });

  it('returns the same plan and inserts only once across two immediate calls', async () => {
    const plan = createPlan();
    let storedPlan: RecoveryPlan | null = null;
    const createRecoveryPlan = vi.fn(async () => {
      storedPlan = plan;
      return plan;
    });
    const prepare = createPrepareRecoveryPlan({
      findSnapshotByOrderNumber: vi.fn(async () => createSnapshot()),
      findActivePendingPlanByOrderId: vi.fn(async () => storedPlan),
      markExpiredPendingPlansByOrderId: vi.fn(async () => undefined),
      invalidatePendingPlan: vi.fn(async () => undefined),
      createRecoveryPlan,
    });

    const firstResult = await prepare('ORD-DEMO-1042');
    const secondResult = await prepare('ORD-DEMO-1042');

    expect(firstResult).toMatchObject({
      plan: { id: 'plan-1' },
      createdPlanRecord: true,
      reusedExistingPlan: false,
    });
    expect(secondResult).toMatchObject({
      plan: { id: 'plan-1' },
      createdPlanRecord: false,
      reusedExistingPlan: true,
    });
    expect(createRecoveryPlan).toHaveBeenCalledOnce();
  });

  it('does not reuse a pending plan for an older order version', async () => {
    const stalePlan = createPlan();
    stalePlan.expectedOrderVersion = 2;
    const freshPlan = createPlan();
    freshPlan.id = 'plan-2';
    const invalidatePendingPlan = vi.fn(async () => undefined);
    const createRecoveryPlan = vi.fn(async () => freshPlan);
    const prepare = createPrepareRecoveryPlan({
      findSnapshotByOrderNumber: vi.fn(async () => createSnapshot()),
      findActivePendingPlanByOrderId: vi.fn(async () => stalePlan),
      markExpiredPendingPlansByOrderId: vi.fn(async () => undefined),
      invalidatePendingPlan,
      createRecoveryPlan,
    });

    await expect(prepare('ORD-DEMO-1042')).resolves.toEqual({
      plan: freshPlan,
      createdPlanRecord: true,
      reusedExistingPlan: false,
    });
    expect(invalidatePendingPlan).toHaveBeenCalledWith(
      'plan-1',
      'The order version or planned changes no longer match the current order state.',
    );
    expect(createRecoveryPlan).toHaveBeenCalledOnce();
  });

  it('does not reuse a plan whose planned changes differ', async () => {
    const stalePlan = createPlan();
    stalePlan.plannedChanges.inventoryReservations[0].quantity = 1;
    const freshPlan = createPlan();
    freshPlan.id = 'plan-2';
    const invalidatePendingPlan = vi.fn(async () => undefined);
    const prepare = createPrepareRecoveryPlan({
      findSnapshotByOrderNumber: vi.fn(async () => createSnapshot()),
      findActivePendingPlanByOrderId: vi.fn(async () => stalePlan),
      markExpiredPendingPlansByOrderId: vi.fn(async () => undefined),
      invalidatePendingPlan,
      createRecoveryPlan: vi.fn(async () => freshPlan),
    });

    await expect(prepare('ORD-DEMO-1042')).resolves.toMatchObject({
      plan: { id: 'plan-2' },
      createdPlanRecord: true,
      reusedExistingPlan: false,
    });
    expect(invalidatePendingPlan).toHaveBeenCalledOnce();
  });

  it('rejects insufficient inventory before checking or writing plans', async () => {
    const snapshot = createSnapshot();
    snapshot.items[0].inventory.available = 1;
    const findActivePendingPlanByOrderId = vi.fn();
    const createRecoveryPlan = vi.fn();
    const prepare = createPrepareRecoveryPlan({
      findSnapshotByOrderNumber: vi.fn(async () => snapshot),
      findActivePendingPlanByOrderId,
      markExpiredPendingPlansByOrderId: vi.fn(),
      invalidatePendingPlan: vi.fn(),
      createRecoveryPlan,
    });

    const expectedError: Partial<PrepareRecoveryPlanError> = {
      code: 'RECOVERY_NOT_ELIGIBLE',
    };

    await expect(prepare('ORD-DEMO-1042')).rejects.toMatchObject({
      ...expectedError,
      eligibility: {
        recoverable: false,
        reason: 'INSUFFICIENT_INVENTORY',
      },
    });
    expect(findActivePendingPlanByOrderId).not.toHaveBeenCalled();
    expect(createRecoveryPlan).not.toHaveBeenCalled();
  });

  it('rejects a cancelled order as ineligible', async () => {
    const snapshot = createSnapshot();
    snapshot.order.orderStatus = 'cancelled';
    const findActivePendingPlanByOrderId = vi.fn();
    const createRecoveryPlan = vi.fn();
    const prepare = createPrepareRecoveryPlan({
      findSnapshotByOrderNumber: vi.fn(async () => snapshot),
      findActivePendingPlanByOrderId,
      markExpiredPendingPlansByOrderId: vi.fn(),
      invalidatePendingPlan: vi.fn(),
      createRecoveryPlan,
    });

    await expect(prepare('ORD-DEMO-1042')).rejects.toMatchObject({
      code: 'RECOVERY_NOT_ELIGIBLE',
      eligibility: {
        recoverable: false,
        reason: 'ORDER_CANCELLED',
      },
    });
    expect(findActivePendingPlanByOrderId).not.toHaveBeenCalled();
    expect(createRecoveryPlan).not.toHaveBeenCalled();
  });

  it('rejects an already recovered order as ineligible', async () => {
    const snapshot = createSnapshot();
    snapshot.order.localPaymentStatus = 'paid';
    snapshot.order.orderStatus = 'ready_for_fulfillment';
    snapshot.items[0].inventory.reserved = 2;
    snapshot.items[0].inventory.available = 8;
    snapshot.items[0].reservation = {
      id: 'reservation-1',
      quantity: 2,
    };
    if (snapshot.fulfillment) {
      snapshot.fulfillment.status = 'ready_to_fulfill';
      snapshot.fulfillment.blockedReason = null;
    }
    const findActivePendingPlanByOrderId = vi.fn();
    const createRecoveryPlan = vi.fn();
    const prepare = createPrepareRecoveryPlan({
      findSnapshotByOrderNumber: vi.fn(async () => snapshot),
      findActivePendingPlanByOrderId,
      markExpiredPendingPlansByOrderId: vi.fn(),
      invalidatePendingPlan: vi.fn(),
      createRecoveryPlan,
    });

    await expect(prepare('ORD-DEMO-1042')).rejects.toMatchObject({
      code: 'RECOVERY_NOT_ELIGIBLE',
      eligibility: {
        recoverable: false,
        reason: 'ALREADY_RECOVERED',
      },
    });
    expect(findActivePendingPlanByOrderId).not.toHaveBeenCalled();
    expect(createRecoveryPlan).not.toHaveBeenCalled();
  });

  it('rejects a missing order without writing a plan', async () => {
    const createRecoveryPlan = vi.fn();
    const prepare = createPrepareRecoveryPlan({
      findSnapshotByOrderNumber: vi.fn(async () => null),
      findActivePendingPlanByOrderId: vi.fn(),
      markExpiredPendingPlansByOrderId: vi.fn(),
      invalidatePendingPlan: vi.fn(),
      createRecoveryPlan,
    });

    await expect(prepare('ORD-MISSING')).rejects.toMatchObject({
      code: 'ORDER_NOT_FOUND',
    });
    expect(createRecoveryPlan).not.toHaveBeenCalled();
  });

  it('expires stale pending plans before creating a fresh plan', async () => {
    const newPlan = createPlan();
    newPlan.id = 'plan-2';
    const markExpiredPendingPlansByOrderId = vi.fn(async () => undefined);
    const createRecoveryPlan = vi.fn(async () => newPlan);
    const prepare = createPrepareRecoveryPlan(
      {
        findSnapshotByOrderNumber: vi.fn(async () => createSnapshot()),
        findActivePendingPlanByOrderId: vi.fn(async () => null),
        markExpiredPendingPlansByOrderId,
        invalidatePendingPlan: vi.fn(async () => undefined),
        createRecoveryPlan,
      },
      { now: () => new Date('2026-01-01T00:16:00.000Z') },
    );

    await expect(prepare('ORD-DEMO-1042')).resolves.toEqual({
      plan: newPlan,
      createdPlanRecord: true,
      reusedExistingPlan: false,
    });
    expect(markExpiredPendingPlansByOrderId).toHaveBeenCalledWith(
      'order-1',
      new Date('2026-01-01T00:16:00.000Z'),
    );
  });

  it('returns the concurrently created plan after a uniqueness race', async () => {
    const winner = createPlan();
    const findActivePendingPlanByOrderId = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner);
    const createRecoveryPlan = vi.fn(async () => {
      throw new PendingRecoveryPlanConflictError();
    });
    const prepare = createPrepareRecoveryPlan({
      findSnapshotByOrderNumber: vi.fn(async () => createSnapshot()),
      findActivePendingPlanByOrderId,
      markExpiredPendingPlansByOrderId: vi.fn(async () => undefined),
      invalidatePendingPlan: vi.fn(async () => undefined),
      createRecoveryPlan,
    });

    await expect(prepare('ORD-DEMO-1042')).resolves.toEqual({
      plan: winner,
      createdPlanRecord: false,
      reusedExistingPlan: true,
    });
    expect(findActivePendingPlanByOrderId).toHaveBeenCalledTimes(2);
  });
});
