import { describe, expect, it } from 'vitest';
import type { Database } from '../../../../src/db/client.js';
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
} from '../../../../src/db/schema.js';
import type { ApplyRecoveryTransactionInput } from '../../../../src/modules/order-recovery/application/apply-recovery.js';
import { applyRecoveryTransaction } from '../../../../src/modules/order-recovery/infrastructure/order-recovery-repository.js';

interface IdempotencyRecordRow {
  requestHash: string;
  resultJson: Record<string, unknown>;
}

interface RecoveryPlanRow {
  id: string;
  orderId: string;
  expectedOrderVersion: number;
  status: 'pending' | 'applied' | 'expired' | 'invalidated';
  plannedChanges: Record<string, unknown>;
  expiresAt: Date;
}

interface FakeDatabaseOptions {
  failUpdateTable?: unknown;
  idempotencyReads?: IdempotencyRecordRow[][];
  plan?: RecoveryPlanRow;
  tableRows?: Map<unknown, unknown[]>;
}

function createFakeDatabase(options: FakeDatabaseOptions = {}) {
  const idempotencyReads = [...(options.idempotencyReads ?? [])];
  const updates: Array<Record<string, unknown>> = [];
  const inserts: Array<{ table: unknown; values: unknown }> = [];

  class SelectQuery implements PromiseLike<unknown[]> {
    private rows: unknown[] = [];

    from(table: unknown) {
      this.rows =
        table === idempotencyRecords
          ? (idempotencyReads.shift() ?? [])
          : table === recoveryPlans && options.plan
            ? [options.plan]
            : (options.tableRows?.get(table) ?? []);
      return this;
    }

    where() {
      return this;
    }

    limit() {
      return this;
    }

    orderBy() {
      return this;
    }

    for() {
      return Promise.resolve(this.rows);
    }

    // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are intentionally promise-like.
    then<TResult1 = unknown[], TResult2 = never>(
      onfulfilled?:
        | ((value: unknown[]) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?:
        | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
        | null,
    ): Promise<TResult1 | TResult2> {
      return Promise.resolve(this.rows).then(onfulfilled, onrejected);
    }
  }

  class MutationQuery implements PromiseLike<undefined> {
    constructor(private readonly table: unknown) {}

    where() {
      return this;
    }

    returning() {
      if (this.table === options.failUpdateTable) {
        return Promise.resolve([]);
      }

      return Promise.resolve([
        this.table === inventory
          ? { sku: 'SKU-DEMO' }
          : this.table === orders
            ? { id: 'order-123', version: 2 }
            : { id: 'updated' },
      ]);
    }

    // biome-ignore lint/suspicious/noThenProperty: Drizzle query builders are intentionally promise-like.
    then<TResult1 = undefined, TResult2 = never>(
      onfulfilled?:
        | ((value: undefined) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?:
        | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
        | null,
    ): Promise<TResult1 | TResult2> {
      return Promise.resolve(undefined).then(onfulfilled, onrejected);
    }
  }

  const transaction = async <Result>(
    operation: (tx: {
      select: () => SelectQuery;
      update: (table: unknown) => {
        set: (values: Record<string, unknown>) => MutationQuery;
      };
      insert: (table: unknown) => {
        values: (values: unknown) => Promise<void>;
      };
    }) => Promise<Result>,
  ) => {
    const pendingUpdates: Array<Record<string, unknown>> = [];
    const pendingInserts: Array<{ table: unknown; values: unknown }> = [];

    const result = await operation({
      select: () => new SelectQuery(),
      update: (table) => {
        return {
          set: (values) => {
            pendingUpdates.push(values);
            return new MutationQuery(table);
          },
        };
      },
      insert: (table) => {
        return {
          values: async (values) => {
            pendingInserts.push({ table, values });
          },
        };
      },
    });

    updates.push(...pendingUpdates);
    inserts.push(...pendingInserts);
    return result;
  };

  return {
    database: { transaction } as unknown as Database,
    inserts,
    updates,
  };
}

const input: ApplyRecoveryTransactionInput = {
  planId: 'plan-123',
  idempotencyKey: 'request-001',
  requestHash: 'request-hash',
  now: new Date('2026-08-05T12:00:00.000Z'),
};

const successfulResult = {
  applied: true,
  code: 'RECOVERY_APPLIED',
  planId: 'plan-123',
  orderNumber: 'ORD-DEMO-1042',
  orderVersion: 2,
  message: 'The approved recovery was applied successfully.',
  idempotentReplay: false,
  commerceStateChangedByThisInvocation: true,
} as const;

function createPlan(
  status: RecoveryPlanRow['status'],
  expiresAt = new Date('2026-08-05T12:15:00.000Z'),
): RecoveryPlanRow {
  return {
    id: 'plan-123',
    orderId: 'order-123',
    expectedOrderVersion: 1,
    status,
    plannedChanges: {},
    expiresAt,
  };
}

function createRecoverableTableRows(): Map<unknown, unknown[]> {
  return new Map<unknown, unknown[]>([
    [
      orders,
      [
        {
          id: 'order-123',
          orderNumber: 'ORD-DEMO-1042',
          localPaymentStatus: 'pending',
          orderStatus: 'awaiting_payment',
          version: 1,
        },
      ],
    ],
    [
      orderItems,
      [
        {
          id: 'item-123',
          sku: 'SKU-DEMO',
          quantity: 2,
          unitPriceMinor: 25000,
        },
      ],
    ],
    [inventory, [{ sku: 'SKU-DEMO', onHand: 10, reserved: 0 }]],
    [inventoryReservations, []],
    [
      processorPayments,
      [
        {
          id: 'payment-123',
          processorPaymentId: 'processor-payment-123',
          amountMinor: 50000,
          currency: 'INR',
          status: 'captured',
          capturedAt: new Date('2026-08-05T11:00:00.000Z'),
        },
      ],
    ],
    [
      webhookEvents,
      [
        {
          id: 'webhook-123',
          eventType: 'payment.captured',
          deliveryStatus: 'failed',
          errorMessage: 'Synthetic failure',
          receivedAt: new Date('2026-08-05T11:00:01.000Z'),
          processedAt: null,
        },
      ],
    ],
    [
      fulfillments,
      [
        {
          id: 'fulfillment-123',
          status: 'blocked_awaiting_payment',
          blockedReason: 'Local payment is pending',
        },
      ],
    ],
  ]);
}

function setExactPlannedChanges(plan: RecoveryPlanRow): void {
  plan.plannedChanges = {
    localPayment: { from: 'pending', to: 'paid' },
    order: {
      from: 'awaiting_payment',
      to: 'ready_for_fulfillment',
    },
    fulfillment: {
      from: 'blocked_awaiting_payment',
      to: 'ready_to_fulfill',
    },
    inventoryReservations: [
      { orderItemId: 'item-123', sku: 'SKU-DEMO', quantity: 2 },
    ],
  };
}

describe('applyRecoveryTransaction foundation', () => {
  it('replays a stored result for the same key and request hash', async () => {
    const { database, inserts, updates } = createFakeDatabase({
      idempotencyReads: [
        [{ requestHash: 'request-hash', resultJson: { ...successfulResult } }],
      ],
    });

    await expect(applyRecoveryTransaction(database, input)).resolves.toEqual({
      ...successfulResult,
      idempotentReplay: true,
      commerceStateChangedByThisInvocation: false,
    });
    expect(inserts).toEqual([]);
    expect(updates).toEqual([]);
  });

  it('rejects reuse of a key with a different request hash', async () => {
    const { database, inserts, updates } = createFakeDatabase({
      idempotencyReads: [
        [{ requestHash: 'another-hash', resultJson: { ...successfulResult } }],
      ],
    });

    await expect(
      applyRecoveryTransaction(database, input),
    ).resolves.toMatchObject({
      applied: false,
      code: 'IDEMPOTENCY_KEY_CONFLICT',
    });
    expect(inserts).toEqual([]);
    expect(updates).toEqual([]);
  });

  it('returns PLAN_NOT_FOUND when the locked plan does not exist', async () => {
    const { database } = createFakeDatabase({ idempotencyReads: [[]] });

    await expect(
      applyRecoveryTransaction(database, input),
    ).resolves.toMatchObject({
      applied: false,
      code: 'PLAN_NOT_FOUND',
    });
  });

  it('returns PLAN_ALREADY_APPLIED for an applied plan', async () => {
    const { database, inserts, updates } = createFakeDatabase({
      idempotencyReads: [[], []],
      plan: createPlan('applied'),
    });

    await expect(
      applyRecoveryTransaction(database, input),
    ).resolves.toMatchObject({
      applied: false,
      code: 'PLAN_ALREADY_APPLIED',
    });
    expect(inserts).toEqual([]);
    expect(updates).toEqual([]);
  });

  it('returns PLAN_NOT_PENDING for an invalidated plan', async () => {
    const { database } = createFakeDatabase({
      idempotencyReads: [[], []],
      plan: createPlan('invalidated'),
    });

    await expect(
      applyRecoveryTransaction(database, input),
    ).resolves.toMatchObject({
      applied: false,
      code: 'PLAN_NOT_PENDING',
    });
  });

  it('marks an expired pending plan as expired and returns PLAN_EXPIRED', async () => {
    const { database, updates } = createFakeDatabase({
      idempotencyReads: [[], []],
      plan: createPlan('pending', new Date('2026-08-05T11:59:59.000Z')),
    });

    await expect(
      applyRecoveryTransaction(database, input),
    ).resolves.toMatchObject({
      applied: false,
      code: 'PLAN_EXPIRED',
    });
    expect(updates).toEqual([{ status: 'expired' }]);
  });

  it('returns RECOVERY_NOT_ELIGIBLE when the locked order is missing', async () => {
    const { database } = createFakeDatabase({
      idempotencyReads: [[], []],
      plan: createPlan('pending'),
      tableRows: new Map(),
    });

    await expect(
      applyRecoveryTransaction(database, input),
    ).resolves.toMatchObject({
      applied: false,
      code: 'RECOVERY_NOT_ELIGIBLE',
    });
  });

  it('returns STALE_ORDER_VERSION before evaluating eligibility', async () => {
    const tableRows = createRecoverableTableRows();
    const [orderRow] = tableRows.get(orders) as Array<{ version: number }>;
    orderRow.version = 2;
    const { database } = createFakeDatabase({
      idempotencyReads: [[], []],
      plan: createPlan('pending'),
      tableRows,
    });

    await expect(
      applyRecoveryTransaction(database, input),
    ).resolves.toMatchObject({
      applied: false,
      code: 'STALE_ORDER_VERSION',
    });
  });

  it('re-evaluates eligibility using the locked snapshot', async () => {
    const tableRows = createRecoverableTableRows();
    const [orderRow] = tableRows.get(orders) as Array<{
      orderStatus: string;
    }>;
    orderRow.orderStatus = 'cancelled';
    const { database } = createFakeDatabase({
      idempotencyReads: [[], []],
      plan: createPlan('pending'),
      tableRows,
    });

    await expect(
      applyRecoveryTransaction(database, input),
    ).resolves.toMatchObject({
      applied: false,
      code: 'RECOVERY_NOT_ELIGIBLE',
      message: 'The order is no longer recoverable: ORDER_CANCELLED.',
    });
  });

  it('rejects approved changes that differ from the current exact plan', async () => {
    const plan = createPlan('pending');
    setExactPlannedChanges(plan);
    const reservations = plan.plannedChanges.inventoryReservations as Array<{
      quantity: number;
    }>;
    reservations[0].quantity = 1;
    const { database } = createFakeDatabase({
      idempotencyReads: [[], []],
      plan,
      tableRows: createRecoverableTableRows(),
    });

    await expect(
      applyRecoveryTransaction(database, input),
    ).resolves.toMatchObject({
      applied: false,
      code: 'PLANNED_CHANGES_MISMATCH',
    });
  });

  it('atomically applies the approved recovery and stores its evidence', async () => {
    const plan = createPlan('pending');
    setExactPlannedChanges(plan);
    const { database, inserts, updates } = createFakeDatabase({
      idempotencyReads: [[], []],
      plan,
      tableRows: createRecoverableTableRows(),
    });

    await expect(applyRecoveryTransaction(database, input)).resolves.toEqual(
      successfulResult,
    );
    expect(inserts.map(({ table }) => table)).toEqual([
      inventoryReservations,
      auditEvents,
      idempotencyRecords,
    ]);
    expect(updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          localPaymentStatus: 'paid',
          orderStatus: 'ready_for_fulfillment',
          version: 2,
        }),
        expect.objectContaining({
          status: 'ready_to_fulfill',
          blockedReason: null,
        }),
        expect.objectContaining({
          status: 'applied',
          appliedAt: input.now,
        }),
      ]),
    );
  });

  it('rolls back earlier writes when a later conditional update fails', async () => {
    const plan = createPlan('pending');
    setExactPlannedChanges(plan);
    const { database, inserts, updates } = createFakeDatabase({
      failUpdateTable: fulfillments,
      idempotencyReads: [[], []],
      plan,
      tableRows: createRecoverableTableRows(),
    });

    await expect(applyRecoveryTransaction(database, input)).rejects.toThrow(
      'The fulfillment record was not in the expected blocked state.',
    );
    expect(inserts).toEqual([]);
    expect(updates).toEqual([]);
  });
});
