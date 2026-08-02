import { describe, expect, it } from 'vitest';
import type { OrderSnapshot } from '../../../../src/modules/order-recovery/domain/order-snapshot.js';
import { evaluateRecoveryEligibility } from '../../../../src/modules/order-recovery/domain/recovery-policy.js';

function createRecoverableSnapshot(orderNumber: string): OrderSnapshot {
  return {
    order: {
      id: `order-${orderNumber}`,
      orderNumber,
      localPaymentStatus: 'pending',
      orderStatus: 'awaiting_payment',
      version: 1,
    },
    items: [
      {
        id: `item-${orderNumber}`,
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
      id: `payment-${orderNumber}`,
      processorPaymentId: `processor-${orderNumber}`,
      amountMinor: 50000,
      currency: 'INR',
      status: 'captured',
      capturedAt: new Date('2026-01-01T00:00:00.000Z'),
    },
    webhookEvents: [
      {
        id: `webhook-${orderNumber}`,
        eventType: 'payment.captured',
        deliveryStatus: 'failed',
        errorMessage: 'Synthetic delivery failure',
        receivedAt: new Date('2026-01-01T00:00:01.000Z'),
        processedAt: null,
      },
    ],
    fulfillment: {
      id: `fulfillment-${orderNumber}`,
      status: 'blocked_awaiting_payment',
      blockedReason: 'Local payment is pending',
    },
  };
}

describe('evaluateRecoveryEligibility', () => {
  it('marks the ORD-DEMO-1042 shape as recoverable', () => {
    const snapshot = createRecoverableSnapshot('ORD-DEMO-1042');

    expect(evaluateRecoveryEligibility(snapshot)).toMatchObject({
      recoverable: true,
      reason: 'RECOVERABLE',
    });
  });

  it('rejects the ORD-DEMO-2042 shape when inventory is insufficient', () => {
    const snapshot = createRecoverableSnapshot('ORD-DEMO-2042');
    snapshot.items[0].quantity = 3;
    snapshot.items[0].inventory.available = 1;
    if (snapshot.payment) {
      snapshot.payment.amountMinor = 75000;
    }

    expect(evaluateRecoveryEligibility(snapshot)).toMatchObject({
      recoverable: false,
      reason: 'INSUFFICIENT_INVENTORY',
      evidence: expect.arrayContaining(['SKU-DEMO: required 3, available 1']),
      recommendedEscalation: 'warehouse_operations',
    });
  });

  it('rejects the complete ORD-DEMO-3042 recovery state as already recovered', () => {
    const snapshot = createRecoverableSnapshot('ORD-DEMO-3042');
    snapshot.order.localPaymentStatus = 'paid';
    snapshot.order.orderStatus = 'ready_for_fulfillment';
    snapshot.order.version = 2;
    snapshot.items[0].inventory.reserved = 2;
    snapshot.items[0].inventory.available = 8;
    snapshot.items[0].reservation = {
      id: 'reservation-ORD-DEMO-3042',
      quantity: 2,
    };

    if (snapshot.fulfillment) {
      snapshot.fulfillment.status = 'ready_to_fulfill';
      snapshot.fulfillment.blockedReason = null;
    }

    expect(evaluateRecoveryEligibility(snapshot)).toMatchObject({
      recoverable: false,
      reason: 'ALREADY_RECOVERED',
    });
  });

  it('rejects the ORD-DEMO-4042 shape when the order is cancelled', () => {
    const snapshot = createRecoverableSnapshot('ORD-DEMO-4042');
    snapshot.order.orderStatus = 'cancelled';

    expect(evaluateRecoveryEligibility(snapshot)).toMatchObject({
      recoverable: false,
      reason: 'ORDER_CANCELLED',
      recommendedEscalation: 'commerce_operations',
    });
  });

  it('rejects a refunded processor payment', () => {
    const snapshot = createRecoverableSnapshot('ORD-TEST-REFUNDED');
    if (snapshot.payment) {
      snapshot.payment.status = 'refunded';
    }

    expect(evaluateRecoveryEligibility(snapshot)).toMatchObject({
      recoverable: false,
      reason: 'PAYMENT_REFUNDED',
      recommendedEscalation: 'payment_operations',
    });
  });

  it('rejects a disputed processor payment', () => {
    const snapshot = createRecoverableSnapshot('ORD-TEST-DISPUTED');
    if (snapshot.payment) {
      snapshot.payment.status = 'disputed';
    }

    expect(evaluateRecoveryEligibility(snapshot)).toMatchObject({
      recoverable: false,
      reason: 'PAYMENT_DISPUTED',
      recommendedEscalation: 'payment_operations',
    });
  });

  it('rejects fulfillment that has already been packed', () => {
    const snapshot = createRecoverableSnapshot('ORD-TEST-PACKED');
    if (snapshot.fulfillment) {
      snapshot.fulfillment.status = 'packed';
      snapshot.fulfillment.blockedReason = null;
    }

    expect(evaluateRecoveryEligibility(snapshot)).toMatchObject({
      recoverable: false,
      reason: 'FULFILLMENT_ALREADY_STARTED',
      recommendedEscalation: 'warehouse_operations',
    });
  });

  it('rejects a captured payment that does not match the order total', () => {
    const snapshot = createRecoverableSnapshot('ORD-TEST-AMOUNT-MISMATCH');
    if (snapshot.payment) {
      snapshot.payment.amountMinor = 49999;
    }

    expect(evaluateRecoveryEligibility(snapshot)).toMatchObject({
      recoverable: false,
      reason: 'PAYMENT_AMOUNT_MISMATCH',
      recommendedEscalation: 'payment_operations',
    });
  });

  it('rejects recovery without a failed payment capture webhook', () => {
    const snapshot = createRecoverableSnapshot('ORD-TEST-NO-WEBHOOK');
    snapshot.webhookEvents = [];

    expect(evaluateRecoveryEligibility(snapshot)).toMatchObject({
      recoverable: false,
      reason: 'FAILED_CAPTURE_WEBHOOK_NOT_FOUND',
      recommendedEscalation: 'payment_operations',
    });
  });
});
