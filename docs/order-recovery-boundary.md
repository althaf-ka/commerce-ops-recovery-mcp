# Order Recovery Boundary

## Purpose

This MCP server handles one specific commerce failure:

A synthetic processor payment was captured, but the local order remained
unpaid and blocked because the payment webhook failed.

The server is not a general order-management tool. It cannot make arbitrary
payment, inventory, order, or fulfillment changes.

## Eligible state

An order is recoverable only when all of these conditions are true:

- The processor payment is `captured`.
- The local payment state is `pending`.
- The related webhook delivery is `failed`.
- The order is `awaiting_payment`.
- Fulfillment is `blocked_awaiting_payment`.
- No inventory reservation already exists.
- Sufficient inventory is available.
- The order is not cancelled, refunded, disputed, packed, or dispatched.

If any condition fails, the order must not be recovered.

## Recovery workflow

The commerce workflow uses three MCP tools:

```text
investigate_order
→ prepare_recovery_plan
→ apply_recovery
```

`get_demo_guide` is an additional read-only tool that helps reviewers discover
the workflow and seeded scenarios.

### Investigation

`investigate_order` reads the current order, payment, webhook, inventory,
reservation, and fulfillment state. It never changes commerce state.

### Plan preparation

`prepare_recovery_plan` stores the exact proposed recovery actions, expected
order version, expiry time, and approval requirement.

Preparing a plan does not change payment, inventory, order, or fulfillment
state.

### Application

`apply_recovery` requires explicit approval.

Before applying a plan, the server locks and reloads the latest database state,
checks the order version, re-runs eligibility, and confirms that the current
recovery actions still exactly match the approved plan.

## Approval

When `approved` is `false`, the server returns:

```text
CONFIRMATION_REQUIRED
```

No commerce mutation is attempted.

When `approved` is `true`, the request must include an idempotency key.

Approval is represented by the MCP input. Operator identity is not
independently authenticated within this assignment.

## Allowed mutations

A valid recovery may only:

- Change the local payment state from `pending` to `paid`.
- Create the exact inventory reservations approved in the plan.
- Increase reserved inventory quantities by the approved amounts.
- Change the order from `awaiting_payment` to `ready_for_fulfillment`.
- Increment the order version exactly once.
- Change fulfillment from `blocked_awaiting_payment` to `ready_to_fulfill`.
- Clear the related fulfillment blocked reason.
- Mark the recovery plan as applied.
- Record audit and reconciliation evidence.
- Store the successful idempotency result.

## Forbidden mutations

The recovery must not:

- Retry, capture, refund, or void the processor payment.
- Change the processor-payment evidence.
- Change physical on-hand inventory.
- Change order-item quantities.
- Create reservations different from the approved plan.
- Modify packed or dispatched fulfillment.
- Apply arbitrary payment, order, inventory, or fulfillment statuses.
- Execute caller-provided or arbitrary SQL.
- Apply an expired, invalidated, stale, or already-applied plan.

## Stale-plan protection

A recovery plan is bound to the order version that existed when the plan was
prepared.

Before mutation, the server compares the current order version with the version
stored in the plan. If they differ, the server returns:

```text
STALE_ORDER_VERSION
```

No commerce mutation occurs.

The server also rebuilds the required recovery actions from the latest locked
state. If they differ from the approved plan, it returns:

```text
PLANNED_CHANGES_MISMATCH
```

## Idempotency

The caller supplies an idempotency key for an approved apply request. The
server generates a stable request hash and stores the original successful
result.

Expected behavior:

```text
Same key + same request
→ return the original result
→ no repeated mutation
```

```text
Same key + different request
→ IDEMPOTENCY_KEY_CONFLICT
```

```text
Different key + already-applied plan
→ PLAN_ALREADY_APPLIED
```

Idempotency provides safe retry behavior. Plan status independently prevents
the same plan from being applied again using another key.

## Transaction and concurrency safety

All recovery mutations run inside one PostgreSQL transaction.

The server locks the recovery plan and associated commerce rows before final
validation and mutation. Conditional updates verify expected statuses,
inventory availability, and order version.

If any required write fails, PostgreSQL rolls back the complete transaction. A
partially recovered order must never be committed.

## Audit evidence

A successful recovery records evidence containing the relevant:

- Order and recovery-plan identifiers.
- Expected and resulting order versions.
- Approved changes.
- Before and after state.
- Idempotency request.
- Application timestamp.

## Demo data

The project uses synthetic commerce data.

`get_demo_guide` exposes the available demo scenarios as read-only information.

Database reset is not available through MCP. The developer-only
`db:reset-demo` script restores only the known synthetic demo scenarios.
