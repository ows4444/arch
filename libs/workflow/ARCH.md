# Design 001

**Library / Bounded Context:** libs/workflow (Workflow Orchestration)
**Date:** 2026-07-18

## Goal

Design the 7 capability gaps flagged in README.md against the current engine
(parallel/fan-out-fan-in steps, declarative conditional branching, durable
timers/sleep, workflow versioning, scheduled/cron-triggered workflows, query
handlers beyond state, human-in-the-loop approval) per ci.loop Section 0.
Primary output: for each item, decide whether it's a genuine
aggregate-boundary/structural addition or authoring sugar over a capability
the engine already has — the README's flat "7 missing features" framing
turned out not to hold up under inspection (see Rejected Alternatives and
the per-item notes below).

## Scale/Team Context Assumed

Single maintainer, one NestJS monolith (`src/app.module.ts`) composing
`libs/workflow` in-process. No stated throughput/tenant-count target. The
engine already assumes **multi-replica horizontal scaling** regardless of
team size — `WorkflowLeaseService` does distributed per-workflow leasing via
a pluggable `WorkflowStateStore.acquireLease`, and sibling libs
(`libs/database`'s reader/writer split, `libs/queue`'s prefetch/backoff)
follow the same assumption. All designs below preserve that: anything that
fires work on a timer reuses lease-scoped locking rather than assuming a
single instance. No concrete scale target exists to size the fan-out design
against — flagged as an explicit open assumption below rather than a
blocker.

## Bounded Contexts Identified

- No new bounded context. All 7 items live inside the existing "Workflow
  Orchestration" context — none of them touch `libs/cache`, `libs/queue`,
  or `libs/database` beyond the persistence/lease ports `libs/workflow`
  already depends on.
- One new **sub-concept**, not a new context: **Scheduling** (cron-triggered
  workflow starts). It only ever calls `WorkflowClient.execute()` — the same
  entry point any external caller uses today — so it's upstream of
  Execution the same way a cron job calling a REST endpoint would be, not a
  new integration surface requiring its own library or context boundary.

## Context Map (delta from current)

Current: `WorkflowClient`/`WorkflowQueryService` (API) → `WorkflowExecutor`
→ `WorkflowRunner` → `WorkflowStepExecutor`/`WorkflowStepPersistenceService`
(step boundary) → persistence adapters (`typeorm` | `database`).

Additions:
- `WorkflowSchedulerService` → `WorkflowClient.execute()` (new caller,
  upstream of the API layer — no changes to the layers below it).
- `WorkflowQueryDispatchService` sits beside `WorkflowQueryService`, sharing
  its read-only relationship to `WorkflowStateStore` (no write path).
- Parallel fan-out reuses the existing `ChildWorkflowService` →
  `WorkflowExecutor.execute(..., { parentWorkflowId })` relationship
  unchanged — branches are children, not a new relationship type.

## Architecture Style Recommendation

Unchanged: modular monolith, `libs/workflow` as one Nest dynamic module.
None of the 7 items justify a service split — each is either an in-process
state-machine extension or a new table behind the same persistence port
pattern already used for state/signals/history/snapshots/idempotency.

## Key Decisions (with risk tag)

**CRITICAL**
- None. No decision here rises to monolith-vs-microservices, broker-choice,
  or multi-tenant-isolation-model territory.

**HIGH**
1. **Parallel/fan-out-fan-in steps.** Model each parallel branch as a child
   workflow execution via the existing `ChildWorkflowService`
   (`WorkflowExecutor.execute(childWorkflowName, input, { parentWorkflowId,
   parentExecutionId })`), *not* as multiple concurrently-active steps
   tracked inside one `WorkflowExecutionState` row.
   - `WorkflowStepResult` gains optional `spawnChildren:
     ChildWorkflowSpawnSpec[]` (workflow name/version + per-branch input) and
     `joinPolicy: 'all' | 'any' | { min: number }`.
   - New status `'waiting-children'`, parallel to today's `'waiting'`
     (signal) status — reuses the exact same "pause, resume on external
     event" shape `WorkflowStateTransitions.resumeFromSignal` already
     implements; add `resumeFromJoin(state)` alongside it.
   - `ChildWorkflowService.onChildCompleted` (currently a no-op stub at
     `child-workflow.service.ts:208-224` — logs and returns) becomes the
     join-quorum check: on each child completion, count completed/total
     children via the already-existing `findByParentWorkflowId`, and if the
     configured `joinPolicy` quorum is met, resume the parent at the
     declared join step.
   - Join-count bookkeeping is computed on demand from
     `findByParentWorkflowId` rather than a new counter table — see
     Rejected Alternatives for the sizing tradeoff this accepts.
   - Compensation: no new semantics needed. Each branch is a full child
     workflow, so `ChildWorkflowService`'s existing per-child
     `compensate-parent`/failure-policy handling already governs it — a
     fan-out region's compensation is "compensate each child," which the
     engine already does for any child workflow today.

