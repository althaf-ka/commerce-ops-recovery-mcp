import type { OrderSnapshot } from './order-snapshot.js';

export type RecoveryReason =
  | 'RECOVERABLE'
  | 'ORDER_CANCELLED'
  | 'PAYMENT_NOT_FOUND'
  | 'PAYMENT_REFUNDED'
  | 'PAYMENT_DISPUTED'
  | 'PAYMENT_NOT_CAPTURED'
  | 'PAYMENT_AMOUNT_MISMATCH'
  | 'LOCAL_PAYMENT_NOT_PENDING'
  | 'FAILED_CAPTURE_WEBHOOK_NOT_FOUND'
  | 'RESERVATION_ALREADY_EXISTS'
  | 'INSUFFICIENT_INVENTORY'
  | 'FULFILLMENT_NOT_FOUND'
  | 'FULFILLMENT_ALREADY_STARTED'
  | 'INVALID_FULFILLMENT_STATE'
  | 'ALREADY_RECOVERED'
  | 'ORDER_HAS_NO_ITEMS';

export interface RecoveryEligibilityResult {
  recoverable: boolean;
  reason: RecoveryReason;
  evidence: string[];
  recommendedEscalation?: string;
}

function calculateOrderTotal(snapshot: OrderSnapshot): number {
  return snapshot.items.reduce(
    (total, item) => total + item.quantity * item.unitPriceMinor,
    0,
  );
}

function hasFailedCapturedPaymentWebhook(snapshot: OrderSnapshot): boolean {
  return snapshot.webhookEvents.some(
    (event) =>
      event.eventType === 'payment.captured' &&
      event.deliveryStatus === 'failed',
  );
}

function hasExistingReservation(snapshot: OrderSnapshot): boolean {
  return snapshot.items.some((item) => item.reservation !== null);
}

function hasInsufficientInventory(snapshot: OrderSnapshot): boolean {
  return snapshot.items.some(
    (item) => item.inventory.available < item.quantity,
  );
}

