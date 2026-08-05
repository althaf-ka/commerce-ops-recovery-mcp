# Commerce Operations Recovery MCP

A remotely hosted TypeScript MCP server for safely recovering a specific
commerce failure where a processor payment was captured, but the local order
remained blocked because its webhook failed.

The server investigates the current state, prepares an exact recovery plan,
waits for approval, and applies the approved changes in one PostgreSQL
transaction.

## Live MCP demo

**Base URL:**
[https://commerce-ops-recovery-mcp.demostore.workers.dev](https://commerce-ops-recovery-mcp.demostore.workers.dev)

| Route              | Purpose                          |
| ------------------ | -------------------------------- |
| `/`                | Service information              |
| `/mcp`             | Remote Streamable HTTP endpoint  |
| `/health`          | Worker health check              |
| `/health/database` | PostgreSQL connectivity check    |

The `/mcp` route is a protocol endpoint, so opening it directly in a browser
may return `Method Not Allowed`. Connect through Claude, MCP Inspector, or
another compatible remote MCP client.

### Claude custom connector

In Claude, open **Customize → Connectors**, add a custom connector, and use:

```text
Name: Commerce Operations Recovery
URL: https://commerce-ops-recovery-mcp.demostore.workers.dev/mcp
```

Enable the connector in a new conversation, then try:

```text
Use the Commerce Operations Recovery connector.

First call get_demo_guide. Then investigate ORD-DEMO-1043 and explain whether
it is eligible for recovery.

Do not apply any recovery until I explicitly approve it.
```

### MCP Inspector

Launch MCP Inspector:

```sh
npx @modelcontextprotocol/inspector
```

Select **Streamable HTTP**, enter the deployed `/mcp` URL above, connect, and
select **List Tools**. Start with `get_demo_guide`, especially if another
reviewer may already have changed the public demo state.

The service uses synthetic commerce data and does not contact real payment or
fulfillment providers. Public demo state is mutable, so a successfully
recovered order may later appear as already recovered.

## Tech stack

- TypeScript
- Cloudflare Workers
- Hono
- Cloudflare Agents SDK for MCP
- Model Context Protocol
- PostgreSQL
- Drizzle ORM
- Cloudflare Hyperdrive
- Zod
- Vitest

The application runs on Cloudflare Workers. Hono handles `/health`,
`/health/database`, and `/mcp`, while Cloudflare's `createMcpHandler` exposes
the MCP server through Streamable HTTP.

Node.js and pnpm are used for local scripts, tests, database migrations, and
development tooling. The application itself is not hosted as a traditional
Node.js server.

## MCP tools

- `get_demo_guide` — shows the workflow, database availability, repository
  link, and mutable demo orders.
- `investigate_order` — checks current order, payment, webhook, inventory,
  reservation, and fulfillment state without making changes.
- `prepare_recovery_plan` — creates or reuses an expiring record containing
  the exact proposed changes.
- `apply_recovery` — applies an explicitly approved plan atomically and
  idempotently.

## Setup

Install dependencies:

```sh
pnpm install
```

Copy the local environment template:

```sh
cp .env.example .env
```

Set a direct PostgreSQL connection string in
`CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE`. The example uses
`sslmode=verify-full` so TLS certificate and hostname verification remain
explicit across upcoming `pg` releases.

`PROJECT_REPOSITORY_URL` is optional. Configure it as a normal public Worker
variable to expose the repository link through `get_demo_guide`; the guide
returns `null` when it is absent.

Run database migrations and verify the schema:

```sh
pnpm db:migrate
pnpm db:verify
```

Seed the scenarios on a database where they do not already exist:

```sh
pnpm db:seed
```

`db:seed` is intentionally non-destructive. It creates the complete scenario
set, makes no change when all four orders already exist, and reports a clear
conflict when only part of the set exists.

If the scenarios were changed during testing, deliberately restore them with:

```sh
pnpm db:reset-demo
```

The reset runs in one transaction and removes only the known synthetic demo
orders and their related plans, idempotency records, audit events,
reservations, webhook evidence, payments, fulfillment rows, items, and
dedicated inventory. It does not reset unrelated data.

Start the Worker locally:

```sh
pnpm dev
```

The local MCP endpoint is normally:

```text
http://localhost:8787/mcp
```

Use the URL printed by Wrangler if it is different.

## Demo orders

| Order           | Scenario                  | Purpose                                 |
| --------------- | ------------------------- | --------------------------------------- |
| `ORD-DEMO-1042` | Already recovered         | Verify safe no-op detection             |
| `ORD-DEMO-1043` | Primary eligible recovery | Full investigate → prepare → apply flow |
| `ORD-DEMO-1044` | Backup eligible recovery  | A second successful test opportunity    |
| `ORD-DEMO-1045` | Insufficient inventory    | Verify rejection without mutation       |

Demo orders are mutable. Start with `get_demo_guide` or call
`investigate_order` before preparing a plan because a successful application
changes an eligible order's state.

## Recovery flow

```text
investigate_order
→ prepare_recovery_plan
→ explicit approval
→ apply_recovery
```

The read-only guide is optional and helps reviewers discover the workflow:

```text
get_demo_guide
→ investigate_order
→ prepare_recovery_plan
→ apply_recovery
```

## Safety

The complete allowed/forbidden mutation contract is documented in
[Order Recovery Boundary](docs/order-recovery-boundary.md).

Before making changes, the server:

1. Validates approval and the idempotency request.
2. Checks for a completed idempotent request.
3. Locks the recovery plan.
4. Locks and reloads the latest commerce state.
5. Checks plan status, expiry, and order version.
6. Re-runs recovery eligibility.
7. Confirms that current changes exactly match the approved plan.
8. Applies every permitted change in one PostgreSQL transaction.

A successful recovery may:

- Mark the local payment as paid.
- Create the exact approved inventory reservations.
- Increase reserved inventory.
- Move the order and fulfillment forward.
- Increment the order version.
- Mark the plan as applied.
- Record audit and idempotency evidence.

It does not:

- Retry, capture, refund, or void the processor payment.
- Change physical on-hand inventory.
- Change order-item quantities.
- Modify packed or dispatched fulfillment.
- Contact a real payment processor or fulfillment provider.
- Execute arbitrary SQL or arbitrary status changes.

## Idempotency

An approved apply request requires a caller-provided idempotency key.

- Same key and same request → return the original result without repeating
  mutations.
- Same key used for different request data → `IDEMPOTENCY_KEY_CONFLICT`.
- Different key used against an applied plan → `PLAN_ALREADY_APPLIED`.

Reuse a key only when retrying the same application request.

## Health and database connectivity

The Worker exposes:

- `GET /health` for service health.
- `GET /health/database` for a fixed PostgreSQL connectivity check.
- `/mcp` for Streamable HTTP MCP clients.

Verify the local database path with:

```sh
curl http://localhost:8787/health/database
```

The connectivity endpoint runs only a fixed `SELECT 1`; it never accepts SQL
from the request. `get_demo_guide` reports the same availability concept but
still loads safely when PostgreSQL is unavailable.

Local development uses the direct connection string to emulate the
`HYPERDRIVE` binding. To test the hosted Hyperdrive configuration without a
deployment, use:

```sh
pnpm dev:remote
```

Remote development uses the hosted database, so treat it like a
production-data connection.

## Database schema

`src/db/schema.ts` is the source of truth. Generated PostgreSQL migrations and
Drizzle metadata are committed under `migrations/`.

With the direct connection configured in `.env`:

```sh
pnpm db:generate
pnpm db:migrate
pnpm db:verify
```

`db:verify` checks the public table and constraint catalog. Worker traffic uses
the Hyperdrive binding, while local migration and seed scripts use the direct
PostgreSQL connection.

## MCP Inspector

With the Worker running, list the registered tools from another terminal:

```sh
pnpm dlx @modelcontextprotocol/inspector@latest \
  --cli http://localhost:8787/mcp \
  --transport http \
  --method tools/list
```

Suggested demonstration sequence:

1. Call `get_demo_guide`.
2. Investigate `ORD-DEMO-1043`.
3. Prepare its recovery plan.
4. Call `apply_recovery` with `approved: false` and confirm no mutation.
5. Apply with `approved: true` and a new idempotency key.
6. Repeat with the same key and verify `idempotentReplay: true`.
7. Use `ORD-DEMO-1044` for a second clean recovery demonstration.

## Validation

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm db:verify
```

## Scope

The project uses synthetic commerce data and does not communicate with a real
payment processor or fulfillment provider.

Approval is represented by `approved: true` in the MCP call. Operator identity
is not independently authenticated within this assignment.