2. **Scheduled/cron-triggered workflows.** New `WorkflowSchedule` aggregate:
   `scheduleId`, `workflowName`, `workflowVersion?`, `cronExpression`,
   `timezone`, `inputTemplate`, `enabled`, `nextFireAt`, `misfirePolicy:
   'skip' | 'fire-once'`, `lastFiredAt`. New TypeORM entity + migration +
   store, mirroring the existing `persistence/adapters/typeorm/{entities,
   stores}` pattern used for signals/snapshots/history. New
   `WorkflowSchedulerService`: a poll-interval sweep (same shape as
   `WorkflowAutoRecoveryService.onModuleInit`, using the `SchedulerRegistry`
   from `@nestjs/schedule` already imported by `WorkflowModule`) that finds
   due schedules and fires `WorkflowClient.execute()`. Single-fire-across-
   replicas guarantee reuses `WorkflowLeaseService`'s exact
   acquire/renew/release pattern against the same
   `WorkflowStateStore.acquireLease`-shaped port, scoped by `scheduleId`
   instead of `workflowId`. New public API: `WorkflowClient.schedule()`,
   `.unschedule()`, `.schedules()`.

**MEDIUM**
3. **Durable timers/sleep.** New `'sleeping'` status. New nullable
   `sleepUntil: Date` column on `workflow_state` (own migration — see
   Rejected Alternatives for why this isn't folded into the existing
   `retryAt` field). `WorkflowStepResult` gains `sleepUntil?: Date` /
   `sleepMs?: number` alongside the existing `waitForSignal`. New
   `WorkflowStateStore.findSleepingReady(now, limit)` query. Woken by a
   third sub-sweep added to `WorkflowAutoRecoveryService.recover()`,
   alongside its existing recoverable/stuck/expired-waiting sub-sweeps — no
   new timer infrastructure, just one more `find*` call in an already
   existing interval loop.
4. **Query handlers beyond state.** New `@Query(name: string)` method
   decorator, mirroring `@Hook`'s shape (`hook.decorator.ts`). Collected
   into `WorkflowMetadata.queries` the same way hooks are collected today.
   New `WorkflowQueryDispatchService.query(workflowId, name, args)`: loads
   the persisted `WorkflowExecutionState`, resolves the workflow's query
   handler instance via the same `ModuleRef.get(type, { strict: false })`
   pattern `WorkflowStepResolver` already uses, and invokes it
   synchronously against `state.data` — a pure projection, no persistence
   changes, no new consistency model. Exposed as
   `WorkflowClient.query(workflowId, name, args)`.

**LOW**
5. **Human-in-the-loop / manual approval primitive.** No engine change —
   this is 100% already supported by `waitForSignal` +
   `findWaitingExpired`'s existing timeout sweep (both already
   distributed-safe). Add `ApprovalStepHandler`, an abstract
   `WorkflowStepHandler` base class whose `execute()` default-returns
   `{ waitForSignal: { name: 'approval', ... } }`, with a documented signal
   payload convention (`approved: boolean`, `approverId: string`,
   `reason?: string`) — pure sugar, zero schema/state-machine changes.
6. **Workflow versioning DX helper** (`getVersion`-style branching within a
   single `@Workflow` class, Temporal-`GetVersion`-style). Deferred to
   Future Ideas below — see Rejected Alternatives for why the underlying
   capability doesn't need this to already work.

## Rejected Alternatives

- **Parallel steps as `activeSteps: WorkflowStepId[]` inside the single
  `WorkflowExecutionState` aggregate** (vs. branches-as-child-workflows,
  chosen above). Rejected: this would multiply
  `WorkflowStateTransitions` — today a small closed set of pure functions
  over one execution thread (`libs/workflow/src/engine/state/transitions.ts`)
  — with per-branch retry/failure/compensation bookkeeping duplicating what
  `ChildWorkflowService` already solves correctly for "a separate execution
  with its own failure/compensation lifecycle." Costs more DB writes/lease
  churn per branch than an in-aggregate array would; accepted per Section
  17's correctness-before-performance ordering, revisit only if a concrete
  high-fan-out workload shows up (see Open Questions).
