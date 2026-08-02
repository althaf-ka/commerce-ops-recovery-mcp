export type LocalPaymentStatus = 'pending' | 'paid';

export type OrderStatus =
  | 'awaiting_payment'
  | 'ready_for_fulfillment'
  | 'cancelled';

export type ProcessorPaymentStatus =
  | 'authorized'
  | 'captured'
  | 'voided'
  | 'refunded'
  | 'disputed'
  | 'failed';

export type WebhookDeliveryStatus = 'pending' | 'processed' | 'failed';

export type FulfillmentStatus =
  | 'blocked_awaiting_payment'
  | 'ready_to_fulfill'
  | 'packing'
  | 'packed'
  | 'dispatched'
  | 'cancelled';

export interface InventorySnapshot {
  onHand: number;
  reserved: number;
  available: number;
}

export interface InventoryReservationSnapshot {
  id: string;
  quantity: number;
}

export interface OrderItemSnapshot {
  id: string;
  sku: string;
  quantity: number;
  unitPriceMinor: number;

  inventory: InventorySnapshot;

  reservation: InventoryReservationSnapshot | null;
}

export interface ProcessorPaymentSnapshot {
  id: string;
  processorPaymentId: string;
  amountMinor: number;
  currency: string;
  status: ProcessorPaymentStatus;
  capturedAt: Date | null;
}

export interface WebhookEventSnapshot {
  id: string;
  eventType: string;
  deliveryStatus: WebhookDeliveryStatus;
  errorMessage: string | null;
  receivedAt: Date;
  processedAt: Date | null;
}

export interface FulfillmentSnapshot {
  id: string;
  status: FulfillmentStatus;
  blockedReason: string | null;
}

export interface OrderSnapshot {
  order: {
    id: string;
    orderNumber: string;
    localPaymentStatus: LocalPaymentStatus;
    orderStatus: OrderStatus;
    version: number;
  };

  items: OrderItemSnapshot[];

  payment: ProcessorPaymentSnapshot | null;

  webhookEvents: WebhookEventSnapshot[];

  fulfillment: FulfillmentSnapshot | null;
}
