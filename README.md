# Commerce Operations Recovery MCP

A remotely hosted MCP server that helps commerce operations investigate
and safely recover an order left inconsistent after a captured-payment
webhook failure.

## Planned workflow

1. Investigate an order using an order ID.
2. Review payment, webhook, inventory, and fulfillment evidence.
3. Prepare an exact recovery plan.
4. Require explicit operator approval.
5. Apply the approved recovery atomically.
6. Verify the final state and durable audit history.

## Recovery eligibility

Recovery is allowed only when:

- Synthetic payment evidence shows the payment was captured.
- The local order still shows payment pending.
- The payment webhook failed.
- Sufficient inventory exists and no reservation has already been created.
- The order is not cancelled, refunded, disputed, packed, or dispatched.

## Allowed recovery actions

- Mark the local order payment as paid.
- Reserve the exact ordered inventory.
- Move the order to ready for fulfillment.
- Move blocked pre-dispatch fulfillment to ready.
- Record reconciliation, audit, and idempotency results.

## Safety boundary

The MCP never:

- Captures, retries, voids, or refunds payments.
- Changes physical on-hand inventory.
- Changes order-item quantities.
- Modifies packed or dispatched fulfillment.
- Executes arbitrary SQL or arbitrary status updates.

## Local development

Start the Worker:

```sh
pnpm dev
```

The Worker exposes two separate routes on the same origin:

- `GET /health` for deployment and monitoring checks.
- `GET /health/database` for the fixed PostgreSQL connectivity check.
- `/mcp` for Streamable HTTP MCP clients.

For local database development, copy the environment template:

```sh
cp .env.example .env
```

Set `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` in the new
file to a direct (non-pooled) Neon connection string with
`sslmode=require`, then start the Worker:

```sh
pnpm dev
```

The `.env` file is ignored by Git. `pnpm dev` loads it into the Wrangler
process, which uses the connection string to emulate the `HYPERDRIVE`
binding. Local mode connects directly to PostgreSQL, so Hyperdrive pooling
and query caching do not run locally.

Verify the database path:

```sh
curl http://localhost:8787/health/database
```

The endpoint runs only `SELECT 1 AS connected`; it does not accept SQL from
the request. Deployed traffic uses the cache-disabled `HYPERDRIVE` binding.

To test the actual Cloudflare Hyperdrive configuration without deploying,
use remote development:

```sh
pnpm dev:remote
```

Remote development runs the Worker on Cloudflare and uses the hosted Neon
database, so treat it like a production-data connection.

Inspect the MCP tools from another terminal:

```sh
pnpm dlx @modelcontextprotocol/inspector@latest \
  --cli http://localhost:8787/mcp \
  --transport http \
  --method tools/list
```
