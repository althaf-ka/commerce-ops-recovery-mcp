import assert from 'node:assert/strict'
import { Client } from 'pg'

const connectionString =
  process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE

if (!connectionString) {
  throw new Error(
    'CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE is required',
  )
}

const expectedTables = [
  'audit_events',
  'fulfillments',
  'idempotency_records',
  'inventory',
  'inventory_reservations',
  'order_items',
  'orders',
  'processor_payments',
  'recovery_plans',
  'webhook_events',
]

const expectedConstraints = [
  'audit_events_after_state_object_check',
  'audit_events_before_state_object_check',
  'audit_events_event_type_not_empty_check',
  'audit_events_order_id_orders_id_fk',
  'audit_events_pkey',
  'audit_events_plan_id_recovery_plans_id_fk',
  'audit_events_reason_not_empty_check',
  'fulfillments_blocked_reason_check',
  'fulfillments_order_id_orders_id_fk',
  'fulfillments_order_id_unique',
  'fulfillments_pkey',
  'fulfillments_status_check',
  'idempotency_records_key_not_empty_check',
  'idempotency_records_pkey',
  'idempotency_records_plan_id_recovery_plans_id_fk',
  'idempotency_records_request_hash_not_empty_check',
  'idempotency_records_result_object_check',
  'inventory_on_hand_nonnegative_check',
  'inventory_pkey',
  'inventory_reservations_order_item_id_unique',
  'inventory_reservations_order_item_id_order_items_id_fk',
  'inventory_reservations_pkey',
  'inventory_reservations_quantity_positive_check',
  'inventory_reserved_nonnegative_check',
  'inventory_reserved_not_above_on_hand_check',
  'inventory_sku_not_empty_check',
  'order_items_order_id_orders_id_fk',
  'order_items_pkey',
  'order_items_quantity_positive_check',
  'order_items_sku_inventory_sku_fk',
  'orders_local_payment_status_check',
  'orders_order_status_check',
  'orders_pkey',
  'orders_version_positive_check',
  'processor_payments_captured_at_check',
  'processor_payments_order_id_orders_id_fk',
  'processor_payments_pkey',
  'processor_payments_processor_id_not_empty_check',
  'processor_payments_processor_payment_id_unique',
  'processor_payments_status_check',
  'recovery_plans_applied_at_check',
  'recovery_plans_expected_version_positive_check',
  'recovery_plans_expiry_after_creation_check',
  'recovery_plans_order_id_orders_id_fk',
  'recovery_plans_pkey',
  'recovery_plans_planned_changes_object_check',
  'recovery_plans_status_check',
  'webhook_events_delivery_status_check',
  'webhook_events_event_type_not_empty_check',
  'webhook_events_failure_error_check',
  'webhook_events_payload_object_check',
  'webhook_events_pkey',
  'webhook_events_processor_payment_id_processor_payments_id_fk',
]

const client = new Client({
  connectionString,
  connectionTimeoutMillis: 10_000,
})

try {
  await client.connect()

  const tables = await client.query({
    text: `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `,
  })

  assert.deepEqual(
    tables.rows.map(({ table_name: tableName }) => tableName),
    expectedTables,
  )

  const inventoryColumns = await client.query({
    text: `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'inventory'
      ORDER BY ordinal_position
    `,
  })

  assert.deepEqual(
    inventoryColumns.rows.map(({ column_name: columnName }) => columnName),
    ['sku', 'on_hand', 'reserved'],
  )

  const constraints = await client.query({
    text: `
      SELECT constraint_name
      FROM information_schema.table_constraints
      WHERE table_schema = 'public'
        AND constraint_name !~ '^[0-9]+_.*_not_null$'
      ORDER BY constraint_name
    `,
  })

  assert.deepEqual(
    constraints.rows.map(
      ({ constraint_name: constraintName }) => constraintName,
    ),
    [...expectedConstraints].sort(),
  )

  console.log({
    event: 'commerce_schema_verified',
    tables: expectedTables.length,
    constraints: expectedConstraints.length,
  })
} finally {
  await client.end()
}
