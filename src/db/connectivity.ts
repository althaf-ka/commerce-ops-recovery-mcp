import { withDatabase } from './client.js'
import type { Env } from '../env.js'

type ConnectivityRow = {
  connected: number
}

export async function checkDatabaseConnectivity(env: Env): Promise<1> {
  return withDatabase(env, async (client) => {
    const result = await client.query<ConnectivityRow>('SELECT 1 AS connected')

    if (result.rows[0]?.connected !== 1) {
      throw new Error('PostgreSQL connectivity check returned an invalid result')
    }

    return 1 as const
  })
}
