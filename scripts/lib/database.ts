import { drizzle } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';
import type { Database } from '../../src/db/client.js';

export async function withScriptDatabase<Result>(
  operation: (database: Database) => Promise<Result>,
): Promise<Result> {
  const connectionString =
    process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE ??
    process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      'CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE or DATABASE_URL is required.',
    );
  }

  const client = new Client({ connectionString });

  try {
    await client.connect();
    return await operation(drizzle(client));
  } finally {
    await client.end();
  }
}
