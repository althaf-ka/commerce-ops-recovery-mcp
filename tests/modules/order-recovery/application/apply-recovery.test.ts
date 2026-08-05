import { describe, expect, it, vi } from 'vitest';
import {
  type ApplyRecoveryTransactionInput,
  type ApplyRecoveryTransactionResult,
  createApplyRecovery,
} from '../../../../src/modules/order-recovery/application/apply-recovery.js';

describe('createApplyRecovery', () => {
  it('requires confirmation without hashing or starting a transaction', async () => {
    const applyRecoveryTransaction = vi.fn();
    const createRequestHash = vi.fn<(planId: string) => Promise<string>>();
    const applyRecovery = createApplyRecovery(
      { applyRecoveryTransaction },
      { createRequestHash },
    );

    await expect(
      applyRecovery({ planId: 'plan-1', approved: false }),
    ).resolves.toEqual({
      applied: false,
      code: 'CONFIRMATION_REQUIRED',
      planId: 'plan-1',
      message:
        'Explicit approval is required before the recovery plan can be applied.',
      idempotentReplay: false,
      commerceStateChangedByThisInvocation: false,
    });
    expect(createRequestHash).not.toHaveBeenCalled();
    expect(applyRecoveryTransaction).not.toHaveBeenCalled();
  });

  it('delegates an approved request with its hash and a single timestamp', async () => {
    const transactionResult: ApplyRecoveryTransactionResult = {
      applied: true,
      code: 'RECOVERY_APPLIED',
      planId: 'plan-1',
      orderNumber: 'ORD-DEMO-1042',
      orderVersion: 2,
      message: 'The approved recovery was applied successfully.',
      idempotentReplay: false,
      commerceStateChangedByThisInvocation: true,
    };
    const applyRecoveryTransaction = vi.fn(async () => transactionResult);
    const createRequestHash = vi.fn(async () => 'request-hash');
    const currentTime = new Date('2026-01-01T00:10:00.000Z');
    const now = vi.fn(() => currentTime);
    const applyRecovery = createApplyRecovery(
      { applyRecoveryTransaction },
      { createRequestHash, now },
    );

    await expect(
      applyRecovery({
        planId: 'plan-1',
        approved: true,
        idempotencyKey: '  idempotency-key-1  ',
      }),
    ).resolves.toBe(transactionResult);
    expect(createRequestHash).toHaveBeenCalledWith('plan-1');
    expect(now).toHaveBeenCalledOnce();
    expect(applyRecoveryTransaction).toHaveBeenCalledWith({
      planId: 'plan-1',
      idempotencyKey: 'idempotency-key-1',
      requestHash: 'request-hash',
      now: currentTime,
    });
  });

  it('rejects an empty idempotency key before hashing or transacting', async () => {
    const applyRecoveryTransaction = vi.fn();
    const createRequestHash = vi.fn<(planId: string) => Promise<string>>();
    const applyRecovery = createApplyRecovery(
      { applyRecoveryTransaction },
      { createRequestHash },
    );

    await expect(
      applyRecovery({
        planId: 'plan-1',
        approved: true,
        idempotencyKey: '   ',
      }),
    ).rejects.toThrow(new TypeError('Idempotency key must not be empty.'));
    expect(createRequestHash).not.toHaveBeenCalled();
    expect(applyRecoveryTransaction).not.toHaveBeenCalled();
  });

  it('creates stable operation-scoped hashes that differ by plan', async () => {
    const applyRecoveryTransaction = vi.fn<
      (
        input: ApplyRecoveryTransactionInput,
      ) => Promise<ApplyRecoveryTransactionResult>
    >(async ({ planId }) => ({
      applied: false,
      code: 'PLAN_NOT_FOUND',
      planId,
      message: 'Plan not found.',
      idempotentReplay: false,
      commerceStateChangedByThisInvocation: false,
    }));
    const applyRecovery = createApplyRecovery({ applyRecoveryTransaction });

    await applyRecovery({
      planId: 'plan-A',
      approved: true,
      idempotencyKey: 'key-A',
    });
    await applyRecovery({
      planId: 'plan-A',
      approved: true,
      idempotencyKey: 'key-B',
    });
    await applyRecovery({
      planId: 'plan-B',
      approved: true,
      idempotencyKey: 'key-C',
    });

    const firstHash = applyRecoveryTransaction.mock.calls[0][0].requestHash;
    const secondHash = applyRecoveryTransaction.mock.calls[1][0].requestHash;
    const differentPlanHash =
      applyRecoveryTransaction.mock.calls[2][0].requestHash;

    expect(firstHash).toMatch(/^[a-f0-9]{64}$/);
    expect(secondHash).toBe(firstHash);
    expect(differentPlanHash).not.toBe(firstHash);
  });
});
