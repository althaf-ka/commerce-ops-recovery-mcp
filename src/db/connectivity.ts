import type { Env } from '../env.js';
import { withDatabaseClient } from './client.js';

export async function checkDatabaseConnectivity(env: Env): Promise<boolean> {
  return withDatabaseClient(env, async (client) => {
    await client.query('SELECT 1');
    return true;
  });
}
