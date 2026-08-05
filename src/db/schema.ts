import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const timestampConfig = {
  mode: 'date',
  precision: 3,
  withTimezone: true,
} as const;

export const orders = pgTable(
  'orders',
  {
    id: uuid().defaultRandom().primaryKey(),
    orderNumber: text('order_number').notNull().unique(),
    localPaymentStatus: text('local_payment_status', {
      enum: ['pending', 'paid'],
    })
      .notNull()
      .default('pending'),
    orderStatus: text('order_status', {
      enum: ['awaiting_payment', 'ready_for_fulfillment', 'cancelled'],
    })
      .notNull()
      .default('awaiting_payment'),
    version: integer().notNull().default(1),
    createdAt: timestamp('created_at', timestampConfig).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', timestampConfig).notNull().defaultNow(),
  },
  (table) => [
    check(
      'orders_local_payment_status_check',
      sql`${table.localPaymentStatus} in ('pending', 'paid')`,
    ),
    check(
      'orders_order_status_check',
      sql`${table.orderStatus} in (
        'awaiting_payment',
        'ready_for_fulfillment',
        'cancelled'
      )`,
    ),
    check('orders_version_positive_check', sql`${table.version} > 0`),
    check(
      'orders_order_number_not_empty_check',
      sql`length(${table.orderNumber}) > 0`,
    ),
    check(
      'orders_workflow_state_check',
      sql`(
        ${table.orderStatus} = 'awaiting_payment'
        and ${table.localPaymentStatus} = 'pending'
      ) or (
        ${table.orderStatus} = 'ready_for_fulfillment'
        and ${table.localPaymentStatus} = 'paid'
      ) or (
        ${table.orderStatus} = 'cancelled'
      )`,
    ),
  ],
);

export const inventory = pgTable(
  'inventory',
  {
    sku: text().primaryKey(),
    onHand: integer('on_hand').notNull(),
    reserved: integer().notNull().default(0),
  },
  (table) => [
    check('inventory_sku_not_empty_check', sql`length(${table.sku}) > 0`),
    check('inventory_on_hand_nonnegative_check', sql`${table.onHand} >= 0`),
    check('inventory_reserved_nonnegative_check', sql`${table.reserved} >= 0`),
    check(
      'inventory_reserved_not_above_on_hand_check',
      sql`${table.reserved} <= ${table.onHand}`,
    ),
  ],
);

export const orderItems = pgTable(
  'order_items',
  {
    id: uuid().defaultRandom().primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    sku: text()
      .notNull()
      .references(() => inventory.sku, { onDelete: 'restrict' }),
    quantity: integer().notNull(),
    unitPriceMinor: integer('unit_price_minor').notNull(),
    createdAt: timestamp('created_at', timestampConfig).notNull().defaultNow(),
  },
  (table) => [
    index('order_items_order_id_idx').on(table.orderId),
    index('order_items_sku_idx').on(table.sku),
    check('order_items_quantity_positive_check', sql`${table.quantity} > 0`),
    check(
      'order_items_unit_price_nonnegative_check',
      sql`${table.unitPriceMinor} >= 0`,
    ),
  ],
);

export const processorPayments = pgTable(
  'processor_payments',
  {
    id: uuid().defaultRandom().primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    processorPaymentId: text('processor_payment_id').notNull().unique(),
    amountMinor: integer('amount_minor').notNull(),
    currency: text().notNull(),
    status: text({
      enum: [
        'authorized',
        'captured',
        'voided',
        'refunded',
        'disputed',
        'failed',
      ],
    }).notNull(),
    capturedAt: timestamp('captured_at', timestampConfig),
    createdAt: timestamp('created_at', timestampConfig).notNull().defaultNow(),
  },
  (table) => [
    unique('processor_payments_order_id_unique').on(table.orderId),
    check(
      'processor_payments_processor_id_not_empty_check',
      sql`length(${table.processorPaymentId}) > 0`,
    ),
    check(
      'processor_payments_status_check',
      sql`${table.status} in (
        'authorized',
        'captured',
        'voided',
        'refunded',
        'disputed',
        'failed'
      )`,
    ),
    check(
      'processor_payments_captured_at_check',
      sql`${table.status} not in ('captured', 'refunded', 'disputed')
        or ${table.capturedAt} is not null`,
    ),
    check(
      'processor_payments_amount_positive_check',
      sql`${table.amountMinor} > 0`,
    ),
    check(
      'processor_payments_currency_check',
      sql`${table.currency} ~ '^[A-Z]{3}$'`,
    ),
  ],
);