export function evaluateRecoveryEligibility(
  snapshot: OrderSnapshot,
): RecoveryEligibilityResult {
  const evidence: string[] = [];

  if (snapshot.order.orderStatus === 'cancelled') {
    return {
      recoverable: false,
      reason: 'ORDER_CANCELLED',
      evidence: ['The order is cancelled.'],
      recommendedEscalation: 'commerce_operations',
    };
  }

  if (!snapshot.payment) {
    return {
      recoverable: false,
      reason: 'PAYMENT_NOT_FOUND',
      evidence: ['No processor payment record exists for the order.'],
      recommendedEscalation: 'payment_operations',
    };
  }

  if (snapshot.payment.status === 'refunded') {
    return {
      recoverable: false,
      reason: 'PAYMENT_REFUNDED',
      evidence: ['The processor payment has been refunded.'],
      recommendedEscalation: 'payment_operations',
    };
  }

  if (snapshot.payment.status === 'disputed') {
    return {
      recoverable: false,
      reason: 'PAYMENT_DISPUTED',
      evidence: ['The processor payment is disputed.'],
      recommendedEscalation: 'payment_operations',
    };
  }

  if (!snapshot.fulfillment) {
    return {
      recoverable: false,
      reason: 'FULFILLMENT_NOT_FOUND',
      evidence: ['No fulfillment record exists for the order.'],
      recommendedEscalation: 'commerce_operations',
    };
  }

  if (
    snapshot.fulfillment.status === 'packing' ||
    snapshot.fulfillment.status === 'packed' ||
    snapshot.fulfillment.status === 'dispatched'
  ) {
    return {
      recoverable: false,
      reason: 'FULFILLMENT_ALREADY_STARTED',
      evidence: [
        `Fulfillment has already reached ${snapshot.fulfillment.status}.`,
      ],
      recommendedEscalation: 'warehouse_operations',
    };
  }

  const alreadyRecovered =
    snapshot.order.localPaymentStatus === 'paid' &&
    snapshot.order.orderStatus === 'ready_for_fulfillment' &&
    snapshot.fulfillment.status === 'ready_to_fulfill';

  if (alreadyRecovered) {
    return {
      recoverable: false,
      reason: 'ALREADY_RECOVERED',
      evidence: [
        'The local payment is already marked as paid.',
        'The order is already ready for fulfillment.',
        'Fulfillment is already ready to proceed.',
      ],
    };
  }

  if (snapshot.payment.status !== 'captured') {
    return {
      recoverable: false,
      reason: 'PAYMENT_NOT_CAPTURED',
      evidence: [`The processor payment status is ${snapshot.payment.status}.`],
      recommendedEscalation: 'payment_operations',
    };
  }

  evidence.push('The processor payment is captured.');

  if (!snapshot.payment.capturedAt) {
    return {
      recoverable: false,
      reason: 'PAYMENT_NOT_CAPTURED',
      evidence: [
        ...evidence,
        'The captured payment does not have a capture timestamp.',
      ],
      recommendedEscalation: 'payment_operations',
    };
  }

  if (snapshot.items.length === 0) {
    return {
      recoverable: false,
      reason: 'ORDER_HAS_NO_ITEMS',
      evidence: [...evidence, 'The order has no items.'],
      recommendedEscalation: 'commerce_operations',
    };
  }

  const orderTotalMinor = calculateOrderTotal(snapshot);

  if (snapshot.payment.amountMinor !== orderTotalMinor) {
    return {
      recoverable: false,
      reason: 'PAYMENT_AMOUNT_MISMATCH',
      evidence: [
        ...evidence,
        `The order total is ${orderTotalMinor} minor units.`,
        `The captured payment is ${snapshot.payment.amountMinor} minor units.`,
      ],
      recommendedEscalation: 'payment_operations',
    };
  }

  evidence.push(
    `The captured amount matches the order total of ${orderTotalMinor} ${snapshot.payment.currency}.`,
  );

  if (snapshot.order.localPaymentStatus !== 'pending') {
    return {
      recoverable: false,
      reason: 'LOCAL_PAYMENT_NOT_PENDING',
      evidence: [
        ...evidence,
        `The local payment status is ${snapshot.order.localPaymentStatus}.`,
      ],
    };
  }

  evidence.push('The local payment remains pending.');

  if (!hasFailedCapturedPaymentWebhook(snapshot)) {
    return {
      recoverable: false,
      reason: 'FAILED_CAPTURE_WEBHOOK_NOT_FOUND',
      evidence: [...evidence, 'No failed payment.captured webhook was found.'],
      recommendedEscalation: 'payment_operations',
    };
  }

  evidence.push('A payment.captured webhook failed.');

  if (hasExistingReservation(snapshot)) {
    return {
      recoverable: false,
      reason: 'RESERVATION_ALREADY_EXISTS',
      evidence: [
        ...evidence,
        'An inventory reservation already exists for the order.',
      ],
      recommendedEscalation: 'commerce_operations',
    };
  }

  evidence.push('No inventory reservation exists.');

  if (hasInsufficientInventory(snapshot)) {
    const insufficientItems = snapshot.items
      .filter((item) => item.inventory.available < item.quantity)
      .map(
        (item) =>
          `${item.sku}: required ${item.quantity}, available ${item.inventory.available}`,
      );

    return {
      recoverable: false,
      reason: 'INSUFFICIENT_INVENTORY',
      evidence: [...evidence, ...insufficientItems],
      recommendedEscalation: 'warehouse_operations',
    };
  }

  evidence.push('Sufficient inventory is available for every order item.');

  if (snapshot.fulfillment.status !== 'blocked_awaiting_payment') {
    return {
      recoverable: false,
      reason: 'INVALID_FULFILLMENT_STATE',
      evidence: [
        ...evidence,
        `Fulfillment is currently ${snapshot.fulfillment.status}.`,
      ],
      recommendedEscalation: 'commerce_operations',
    };
  }

  evidence.push('Fulfillment is blocked because the local payment is pending.');

  return {
    recoverable: true,
    reason: 'RECOVERABLE',
    evidence,
  };
}
