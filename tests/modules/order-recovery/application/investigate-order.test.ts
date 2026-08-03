import { describe, expect, it, vi } from 'vitest';
import { createInvestigateOrder } from '../../../../src/modules/order-recovery/application/investigate-order.js';
import type { OrderSnapshot } from '../../../../src/modules/order-recovery/domain/order-snapshot.js';

function createSnapshot(): OrderSnapshot {
  return {
    order: {
      id: 'order-1',
      orderNumber: 'ORD-DEMO-1042',
      localPaymentStatus: 'pending',
      orderStatus: 'awaiting_payment',
      version: 1,
    },
    items: [
      {
        id: 'item-1',
        sku: 'SKU-DEMO',
        quantity: 2,
        unitPriceMinor: 25000,
        inventory: {
          onHand: 10,
          reserved: 0,
          available: 10,
        },
        reservation: null,
      },
    ],
    payment: {
      id: 'payment-1',
      processorPaymentId: 'pay-demo-1',
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
        errorMessage: 'Synthetic webhook failure',
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

describe('investigateOrder', () => {
  it('returns a recovery decision for an existing order', async () => {
    const snapshot = createSnapshot();
    const findSnapshotByOrderNumber = vi.fn(async () => snapshot);
    const investigateOrder = createInvestigateOrder({
      findSnapshotByOrderNumber,
    });

    const result = await investigateOrder('ORD-DEMO-1042');

    expect(findSnapshotByOrderNumber).toHaveBeenCalledOnce();
    expect(findSnapshotByOrderNumber).toHaveBeenCalledWith('ORD-DEMO-1042');
    expect(result).toMatchObject({
      found: true,
      orderNumber: 'ORD-DEMO-1042',
      orderVersion: 1,
      mutated: false,
      eligibility: {
        recoverable: true,
        reason: 'RECOVERABLE',
      },
    });

    if (result.found) {
      expect(result.snapshot).toBe(snapshot);
    }
  });

  it('returns a clear result when the order is missing', async () => {
    const findSnapshotByOrderNumber = vi.fn(async () => null);
    const investigateOrder = createInvestigateOrder({
      findSnapshotByOrderNumber,
    });

    const result = await investigateOrder('ORD-DEMO-9999');

    expect(findSnapshotByOrderNumber).toHaveBeenCalledOnce();
    expect(findSnapshotByOrderNumber).toHaveBeenCalledWith('ORD-DEMO-9999');
    expect(result).toEqual({
      found: false,
      orderNumber: 'ORD-DEMO-9999',
      message: 'No order was found with this order number.',
      mutated: false,
    });
  });
});
