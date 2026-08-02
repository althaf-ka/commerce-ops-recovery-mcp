import { asc, eq } from 'drizzle-orm';
import type { Database } from '../../../db/client.js';
import {
  fulfillments,
  inventory,
  inventoryReservations,
  orderItems,
  orders,
  processorPayments,
  webhookEvents,
} from '../../../db/schema.js';
import type { OrderSnapshot } from '../domain/order-snapshot.js';

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