- **Declarative `@Step({ branch: {...} })` DSL for conditional
  branching** — rejected outright, no design produced. A step handler's
  `WorkflowStepResult.nextStep`, returned dynamically and validated against
  the declared `transitions` adjacency map by
  `WorkflowDefinitionValidator` (which already checks DAG shape,
  reachability, and cycles), already gives full conditional branching. No
  concrete pain point was found that a declarative DSL would solve beyond
  what the existing return-value mechanism does — building it anyway would
  give two ways to express the same thing, against Section 17's "every
  refactor must have measurable value."
- **One in-process `@Cron()` decorator per `WorkflowSchedule` row** —
  rejected in favor of the poll-interval sweep, for the same reason
  `WorkflowAutoRecoveryService` doesn't use `@Cron()` today: schedules are
  DB-driven and can be created/edited/disabled at runtime, and a decorator-
  registered cron job can't be added/removed per row without the same
  `SchedulerRegistry.addInterval`/`deleteInterval` bookkeeping a poll
  already does more simply.
- **Overloading `retryAt`/`requiresRecovery` for durable-timer wake-ups**
  instead of a new `sleepUntil` column/status — rejected: `retryAt` already
  means "this execution crashed/failed and needs recovery." Reusing it for
  "intentionally asleep on a timer" would corrupt operational queries — a
  "stuck workflows" dashboard built on `requiresRecovery` would start
  showing every sleeping workflow as a false positive.
- **`getVersion()` Temporal-style helper implemented now** — rejected for
  this pass. The README's framing that versioning is "missing" doesn't
  hold: `WorkflowMetadata.version` is already mandatory, `WorkflowRegistry`
  already keeps multiple versions registered side by side
  (`get(name, version)` vs. `getLatest(name)`), and
  `WorkflowExecutionState.workflowVersion` already pins each in-flight
  instance to the version it started on — a deploy of a new `@Workflow`
  version doesn't affect existing in-flight instances, which was the
  concrete concern raised. What Temporal's `GetVersion` additionally offers
  — branching within one class body instead of registering two full
  versions — is a DX nicety with no reported pain point yet; moved to
  Future Ideas.

## CQRS Decision

Not adopted. Query handlers (item 4) look CQRS-adjacent but are a
synchronous read projection over the existing `WorkflowStateStore`, not a
separate write/read model or event-sourced projection — no eventual
consistency is introduced. Revisit only if a query handler needs to project
over data the state store doesn't already hold (e.g. cross-workflow
aggregation at scale); none of the 7 items need that.

## Event Sourcing Decision

Not adopted — unchanged from the engine's existing design. State plus the
append-only `workflow_step_history` audit trail already gets most of Event
Sourcing's audit benefit without its replay complexity; none of the 7 items
require event replay.

## Open Questions / Future Evolution

- **Fan-out branch width.** If a workflow ever needs hundreds/thousands of
  parallel branches, the child-workflow-per-branch model's per-branch
  lease-acquire + state row becomes real overhead. The rejected
  in-aggregate `activeSteps` alternative would need to be revisited at that
  point — this is the one design decision above most likely to age out if a
  concrete high-width use case shows up.
- **`nextFireAt` computation for schedules.** `@nestjs/schedule` already
  depends on the `cron` package, which can compute next-fire times.
  Confirm it's usable directly from `WorkflowSchedulerService` before
  adding any new npm dependency for cron-expression parsing.
- **Compensation ordering across parallel branches.** Since each branch is
  its own child workflow, there is no single timeline to compensate "in
  reverse" across siblings — compensation ordering across branches is
  whatever order `ChildWorkflowService`'s existing cancellation loop
  iterates children in. Worth an explicit `LOOP.md` note once implemented
  so it isn't later mistaken for a bug.
- **`getVersion()` DX helper** (see Rejected Alternatives) — implement only
  if a future workflow change needs in-class branching rather than a full
  new registered version.

## Handoff to Improvement Loop

- **Public API surface** (all additive, no breaking changes to
  `@ows4444/nest-workflow`): `WorkflowClient` gains `schedule()`,
  `unschedule()`, `schedules()`, `query()`. `WorkflowStepResult` gains
  `spawnChildren?`, `joinPolicy?`, `sleepUntil?`/`sleepMs?`. New decorator
  `@Query()`. New abstract class `ApprovalStepHandler`. New status values
  `'waiting-children'` and `'sleeping'` added to `WorkflowStatus`.
- **Module boundaries:** no new library. New files under
  `engine/scheduling/*` (scheduler service, schedule store port), new
  `engine/query/*` (dispatch service, decorator), extensions to
  `engine/state/{transitions,transition-validator}.ts` and
  `models/workflow-status.ts`, new
  `persistence/adapters/typeorm/{entities,stores}/workflow-schedule.*` +
  migration, extension to `ChildWorkflowService.onChildCompleted` and
  `engine/retry/auto-recovery.service.ts`'s sweep.
