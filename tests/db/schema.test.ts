import { readFile } from 'node:fs/promises';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import {
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
} from '../../src/db/schema.js';

const tables = [
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
];

describe('commerce schema', () => {
  it('declares exactly the workflow tables', () => {
    expect(tables.map((table) => getTableConfig(table).name).sort()).toEqual([
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
    ]);
  });

  it('derives inventory availability instead of storing it', () => {
    const config = getTableConfig(inventory);

    expect(config.columns.map((column) => column.name)).toEqual([
      'sku',
      'on_hand',
      'reserved',
    ]);
    expect(config.checks.map((constraint) => constraint.name)).toEqual(
      expect.arrayContaining([
        'inventory_on_hand_nonnegative_check',
        'inventory_reserved_nonnegative_check',
        'inventory_reserved_not_above_on_hand_check',
      ]),
    );
  });

  it('prevents more than one reservation for an order item', () => {
    const config = getTableConfig(inventoryReservations);

    expect(
      config.uniqueConstraints.map((constraint) => constraint.getName()),
    ).toContain('inventory_reservations_order_item_id_unique');
  });

  it('keeps the required recovery and audit fields in the migration', async () => {
    const migration = await readFile('migrations/0001_initial.sql', 'utf8');

    expect(migration).toContain('CREATE TABLE "recovery_plans"');
    expect(migration).toContain('"expected_order_version" integer NOT NULL');
    expect(migration).toContain('"planned_changes" jsonb NOT NULL');
    expect(migration).toContain('CREATE TABLE "idempotency_records"');
    expect(migration).toContain('"idempotency_key" text PRIMARY KEY NOT NULL');
    expect(migration).toContain('CREATE TABLE "audit_events"');
    expect(migration).toContain('"before_state" jsonb NOT NULL');
    expect(migration).toContain('"after_state" jsonb NOT NULL');
  });
});
