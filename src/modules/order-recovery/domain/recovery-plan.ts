import type { OrderSnapshot } from './order-snapshot.js';

export type RecoveryPlanStatus =
  | 'pending'
  | 'applied'
  | 'expired'
  | 'invalidated';

export interface PlannedInventoryReservation {
  orderItemId: string;
  sku: string;
  quantity: number;
}

export interface RecoveryPlannedChanges {
  localPayment: {
    from: 'pending';
    to: 'paid';
  };

  order: {
    from: 'awaiting_payment';
    to: 'ready_for_fulfillment';
  };

  fulfillment: {
    from: 'blocked_awaiting_payment';
    to: 'ready_to_fulfill';
  };

  inventoryReservations: PlannedInventoryReservation[];
}

export interface RecoveryPlan {
  id: string;

  orderId: string;
  orderNumber: string;

  expectedOrderVersion: number;

  status: RecoveryPlanStatus;
  plannedChanges: RecoveryPlannedChanges;

  createdAt: Date;
  expiresAt: Date;

  appliedAt: Date | null;
  invalidatedReason: string | null;
}

export interface CreateRecoveryPlanInput {
  orderId: string;
  orderNumber: string;
  expectedOrderVersion: number;
  plannedChanges: RecoveryPlannedChanges;
  expiresAt: Date;
}

export function buildRecoveryPlannedChanges(
  snapshot: OrderSnapshot,
): RecoveryPlannedChanges {
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

export function recoveryPlannedChangesMatch(
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
