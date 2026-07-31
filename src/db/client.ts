import { Client } from 'pg'
import type { Env } from '../env.js'

export type DatabaseOperation<Result> = (client: Client) => Promise<Result>

export async function withDatabaseClient<Result>(
  env: Env,
  operation: DatabaseOperation<Result>,
): Promise<Result> {
  const client = new Client({
    connectionString: env.HYPERDRIVE.connectionString,
    connectionTimeoutMillis: 3_000,
  })

  try {
    await client.connect()
    return await operation(client)
  } finally {
    await client.end()
  }
}