export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: uuid().defaultRandom().primaryKey(),
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => processorPayments.id, { onDelete: 'restrict' }),
    eventType: text('event_type').notNull(),
    deliveryStatus: text('delivery_status', {
      enum: ['pending', 'processed', 'failed'],
    }).notNull(),
    payload: jsonb().$type<Record<string, unknown>>().notNull(),
    errorMessage: text('error_message'),
    receivedAt: timestamp('received_at', timestampConfig)
      .notNull()
      .defaultNow(),
    processedAt: timestamp('processed_at', timestampConfig),
  },
  (table) => [
    index('webhook_events_payment_id_idx').on(table.paymentId),
    check(
      'webhook_events_event_type_not_empty_check',
      sql`length(${table.eventType}) > 0`,
    ),
    check(
      'webhook_events_delivery_status_check',
      sql`${table.deliveryStatus} in ('pending', 'processed', 'failed')`,
    ),
    check(
      'webhook_events_payload_object_check',
      sql`jsonb_typeof(${table.payload}) = 'object'`,
    ),
    check(
      'webhook_events_failure_error_check',
      sql`${table.deliveryStatus} <> 'failed' or ${table.errorMessage} is not null`,
    ),
  ],
);

export const inventoryReservations = pgTable(
  'inventory_reservations',
  {
    id: uuid().defaultRandom().primaryKey(),
    orderItemId: uuid('order_item_id')
      .notNull()
      .references(() => orderItems.id, { onDelete: 'restrict' }),
    quantity: integer().notNull(),
    createdAt: timestamp('created_at', timestampConfig).notNull().defaultNow(),
  },
  (table) => [
    unique('inventory_reservations_order_item_id_unique').on(table.orderItemId),
    check(
      'inventory_reservations_quantity_positive_check',
      sql`${table.quantity} > 0`,
    ),
  ],
);

export const fulfillments = pgTable(
  'fulfillments',
  {
    id: uuid().defaultRandom().primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    status: text({
      enum: [
        'blocked_awaiting_payment',
        'ready_to_fulfill',
        'packing',
        'packed',
        'dispatched',
        'cancelled',
      ],
    }).notNull(),
    blockedReason: text('blocked_reason'),
    createdAt: timestamp('created_at', timestampConfig).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', timestampConfig).notNull().defaultNow(),
  },
  (table) => [
    unique('fulfillments_order_id_unique').on(table.orderId),
    check(
      'fulfillments_status_check',
      sql`${table.status} in (
        'blocked_awaiting_payment',
        'ready_to_fulfill',
        'packing',
        'packed',
        'dispatched',
        'cancelled'
      )`,
    ),
    check(
      'fulfillments_blocked_reason_check',
      sql`(
        ${table.status} = 'blocked_awaiting_payment'
        and ${table.blockedReason} is not null
      ) or (
        ${table.status} <> 'blocked_awaiting_payment'
        and ${table.blockedReason} is null
      )`,
    ),
  ],
);