- **Suggested implementation order** (lowest-risk/most-reusable-infra
  first): (1) durable timers — self-contained, reuses the existing sweep;
  (2) query handlers — purely additive, no schema; (3) human-in-the-loop
  sugar — trivial; (4) cron scheduling — new aggregate, but proves out the
  "poll sweep + scoped lease" pattern that (5) also leans on; (5)
  parallel/fan-out — largest behavioral surface, tackled last so it can
  reuse the status-handling pattern proven in (1) and the
  scheduler-service pattern proven in (4).

---

# Design 002

**Library / Bounded Context:** libs/workflow
**Date:** 2026-07-20

## Goal

Add a `@Step({ inputSpec })` hook so a step can declare a validation check its input `data` must
satisfy before the step handler runs, per the user's explicit request to complete this
previously-deferred item.

## Scale/Team Context Assumed

Unchanged from Design 001.

## Key Decisions (with risk tag)

**CRITICAL**
- `libs/workflow` (`@ows4444/nest-workflow`) is built and published standalone —
  `tsconfig.build.json` compiles only `libs/workflow/src`, and the package's `peerDependencies`
  list exactly what an external consumer must have installed (`@nestjs/common`, `typeorm`, etc.).
  `@/validation` is a workspace path alias, not a real npm package, and is not in
  `peerDependencies`. **`libs/workflow` must not import anything — type or value — from
  `@/validation`.** Doing so would type-check fine inside this monorepo (the root `tsconfig.json`
  resolves the alias) but would silently break the *published* package for any external consumer,
  since `tsc` does not rewrite path aliases to relative imports and the emitted `.js`/`.d.ts`
  would reference an unresolvable module. This is exactly the class of mistake CLAUDE.md's
  "treat as a real semver-sensitive surface" instruction exists to prevent.
  - **Resolution:** define a minimal, self-contained structural interface *inside*
    `libs/workflow` — `WorkflowStepInputSpecification<T>` (`isSatisfiedBy`/`explain`), shaped
    identically to `@/validation`'s `Specification<T>` but with zero import from it. Because
    TypeScript uses structural typing, any `Specification` instance built with `libs/validation`
    (in `apps/server` or another workspace lib) satisfies `WorkflowStepInputSpecification` by
    shape alone — callers get full interop without either package depending on the other.
  - *Alternative rejected:* import `Specification` as a type-only import (`import type`).
    Rejected — even type-only imports of a non-existent-outside-the-monorepo module break
    external consumers' ability to import the emitted `.d.ts` file, which re-exports/references
    that type position. A structurally-identical local interface has zero such risk.

**MEDIUM**
- `inputSpec` validation runs in `WorkflowStepExecutor.execute`, immediately before building the
  step's `WorkflowContext` and invoking the handler — mirroring where `WorkflowStepResultValidator`
  already runs (immediately after the handler returns), so input and output validation sit
  symmetrically around the same call.
- Failure throws `WorkflowExecutionError` (the same error type `WorkflowStepResultValidator`
  already throws for structural violations), not a new error class — keeps failure handling
  (retry classification, etc.) unchanged; a bad input is treated as an execution error, same as
  a bad result shape.
- `inputSpec` is optional (`WorkflowStepMetadata.inputSpec?`) — every existing `@Step(...)`
  registration compiles and behaves identically with no `inputSpec`, so this is additive, not a
  breaking change to the public API.

## Rejected Alternatives

- Type-only import of `@/validation`'s `Specification` — see CRITICAL decision above.
- Validating in the step handler itself (each handler calls `ValidationService` manually) —
  rejected as the default pattern; that's still possible for handlers that want business-rule
  validation with side effects (DB reads, etc.), but a declarative `inputSpec` on the decorator is
  what "the input `data` shape must satisfy X before running" actually asked for, and doing it in
  the executor means a misconfigured step fails before any handler code runs at all.

## CQRS / Event Sourcing Decisions

Unchanged from Design 001 (not applicable).

## Open Questions / Future Evolution

- None — this closes the specific item Design 001's "Suggested implementation order" section had
  left unaddressed.

## Handoff to Improvement Loop

- **Public API surface (additive):** `WorkflowStepInputSpecification<T>` (new, exported),
  `WorkflowStepMetadata.inputSpec?` (new optional field), `WorkflowStepInputValidator` (new
  injectable service, mirroring `WorkflowStepResultValidator`).
- **Module boundaries (unchanged):** `libs/workflow` still imports nothing from `@/validation`,
  `@/queue`, `@/auth`, or `@/cache` — only `@/database` for its TypeORM persistence adapter, as
  already documented in Design 001.
