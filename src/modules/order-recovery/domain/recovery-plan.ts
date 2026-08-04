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