export const recoveryPlans = pgTable(
  'recovery_plans',
  {
    id: uuid().defaultRandom().primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    expectedOrderVersion: integer('expected_order_version').notNull(),
    status: text({
      enum: ['pending', 'applied', 'expired', 'invalidated'],
    })
      .notNull()
      .default('pending'),
    plannedChanges: jsonb('planned_changes')
      .$type<Record<string, unknown>>()
      .notNull(),
    invalidatedReason: text('invalidated_reason'),
    createdAt: timestamp('created_at', timestampConfig).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', timestampConfig).notNull(),
    appliedAt: timestamp('applied_at', timestampConfig),
  },
  (table) => [
    uniqueIndex('recovery_plans_one_pending_per_order_idx')
      .on(table.orderId)
      .where(sql`${table.status} = 'pending'`),
    index('recovery_plans_order_id_status_idx').on(table.orderId, table.status),
    check(
      'recovery_plans_expected_version_positive_check',
      sql`${table.expectedOrderVersion} > 0`,
    ),
    check(
      'recovery_plans_status_check',
      sql`${table.status} in ('pending', 'applied', 'expired', 'invalidated')`,
    ),
    check(
      'recovery_plans_invalidated_reason_check',
      sql`(
        ${table.status} = 'invalidated'
        and ${table.invalidatedReason} is not null
        and length(${table.invalidatedReason}) > 0
      ) or (
        ${table.status} <> 'invalidated'
        and ${table.invalidatedReason} is null
      )`,
    ),
    check(
      'recovery_plans_planned_changes_object_check',
      sql`jsonb_typeof(${table.plannedChanges}) = 'object'`,
    ),
    check(
      'recovery_plans_expiry_after_creation_check',
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    check(
      'recovery_plans_applied_at_check',
      sql`(
        ${table.status} = 'applied' and ${table.appliedAt} is not null
      ) or (
        ${table.status} <> 'applied' and ${table.appliedAt} is null
      )`,
    ),
  ],
);

export const idempotencyRecords = pgTable(
  'idempotency_records',
  {
    idempotencyKey: text('idempotency_key').primaryKey(),
    planId: uuid('plan_id')
      .notNull()
      .references(() => recoveryPlans.id, { onDelete: 'restrict' }),
    requestHash: text('request_hash').notNull(),
    resultJson: jsonb('result_json').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', timestampConfig).notNull().defaultNow(),
  },
  (table) => [
    index('idempotency_records_plan_id_idx').on(table.planId),
    check(
      'idempotency_records_key_not_empty_check',
      sql`length(${table.idempotencyKey}) > 0`,
    ),
    check(
      'idempotency_records_request_hash_not_empty_check',
      sql`length(${table.requestHash}) > 0`,
    ),
    check(
      'idempotency_records_result_object_check',
      sql`jsonb_typeof(${table.resultJson}) = 'object'`,
    ),
  ],
);

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid().defaultRandom().primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    planId: uuid('plan_id')
      .notNull()
      .references(() => recoveryPlans.id, { onDelete: 'restrict' }),
    eventType: text('event_type').notNull(),
    beforeState: jsonb('before_state')
      .$type<Record<string, unknown>>()
      .notNull(),
    afterState: jsonb('after_state').$type<Record<string, unknown>>().notNull(),
    reason: text().notNull(),
    createdAt: timestamp('created_at', timestampConfig).notNull().defaultNow(),
  },
  (table) => [
    index('audit_events_order_id_created_at_idx').on(
      table.orderId,
      table.createdAt,
    ),
    index('audit_events_plan_id_idx').on(table.planId),
    check(
      'audit_events_event_type_not_empty_check',
      sql`length(${table.eventType}) > 0`,
    ),
    check(
      'audit_events_before_state_object_check',
      sql`jsonb_typeof(${table.beforeState}) = 'object'`,
    ),
    check(
      'audit_events_after_state_object_check',
      sql`jsonb_typeof(${table.afterState}) = 'object'`,
    ),
    check(
      'audit_events_reason_not_empty_check',
      sql`length(${table.reason}) > 0`,
    ),
  ],
);

export const schema = {
  auditEvents,
  fulfillments,
  idempotencyRecords,
  inventory,
  inventoryReservations,
  orderItems,
  orders,
  processorPayments,
  recoveryPlans,
  webhookEvents,
};
