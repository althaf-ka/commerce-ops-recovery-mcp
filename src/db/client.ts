import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';
import type { Env } from '../env.js';

export type Database = NodePgDatabase;

export type DatabaseOperation<Result> = (client: Client) => Promise<Result>;

export async function withDatabaseClient<Result>(
  env: Env,
  operation: DatabaseOperation<Result>,
): Promise<Result> {
  const client = new Client({
    connectionString: env.HYPERDRIVE.connectionString,
  });

  try {
    await client.connect();
    return await operation(client);
  } finally {
    await client.end();
  }
}
