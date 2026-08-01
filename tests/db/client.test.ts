import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withDatabaseClient } from '../../src/db/client.js';
import type { Env } from '../../src/env.js';

const client = vi.hoisted(() => ({
  config: undefined as unknown,
  connect: vi.fn<() => Promise<void>>(),
  end: vi.fn<() => Promise<void>>(),
}));

vi.mock('pg', () => ({
  Client: class {
    constructor(config: unknown) {
      client.config = config;
    }

    connect = client.connect;
    end = client.end;
  },
}));

const env = {
  HYPERDRIVE: {
    connectionString: 'postgresql://hyperdrive.internal/database',
  } as Hyperdrive,
  CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE:
    'postgresql://hyperdrive.internal/database',
} satisfies Env;

describe('withDatabaseClient', () => {
  beforeEach(() => {
    client.config = undefined;
    client.connect.mockReset().mockResolvedValue();
    client.end.mockReset().mockResolvedValue();
  });

  it('connects, runs the operation, and closes the client', async () => {
    const operation = vi.fn().mockResolvedValue('result');

    await expect(withDatabaseClient(env, operation)).resolves.toBe('result');
    expect(client.config).toEqual({
      connectionString: env.HYPERDRIVE.connectionString,
    });
    expect(client.connect).toHaveBeenCalledOnce();
    expect(operation).toHaveBeenCalledOnce();
    expect(client.end).toHaveBeenCalledOnce();
  });

  it('closes the client when the operation fails', async () => {
    const operationError = new Error('operation failed');

    await expect(
      withDatabaseClient(env, async () => {
        throw operationError;
      }),
    ).rejects.toBe(operationError);

    expect(client.end).toHaveBeenCalledOnce();
  });
});
