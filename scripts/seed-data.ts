export const demoTimestamp = '2026-01-15T10:42:00.000Z';

export const demoScenarios = {
  recoverable: {
    order: {
      id: '00000000-0000-4000-8000-000000001042',
      orderNumber: 'ORD-DEMO-1042',
      localPaymentStatus: 'pending',
      orderStatus: 'awaiting_payment',
      version: 1,
    },
    inventory: {
      sku: 'DEMO-KEYBOARD-1042',
      onHand: 10,
      reserved: 0,
    },
    orderItem: {
      id: '00000000-0000-4000-8000-000000011042',
      orderId: '00000000-0000-4000-8000-000000001042',
      sku: 'DEMO-KEYBOARD-1042',
      quantity: 2,
      unitPriceMinor: 25_000,
    },
    payment: {
      id: '00000000-0000-4000-8000-000000021042',
      orderId: '00000000-0000-4000-8000-000000001042',
      processorPaymentId: 'pay_demo_1042',
      amountMinor: 50_000,
      currency: 'INR',
      status: 'captured',
    },
    webhook: {
      id: '00000000-0000-4000-8000-000000031042',
      paymentId: '00000000-0000-4000-8000-000000021042',
      eventType: 'payment.captured',
      deliveryStatus: 'failed',
      payload: {
        paymentId: 'pay_demo_1042',
        orderNumber: 'ORD-DEMO-1042',
        status: 'captured',
      },
      errorMessage: 'Database timeout while updating the local order',
      processedAt: null,
    },
    fulfillment: {
      id: '00000000-0000-4000-8000-000000041042',
      orderId: '00000000-0000-4000-8000-000000001042',
      status: 'blocked_awaiting_payment',
      blockedReason: 'local_payment_pending',
    },
  },
  insufficientInventory: {
    order: {
      id: '00000000-0000-4000-8000-000000002042',
      orderNumber: 'ORD-DEMO-2042',
      localPaymentStatus: 'pending',
      orderStatus: 'awaiting_payment',
      version: 1,
    },
    inventory: {
      sku: 'DEMO-HEADSET-2042',
      onHand: 1,
      reserved: 0,
    },
    orderItem: {
      id: '00000000-0000-4000-8000-000000012042',
      orderId: '00000000-0000-4000-8000-000000002042',
      sku: 'DEMO-HEADSET-2042',
      quantity: 3,
      unitPriceMinor: 30_000,
    },
    payment: {
      id: '00000000-0000-4000-8000-000000022042',
      orderId: '00000000-0000-4000-8000-000000002042',
      processorPaymentId: 'pay_demo_2042',
      amountMinor: 90_000,
      currency: 'INR',
      status: 'captured',
    },
    webhook: {
      id: '00000000-0000-4000-8000-000000032042',
      paymentId: '00000000-0000-4000-8000-000000022042',
      eventType: 'payment.captured',
      deliveryStatus: 'failed',
      payload: {
        paymentId: 'pay_demo_2042',
        orderNumber: 'ORD-DEMO-2042',
        status: 'captured',
      },
      errorMessage: 'Local order update failed',
      processedAt: null,
    },
    fulfillment: {
      id: '00000000-0000-4000-8000-000000042042',
      orderId: '00000000-0000-4000-8000-000000002042',
      status: 'blocked_awaiting_payment',
      blockedReason: 'local_payment_pending',
    },
  },
  alreadyRecovered: {
    order: {
      id: '00000000-0000-4000-8000-000000003042',
      orderNumber: 'ORD-DEMO-3042',
      localPaymentStatus: 'paid',
      orderStatus: 'ready_for_fulfillment',
      version: 2,
    },
    inventory: {
      sku: 'DEMO-MOUSE-3042',
      onHand: 10,
      reserved: 1,
    },
    orderItem: {
      id: '00000000-0000-4000-8000-000000013042',
      orderId: '00000000-0000-4000-8000-000000003042',
      sku: 'DEMO-MOUSE-3042',
      quantity: 1,
      unitPriceMinor: 15_000,
    },
    payment: {
      id: '00000000-0000-4000-8000-000000023042',
      orderId: '00000000-0000-4000-8000-000000003042',
      processorPaymentId: 'pay_demo_3042',
      amountMinor: 15_000,
      currency: 'INR',
      status: 'captured',
    },
    webhook: {
      id: '00000000-0000-4000-8000-000000033042',
      paymentId: '00000000-0000-4000-8000-000000023042',
      eventType: 'payment.captured',
      deliveryStatus: 'failed',
      payload: {
        paymentId: 'pay_demo_3042',
        orderNumber: 'ORD-DEMO-3042',
        status: 'captured',
      },
      errorMessage: 'Original webhook processing failed',
      processedAt: null,
    },
    reservation: {
      id: '00000000-0000-4000-8000-000000053042',
      orderItemId: '00000000-0000-4000-8000-000000013042',
      quantity: 1,
    },
    fulfillment: {
      id: '00000000-0000-4000-8000-000000043042',
      orderId: '00000000-0000-4000-8000-000000003042',
      status: 'ready_to_fulfill',
      blockedReason: null,
    },
  },
} as const;

export const demoOrderNumbers = Object.values(demoScenarios).map(
  ({ order }) => order.orderNumber,
);

export const demoSkus = Object.values(demoScenarios).map(
  ({ inventory }) => inventory.sku,
);
