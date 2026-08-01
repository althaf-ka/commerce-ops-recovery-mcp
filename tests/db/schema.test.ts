import { readdir, readFile } from 'node:fs/promises';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import {
  inventory,
  inventoryReservations,
  orderItems,
  orders,
  processorPayments,
  schema,
  webhookEvents,
} from '../../src/db/schema.js';

describe('commerce schema', () => {
  it('includes the expected workflow tables', () => {
    expect(
      Object.values(schema)
        .map((table) => getTableConfig(table).name)
        .sort(),
    ).toEqual([
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

  it('exposes a unique readable order number', () => {
    const config = getTableConfig(orders);
    const orderNumberColumn = config.columns.find(
      (column) => column.name === 'order_number',
    );

    const hasColumnLevelUnique = orderNumberColumn?.isUnique === true;

    const hasTableLevelUnique = config.uniqueConstraints.some((constraint) =>
      constraint.columns.some((column) => column.name === 'order_number'),
    );

    expect(hasColumnLevelUnique || hasTableLevelUnique).toBe(true);
  });

  it('stores unit price and captured amount evidence', () => {
    const orderItemColumns = getTableConfig(orderItems).columns.map(
      (column) => column.name,
    );
    expect(orderItemColumns).toEqual(
      expect.arrayContaining(['unit_price_minor']),
    );
    expect(
      getTableConfig(orderItems).checks.map((constraint) => constraint.name),
    ).toEqual(
      expect.arrayContaining(['order_items_unit_price_nonnegative_check']),
    );

    const paymentColumns = getTableConfig(processorPayments).columns.map(
      (column) => column.name,
    );
    expect(paymentColumns).toEqual(
      expect.arrayContaining(['amount_minor', 'currency']),
    );
    expect(
      getTableConfig(processorPayments).checks.map(
        (constraint) => constraint.name,
      ),
    ).toEqual(
      expect.arrayContaining([
        'processor_payments_amount_positive_check',
        'processor_payments_currency_check',
      ]),
    );
  });

  it('links webhook events to payments through a payment_id foreign key', () => {
    const config = getTableConfig(webhookEvents);

    expect(config.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(['payment_id']),
    );
    expect(config.foreignKeys.map((key) => key.getName())).toContain(
      'webhook_events_payment_id_processor_payments_id_fk',
    );
  });

  it('prevents more than one reservation for an order item', () => {
    const config = getTableConfig(inventoryReservations);

    expect(
      config.uniqueConstraints.map((constraint) => constraint.getName()),
    ).toContain('inventory_reservations_order_item_id_unique');
  });

  it('keeps the required recovery and audit fields in migration history', async () => {
    const files = (await readdir('migrations'))
      .filter((file) => file.endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    if (files.length === 0) {
      throw new Error('No migration SQL files found in migrations/');
    }

    const migrationHistory = (
      await Promise.all(
        files.map((file) => readFile(`migrations/${file}`, 'utf8')),
      )
    ).join('\n');

    expect(migrationHistory).toContain('CREATE TABLE "recovery_plans"');
    expect(migrationHistory).toContain(
      '"expected_order_version" integer NOT NULL',
    );
    expect(migrationHistory).toContain('"planned_changes" jsonb NOT NULL');

    expect(migrationHistory).toContain('CREATE TABLE "idempotency_records"');
    expect(migrationHistory).toContain(
      '"idempotency_key" text PRIMARY KEY NOT NULL',
    );

    expect(migrationHistory).toContain('CREATE TABLE "audit_events"');
    expect(migrationHistory).toContain('"before_state" jsonb NOT NULL');
    expect(migrationHistory).toContain('"after_state" jsonb NOT NULL');
  });
});
