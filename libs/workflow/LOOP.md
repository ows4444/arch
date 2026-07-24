# Loop 001

**Library:** libs/workflow
**Date:** 2026-07-17

## Goal

First `ci.loop` pass over `libs/workflow`, the largest and most complex of
the four shared libraries (durable workflow/saga engine, published
separately as `@ows4444/nest-workflow`). Delegated initial Phase 1/2 reading
to a research subagent given the library's size, then independently
verified every finding against the source before acting on it.

## Files Reviewed

All of `libs/workflow/src/**/*.ts` (engine: executor/runner/step-executor,
compensation, retry/auto-recovery, signals, state machine, child-workflow,
lifecycle, hooks, expiration; persistence: TypeORM adapters/entities/
migrations and the database-backed adapter; ports; public API surface
`public/api/*` and `index.ts`), plus `libs/database`'s
`TransactionExecutor` (to verify rollback-on-throw semantics before deciding
on the signal-store finding).

## Problems Found

**Critical**
- `WorkflowSignalEntity.signalId` was the sole `@PrimaryColumn` —
  caller-supplied via `WorkflowClient.signal()` and only meant to be unique
  within one workflow, but the schema made it globally unique across *all*
  workflows. `WorkflowSignalProcessor.prepareInternal` also discarded
  `WorkflowSignalService.append()`'s return value, so when a second workflow
  reused the same `signalId` (e.g. `"approve"`), its insert silently failed
  against the duplicate key while its state machine still advanced as if
  the signal landed — and `complete()`/`markProcessed()`/`load()`/`exists()`
  all keyed off `signalId` alone, so one workflow's calls could load/mark
  a *different* workflow's row. Same class of bug as the `RMQPublisher`
  fix from the `libs/queue` loop (reused caller id as sole correlation key).

**High**
- (Investigated, not applicable) `WorkflowModule.forRootAsync` — initially
  flagged as missing like `libs/queue`/`cache`/`database`, but on closer
  inspection `WorkflowModuleOptions.metrics`/`.eventPublisher` already
  accept raw Nest `Provider` objects (`useFactory`/`inject` work today, and
  `ConfigModule` is global in this app), so ConfigService-based resolution
  already works without `forRootAsync`. The one option that can't be made
  async is `persistence` — it selects which module gets imported
  (`WorkflowPersistenceModule` vs `WorkflowDatabasePersistenceModule`),
  which Nest can't resolve from a runtime factory. User chose to skip this
  rather than add speculative API surface with no functional gap behind it.

**Medium**
- `WorkflowExpirationService` was dead/orphaned: registered and exported
  from `WorkflowModule` but never called anywhere, and not exported from
  the public `index.ts` barrel either (so external consumers couldn't
  reach it without violating the barrel-only import rule).
  `WorkflowAutoRecoveryService.recover()` already implements equivalent
  (and more complete — stuck-detection and retryable-recovery too)
  expired-waiting cancellation via `WorkflowExecutor.cancel()`. Same shape
  as the dead `QueueService` found in the `libs/queue` loop.
- `WorkflowCompensationService.compensateSteps` swallowed per-step handler
  failures with only a log line; callers (`WorkflowFailureService`,
  `ChildWorkflowService`'s `compensate-parent` policy) had no way to know
  whether a saga rollback partially failed (e.g. an uncompensated payment
  capture), and the `compensate-parent` code path itself had zero test
  coverage before this loop.

**Low / coverage gap**
- Zero coverage on `delay.service.ts` (pure retry-delay math) and
  `workflow-idempotency-key.ts` (pure key-building util) — both cheap to
  test and directly relevant to this loop's fixes.
- Broader coverage gaps remain on `step-persistence.ts` (state+history+
  snapshot atomicity — the core write path), `auto-recovery.service.ts`
  (the entire crash-recovery sweep), `hook-executor.ts`,
  `definition.validator.ts`/`step-result.validator.ts`, `history.service.ts`,
  `workflow-persistence.service.ts`, `retention.service.ts` — not addressed
  this loop, see Next Loop.

## Changes Made

- **Signal-id collision (Critical):**
  - `WorkflowSignalEntity`: composite primary key `(workflowId, signalId)`.
  - New migration `WorkflowSignalCompositeKey1752200000000` (MySQL
    `DROP PRIMARY KEY` / `ADD PRIMARY KEY`), registered in
    `WORKFLOW_MIGRATIONS` and exported from `index.ts`.
  - `WorkflowSignalStore` port, `TypeOrmWorkflowSignalStore`, and
    `WorkflowSignalService`: `load`/`exists`/`markProcessed` now take
    `(workflowId, signalId)` instead of `signalId` alone.
  - `WorkflowSignalProcessor.complete()` threads `workflowId` through to the
    now-scoped `load`/`markProcessed` calls.
  - `WorkflowSignalProcessor.prepareInternal` no longer discards
    `append()`'s return value — a duplicate-key hit (now only reachable via
    a genuine same-workflow race, since cross-workflow collisions are fixed
    by the composite key) is logged and treated as already-recorded rather
    than silently proceeding to resume the workflow.
  - Regression tests: two workflows reusing the same `signalId` no longer
    collide on insert or `markProcessed`; `WorkflowSignalProcessor` returns
    `acquired: false` without resuming when a duplicate row is hit.

- **`WorkflowExpirationService` (Medium):** deleted (`engine/expiration/`
  directory and its spec) along with its `WorkflowModule` provider/export
  wiring — `WorkflowAutoRecoveryService` already covers this behavior.

- **Compensation failures (Medium):**
  - `WorkflowMetrics` gained an optional `compensationFailed?(workflowName,
    step)` method (optional so existing external implementations keep
    compiling); implemented as a no-op in `NoopWorkflowMetricsService`.
  - `WorkflowCompensationService.compensate()` now returns
    `Promise<CompensationOutcome>` (`boolean`: `true` iff every step's
    compensation handler succeeded) instead of `Promise<void>`, and calls
    `metrics.compensationFailed?.()` per failed step. `WorkflowCompensationService`
    is internal-only (not exported from `index.ts`), so this signature
    change doesn't touch the public API.
  - `WorkflowFailureService.failExecution` and
    `ChildWorkflowService.onChildFailed`'s `compensate-parent` branch both
    now log an explicit "did not fully complete... requires manual
    intervention" error when compensation reports partial failure.
  - Added the first tests for the previously-uncovered `compensate-parent`
    policy branch (3 new tests), plus tests for the new return-value
    contract on `WorkflowCompensationService`.

- Added `delay.service.spec.ts` and `workflow-idempotency-key.spec.ts`.

## Why

- User approved the full scope ("everything incl. the migration") after
  reviewing the signal-id collision finding and its schema/migration
  impact — the highest-value fix this loop, reachable via the public
  `WorkflowClient.signal()` API with realistic caller behavior (any
  client-chosen signalId, not just UUIDs).
- The `forRootAsync` finding was dropped after implementation-level
  investigation showed the premise didn't hold — Section 17's "every
  refactor must have measurable value" argues against adding it anyway.
- Compensation-failure visibility was implemented via an *optional*
  interface method and an internal-only return-value change specifically
  to avoid a breaking public-API change, per Section 17's backward-
  compatibility rule.

## Tests

`libs/workflow` suite is now 33 spec files / 246 tests (up from 32 files /
236 tests — net change reflects the deleted `workflow-expiration.service.spec.ts`
offset by new signal-store, signal-processor, compensation, child-workflow,
delay-service, and idempotency-key tests). Full monorepo suite: 87 suites /
646 tests, all passing.

## Build

PASS (`npx tsc --noEmit -p tsconfig.json`)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- No `ARCH.md` exists for this library yet; this loop was pure Improvement
  Loop (Sections 1-19), no Design Mode session preceded it.
- Broader test-coverage gaps noted above (`step-persistence.ts`,
  `auto-recovery.service.ts`, `hook-executor.ts`, validators,
  `history.service.ts`, `workflow-persistence.service.ts`,
  `retention.service.ts`) — not started.
- Deployments with existing `workflow_signals` data should confirm no
  pre-existing cross-workflow `signalId` collisions exist before running
  the new migration (a collision would mean two rows already share a
  `signalId` with different `workflowId`s — the migration itself doesn't
  need to dedup since the old PK already guaranteed at most one row per
  `signalId`, but it's worth a sanity check in any environment with
  meaningful production signal history).

## Next Loop

- Prioritize `step-persistence.ts` and `auto-recovery.service.ts` for test
  coverage — both encode business-critical atomicity/scheduling decisions
  with zero current coverage.
- Consider whether `WorkflowCompensationService`'s new `CompensationOutcome`
  boolean should eventually carry which steps failed (not just whether
  everything succeeded) if a consumer ever needs to retry specific
  compensation steps rather than requiring full manual intervention.
- No further Critical/High findings identified this pass beyond what's
  listed above as remaining coverage gaps (Low severity). Per Section 16,
  this library is close to a natural stopping point once the
  `step-persistence.ts`/`auto-recovery.service.ts` coverage gap is closed.

# Loop 002

**Library:** libs/workflow
**Date:** 2026-07-17

## Goal

Close the two highest-priority test-coverage gaps flagged in Loop 001's
Next Loop notes: `step-persistence.ts` (core write-path atomicity) and
`auto-recovery.service.ts` (the crash-recovery sweep) — both at zero
coverage despite encoding business-critical logic.

## Files Reviewed

- `engine/executor/step-persistence.ts`
- `engine/retry/auto-recovery.service.ts`
- `engine/retry/recovery.service.ts`, `engine/registry/registry.ts` (to
  build accurate mocks/fixtures)
- While writing the auto-recovery test, a real bug surfaced (see below),
  which prompted a repo-wide sweep of every `setInterval`/`setTimeout` in
  `libs/workflow` for the same gap: `infrastructure/lease/lease.service.ts`,
  `engine/retry/default-scheduler.service.ts`,
  `engine/executor/step-executor.ts`, `engine/compensation/service.ts`,
  `retention/retention.service.ts`.

## Problems Found

**Medium**
- `WorkflowAutoRecoveryService.onModuleInit`'s sweep `setInterval` was never
  `.unref()`'d, unlike the equivalent pattern already fixed in
  `libs/queue`'s `OutboxDispatcherService`/`RMQConnection` during that
  library's loop. This isn't hypothetical: writing a straightforward test
  that called `onModuleInit()` and let the interval run past the test
  actually hung the Jest worker on a leaked, ref'd timer — the same failure
  mode this would cause in a real short-lived Node process (a script or
  worker that spins up the module and never explicitly calls `.close()`).
  The same gap was found in five more places on inspection:
  `WorkflowRetentionService`'s cleanup sweep interval, and one-shot timers
  in `WorkflowLeaseService.keepAlive`, `DefaultWorkflowRetryScheduler.wait`,
  `WorkflowStepExecutor`'s per-step timeout, and
  `WorkflowCompensationService`'s per-step compensation timeout.
- (Not changed) `WorkflowLeaseService.onApplicationShutdown`'s shutdown-poll
  `setTimeout` was deliberately left un-refed as-is — unlike the others,
  it's a bounded poll-until-condition loop already running inside an
  explicit shutdown sequence, so unrefing it risks the process exiting
  before the poll's deadline/condition is ever re-checked.

## Changes Made

- Added `timer.unref()` / `timeout.unref()` at all six sites listed above
  (five sweep/wait timers fixed; the shutdown-poll timer deliberately left
  alone, see above).
- New spec files:
  - `step-persistence.spec.ts` (7 tests): transaction wrapping for
    `startStep`/`completeStep`/`recordRetryAttempt`, write-ordering
    (history append before state transition) for `completeStep`, and that
    `recordStepAttempt`/`appendFailure` deliberately bypass the transaction
    wrapper (single atomic write, no combined state save).
  - `auto-recovery.service.spec.ts` (13 tests): interval scheduling
    (default vs. smallest configured `autoResume.intervalMs`), the full
    `recover()` sweep across all three sub-sweeps (recoverable/stuck/
    expired-waiting) including per-item skip conditions (retryAt in future,
    autoResume disabled, maxAttempts exhausted, timeout not yet elapsed)
    and that one item's failure doesn't abort the rest of the sweep.
  - `delay.service.spec.ts` and `workflow-idempotency-key.spec.ts` (from
    Loop 001's leftover scope, folded in here).

## Why

- These two files were called out explicitly in Loop 001 as the top
  priority: `step-persistence.ts` is the atomicity boundary between state,
  history, and snapshot writes (get this wrong and you can silently lose
  audit trail or leave state/history inconsistent), and
  `auto-recovery.service.ts` is the entire crash-recovery sweep — the
  mechanism that makes the "durable" in "durable workflow engine" true.
  Both had zero coverage protecting them from regression.
- The `.unref()` fix wasn't planned — it was discovered because a real test
  exercising real behavior hung, which is exactly the value of writing the
  test in the first place. Extended to sibling timers per Section 17's
  "check whether a fix pattern... should be cross-checked" guidance and the
  cross-lib consistency principle (Section 1) — this exact pattern was
  fixed in `libs/queue` two loops ago, and `libs/workflow` has more
  standalone timers than that library did.

## Tests

`libs/workflow` suite is now 35 spec files / 266 tests (up from 33 files /
246 tests). Full monorepo suite: 89 suites / 666 tests, all passing.

## Build

PASS (`npx tsc --noEmit -p tsconfig.json`)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- No `ARCH.md` exists for this library yet.
- Remaining coverage gaps from Loop 001 not addressed this loop:
  `hook-executor.ts`, `definition.validator.ts`/`step-result.validator.ts`,
  `history.service.ts`, `workflow-persistence.service.ts`,
  `retention.service.ts`.

## Next Loop

- Continue closing the remaining coverage gaps listed above, roughly in
  that priority order (validators and `history.service.ts` are the next
  most business-critical; `retention.service.ts` is lower-stakes cleanup
  logic).
- No Critical/High findings remain open. Per Section 16, `libs/workflow` is
  now at the same "no Critical/High open, tests/build/lint green" stopping
  point `libs/queue` reached — further loops are coverage/polish work
  rather than defect-driven.

# Loop 003

**Library:** libs/workflow
**Date:** 2026-07-17

## Goal

Close the remaining test-coverage gaps from Loop 002's Next Loop list:
`definition.validator.ts`, `step-result.validator.ts`, `history.service.ts`,
`workflow-persistence.service.ts`, `retention.service.ts`, and
`hook-executor.ts`.

## Files Reviewed

- `engine/validation/definition.validator.ts` (15 private validation rules
  across start-step, transitions, reachability, cycles, terminal-steps,
  retry policy, timeouts, signals, deprecated steps, child workflows,
  compensation, auto-resume, retention, persistence, and a cross-field
  compatibility check)
- `engine/validation/step-result.validator.ts`
- `persistence/history.service.ts`, `persistence/workflow-persistence.service.ts`
- `retention/retention.service.ts`, `engine/hooks/hook-executor.ts`

## Problems Found

**Low (dead code, discovered while writing tests)**
- `WorkflowDefinitionValidator.validateTerminalSteps`'s throw branch is
  unreachable in practice: a finite transition graph with zero terminal
  steps and zero cycles is mathematically impossible (following out-edges
  from any node must eventually revisit one), and `validateCycles` runs
  *before* `validateTerminalSteps` in `validate()`'s call order — so any
  graph that would trip the terminal-step check always trips the cycle
  check first instead. Not changed — this reads as an intentional
  belt-and-suspenders check rather than a bug, and removing defensive
  validation code without a clear win isn't justified by Section 17.
- `validateSignals`'s dedicated "Signal expiry would be effectively
  disabled" error message (for `signals.defaultTimeoutMs` exceeding the
  365-day maximum) is also unreachable: `validatePositiveDuration`, called
  a few lines earlier in the same method for the same field, already
  throws its own (more generic) "must be <= ...365 days" error for the
  exact same condition first. Also not changed this loop — same reasoning,
  but flagged here since unlike the terminal-steps case, this one directly
  means a more-specific, more-helpful error message never fires in favor
  of a less specific one, which is worth a deliberate cleanup decision
  rather than an incidental one.

## Changes Made

- New spec files, no production code changes this loop:
  - `definition.validator.spec.ts` (34 tests): one passing case per
    validation rule plus a representative failing case for each of the ~25
    distinct error conditions across all 15 validation methods.
  - `step-result.validator.spec.ts` (5 tests).
  - `history.service.spec.ts` (6 tests): covers both the store-configured
    path and the `@Optional()` no-store path (all three methods degrade to
    safe no-ops/empty-array rather than throwing when no
    `WORKFLOW_HISTORY_STORE` is bound).
  - `workflow-persistence.service.spec.ts` (11 tests): `shouldSnapshot`'s
    frequency/zero-historyCount edge cases, `snapshot`'s conditional write,
    and all four of `recoverSnapshot`'s staleness-rejection branches
    (missing, wrong workflow, older stateVersion, less history).
  - `retention.service.spec.ts` (8 tests): interval scheduling,
    skip-when-no-retention-configured, delete, archive-before-delete,
    per-item failure isolation, and that ttlMs/batchSize are threaded
    through to the store query correctly.
  - `hook-executor.spec.ts` (5 tests): no-hook no-op, `observability.audit:
    false` skip, missing-instance warning path, successful invocation, and
    that a throwing hook handler reports `metrics.hookFailed` without
    propagating.

## Why

- This was the last item on Loop 002's Next Loop list — closing it means
  every non-trivial file in `libs/workflow`'s engine/persistence/retention
  layers now has direct test coverage, matching the bar already met by
  `libs/queue`.
- The two dead-code findings were left alone rather than fixed: both are
  genuinely low-stakes (unreachable defensive code, not incorrect
  behavior), and per Section 17 "never refactor code that already
  satisfies correctness" — these don't cause wrong behavior, just a
  redundant/less-specific error message in one case. Recorded here so a
  future loop can make a deliberate call rather than rediscovering it.

## Tests

`libs/workflow` suite is now 41 spec files / 337 tests (up from 35 files /
266 tests). Full monorepo suite: 95 suites / 737 tests, all passing.

## Build

PASS (`npx tsc --noEmit -p tsconfig.json`)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- No `ARCH.md` exists for this library yet.
- The two unreachable-branch observations above (terminal-steps check,
  duplicate signal-timeout message) — no action needed unless a future
  loop decides the redundant error message in `validateSignals` is worth
  cleaning up.
- No further systematic coverage gaps identified. Any remaining untested
  files at this point are either trivial (interfaces, DTOs, decorators
  already covered indirectly) or already covered.

## Next Loop

- No Critical/High findings open. `libs/workflow`'s three loops (bug fix +
  dead code removal → timer/shutdown hygiene → coverage completion) mirror
  the shape of `libs/queue`'s two loops. Both libraries are now at a
  genuine stopping point per Section 16 — further work would be either new
  findings from a fresh review pass, or moving to `libs/cache`/
  `libs/database`'s own deferred Next Loop items.

# Loop 004

**Library:** libs/workflow
**Date:** 2026-07-18

## Goal

Implement item 3 (durable timers/sleep) from `ARCH.md` Design 001 — the
first of the five capability gaps that Design session ranked for
implementation, chosen first because it was flagged MEDIUM risk and
self-contained (rides entirely on the existing `WorkflowAutoRecoveryService`
sweep rather than introducing new infrastructure).

## Files Reviewed

- `ARCH.md` Design 001, item 3 and its Rejected Alternatives entry (why a
  new `sleepUntil` column instead of overloading `retryAt`).
- `engine/state/transitions.ts`, `engine/state/validator.ts`,
  `engine/validation/step-result.validator.ts` (to mirror the existing
  `waitForSignal` pause/resume shape).
- `engine/retry/auto-recovery.service.ts`, `engine/retry/recovery.service.ts`
  (the existing sweep loop item 3's design explicitly said to extend).
- `persistence/adapters/typeorm/{entities,mappers,stores}/workflow-state.*`
  and both migration files (to match the established migration-authoring
  convention — TypeORM's `Table`/`TableIndex`/`addColumn` builder API, not
  raw SQL, except where the builder API can't express the change).
- `persistence/workflow-database-persistence.module.ts` — confirmed both
  persistence backends (`typeorm`, `database`) share the same
  `TypeOrmWorkflowStateStore`/entity/mapper, so only one store needed
  updating.

## Problems Found

**Low (pre-existing, surfaced while implementing)**
- `1752000000000-InitialWorkflowSchema.migration.spec.ts` ran only the
  initial migration against a `DataSource` whose `entities` array is the
  live `WorkflowStateEntity` class. Adding a column to that entity (for
  `sleepUntil`) broke the test's insert step, since the physical schema
  (one migration) and the entity's column set (always current) fell out of
  sync. This is a latent fragility in that test's design — any future
  schema-adding migration will hit the same failure unless the test is
  updated to run every migration that touches `workflow_executions`, not
  just the first one.

## Changes Made

- `WorkflowStatus` gains `'sleeping'`. `WorkflowStepResult` gains
  `sleepUntil?: Date` / `sleepMs?: number` (mutually exclusive with
  `waitForSignal`, enforced in `WorkflowStepResultValidator`).
  `WorkflowExecutionState` gains `sleepUntil?: Date`.
- `WorkflowStateTransitions.completeStep` gained a `sleepUntil` branch
  (parallel to the existing `waitForSignal` branch): sets status
  `'sleeping'`, records `resumeStep`, clears execution context. New
  `resumeFromSleep(state)` mirrors `resumeFromSignal`. `sleepUntil` was
  added to `clearExecutionContext()`'s cleared-field set so it can't leak
  across a fail/cancel/complete transition.
- `WorkflowStepPersistenceService.completeStep` resolves `sleepMs` to an
  absolute `sleepUntil` (`Date.now() + sleepMs`) before calling
  `transitions.completeStep`, so the transition layer only ever deals in
  absolute time.
- `WorkflowStateValidator` gained a `'sleeping'` case enforcing
  `sleepUntil`/`resumeStep` are set and `executingStep`/`waitingForSignal`
  are not (sleep and signal-wait are mutually exclusive at the state
  level, not just the step-result level).
- New `WorkflowStateService.wake(workflowId)` / `WorkflowExecutor.wake(workflowId)`
  / `WorkflowClient.wake(workflowId)`, mirroring the existing
  `resume`/`signal`/`cancel` triad: validates status is `'sleeping'`,
  applies `resumeFromSleep`, then runs the workflow from the resumed step.
- `WorkflowSignalProcessor.prepareInternal` explicitly rejects signals sent
  to a sleeping workflow (`case 'sleeping':` throws) rather than falling
  through to the generic "unrecognized status" warn-and-proceed branch —
  sleep and signal-wait are deliberately independent primitives this loop,
  not a "wake on either" primitive (noted as a possible future extension,
  not built).
- `WorkflowRunner`'s per-iteration loop now breaks on `sleepUntil`/`sleepMs`
  the same way it already broke on `waitForSignal`.
- New `sleepUntil` nullable column + `(status, sleepUntil)` index on
  `workflow_executions`, migration `WorkflowSleepUntil1752300000000`
  (builder-API style, explicit index name so `down()` can drop it
  precisely — the initial migration never needed one since its `down()`
  drops whole tables).
- `TypeOrmWorkflowStateStore.findActive` now includes `'sleeping'` alongside
  `'running'`/`'waiting'`. New `findSleepingReady(readyAt, limit)`,
  store-level filtered by `sleepUntil <= readyAt`.
- `WorkflowAutoRecoveryService.recover()` gained a third sub-sweep —
  `findSleepingReady` → `executor.wake()` per ready workflow, same
  try/catch-and-continue shape as the existing recoverable/stuck/expired-
  waiting sub-sweeps. New `WorkflowMetrics.sweepSleepWoken(count)` (added
  as a required method, unlike the optional `compensationFailed` — every
  existing `WorkflowMetrics` implementation in this repo is
  `NoopWorkflowMetricsService`, so there was no external-implementation
  compile-break risk to guard against here).
- Fixed `1752000000000-InitialWorkflowSchema.migration.spec.ts` (see
  Problems Found) to run both migrations that now touch
  `workflow_executions` and tear down by looping `undoLastMigration()`
  once per migration instead of assuming a single migration undoes
  everything.

## Why

- Followed `ARCH.md`'s explicit rejection of overloading `retryAt` — a
  separate `sleepUntil` column/status keeps "crashed, needs recovery"
  and "intentionally asleep" independently queryable, matching the
  documented reasoning about not corrupting a "stuck workflows" dashboard.
- `wake()` was built as a third sibling to `resume()`/`signal()` on
  `WorkflowExecutor`/`WorkflowClient` rather than folded into `resume()`,
  because `resume()`'s semantics (crash recovery, snapshot restore,
  `requiresRecovery` handling) don't apply to a voluntary sleep — a
  sleeping workflow didn't crash, so forcing it through the recovery path
  would be semantically wrong even though the surface shape is similar.
- Rejected buffering signals during sleep for this pass (see Changes
  Made) — `ARCH.md` didn't call for a "wake on either" primitive, and
  building one silently would add behavior nobody asked for per Section 17.

## Tests

`libs/workflow` suite is now 41 spec files / 356 tests (up from 41/337 —
same file count since all additions extended existing spec files with new
`describe`/`it` blocks for `wake`, `resumeFromSleep`, the `'sleeping'`
validator case, the sleep branch of `WorkflowStepResultValidator`,
`findSleepingReady`, and the sweep's new sub-loop, rather than creating new
spec files). Full monorepo suite: 97 suites / 786 tests, all passing.

## Build

PASS (`npx tsc --noEmit -p tsconfig.json`)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- None outstanding for this item. `ARCH.md`'s Open Questions entry about a
  possible future `getVersion()` helper and fan-out branch-width sizing
  remain relevant to *other* Design 001 items, not this one.

## Next Loop

- Continue `ARCH.md` Design 001's suggested implementation order: (2)
  query handlers beyond state, (3) human-in-the-loop approval sugar, (4)
  scheduled/cron-triggered workflows, (5) parallel/fan-out-fan-in steps.

# Loop 005

**Library:** libs/workflow
**Date:** 2026-07-18

## Goal

Implement item 4 (query handlers beyond state) from `ARCH.md` Design 001 —
the second implementation item, chosen next per the design's suggested
order since it's purely additive (no schema change) and self-contained.

## Files Reviewed

- `ARCH.md` Design 001, item 4.
- `engine/hooks/{hook.decorator,hook.metadata,hook-executor}.ts` — the
  design doc said the new decorator should mirror `@Hook`'s shape, but
  reading it showed `@Hook`/`@WorkflowHooks` is a *class* decorator on the
  workflow itself that maps named slots to handler *types* — there's no
  "workflow instance with methods" the way Temporal's `@QueryMethod` implies
  in this engine (workflows are pure metadata; steps/hooks/compensation are
  all separate handler classes). Query handlers were built as their own
  handler-class-per-query, decorated directly (mirroring `@Step` more than
  `@Hook`), and discovered the same way steps are.
- `engine/registry/discovery.ts` — the step-registration second pass
  (workflow-version resolution + duplicate-name rejection) was the pattern
  to replicate for queries.
- `models/registered-workflow.ts`, `ports/workflow-query.store.ts` (to
  confirm no overlap with the existing state-shaped `WorkflowQueryStore`/
  `IWorkflowQueryService` — this is a parallel, unrelated concept: arbitrary
  per-workflow projections vs. the existing fixed state accessors).

## Problems Found

None — pure greenfield addition, no existing behavior touched.

## Changes Made

- New `WorkflowQueryHandler<TState, TArgs, TResult>` interface
  (`models/workflow-query-handler.ts`): `handle(state, args?)`, mirroring
  `WorkflowHook.execute(state)`/`WorkflowStepHandler.execute(context)`'s
  shape.
- New `WorkflowQueryMetadata` (`workflow`, `workflowVersion?`, `name`) and
  `@Query(metadata)` class decorator (`engine/query/query.decorator.ts`),
  structurally identical to `@Step` — applies `@Injectable()` and stamps
  `WORKFLOW_QUERY_METADATA` (new symbol in `workflow.constants.ts`).
- `RegisteredWorkflow.queries: ReadonlyMap<string, Type<WorkflowQueryHandler>>`.
- `WorkflowDiscovery` gained a second discovery pass for `@Query`-decorated
  providers, structurally parallel to the existing step pass. Factored the
  version-resolution logic (default to the workflow's only/highest
  registered version, error naming the deciding decorator when ambiguous)
  out of the step loop into a shared `resolveTargetWorkflow()` private
  method, since the query loop needed identical semantics — copying it a
  third time would have been more diff than extracting it once.
  `registerQuery()` throws `WorkflowConfigurationError` on a duplicate
  query name within one workflow version, mirroring `registerStep()`.
- New `WorkflowQueryDispatchService.query(workflowId, name, args?)`
  (`engine/query/query-dispatch.service.ts`): loads state via
  `WorkflowStateService`, resolves the workflow via `WorkflowRegistry`,
  looks up the named handler in `workflow.queries`, resolves an instance
  via `ModuleRef.get(type, { strict: false })` (same resolution pattern
  `WorkflowHookExecutor` already uses for hooks), and invokes
  `.handle(state, args)`. Pure read — no persistence writes, no new
  consistency model, matching `ARCH.md`'s explicit "not CQRS" call.
- `WorkflowClient.query(workflowId, name, args?)`. This required renaming
  `WorkflowClient`'s existing private `query: WorkflowQueryService` field to
  `queryService` — the new public method needed the name `query` per
  `ARCH.md`'s handoff notes, and a class can't have a property and a method
  share one name. Purely an internal rename; the public method surface
  (`active`, `correlation`, `get`, `exists`, `running`, `waiting`, `failed`)
  is unchanged.
- Registered `WorkflowQueryDispatchService` in `WorkflowModule`'s
  `BASE_PROVIDERS` (not separately exported — only `WorkflowClient` is the
  intended external entry point, matching how `WorkflowStepExecutor`/
  `WorkflowSignalProcessor` etc. aren't exported either).
- Barrel exports: `@Query` decorator, `WorkflowQueryHandler`,
  `WorkflowQueryMetadata`.

## Why

- Chose handler-class-per-query (like steps/compensation) over a
  method-decorator-on-the-workflow-class design, despite `ARCH.md` phrasing
  it as "@Query(name) method decorator, mirroring @Hook's shape" — once
  actually reading `hook.decorator.ts`, `@Hook` turned out to be a class
  decorator on the workflow mapping named slots to handler types, not a
  method decorator on workflow instance methods. There's no natural home
  for query *methods* on the workflow class in this engine (workflow
  classes carry no business logic — steps/hooks/compensation are all
  separate injectable classes). The handler-class approach is both more
  consistent with the codebase's actual conventions and still delivers
  exactly what was asked: named, per-workflow, independently-injectable
  query handlers dispatched via `WorkflowClient.query()`.
- Factoring `resolveTargetWorkflow()` out of the step-registration loop
  was a judgment call to avoid tripling ~25 lines of identical
  version-resolution logic across steps/queries — Section 17's
  "minimize diff" cuts toward extraction here since the query loop needed
  the exact same semantics, not just similar-looking code.

## Tests

`libs/workflow` suite is now 42 spec files / 363 tests (up from 41/356).
New `query-dispatch.service.spec.ts` (4 tests: missing workflow, missing
handler name, unresolvable handler instance, successful dispatch with
args). Extended `discovery.spec.ts` with a `query registration` block (3
tests: registers under the correct workflow, throws on duplicate name,
throws on unknown workflow reference). Full monorepo suite: 98 suites / 793
tests, all passing.

## Build

PASS (`npx tsc --noEmit -p tsconfig.json`)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- None outstanding for this item.

## Next Loop

- Continue `ARCH.md` Design 001's implementation order: (3) human-in-the-
  loop approval sugar, (4) scheduled/cron-triggered workflows, (5)
  parallel/fan-out-fan-in steps.

# Loop 006

**Library:** libs/workflow
**Date:** 2026-07-18

## Goal

Implement item 5 (human-in-the-loop approval primitive) from `ARCH.md`
Design 001 — the third implementation item, LOW risk per the design (pure
sugar over the existing `waitForSignal` mechanism, zero engine changes).

## Files Reviewed

- `ARCH.md` Design 001, item 5.
- `engine/executor/runner.ts`, `engine/state/transitions.ts` — specifically
  how `resumeStep` behaves on signal resume: `resumeFromSignal` sets
  `currentStep = resumeStep`, so the step that receives the delivered
  signal (`context.signal`) is *not* the same step invocation that returned
  `waitForSignal` — it's whatever step `resumeStep` points to. This was the
  key finding that reshaped the implementation (see Why).
- `handlers/workflow-step-handler.ts`, `types/workflow-context.ts`,
  `models/workflow-signal.ts` (to confirm `WorkflowSignal.signalId` isn't
  matched against anything — `WorkflowSignalProcessor.prepareInternal` only
  compares `.name` — so a step-generated `waitForSignal.signalId` is
  free to be any traceable value, not something that has to be predicted).

## Problems Found

None — pure additive sugar, no existing behavior touched.

## Changes Made

- New `WorkflowApprovalDecision` (`approved: boolean`, `approverId:
  string`, `reason?: string`) — the documented signal-payload convention.
- New `RequestApprovalStepHandler` abstract class: `execute()` always
  returns `{ waitForSignal: { name: this.signalName, signalId:
  context.stepExecutionKey }, nextStep: this.resumeStep }`. Concrete
  subclasses declare `signalName` and `resumeStep` as abstract readonly
  properties.
- New `ApprovalDecisionStepHandler` abstract class: `execute()` reads
  `context.signal.payload`, validates it matches
  `WorkflowApprovalDecision`'s shape (throwing `WorkflowExecutionError`
  otherwise), and dispatches to abstract `onApproved`/`onRejected` methods.
- Both exported from the public barrel alongside `WorkflowApprovalDecision`.

## Why

- `ARCH.md` described this as a single `ApprovalStepHandler` class whose
  `execute()` branches on whether `context.signal` is present. Tracing
  through `WorkflowRunner`/`WorkflowStateTransitions.resumeFromSignal`
  showed that doesn't actually fit this engine's execution model: the step
  that initiates a wait and the step that receives the resulting signal are
  two *different* `currentStep` entries (`resumeStep` is a distinct step
  id) — the waiting step's `execute()` never runs again. Making one class
  serve both roles would require a self-transition (`resumeStep` pointing
  back at its own step), which `WorkflowDefinitionValidator.validateCycles`
  rejects unless the whole workflow opts out of cycle protection via
  `allowCycles: true` — too large a cost (and a workflow-wide one) for a
  convenience class to impose. Split into two paired classes instead
  (`RequestApprovalStepHandler` + `ApprovalDecisionStepHandler`), matching
  the two-step shape the engine actually has. Recorded here since it's a
  deliberate, reasoned deviation from `ARCH.md`'s literal wording, not an
  oversight — the same pattern as Loop 005's `@Query` decorator-shape
  deviation.
- `waitForSignal.signalId` is set to `context.stepExecutionKey` rather than
  a fixed string — confirmed via `WorkflowSignalProcessor.prepareInternal`
  that only `.name` is compared for resume-matching, so this field is free
  to carry a genuinely unique, traceable value (useful for observability)
  instead of a placeholder with no functional role.

## Tests

`libs/workflow` suite is now 44 spec files / 370 tests (up from 42/363).
New `request-approval-step.handler.spec.ts` (2 tests) and
`approval-decision-step.handler.spec.ts` (5 tests: approve/reject
dispatch, missing signal, missing approverId, non-boolean approved).
Full monorepo suite: 100 suites / 800 tests, all passing.

## Build

PASS (`npx tsc --noEmit -p tsconfig.json`)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- None outstanding for this item.

## Next Loop

- Continue `ARCH.md` Design 001's implementation order: (4)
  scheduled/cron-triggered workflows, (5) parallel/fan-out-fan-in steps.
  Both remaining items are HIGH risk per Design 001's Key Decisions table
  (new aggregate + schema for scheduling; new status + child-workflow-based
  execution model for fan-out) — Section 18 requires explicit justification
  for HIGH changes, so these are good candidates to confirm scope with the
  user before implementing, unlike the three LOW/MEDIUM items closed so
  far.

# Loop 007

**Library:** libs/workflow
**Date:** 2026-07-18

## Goal

Implement item 2 (scheduled/cron-triggered workflows) from `ARCH.md`
Design 001 — the first of the two remaining HIGH-risk items. User
explicitly confirmed proceeding with both remaining HIGH items before this
loop started, per Section 18's justification requirement.

## Files Reviewed

- `ARCH.md` Design 001, item 2 and its Rejected Alternatives (why a poll
  sweep instead of one `@Cron()` per schedule row).
- `libs/queue/src/outbox/{outbox-dispatcher.service,outbox.repository}.ts`
  — the established codebase pattern for "poll sweep atomically claims a
  batch of due rows across replicas": select candidate ids, conditionally
  UPDATE them to claim, re-select the now-claimed rows. Adapted for
  `WorkflowScheduleStore.claimDue()` instead of reusing `WorkflowLeaseService`
  (which holds one lease per long-running workflow execution — the wrong
  shape for "claim, do one quick thing, release").
  `@nestjs/schedule`'s `cron` package (`CronTime.sendAt()`) for next-fire
  computation — confirmed usable directly per `ARCH.md`'s Open Questions
  note, no new dependency needed.
- `engine/lifecycle/lifecycle.service.ts`'s `create()` — discovered it
  always calls `registry.getLatest(workflowName)`, silently ignoring any
  specific version even though `WorkflowExecutionOptions` conceptually
  could carry one. This meant a schedule's `workflowVersion` field
  (explicitly part of `ARCH.md`'s aggregate design) would validate at
  creation time but be silently ignored at fire time — a real bug in the
  making, not a hypothetical one.

## Problems Found

**Medium (discovered while implementing, not pre-existing — introduced
by this loop's own design and fixed before it shipped)**
- Without a fix, `WorkflowSchedule.workflowVersion` would have been
  write-only: validated against the registry at `schedule()` time via
  `WorkflowRegistry.resolve()`, but every fire would go through
  `WorkflowExecutor.execute()` → `WorkflowLifecycleService.create()`,
  which only ever calls `registry.getLatest()`. A schedule pinned to an
  old version would silently start the *latest* version instead — exactly
  the kind of silent-misconfiguration bug this loop's whole point is to
  avoid introducing.

## Changes Made

- **Version-pinning gap (see Problems Found):** `WorkflowExecutionOptions`
  gained `workflowVersion?: number`; `WorkflowLifecycleService.create()`
  now calls `registry.resolve(workflowName, options?.workflowVersion)`
  instead of unconditionally `registry.getLatest()`. Purely additive —
  `resolve()` already falls back to latest when no version is given, so
  every existing caller keeps its current behavior.
- New `WorkflowSchedule` model (`scheduleId`, `workflowName`,
  `workflowVersion?`, `cronExpression`, `timezone?`, `inputTemplate`,
  `enabled`, `nextFireAt`, `misfirePolicy: 'skip' | 'fire-once'`,
  `lastFiredAt?`, `claimedBy?`/`claimedAt?` for the claim mechanism).
- New `WorkflowScheduleStore` port + `TypeOrmWorkflowScheduleStore`
  (shared by both persistence backends, same as the state/signal/history
  stores) + `WorkflowScheduleEntity`/`WorkflowScheduleMapper` + migration
  `WorkflowSchedule1752400000000` (new `workflow_schedules` table,
  `(enabled, nextFireAt)` index).
- `TypeOrmWorkflowScheduleStore.claimDue(owner, now, claimStaleAfterMs,
  limit)`: select-candidates → conditional UPDATE (claim) → re-select
  claimed rows, exactly mirroring `libs/queue`'s outbox `claimBatch`.
  `recordFired()`/`release()` clear the claim; only `recordFired` advances
  `nextFireAt`.
- New `WorkflowScheduleRegistrationService`: `create()` (validates the
  target workflow+version is registered via `WorkflowRegistry.resolve()`
  before inserting, computes initial `nextFireAt` via `CronTime` — which
  also validates the cron expression itself), `remove()`, `setEnabled()`,
  `get()`, `list()`. `computeNextFireAt()` is reused by the sweep service
  after each fire.
- New `WorkflowSchedulerService` (`OnModuleInit`/`OnModuleDestroy`,
  unref'd poll interval via `SchedulerRegistry`, same shape as
  `WorkflowAutoRecoveryService`): `sweep()` claims due schedules, and for
  each one applies the misfire policy (a claimed schedule whose
  `nextFireAt` is more than one sweep interval in the past is treated as
  missed — `'skip'` advances without firing, `'fire-once'` fires once
  then advances) before calling `WorkflowExecutor.execute()` and
  recording the fire. A firing failure releases the claim (not
  `recordFired`) so the next sweep retries it.
- `WorkflowClient.schedule(options)`/`.unschedule(scheduleId)`/
  `.schedules()`, delegating to `WorkflowScheduleRegistrationService`.
- Registered both new services + `WORKFLOW_SCHEDULE_STORE` token binding
  in `WorkflowModule`'s `BASE_PROVIDERS` and both persistence modules
  (`WorkflowPersistenceModule`, `WorkflowDatabasePersistenceModule`) —
  `WorkflowSchedulerService` is self-starting (like
  `WorkflowAutoRecoveryService`) and isn't separately exported;
  `WorkflowScheduleRegistrationService` is reached only through
  `WorkflowClient`.

## Why

- Poll-and-claim (not `WorkflowLeaseService`, not per-row `@Cron()`) was
  the design already settled in `ARCH.md` — this loop's job was
  implementing it, and the outbox's `claimBatch` gave a proven, exact
  template for the atomic-claim-across-replicas shape rather than
  inventing one.
- The version-pinning fix was scoped narrowly (one field addition, one
  line changed from `getLatest` to `resolve`) specifically because
  shipping `WorkflowSchedule.workflowVersion` without it would make the
  field actively misleading — this isn't scope creep, it's making this
  loop's own new feature correct. Recorded as a "Problems Found" entry
  rather than folded silently into "Changes Made" so it's visible that a
  real (if narrowly-scoped) gap was closed along the way.
- Misfire policy is decided in the service, not the store — matches
  `WorkflowAutoRecoveryService`'s existing convention of keeping the store
  layer to plain reads/writes and putting policy decisions
  (`autoResume.enabled`, `maxAttempts`) in the service.

## Tests

`libs/workflow` suite is now 47 spec files / 397 tests (up from 44/370).
New `schedule-registration.service.spec.ts` (8 tests), `scheduler.service.spec.ts`
(8 tests: sweep firing, both misfire-policy branches, claim release on
failure, multi-schedule processing), `typeorm-workflow-schedule.store.spec.ts`
(13 tests, real sqlite round-trips: insert/load/list/delete, duplicate-id
rejection, claim/reclaim/stale-reclaim, recordFired/release). Extended
`lifecycle.service.spec.ts` with a workflowVersion-resolution test. Full
monorepo suite: 103 suites / 827 tests, all passing.

## Build

PASS (`npx tsc --noEmit -p tsconfig.json`)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- None outstanding for this item.

## Next Loop

- Item 5 (parallel/fan-out-fan-in steps) is the last item from `ARCH.md`
  Design 001 — largest behavioral surface of the original five, per the
  design's own suggested ordering (tackled last so it can reuse the
  status-handling pattern proven in Loop 004 and the
  poll-sweep-service pattern proven in this loop).

# Loop 008

**Library:** libs/workflow
**Date:** 2026-07-18

## Goal

Implement item 1 (parallel/fan-out-fan-in steps) from `ARCH.md` Design
001 — the last of the five items and the largest behavioral surface, per
user confirmation to proceed with both remaining HIGH-risk items.

## Files Reviewed

- `ARCH.md` Design 001, item 1 and its Rejected Alternatives (branches as
  child workflows, not an in-aggregate `activeSteps` array).
- `engine/child-workflow/child-workflow.service.ts` in full — this is
  where the design assumption from `ARCH.md` broke: `startChildren()`
  starts *every* declared child unconditionally, once, right after the
  *parent itself* starts (`WorkflowLifecycleService.create()`'s
  `afterCommit` hook) — children are a static list on `@Workflow({
  childWorkflows })`, not something a step spawns dynamically. There was
  no existing per-step, data-driven child-spawning primitive to build on;
  `spawnFanOut()` had to be new, not an extension of `startChildren()`.
- `engine/lifecycle/completion.service.ts` — `completeIfFinished()` already
  waits for all "managed" (statically-declared) children to reach a
  terminal status before letting the *parent's own* workflow complete.
  Confirmed this is a different mechanism (end-of-workflow gating) from
  what fan-out needs (mid-workflow join-point gating, resuming at a
  specific next step) — didn't try to reuse or extend it.
  `onChildCompleted()`/`onChildFailed()` are called synchronously, after
  the child's own state-transition transaction has already committed,
  from `completion.service.ts`/`failure.service.ts` respectively — this is
  the existing pattern `checkJoinQuorum()`'s call into
  `executor.resumeJoin()` follows.
- `WorkflowExecutor`/`ChildWorkflowService`'s existing `forwardRef(() =>
  ...)` pair (each already injects the other behind a forward reference)
  — confirmed adding a third plain edge
  (`WorkflowStepPersistenceService` → `ChildWorkflowService`) wouldn't
  introduce an unresolvable cycle, since forward-referencing one edge in a
  cycle is sufficient for Nest's DI container; verified empirically via
  `public/workflow-retry.integration.spec.ts`, which bootstraps the real
  `WorkflowModule.forRoot(...)` through `Test.createTestingModule` and
  still passes.
- `libs/queue`'s `startChildren()`-adjacent partial-failure handling
  (cancel already-started siblings, fail the parent) — reused the *shape*
  for `spawnFanOut()` but kept it as its own self-contained block rather
  than factoring a shared helper with `startChildren()` (see Why).

## Problems Found

None in existing code — this loop is additive. The `ARCH.md` assumption
that fan-out would "reuse `ChildWorkflowService`'s existing... failure
propagation" held up, but the mechanism for *starting* the children needed
to be built new (see Files Reviewed).

## Changes Made

- `WorkflowStatus` gains `'waiting-children'`. `WorkflowExecutionState`
  gains `joinId?`/`joinPolicy?` (set on a parent while it waits, and on
  each child spawned as part of that specific fan-out episode — needed so
  join-quorum counting stays scoped correctly even if a workflow also has
  ordinary `trigger: 'onStart'` children, or fans out more than once over
  its lifetime; a workflow execution is still single-threaded, so only one
  fan-out episode is ever active at a time).
- New `WorkflowJoinPolicy` (`'all' | 'any' | { min: number }`) and
  `WorkflowChildSpawnSpec` (`{ workflow: Type<unknown>; input?: Record<string,
  unknown> }`) models. `WorkflowStepResult` gains `spawnChildren?`/
  `joinPolicy?`, validated in `WorkflowStepResultValidator` as mutually
  exclusive with `waitForSignal`/sleep and requiring a join step.
- `WorkflowChildMetadata` gains `trigger?: 'onStart' | 'step'` (default
  `'onStart'`, fully backward compatible). A `'step'`-triggered child is
  never auto-started by `startChildren()` — it's only spawned when a
  step's `spawnChildren` references its workflow class, and that class
  must still appear in the parent's declared `childWorkflows` (this is
  what gives fan-out branches the *existing*, already-tested
  `failurePolicy`/`cancellationPolicy` machinery for free — `getManagedChild`/
  `isManagedChild` match by declared child class regardless of trigger).
- `WorkflowStateTransitions.completeStep` gained a `join` branch (checked
  after `waitForSignal`/`sleepUntil`, same mutual-exclusion shape): sets
  status `'waiting-children'`, records `joinId`/`joinPolicy`/`resumeStep`.
  New `resumeFromJoin(state)` mirrors `resumeFromSleep`. `joinId`/
  `joinPolicy` added to `clearExecutionContext()`'s cleared-field set.
- `WorkflowStepPersistenceService.completeStep` computes `joinId` as
  `` `${workflowId}:${step}:${historyCount + 1}` `` (same shape as the
  existing `stepExecutionKey` convention) and, after the step's own
  transaction commits, registers an `afterCommit` callback to
  `ChildWorkflowService.spawnFanOut()` — mirroring exactly how
  `WorkflowLifecycleService.create()` already defers `startChildren()`
  until after its own commit, for the same reason (each child is its own
  independently-committed aggregate; partial-spawn failure is handled by
  explicit compensating action — cancel siblings, fail the parent — not
  by relying on cross-aggregate transactional rollback).
- New `ChildWorkflowService.spawnFanOut(workflow, state, specs)`: starts
  one child per spec (validating each references a class declared with
  `trigger: 'step'`), tags each with the parent's `joinId`, and on partial
  failure cancels already-started siblings and fails the parent — same
  shape as `startChildren()`'s failure handling, written as its own block
  (see Why on the shared-helper call).
- `ChildWorkflowService.onChildCompleted` is no longer a no-op stub: it
  now calls `checkJoinQuorum()`, which no-ops unless the parent is
  currently `'waiting-children'` *and* the completed child's `joinId`
  matches the parent's, then counts `'completed'` siblings scoped to that
  `joinId` (via the existing `findByParentWorkflowId`, filtered in
  memory — no new query, consistent with `ARCH.md`'s "computed on demand,
  not a new counter table" call) and resumes the parent via the new
  `WorkflowExecutor.resumeJoin()`/`WorkflowStateService.resumeJoin()`
  (mirroring `wake()`'s shape exactly: validates status, applies
  `resumeFromJoin`, runs) once the configured `joinPolicy` quorum is met.
  A `resumeJoin()` failure (e.g. a lease race) is caught and logged, not
  thrown — a missed wake here is a known, documented gap (see Remaining
  TODO), not a crash.
- New `joinId`/`joinPolicy` columns + `(parentWorkflowId, joinId)` index on
  `workflow_executions`, migration `WorkflowJoin1752500000000`.

## Why

- `spawnFanOut()` was written as its own self-contained block rather than
  factoring a shared helper with `startChildren()`'s nearly-identical
  partial-failure handling — they differ enough (static list with empty
  input vs. dynamic specs with per-branch input and a `trigger: 'step'`
  declaration check that must happen *per-entry*, inside the
  `Promise.allSettled` map, to preserve existing per-entry error
  isolation) that forcing a shared abstraction risked obscuring more than
  it saved. Recorded as a deliberate call, not an oversight — Section 17
  favors reuse, but not reuse that fights the shapes being reused.
- Quorum counts only `'completed'` siblings, not "resolved" (completed or
  permanently failed). This means a `joinPolicy: 'all'` fan-out where one
  branch has `failurePolicy: 'ignore'` and later fails permanently will
  never resume — a real, known limitation, not silently papered over (see
  Remaining TODO). `'fail-parent'`/`'compensate-parent'` failure policies
  don't hit this at all, since they take the parent out of
  `'waiting-children'` directly the moment a branch fails — `checkJoinQuorum`
  correctly no-ops once `parent.status !== 'waiting-children'`. Solving
  the `'ignore'`/`'retry-child'`-exhausted case properly requires deciding
  what "the join step sees a permanently-failed branch" should look like
  (surface partial results? require the join step to inspect sibling
  statuses itself?) — a real design question `ARCH.md` didn't answer, so
  it wasn't invented here.
- `resumeJoin()` acquires the parent's lease (mirrors `wake()`, unlike
  `failParent`'s existing no-lease pattern for `compensate-parent`/
  `fail-parent`) because it *runs* the parent's step handlers, not just
  flips a status field — running steps without the lease would let two
  concurrent sweeps/completions drive the same parent simultaneously,
  exactly the hazard the lease exists to prevent.

## Tests

`libs/workflow` suite is now 47 spec files / 426 tests (up from 47/397 —
same file count since all additions extended existing spec files).
Extended `transitions.spec.ts` (join branch + `resumeFromJoin`),
`validator.spec.ts` (`'waiting-children'` invariants),
`step-result.validator.spec.ts` (spawnChildren validation),
`executor.spec.ts`/`state/service.spec.ts` (`resumeJoin`),
`step-persistence.spec.ts` (updated call-arity), and substantially
extended `child-workflow.service.spec.ts` (+25 tests: trigger filtering,
`spawnFanOut` happy/empty/undeclared-class/partial-failure paths, and the
full `onChildCompleted`/join-quorum matrix — status guard, joinId
mismatch, `'all'`/`'any'`/`{min}` policies met and not-met, and the
resumeJoin-throws-is-caught path). Full monorepo suite: 103 suites / 856
tests, all passing. Also verified via the real-module-bootstrap
integration spec (`workflow-retry.integration.spec.ts`) that the new
`WorkflowStepPersistenceService → ChildWorkflowService` DI edge resolves
correctly alongside the existing `WorkflowExecutor ↔ ChildWorkflowService`
forward-referenced pair.

## Build

PASS (`npx tsc --noEmit -p tsconfig.json`)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- **Known limitation, not fixed this loop:** `joinPolicy: 'all'` combined
  with a fan-out branch whose `failurePolicy` is `'ignore'` (or
  `'retry-child'` that exhausts its retries) will never satisfy quorum —
  the parent stays `'waiting-children'` forever, since only `'completed'`
  siblings count and a permanently-failed branch can never become
  `'completed'`. Not silently shipped as "working" — flagged explicitly so
  a future loop makes a deliberate semantics decision (see Why) rather
  than discovering this as a production incident.
- **Known limitation, not fixed this loop:** if `resumeJoin()` fails when
  quorum is met (e.g. a concurrent lease holder), the parent has no other
  wake trigger — unlike sleeping workflows (Loop 004), there's no
  auto-recovery sub-sweep re-checking stuck `'waiting-children'` parents.
  Deliberately scoped out to keep this already-large change reviewable;
  the mitigating factor is that the failure is logged, so it's operationally
  visible rather than silent.
- No `ARCH.md`-level decision needs updating — the actual implementation
  matches the documented design's Key Decisions, with the two deviations
  above recorded as implementation-time discoveries in this entry.

## Next Loop

- All five items from `ARCH.md` Design 001 are now implemented. No
  Critical/High findings open elsewhere in `libs/workflow`. The two
  documented known limitations above (join-quorum-vs-permanent-failure
  semantics, stuck-join recovery sweep) are the natural next candidates if
  this feature area gets revisited — both require a deliberate design
  decision first, not just an implementation pass.

# Loop 009

**Library:** libs/workflow
**Date:** 2026-07-18

## Goal

Fix the first of Loop 008's two documented known limitations, per explicit
user request: `joinPolicy: 'all'` deadlocking forever when a fan-out branch
permanently fails via `failurePolicy: 'ignore'` (or `'retry-child'` once
its retries are exhausted), since quorum previously only counted
`'completed'` siblings.

## Files Reviewed

- Loop 008's own "Why" section (the semantics question it deliberately
  left open: what should "all branches accounted for" mean when a branch
  can never succeed?) and `child-workflow.service.ts`'s existing
  `retryChild()` (to confirm exactly how a `'retry-child'` failure becomes
  "permanent" — `attempts >= maxRetries`, logged as "will remain in failed
  status", no exception thrown) and `onChildFailed`'s switch (to find where
  a re-check needs to hook in for failures, not just completions).

## Problems Found

The limitation exactly as documented in Loop 008 — confirmed, not
rediscovered: `isJoinQuorumMet` counted only `status === 'completed'`
siblings for every policy including `'all'`, so a permanently-`'failed'`
sibling could never be counted, and nothing ever re-checked quorum on a
*failure* event in the first place (only `onChildCompleted` called into
the quorum check; `onChildFailed`'s `'ignore'`/`'retry-child'`-exhausted
paths just returned).

## Changes Made

- Redefined what `'all'` means: **every branch has reached a terminal
  outcome** (`'completed'`, `'cancelled'`, or a `'failed'` branch the
  engine will never retry again), not that every branch succeeded. New
  `isChildResolved(child, definition)`: completed/cancelled → resolved;
  failed + `failurePolicy: 'ignore'` → resolved immediately; failed +
  `'retry-child'` → resolved only once `failureCount >= maxRetries`; else
  not resolved (still in-flight). `'any'`/`{ min }` are unchanged — they
  still count only `'completed'` siblings, since "resume once N branches
  *succeed*" is their whole point and wasn't the reported problem.
  `isJoinQuorumMet` now takes the `RegisteredWorkflow` (to look up each
  sibling's own `WorkflowChildMetadata` via the existing `findDefinition`)
  instead of a plain completed/total count pair.
- `checkJoinQuorum` reworked to take just `parentWorkflowId` and reload the
  parent fresh via `stateService.load()`, rather than trusting a
  caller-passed `parent` object. This became necessary once a second call
  site was added (see below): `onChildFailed`'s `'retry-child'` branch can
  itself trigger a nested `resume()` that changes the parent before
  `onChildFailed`'s own locally-held `parent` reference would reflect it —
  reloading avoids acting on a stale `parent.status`.
- `onChildFailed` now calls `checkJoinQuorum(parent.workflowId)` (guarded
  by `child.joinId` being set, i.e. the failure belongs to an active
  fan-out) at the end of both the `'ignore'` case and the `'retry-child'`
  case — the two paths that can leave a child permanently `'failed'`
  without otherwise notifying anything. `'fail-parent'`/`'compensate-parent'`
  don't need this hook: they already pull the parent out of
  `'waiting-children'` directly on the first such failure.

## Why

- `'all'` was redefined to "all resolved" rather than teaching quorum to
  treat a specific failure as a substitute success, because the engine has
  no principled way to decide *what the join step should see* for a
  partially-failed fan-out — that's the join step's call, made with
  `ChildWorkflowService.findChildren()` if it needs to inspect what
  happened. The alternative (inventing a result-passing mechanism so the
  join step doesn't have to query) is a real, larger feature Loop 008
  correctly scoped out, and this fix doesn't try to sneak it in.
- `'any'`/`{ min }` were deliberately left counting only successes. Loop
  008's limitation was specifically about `'all'` deadlocking; making
  `'any'`/`{ min }` also count failures would change what "resume once N
  branches succeed" means without a reported problem motivating it, and
  they have their own separate (unaddressed) failure mode — a `{ min: 2 }`
  quorum that becomes mathematically impossible once too many siblings
  fail — which needs its own decision, not a side effect of this fix.
- Reloading the parent in `checkJoinQuorum` instead of trusting the
  passed-in state was the direct, minimal fix for a staleness bug that
  became *reachable* only because this loop added a second call site
  (`onChildFailed`) — not a hypothetical worry invented for its own sake.

## Tests

`libs/workflow` suite is now 47 spec files / 434 tests (up from 47/426).
Extended `child-workflow.service.spec.ts` (+8 tests): `'all'` resuming once
an `'ignore'`-policy sibling permanently fails, `'all'` resuming once every
`'retry-child'` sibling exhausts retries, `'all'` *not* resuming while a
`'retry-child'` sibling still has attempts left, `'any'` still requiring an
actual success (not satisfied by a permanent failure), and a new
`onChildFailed / join quorum` block covering both new call sites (the
`'ignore'` and exhausted-`'retry-child'` hooks) plus a no-op check for a
failed child with no `joinId`. Full monorepo suite: 103 suites / 864 tests,
all passing.

## Build

PASS (`npx tsc --noEmit -p tsconfig.json`)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- Loop 008's second documented limitation (no auto-recovery sweep for a
  stuck `'waiting-children'` parent if `resumeJoin()` itself fails when
  quorum is met) is unaffected by this fix and remains open.
- The `{ min: N }` "impossible to reach" case noted in Why above is a new,
  narrower observation from this loop, not yet acted on.

## Next Loop

- Candidates, in no particular priority: the stuck-join recovery sweep
  (Loop 008's second limitation), the `{ min: N }`-impossibility case
  noted above, or a way for a join step to receive fan-out results without
  having to call `findChildren()` itself. None of these are Critical/High;
  `libs/workflow` remains at a stopping point per Section 16 absent a new
  concrete ask.

# Loop 010

**Library:** libs/workflow
**Date:** 2026-07-18

## Goal

Fix the second of Loop 008's two documented known limitations, per
explicit user request: a `'waiting-children'` parent whose join quorum was
already met has no wake trigger if `ChildWorkflowService.checkJoinQuorum`'s
`resumeJoin()` call fails the first time (e.g. a lease race) — unlike
sleeping workflows (Loop 004), there was no recovery-sweep safety net.

## Files Reviewed

- `WorkflowAutoRecoveryService.recover()`'s four existing sub-sweeps
  (recoverable/stuck/expired-waiting/sleeping) — confirmed the established
  shape: a `WorkflowRecoveryService` finder method backed by an optional
  `WorkflowStateStore` method, a try/catch-and-continue loop in the
  sweep, a per-sub-sweep counter folded into the summary log and a
  dedicated `WorkflowMetrics` call. Followed this shape exactly rather
  than inventing a different one for joins.
- `ChildWorkflowService.checkJoinQuorum` (Loop 009) — was `private` and
  returned `void`; needed to become callable from `WorkflowAutoRecoveryService`
  and to report back whether it actually resumed anything, for the sweep's
  count.
- Confirmed via `TypeOrmWorkflowStateStore`'s existing `findWaiting()` (a
  plain `findByStatus('waiting')`) that a `findWaitingChildren()`
  counterpart was a trivial, low-risk addition — no new query shape needed.

## Problems Found

The limitation exactly as documented in Loop 008 — confirmed, not
rediscovered.

## Changes Made

- `WorkflowStateStore.findWaitingChildren?(limit?)` (optional port method)
  + `TypeOrmWorkflowStateStore` implementation (`findByStatus('waiting-children')`,
  mirrors `findWaiting()`).
- `WorkflowRecoveryService.findWaitingChildrenExecutions(limit?)`, mirrors
  `findSleepingReady`.
- `ChildWorkflowService.checkJoinQuorum` made public and changed to return
  `Promise<boolean>` (whether it actually called `resumeJoin()` successfully),
  so the sweep can report a precise count instead of just "checked N."
  Behavior for its two existing call sites (`onChildCompleted`,
  `onChildFailed`) is unchanged — they already discarded the return value.
- `WorkflowAutoRecoveryService` gained a fifth sub-sweep: fetch every
  currently-`'waiting-children'` parent via the new finder, and call
  `ChildWorkflowService.checkJoinQuorum(workflowId)` on each — a no-op for
  the overwhelmingly common case where quorum genuinely isn't met yet,
  since `checkJoinQuorum` re-evaluates fresh rather than trusting anything
  cached. New `WorkflowMetrics.sweepStuckJoinResumed(count)` (required,
  matching `sweepSleepWoken`'s existing precedent rather than the optional
  `compensationFailed` pattern — see Why).

## Why

- `checkJoinQuorum` returning a boolean (rather than the sweep just
  calling it and assuming success) was necessary for the metric to mean
  anything — without it, `sweepStuckJoinResumed` could only report "how
  many waiting-children parents exist," not "how many were actually stuck
  and got un-stuck," which is the actually-useful signal.
- No sub-sweep interval/threshold config was added for this (unlike e.g.
  `autoResume.intervalMs`) — a `'waiting-children'` parent has no natural
  "time to next check" the way a sleeping workflow's `sleepUntil` does
  (resumption is event-driven, not time-driven), so re-checking every
  currently-waiting parent on every sweep tick is the only sensible
  cadence; gating it further would need a threshold with no principled
  value to default to.
- `sweepStuckJoinResumed` was added as a required `WorkflowMetrics` method,
  following Loop 004's `sweepSleepWoken` precedent (all sweep-count
  methods required) rather than Loop 001's `compensationFailed` precedent
  (optional, to protect external implementations). Noting explicitly:
  this is consistent with the *existing* pattern in this file, not a
  reconsideration of which pattern is right — `libs/workflow` is published
  separately as `@ows4444/nest-workflow`, so any external
  `WorkflowMetrics` implementation already had to add `sweepSleepWoken`
  when that shipped; adding another required sweep method follows the
  same convention rather than introducing a third, inconsistent style.

## Tests

`libs/workflow` suite is now 47 spec files / 437 tests (up from 47/434).
Extended `auto-recovery.service.spec.ts` (+3 tests: resumes and counts a
join whose quorum is now met, does not count one still unmet, continues
the sweep past one re-check that throws). Full monorepo suite: 103 suites
/ 867 tests, all passing — including the real-module-bootstrap integration
spec, confirming the new `WorkflowAutoRecoveryService → ChildWorkflowService`
DI edge resolves cleanly alongside the existing `Executor ↔
ChildWorkflowService` forward-referenced pair.

## Build

PASS (`npx tsc --noEmit -p tsconfig.json`)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- Both of Loop 008's originally-documented known limitations are now
  closed. The two items noted in Loop 009's "Next Loop" (the `{ min: N }`
  impossibility case, and join-step result visibility) remain open and
  unaddressed by this loop.

## Next Loop

- No Critical/High findings open. Remaining candidates are the same two
  carried from Loop 009: `{ min: N }`-impossibility handling, and a
  cleaner way for a join step to see fan-out outcomes without calling
  `findChildren()` itself. `libs/workflow` is at a stopping point per
  Section 16 absent a new concrete ask.

# Loop 011

**Library:** libs/workflow
**Date:** 2026-07-18

## Goal

Fix the `{ min: N }`-impossibility case noted in Loop 009/010, per explicit
user request: a `joinPolicy: { min: N }` (or `'any'`, i.e. `{ min: 1 }`)
quorum can become mathematically unreachable if enough fan-out siblings
permanently fail (e.g. `{ min: 2 }` with 3 siblings, 2 of which already
failed via `failurePolicy: 'ignore'` — the third succeeding still can't
reach 2). Same class of deadlock as the `'all'` fix in Loop 009, just for
the count-based policies Loop 009 deliberately left unchanged.

## Files Reviewed

- `child-workflow.service.ts`'s `isJoinQuorumMet`/`isChildResolved` from
  Loop 009 — the "resolved" concept (completed/cancelled/permanently-failed)
  already existed for `'all'`; this loop reuses it to compute how many
  siblings are still *possibly* able to succeed, rather than introducing a
  second notion of "resolved."

## Problems Found

The gap exactly as noted in Loop 009's Why section ("a separate
impossible-to-reach-quorum decision this fix doesn't make") — confirmed,
not rediscovered.

## Changes Made

- Renamed `isJoinQuorumMet` → `evaluateJoin`, now returning `{
  shouldResume: boolean; unreachable: boolean }` instead of a plain
  boolean. For `'any'`/`{ min }`: still resumes once `completedCount >=
  min` (unchanged); additionally resumes — with `unreachable: true` — once
  `completedCount + stillInFlightCount < min`, i.e. even every
  currently-in-flight sibling succeeding couldn't reach `min` anymore.
  `'all'`'s behavior is unchanged (it already had no separate "impossible"
  case — reaching "everyone resolved" without success is exactly what Loop
  009 already made it tolerate).
- `checkJoinQuorum` now logs a `warn` when resuming specifically because
  quorum became unreachable (vs. genuinely met), so an operator sees *why*
  a join resumed under its configured minimum instead of silently
  wondering.

## Why

- Reused the existing `isChildResolved` notion rather than inventing a
  second "give up" concept — "still possibly able to succeed" is just "not
  yet resolved," the same computation `'all'` already needed.
- Distinct logging for the unreachable case (vs. the ordinary quorum-met
  path) was added because this one *is* operationally surprising in a way
  quorum-met isn't — a join step author configured `{ min: 2 }` expecting
  2 successes and is now running with fewer; that's worth a log line, not
  silent success-path behavior.
- Did not change `'all'` at all — Loop 009 already gave it the correct
  semantics (resume once everyone's resolved, regardless of how many
  succeeded), so there was nothing left to fix there.

## Tests

`libs/workflow` suite is now 47 spec files / 440 tests (up from 47/437).
Extended `child-workflow.service.spec.ts` (+3 tests): resumes once `{
min: 2 }` becomes unreachable (1 completed, 2 permanently failed),
does not resume while `{ min: 2 }` is still reachable (1 completed, 1
still running, 1 failed), and resumes `'any'` once its only sibling
permanently fails. Full monorepo suite: 103 suites / 870 tests, all
passing.

## Build

PASS (`npx tsc --noEmit -p tsconfig.json`)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- The join-step-result-visibility item (a join step currently has no
  direct way to see fan-out outcomes except calling
  `ChildWorkflowService.findChildren()` itself) remains open and
  unaddressed by this loop — it's a DX/API-design question, not a
  deadlock, and wasn't part of this loop's ask.

## Next Loop

- No Critical/High findings open. The only remaining candidate carried
  forward is join-step result visibility. `libs/workflow` is at a
  stopping point per Section 16 absent a new concrete ask.

# Loop 012

**Library:** libs/workflow
**Date:** 2026-07-18

## Goal

Add join-step result visibility — the last item carried across Loops 009
through 011 — per explicit user request. A join step previously had no
direct way to see which fan-out branches succeeded/failed short of
injecting `ChildWorkflowService` and re-implementing the sibling-filtering
`checkJoinQuorum` already does internally.

## Files Reviewed

- `engine/state/transitions.ts`'s `resumeFromJoin` (Loop 008) — discovered
  it clears `joinId`/`joinPolicy` via `clearExecutionContext()` *before*
  the join step ever runs, which meant even a step author willing to
  inject `ChildWorkflowService` directly had no way to know *which*
  `joinId` was theirs by the time their `execute()` ran. This was the
  actual blocker, not just "no convenience API exists."
- `engine/executor/step-executor.ts`'s `buildOperation` — where
  `WorkflowContext`/`WorkflowRuntime` are actually constructed per step
  invocation; confirmed it's the single place that would need to gain
  access to `ChildWorkflowService` to expose anything through
  `context.runtime`.
- `types/workflow-runtime.ts` — `WorkflowRuntime.isCancelled` was the
  existing precedent for "a closure over internal services, handed to the
  step without it injecting anything itself."

## Problems Found

None — pure additive feature. The one real fix embedded in it (`joinId`
surviving into the join step's own execution) is the mechanism the feature
needs to work at all, not a separately-discovered bug.

## Changes Made

- `WorkflowStateTransitions.resumeFromJoin` no longer clears `joinId`/
  `joinPolicy` — it now explicitly re-sets them after
  `clearExecutionContext()` wipes them, so they survive through the join
  step's own execution. They're still cleared the moment the join step
  itself calls `completeStep` (same `clearExecutionContext()` call every
  other transition already goes through), so nothing lingers past the one
  step that needs it.
- New `WorkflowJoinSummary` model (`succeeded`/`failed`/`pending`, each a
  `WorkflowExecutionState[]`).
- `ChildWorkflowService` gained `categorizeChild()` (shared helper —
  `evaluateJoin`, from Loop 009/011, now uses it too instead of its own
  inline resolved/succeeded counting) and public `summarizeJoin(parentWorkflowId,
  joinId)`, which loads the parent, resolves its `RegisteredWorkflow`,
  filters siblings by `joinId`, and buckets each into succeeded/failed/
  pending via `categorizeChild`.
- `WorkflowRuntime` gained an optional `joinResults?(): Promise<WorkflowJoinSummary>`.
  `WorkflowStepExecutor` (now depending on `ChildWorkflowService`) builds
  it conditionally — present only when `state.joinId` is set — as a
  closure over `ChildWorkflowService.summarizeJoin(state.workflowId,
  state.joinId)`, mirroring exactly how `runtime.isCancelled` is already a
  closure over `stateService` rather than something the step handler has
  to wire up itself.

## Why

- Chose "preserve `joinId` through the step + expose a `runtime` closure"
  over the alternative of stuffing a summary into `data` at resume time,
  because `data` is already merged/mutated by step return values and
  conflating "durable business state" with "this step's transient
  metadata about how it got here" felt like the wrong layer — `runtime`
  already exists specifically for transient, step-scoped capabilities
  (`abortSignal`, `isCancelled`), so `joinResults` belongs there by the
  same reasoning.
- Refactored `evaluateJoin` to share `categorizeChild` with `summarizeJoin`
  rather than leaving two separate succeeded/resolved-counting
  implementations, since they were computing the literal same
  classification for two different purposes (count vs. return the actual
  states) — this is the kind of "not just similar-looking, actually
  identical" duplication Section 17 argues for removing, unlike the
  `spawnFanOut`/`startChildren` duplication from Loop 008 which was
  deliberately kept separate for different reasons.
- Did not add a way to know *why* a specific sibling is `'failed'` (e.g.
  its `lastFailure`) beyond what's already on each returned
  `WorkflowExecutionState` (which already carries `.lastFailure`) — no new
  surface needed there, the existing per-state field already answers it.

## Tests

`libs/workflow` suite is now 47 spec files / 446 tests (up from 47/440).
Extended `child-workflow.service.spec.ts` (+5 tests: `summarizeJoin`
categorization, not-found error, unmanaged-sibling defensive handling),
`transitions.spec.ts` (updated the Loop 008 `resumeFromJoin` test for the
new preserve-then-clear-on-next-completeStep behavior, +1 new test proving
the clear-on-completion), and `step-executor.spec.ts` (+2 tests:
`joinResults` absent when not resuming from a join, present and correctly
delegating to `summarizeJoin` when it is). Full monorepo suite: 103 suites
/ 876 tests, all passing — including the real-module-bootstrap integration
spec, confirming the new `WorkflowStepExecutor → ChildWorkflowService` DI
edge resolves cleanly (the fourth such edge added across Loops 008/010/012,
all resolving via the same pre-existing `Executor ↔ ChildWorkflowService`
forward-referenced pair).

## Build

PASS (`npx tsc --noEmit -p tsconfig.json`)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- None outstanding. This closes the last item carried across Loops
  009–011.

## Next Loop

- No Critical/High findings open, and no carried-forward items remain.
  `ARCH.md` Design 001's five items are all implemented, and every known
  limitation raised while implementing them has been addressed. Further
  work on `libs/workflow` would come from a fresh review pass, not a
  carried-forward backlog.

# Loop 013

**Library:** libs/workflow
**Date:** 2026-07-18

## Goal

Fresh Phase 1/2 review pass, per explicit user request — not continuing
the (now-closed) ARCH.md backlog. Scoped scrutiny toward Loops 004-012
(the ARCH.md feature work), since that code had been build-and-tested but
not adversarially re-read the way Loops 1-3's original review passes
covered the pre-existing engine.

## Files Reviewed

- `child-workflow.service.ts` in full (777 lines — the file that grew the
  most across Loops 008-012) — read start to finish rather than
  incrementally, specifically looking for interactions *between* features
  added in different loops that no single loop's own review would have
  caught.
- Cross-checked `WorkflowLifecycleService.create()`'s `afterCommit`
  deferral of `startChildren()` against `WorkflowStepPersistenceService
  .completeStep()`'s identical deferral of `spawnFanOut()`, and read
  `TypeOrmWorkflowTransactionRunner.execute()`'s actual `afterCommit`
  semantics (runs sequentially, in-process, after the commit; a thrown
  callback is logged but swallowed, not re-thrown) to confirm a
  crash-or-swallowed-failure window between "parent commits to
  `'waiting-children'`" and "children actually get spawned" is real, not
  hypothetical.
- Repo-wide grep for stale references to the loop-011 rename
  (`isJoinQuorumMet` → `evaluateJoin`) and for the same
  zero-siblings-as-unreachable shape elsewhere (scheduler, etc.) — found
  nowhere else.

## Problems Found

**High**
- `evaluateJoin`'s `'any'`/`{ min }` branch computed `unreachable =
  succeededCount + stillInFlight < min` with no floor on `siblings.length`
  — unlike the `'all'` branch, which already guards with `siblings.length
  > 0 && ...`. When `siblings.length === 0`, this evaluates to `true` for
  any `min >= 1`. This state (parent already `'waiting-children'` with
  *zero* spawned children) is reachable: `WorkflowStepPersistenceService
  .completeStep()` commits the parent's transition to `'waiting-children'`
  *before* `spawnFanOut()` ever runs (deferred to the same `afterCommit`
  pattern `startChildren()` already uses for `trigger: 'onStart'`
  children) — a process crash, or `spawnFanOut()`'s own
  `parentFailureHandler.failExecution()` call itself throwing (e.g. a
  `WorkflowConcurrencyError`, silently swallowed per the transaction
  runner's afterCommit semantics above), can leave the parent stuck in
  that state with no children ever spawned. `WorkflowAutoRecoveryService`'s
  Loop-010 stuck-join sweep is the only caller that can observe this
  window — `onChildCompleted`/`onChildFailed` are both event-driven off an
  actual child, so by construction at least one sibling already exists
  whenever they fire. Net effect: the sweep meant to be a *safety net* for
  a stuck join could instead resume it prematurely with an empty
  `WorkflowJoinSummary`, before any branch ever ran.

**Low**
- A comment in `onChildFailed`'s `'ignore'` case still referenced
  `isJoinQuorumMet` by name — the method Loop 011 renamed to
  `evaluateJoin`. Stale, but harmless (a doc comment, not a behavioral
  bug) — fixed alongside the High finding since it's in the same file and
  trivial.

## Changes Made

- Added `siblings.length > 0 &&` to the `unreachable` computation in
  `evaluateJoin`'s `'any'`/`{ min }` branch, mirroring `'all'`'s existing
  guard — zero siblings now always means "not yet resolvable" rather than
  "unreachable," for both policy shapes.
- Fixed the stale `isJoinQuorumMet` comment reference to `evaluateJoin`.

## Why

- The fix intentionally does *not* attempt to solve the deeper,
  pre-existing gap it surfaces: there is no recovery mechanism at all for
  "a workflow's committed state implies an `afterCommit` side effect
  (`startChildren`, `spawnFanOut`, lifecycle-event publishing) that never
  ran or silently failed." That gap is symmetric between `trigger:
  'onStart'` children (already existed before any of this session's
  loops) and `trigger: 'step'` fan-out children (introduced in Loop 008) —
  it's a systemic characteristic of the `afterCommit` pattern itself, not
  specific to fan-out. Fully closing it would mean a new "detect
  committed-but-never-materialized side effects" sweep, a design decision
  well beyond a review-pass bug fix. This loop closes the *specific,
  newly-introduced* bad interaction (the stuck-join sweep drawing the
  wrong conclusion from that pre-existing gap), and records the broader
  gap here rather than silently expanding scope to fix it, per Section 17.
- Did not change the `'all'` branch — it was never wrong; it already had
  the guard the `'any'`/`{ min }` branch was missing.

## Tests

`libs/workflow` suite is now 47 spec files / 447 tests (up from 47/446).
New regression test on `checkJoinQuorum` directly (bypassing the
event-driven call sites, since they can't reproduce a zero-siblings state)
proving a `{ min: 2 }` join with no spawned children yet does not resume.
Full monorepo suite: 103 suites / 877 tests, all passing.

## Build

PASS (`npx tsc --noEmit -p tsconfig.json`)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- The broader "no recovery for a committed-but-never-materialized
  `afterCommit` side effect" gap (see Why) remains open, affecting both
  `startChildren()` and `spawnFanOut()` symmetrically. Not fixed this
  loop — flagged as a real architectural gap worth a deliberate design
  decision (likely a new sweep, or moving side-effect scheduling into the
  same transaction with an explicit outbox-style pattern like
  `libs/queue` already uses) rather than a quick patch.
- SRP observation, not acted on: `ChildWorkflowService` is now 777 lines
  covering five distinct concerns (static child lifecycle, failure-policy
  dispatch, fan-out spawning, join-quorum evaluation, join summarization).
  A future loop could reasonably split join-quorum/summarization into its
  own `WorkflowJoinService`, but this pass didn't attempt it — four
  separate call sites (`WorkflowStepPersistenceService`,
  `WorkflowStepExecutor`, `WorkflowAutoRecoveryService`, and the two
  lifecycle services) are already wired to the current shape, and a
  mechanical split with no behavior change has real diff cost for
  benefit that's organizational, not correctness-bearing — didn't meet
  the bar to do opportunistically inside a review pass looking for bugs.

## Next Loop

- The `afterCommit` side-effect durability gap (Remaining TODO above) is
  the most substantive open item — likely candidate for a future Design
  Mode session (Section 0) rather than an Improvement Loop patch, since it
  affects the shape of a cross-cutting pattern (not just one call site).
  The `ChildWorkflowService` SRP split is a lower-priority, purely
  organizational follow-up.

---

# Loop 014

**Library:** libs/workflow
**Date:** 2026-07-20

## Goal

Add a `@Step({ inputSpec })` validation hook, per the user's explicit request to complete this
item (previously deferred in `libs/validation`'s own loop history as "avoid speculative API
surface on a semver-sensitive package"). See `ARCH.md` Design 002.

## Files Reviewed

- `engine/executor/step-executor.ts` — where `WorkflowStepResultValidator` already runs, as the
  symmetric place to run input validation.
- `libs/workflow/package.json` — `peerDependencies` and the standalone `tsconfig.build.json`,
  confirming `@/validation` is not (and cannot be) a real dependency of this published package.
- `engine/validation/step-result.validator.ts` — the existing validator-service shape to mirror.

## Problems Found

**Critical**
- (none in the existing code — but the CRITICAL item in `ARCH.md` Design 002 is the constraint
  this whole design had to be built around: `libs/workflow` must never import `@/validation`,
  even type-only, or the published package breaks for external consumers. Resolved via a
  self-contained structural interface — see Changes Made.)

**High / Medium / Low**
- (none)

## Changes Made

- `definition/workflow-step-input-specification.ts`: new — `WorkflowStepInputSpecification<T>`,
  a self-contained interface shaped identically to `@/validation`'s `Specification<T>` but with
  zero import from it (structural typing gives interop for free).
- `WorkflowStepMetadata` gained optional `inputSpec?: WorkflowStepInputSpecification<unknown>` —
  additive, no existing `@Step(...)` registration is affected.
- `engine/validation/step-input.validator.ts`: new `WorkflowStepInputValidator`, mirroring
  `WorkflowStepResultValidator`'s shape — throws `WorkflowExecutionError` (same error type the
  result validator uses) with the specification's `explain()` messages joined, when
  `isSatisfiedBy` returns false. No-op when `inputSpec` is undefined.
- `WorkflowStepExecutor.execute` calls `inputValidator.validate(...)` immediately after resolving
  the step (before lease renewal, before entering the retry loop) — a bad input fails once,
  immediately, and is never retried (not a `WorkflowFailureError`, so `isRetriable` is false
  regardless).
- Registered `WorkflowStepInputValidator` in `public/workflow.module.ts`'s `BASE_PROVIDERS`,
  alongside `WorkflowStepResultValidator`. Exported `WorkflowStepInputSpecification` from the
  barrel; the validator service itself stays internal (same as `WorkflowStepResultValidator`).
- Appended Design 002 to `ARCH.md` before implementing, given the CRITICAL package-boundary
  constraint above.

## Why

- Explicit user request. The structural-interface-instead-of-import approach exists specifically
  to honor CLAUDE.md's instruction to treat `libs/workflow`'s public API "as a real
  semver-sensitive surface, not just an internal module" — an ordinary monorepo lib could safely
  import `@/validation` directly (as `libs/queue` and `libs/auth` now do), but this package is
  built and published standalone, so that option was never available here.

## Tests

- `step-input.validator.spec.ts`: 4 tests (no-op without inputSpec, satisfied, failure message,
  async specification support).
- `step-executor.spec.ts`: 2 new tests — `inputValidator.validate` is called with the step's
  metadata and state data before the handler runs; an input-validation failure propagates without
  invoking the handler or engaging the retry loop. Existing constructor-argument tests updated for
  the new `inputValidator` parameter.
- Confirmed via `grep -rn "@/validation" libs/workflow/src` (excluding specs) that no import was
  introduced. `libs/workflow`'s standalone `npm run build` fails on unrelated, pre-existing
  `rootDir` errors for `@/database` imports that predate this change — not something this loop
  introduced or was asked to fix.
- Full repo suite: 131 suites / 1020 tests passing.

## Build

PASS (`make check`'s `tsc --noEmit` against the monorepo root config, which is what CI actually
runs). The library's own standalone `npm run build` has a pre-existing, unrelated failure — noted
above, out of scope for this loop.

## Lint

PASS

## Remaining TODO

- Unchanged from Loop 013 (the `afterCommit` durability gap, `ChildWorkflowService` SRP split).
- The standalone `npm run build` `rootDir` failures (pre-existing, affects `@/database` imports
  too) are worth a dedicated loop if `@ows4444/nest-workflow` is ever actually published from this
  monorepo — not urgent while it's consumed in-repo via the path alias.

## Next Loop

- None forced for this item — it's complete. Priorities are as stated in Loop 013's Next Loop.

---

# Loop 015

**Library:** libs/workflow
**Date:** 2026-07-21

## Goal

Fresh, adversarial Phase 1/2 review pass over `libs/workflow` per explicit user request, plus a
required cross-check triggered by a sibling loop: `libs/database`'s `TransactionExecutor` had a
just-fixed Critical bug where `runOnTransactionCommit`/`runOnTransactionRollback`/
`runOnTransactionComplete` hooks fired based on when the user callback *settled* rather than when
the physical COMMIT/ROLLBACK actually executed (plus a stray-second-`commit()` bug for
`REQUIRES_NEW`). Task: determine whether `libs/workflow`'s `persistence: 'database'` adapter or its
own `persistence: 'typeorm'` adapter relied on the old (buggy) hook-timing behavior, and do a
genuinely fresh review of the engine rather than re-confirming prior loops' conclusions.

## Files Reviewed

- **libs/database cross-check:** `persistence/adapters/database/database-workflow-transaction-runner.ts`,
  `persistence/adapters/typeorm/stores/typeorm-workflow-transaction-runner.ts`,
  `ports/workflow-transaction-runner.ts`, and (read-only, to understand the contract being relied
  on) `libs/database/src/transaction/transaction.executor.ts` and `transaction.context.ts`.
- `engine/child-workflow/child-workflow.service.ts` in full (again — see Problems Found; this is
  the fourth loop in a row to find something new in this file after a full read, following Loops
  008/009/013).
- `engine/lifecycle/failure.service.ts`, `engine/lifecycle/completion.service.ts`,
  `engine/executor/executor.ts` — traced every call site of `WorkflowFailureService.failExecution`/
  `.handleFailure` and `WorkflowCompletionService.completeIfFinished` to confirm whether
  `ChildWorkflowService.onChildFailed`/`.onChildCompleted` run inside or outside the caller's
  active database transaction.
- `engine/retry/retry.service.ts` (the top-level, already-correct retry pattern: persists a
  `retryAt` timestamp and returns immediately — no blocking wait — relying on
  `WorkflowAutoRecoveryService`'s sweep to pick it up later) and
  `engine/retry/default-scheduler.service.ts` (`DefaultWorkflowRetryScheduler.wait`: a real
  `setTimeout`, confirming the delay in `ChildWorkflowService.retryChild` is a genuine real-time
  wait, not a test-only abstraction).

## Problems Found

**Critical (libs/database cross-check — no `libs/workflow` code change needed)**
- Not applicable — see "libs/database cross-check outcome" below for the full analysis. Both
  `libs/workflow` transaction runners were already safe against the old bug; recorded here per the
  task's explicit instruction to report the outcome even when no fix is required.

**High**
- `ChildWorkflowService.onChildFailed`'s `'retry-child'` case called `this.retryChild(definition,
  child)` **synchronously**, and `retryChild()` — when the child hasn't exhausted its retries —
  does `await this.retryScheduler.wait(this.retryJitter.apply(delay, attempt))` before resetting
  and resuming the child. `DefaultWorkflowRetryScheduler.wait` is a real `setTimeout`
  (`DEFAULT_CHILD_RETRY_DELAY_MS = 5000`, exponential backoff — so 5s/10s/20s/... in practice).
  `onChildFailed` is called from `WorkflowFailureService.failExecution`, which is itself always
  invoked from inside an already-open database transaction (every `WorkflowExecutor.execute`/
  `.resume`/`.wake`/`.resumeJoin`/`.signal` wraps its whole body, including the failure-handling
  catch block, in `transactionRunner.execute`/`.executeOrJoin`). Since `executeOrJoin`/`execute`
  simply join an already-active transaction rather than starting a new one, the entire
  `retryChild()` call — including the multi-second `setTimeout` wait, and the subsequent
  `stateService.save()` + `executor.resume()` (which itself recursively runs the child's next step,
  fully nested inside the still-open outer transaction) — executed while the failing child's own
  database transaction was still open and uncommitted. Concretely, this meant: (1) a database
  connection/transaction held open for the full backoff delay on every `'retry-child'` failure —
  real connection-pool exhaustion and lock-contention risk under any nontrivial fan-out/retry load
  (ci.loop §12); (2) the resumed child's next step running fully nested inside a different logical
  operation's uncommitted transaction, rather than the failure's own record becoming durable before
  further work began (ci.loop §7's atomicity-between-state-persistence rule). This diverges from
  the codebase's own established, deliberate pattern: the top-level `WorkflowRetryService.retry()`
  never blocks — it persists a `retryAt` timestamp and returns, relying on
  `WorkflowAutoRecoveryService`'s sweep to pick it up later — and `WorkflowFailureService
  .failExecution` itself already defers its own retry/compensation scheduling into an
  `afterCommit` callback for exactly this reason. Loop 008's own notes asserted `onChildFailed`
  runs "after the child's own state-transition transaction has already committed" — that assumption
  was never actually true for the synchronous call path and had gone unverified across five loops
  (008–013) that built and hardened join-quorum logic on top of it.

## Changes Made

- `ChildWorkflowService` now injects `WORKFLOW_TRANSACTION_RUNNER` (`WorkflowTransactionRunner`).
- `onChildFailed`'s `'retry-child'` case now defers the entire `retryChild()` call plus its
  follow-up `checkJoinQuorum()` re-check into `this.transactionRunner.afterCommit?.(async () =>
  {...})`, mirroring the exact pattern `WorkflowFailureService.failExecution` already uses for its
  own retry/compensation scheduling. This guarantees the backoff wait and the resumed child's
  execution both run only after the failing child's own transaction has actually committed — no
  more holding a connection/transaction open across a real-time timer, and no more nesting a full
  step execution inside an unrelated, still-open transaction.
- The `'ignore'` and `'fail-parent'`/`'compensate-parent'` cases were left unchanged — they don't
  block on a real-time wait, so this specific defect doesn't apply to them (the broader question of
  whether *all* cross-aggregate `onChildCompleted`/`onChildFailed` work should be deferred to
  `afterCommit` is intentionally left open — see Remaining TODO).

## Why

- Scoped the fix narrowly to the one call path with a genuine, severe defect (a real-time blocking
  wait held open inside someone else's database transaction) rather than restructuring
  `onChildCompleted`/`onChildFailed` wholesale, per Section 17's "minimize diff" and Section 18's
  requirement that HIGH-risk changes (this touches retry/failure semantics — workflow semantics is
  an explicit HIGH category) be justified narrowly, not opportunistically expanded.
- Verified via `TypeOrmWorkflowTransactionRunner.execute()` that its internal `AsyncLocalStorage`
  transaction-context scope closes (`isActive()` becomes `false`) before its `afterCommit`
  callbacks run — so deferring via `afterCommit` genuinely gives the deferred work its own fresh
  transaction rather than silently rejoining the just-closed one. For the `database` backend,
  `DatabaseWorkflowTransactionRunner.afterCommit` delegates to `libs/database`'s
  `runOnTransactionCommit`, which (per the sibling loop's fix) now fires strictly after the
  physical COMMIT — a strict improvement over the pre-fix synchronous-inline behavior regardless of
  backend.
- Did not attempt to also guard `checkJoinQuorum`'s non-`resumeJoin()` steps (`stateService.load`,
  `registry.get`, `findByParentWorkflowId`) with a try/catch inside the new `afterCommit` closure —
  they were already unguarded in the pre-existing code at the same call site, and moving *when*
  they run (post-commit instead of pre-commit) doesn't change whether they can throw; not a
  regression introduced by this loop, and adding new defensive error handling there wasn't part of
  the identified defect.

## libs/database cross-check outcome

- **`persistence: 'database'` adapter (`WorkflowDatabasePersistenceModule` /
  `DatabaseWorkflowTransactionRunner`): not affected by the old bug, and does not rely on the fixed
  hook-timing behavior in any fragile way.** `DatabaseWorkflowTransactionRunner.execute()`/
  `.executeOrJoin()` both call `TransactionExecutor.execute(operation)` with **no `options`
  argument** — meaning every call goes through `TransactionExecutor`'s default path
  (`runOwnedTransaction`, the fixed "commit hooks fire after the physical COMMIT, inside the same
  ALS scope" path) or, if a transaction is already active, simply joins it. `libs/workflow` never
  passes `{ propagation: TransactionPropagation.REQUIRES_NEW }` (the specific propagation mode that
  had the stray-second-`commit()` bug) anywhere — it has no concept of nested/independent
  sub-transactions of its own; nesting is handled entirely by `WorkflowTransactionRunner
  .execute`/`.executeOrJoin` simply joining an already-active transaction. So neither of the two
  bugs fixed in the sibling loop had a reachable path through `libs/workflow`'s database-backed
  adapter. `WorkflowStateService`, `WorkflowStepPersistenceService`, `WorkflowFailureService`, etc.
  all call `afterCommit` (→ `runOnTransactionCommit`) expecting it to fire only once the state
  write is durable — that expectation was violated before the sibling fix and is honored now,
  transitively, with zero code change required on the workflow side.
- **`persistence: 'typeorm'` adapter (`WorkflowPersistenceModule` /
  `TypeOrmWorkflowTransactionRunner`): entirely independent of `libs/database`, and was already
  correct.** This adapter runs its own transactions directly via TypeORM's `DataSource.transaction()`
  helper (not `libs/database`'s `TransactionExecutor` at all) and maintains its own separate
  `AsyncLocalStorage`-backed callback queue for `afterCommit`. `dataSource.transaction()` only
  resolves after TypeORM has physically committed, and the callback queue is drained strictly after
  that `await` — so commit-hook firing was already correctly ordered against the physical commit,
  independent of whatever bug existed in `libs/database`'s own `TransactionExecutor`. No overlap,
  no shared code path, no fix needed.
- Net conclusion: both of `libs/workflow`'s persistence backends were already safe. The High-severity
  bug found and fixed this loop (`ChildWorkflowService.retryChild`'s inline blocking wait) is
  unrelated to the `libs/database` bug — it would have held a transaction open regardless of
  whether the underlying commit-hook timing was correct, since the problem was that the wait ran
  *before* any commit was ever attempted, synchronously inside the still-open transaction.

## Tests

`libs/workflow` suite is now 48 spec files / 454 tests (up from 47/447 — one new test in
`child-workflow.service.spec.ts` asserting the retry-child policy defers to `afterCommit` and does
not touch `stateService`/`executor` synchronously; six existing retry-child tests updated to flush
the captured `afterCommit` callback before asserting on its effects). Full monorepo suite: 133
suites / 1049 tests, all passing.

## Build

PASS (`npm run typecheck` — `tsc --noEmit`)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- `ChildWorkflowService.onChildCompleted`'s call into `checkJoinQuorum()` → `executor.resumeJoin()`
  is still called synchronously, nested inside the completing child's own open transaction (same
  general shape as the bug fixed this loop, minus the real-time timer wait — it "only" nests a full
  step execution inside an unrelated transaction rather than also holding a connection open across
  a `setTimeout`). Not fixed this loop: it has no blocking real-time wait, so its severity is lower,
  and Loop 013 already documented the closely-related, broader "no recovery for a
  committed-but-never-materialized `afterCommit` side effect" gap as a candidate for a future Design
  Mode session rather than a quick patch — deferring `onChildCompleted` too belongs in that same
  deliberate design pass, not bundled reactively into this loop's narrower fix.
- Unchanged from Loop 013/014: the `afterCommit` side-effect durability gap, the `ChildWorkflowService`
  SRP split (now more relevant than ever — this is the fifth loop in a row to touch this file), and
  the standalone `npm run build` `rootDir` pre-existing failure (not urgent while consumed in-repo).

## Next Loop

- Strongest candidate: revisit whether `onChildCompleted`/`onChildFailed`'s remaining synchronous,
  transaction-nested calls (now just the `'ignore'`/`'fail-parent'`/`'compensate-parent'` cases and
  `onChildCompleted` itself) should uniformly move to `afterCommit`, as part of the same Design Mode
  session Loop 013 flagged for the broader `afterCommit`-durability question — doing it piecemeal
  loop-by-loop each time a concrete defect is found (as this loop did) risks leaving an inconsistent
  half-migrated state.
- `ChildWorkflowService`'s SRP split (join-quorum/summarization → its own service) remains a
  lower-priority, purely organizational follow-up.

---

# Loop 016

**Library:** libs/workflow
**Date:** 2026-07-22

## Goal

Fix the `onChildCompleted` synchronous-transaction-nesting bug Loop 015 identified and explicitly
deferred, per direct user request.

## Files Reviewed

- `libs/workflow/src/engine/lifecycle/completion.service.ts`
- `libs/workflow/src/engine/child-workflow/child-workflow.service.ts`
- `libs/workflow/src/engine/lifecycle/completion.service.spec.ts`
- `libs/workflow/src/engine/child-workflow/child-workflow.service.spec.ts`

## Problems Found

**Critical**
- None

**High**
- `WorkflowCompletionService.completeIfFinished()` called `ChildWorkflowService.onChildCompleted()`
  synchronously, before registering its own `afterCommit` callback for the completion event. When
  `onChildCompleted` finds `child.joinId` set, it calls `checkJoinQuorum()` → `executor.resumeJoin()`,
  which runs the parent's actual join-step logic — not a status flip. That ran nested inside the
  completing child's own still-open completion transaction, exactly matching the shape of the bug
  fixed in Loop 014/015 for `retry-child` (real work held a transaction open; here a nested nested
  step execution, rather than a blocking timer, is the payload) — Loop 015 named this exact call site
  in its Remaining TODO and deliberately left it for a follow-up.
- Same defect found in a second, previously-unnoticed spot while fixing the above: `onChildFailed`'s
  `'ignore'` case also called `checkJoinQuorum()` synchronously — inside `WorkflowFailureService
  .failExecution`'s still-open failure transaction, the same way the pre-Loop-014 `retry-child` case
  did. Only `retry-child` was deferred to `afterCommit` in Loop 014; `'ignore'` was missed. Fixed in
  the same pass since it's the identical root cause and fix shape, not a separate design question.

**Medium**
- None

**Low**
- None

## Changes Made

- `completion.service.ts`: wrapped the `this.children.onChildCompleted(parent, persisted)` call in
  `this.transactionRunner.afterCommit?.(...)`, matching the pattern already used two lines below it
  for the completion event.
- `child-workflow.service.ts`: wrapped the `'ignore'` case's `checkJoinQuorum(parent.workflowId)`
  call in `this.transactionRunner.afterCommit?.(...)` — the transaction runner was already injected
  into this class for the `retry-child` case.
- Updated `completion.service.spec.ts`'s test harness from a single captured `afterCommitCallback` to
  an array + `flushAfterCommit()` helper (mirroring the pattern already in
  `child-workflow.service.spec.ts`), since this loop's fix means the harness now needs to capture two
  independent deferred callbacks (`onChildCompleted`, `publisher.completed`) instead of one.
- Updated two existing tests (one per file) that asserted the old synchronous-call behavior to instead
  assert the call is *not* made before `flushAfterCommit()`, then *is* made after — same shape as the
  existing `retry-child` tests.

## Why

Loop 015 explicitly scoped this out as lower-urgency (no blocking real-time wait, unlike the
`retry-child` case) and suggested bundling it into a future Design Mode pass covering the broader
`afterCommit`-durability question. The user asked for this specific fix directly, which changes the
prioritization — doing the narrow, mechanical part of "these three `checkJoinQuorum()` call sites all
defer to `afterCommit`, matching the pattern already established for `retry-child`" doesn't require
resolving the broader durability question Loop 013 raised (what happens if the process crashes
between commit and an `afterCommit` callback running) — that question applies equally to the
already-deferred `retry-child`/`publisher.completed` calls today and isn't made worse by adding two
more callers to the same existing mechanism.

## Tests

`libs/workflow` suite: 48 spec files / 454 tests, all passing (2 pre-existing tests updated to assert
the new deferred timing rather than the old synchronous one; no net change in test count — this loop
tightened existing assertions rather than adding coverage for new behavior). Full monorepo suite: 133
suites / 1049 tests, all passing.

## Build

PASS (`npm run typecheck` — `tsc --noEmit`)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- Unchanged from Loop 013/014/015: the broader `afterCommit` side-effect durability gap (a crash
  between physical commit and the deferred callback running silently drops the callback — applies to
  every `afterCommit` user in this file, not just the two touched this loop) remains a Design Mode
  question, not a loop-sized fix. `ChildWorkflowService`'s SRP split remains a lower-priority
  organizational follow-up — this is the sixth loop in a row to touch this file.

## Next Loop

- The three `checkJoinQuorum()` call sites (`onChildCompleted`, `onChildFailed`'s `'ignore'` case,
  `onChildFailed`'s `'retry-child'` case) are now uniformly deferred to `afterCommit` — Loop 015's
  "piecemeal vs. uniform" concern about this specific call is resolved. The broader durability
  question (Loop 013) is still open and is the better next target than further piecemeal fixes here.
  lower-priority, purely organizational follow-up.

---

# Loop 017

**Library:** libs/workflow
**Date:** 2026-07-22

## Goal

Close the broader `afterCommit` durability gap Loops 013–016 repeatedly named and deferred as a
Design Mode question: a process crash between a state change's commit and its deferred
`afterCommit` callback running silently drops that side effect, with no record it was ever due.
Direct user request to fix all affected call sites in one pass, not just the highest-severity one.

## Files Reviewed

- Every `afterCommit?.(...)` call site in the engine: `lifecycle.service.ts` (`create`),
  `step-persistence.ts` (`completeStep`'s fan-out spawn), `executor.ts` (`cancel`, `signal`),
  `child-workflow.service.ts` (`onChildFailed`'s `'ignore'`/`'retry-child'` cases),
  `completion.service.ts` (`onChildCompleted`, `publisher.completed`), `state/service.ts`
  (`cancelInternal`'s publisher calls), `failure.service.ts` (publish + retry/compensation
  scheduling).
- `engine/retry/auto-recovery.service.ts` / `recovery.service.ts` — the existing sweep
  infrastructure, particularly the "waitingOnChildren" backstop Loop 013-era work added
  specifically for `checkJoinQuorum`, to see what was already covered.
- `persistence/adapters/typeorm/entities/workflow-state.entity.ts`,
  `mappers/workflow-state.mapper.ts`, `stores/typeorm-workflow-state.store.ts`,
  `persistence/workflow-database-persistence.module.ts` /
  `workflow-persistence.module.ts` — confirmed both persistence backends (`'typeorm'` and
  `'database'`) share the exact same `TypeOrmWorkflowStateStore`/entities/migrations (only the
  transaction-runner implementation differs), so only one schema/store change was needed, not two.
- `models/workflow-child-spawn-spec.ts`, `child-workflow.service.ts`'s `spawnFanOut`/`startChildren` —
  confirmed both call `WorkflowExecutor.execute`/`.cancel`, i.e. open a *second* transaction, which is
  the actual reason these are deferred to `afterCommit` in the first place (not an oversight) — so the
  fix couldn't just "not defer it," it needed a durable marker.

## Problems Found

**High**
- Five `afterCommit` call sites had no crash backstop at all: `create()`'s `startChildren` (declared
  auto-start children silently never start), `completeStep`'s `spawnFanOut` (fan-out children never
  spawn), `executor.cancel()`'s `cancelChildren` (children of a cancelled parent orphaned, running
  forever), `onChildFailed`'s `'retry-child'` case (`retryChild()` never runs — a retriable child
  failure becomes permanent with no trace a retry was due), `failExecution`'s retry/compensation
  scheduling (the single most severe case: a top-level workflow that should retry after failure
  instead sits permanently `'failed'`, silently, forever).
- One call site was *already* covered and needed no fix: `checkJoinQuorum` (from `onChildCompleted`
  and the `'ignore'` failure policy) is re-evaluated by the existing "waitingOnChildren" sweep for any
  parent still `'waiting-children'` — Loop 013-era work already solved this one.
- The remaining call sites (`publisher.started/completed/failed/expired/cancelled/signalled`,
  `signalProcessor.complete`) are event-only — a dropped callback there is a missed notification, not
  a stuck workflow, so left alone; adding durability there would be scope creep with no correctness
  payoff.

## Changes Made

- `models/workflow-pending-effect.ts` (new): `WorkflowPendingEffect` discriminated union — one variant
  per unprotected call site above. `spawn-fan-out`'s specs are the child workflow's registered *name*
  (string), not `WorkflowChildSpawnSpec`'s `Type<unknown>` class reference — a class reference isn't
  JSON-serializable, and `WorkflowExecutor.execute` already accepts a plain name.
- `models/workflow-execution-state.ts`: added `pendingEffect?: WorkflowPendingEffect`.
- `persistence/adapters/typeorm/entities/workflow-state.entity.ts` /
  `mappers/workflow-state.mapper.ts`: mapped the new field (JSON column, nullable); added an
  `updatedAt` index backing the sweep's staleness query.
- `persistence/adapters/typeorm/migrations/1752600000000-WorkflowPendingEffect.migration.ts` (new):
  adds the column + index; registered in `migrations/index.ts`'s `WORKFLOW_MIGRATIONS`.
- `ports/workflow-state-store.ts` / `typeorm-workflow-state.store.ts`: added optional
  `findPendingEffects(olderThanMs, limit)` — `pendingEffect IS NOT NULL AND updatedAt < threshold`.
- `constants/workflow.constants.ts`: `DEFAULT_PENDING_EFFECT_GRACE_MS` (2 minutes) — how long a marker
  sits unconfirmed before the sweep treats it as dropped rather than still in-flight (generous enough
  to clear `retry-child`'s real backoff wait under normal conditions).
- `engine/state/service.ts`: `WorkflowStateService.setPendingEffect(state, effect)` (must be called
  inside the same transaction as the state change the effect originates from) and
  `clearPendingEffect(workflowId)` — the latter takes an id and reloads rather than trusting a
  caller-held state reference, since the deferred effect itself may have already saved the same
  execution (e.g. `retryChild` resetting a child), advancing `stateVersion` past what the caller last
  saw.
- `lifecycle.service.ts`, `step-persistence.ts`, `executor.ts`, `child-workflow.service.ts`,
  `failure.service.ts`: each of the five call sites now sets the matching marker (same transaction as
  the state change) before deferring, and clears it once the deferred effect actually runs.
- `child-workflow.service.ts`: added `spawnFanOutFromNames` (fan-out replay from persisted
  name+input, not `Type<unknown>`) and `replayRetryChild` (re-resolves parent/definition from current
  state rather than trusting anything captured at marker-write time — `retryChild` itself is already
  idempotent, a no-op once the child is no longer `'failed'`). Deliberately not unified with
  `spawnFanOut`/the live `retryChild` call into one shared helper — matches this file's own existing
  precedent (`spawnFanOut`'s docstring already declines to unify with `startChildren` for the same
  reason): the two paths differ in how they resolve a target and in failure semantics, and forcing one
  abstraction over both seemed more likely to obscure than help.
- `failure.service.ts`: extracted `scheduleRetryOrCompensation(workflow, state)` out of
  `failExecution`'s `afterCommit` closure so the sweep can invoke the identical logic.
- `engine/retry/recovery.service.ts`: `findPendingEffectExecutions` wrapper, same shape as the other
  `find*` methods on this class.
- `engine/retry/auto-recovery.service.ts`: sweep step — for each stale pending-effect execution,
  dispatches on `effect.type` to the matching replay call, then clears the marker; wrapped in the same
  per-item try/catch pattern the rest of `recover()` already uses (one execution's replay failure
  doesn't block the rest of the sweep). Injects `WorkflowFailureService`/`WorkflowStateService`
  (already provided in the same module — no new circular-DI edge).
- `models/workflow-metrics.ts` / `observability/noop-metrics.service.ts`: added
  `sweepPendingEffectsReplayed?(count)` — **optional**, matching the precedent already set by
  `compensationFailed?`, since `WorkflowMetrics` is a real external interface
  (`@ows4444/nest-workflow`) and a required new method would break every existing custom
  implementation.

## Why

Per Section 18, this touches workflow semantics and schema — properly a HIGH-risk change requiring
explicit justification. Confirmed scope with the user via `AskUserQuestion` before touching any
schema (options were: full fix, worst-case-only, or design-only) — user chose the full fix across all
five sites rather than partial coverage.

Design choice (durable marker + sweep replay, reusing the existing `WorkflowAutoRecoveryService`
interval rather than inventing new scheduling infrastructure) mirrors `libs/queue`'s outbox pattern
already established in this monorepo, applied to workflow lifecycle side effects instead of message
publishing — consistent with Section 17's "prefer existing patterns over inventing new ones."

**Known accepted tradeoff, not fixed this loop:** `start-children` and `spawn-fan-out` replay are
naturally idempotent for the case that matters (a fully-dropped callback — nothing was created, sweep
creates it). But if the *original* callback partially ran (some children created) and then crashed
before the marker was cleared, replay has no per-child dedup key and could create an extra duplicate
child. Making that dedup-safe would require a new idempotency-key primitive threaded through child
creation — a real, separate change. `cancel-children`/`retry-child`/`schedule-retry-or-compensation`
have no such gap: each is naturally idempotent (checks the target's current status before acting), so
replay is always safe there. The duplicate-child window is a crash-during-a-microsecond-callback *and*
a concurrent sweep race — both would have to happen together — traded deliberately against the
alternative (declared children silently never spawning at all, today's actual behavior), and is
strictly better than the status quo even with the gap open.

## Tests

`libs/workflow` suite: 48 spec files / 454 tests, all passing (updated 6 existing tests across
`lifecycle.service.spec.ts`, `executor.spec.ts`, `child-workflow.service.spec.ts`,
`failure.service.spec.ts`, `step-persistence.spec.ts`, `auto-recovery.service.spec.ts`,
`1752000000000-InitialWorkflowSchema.migration.spec.ts` to account for the new field/mocks/migration
— no net change in test count, this loop extended existing coverage rather than adding new spec
files). Full monorepo suite: 135 suites / 1054 tests, all passing.

## Build

PASS (`npm run typecheck`; also explicitly verified `npx nest build server` and
`npx nest build worker` both compile clean)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- The duplicate-child-on-replay tradeoff noted above (`start-children`/`spawn-fan-out` only) — would
  need a per-child idempotency key threaded through `WorkflowExecutor.execute`/`ChildWorkflowService`
  to close fully. Not attempted this loop; flagged as a real gap, not silently ignored.
- `ChildWorkflowService`'s SRP split remains a lower-priority organizational follow-up (unchanged from
  Loop 016 — this is the seventh loop in a row to touch this file).
- This loop was verified statically (typecheck/lint/full unit suite/both app builds) but not against
  live MySQL — no test exercises an actual process crash mid-`afterCommit`, since that's inherently
  hard to simulate in a unit suite. The sweep's replay logic is unit-tested at the dispatch level
  (`auto-recovery.service.spec.ts`), not end-to-end against a real crash.

## Next Loop

- No further Critical/High findings on this specific durability question. A natural next candidate
  (not forced): the idempotency-key gap above, if duplicate children under the narrow crash-plus-race
  window becomes a real concern rather than a documented tradeoff.

---

# Loop 018

**Library:** libs/workflow
**Date:** 2026-07-22

## Goal

Close the one accepted tradeoff Loop 017 left open: `start-children`/`spawn-fan-out` replay had
no per-child idempotency key, so a crash mid-callback after some (not all) children were created
could duplicate a child on replay.

## Files Reviewed

- `engine/child-workflow/child-workflow.service.ts` (`startChildren`, `spawnFanOut`,
  `spawnFanOutFromNames`)
- `engine/executor/executor.ts` (`WorkflowExecutionOptions`, `execute`)
- `engine/state/factory.ts` (`WorkflowStateFactory.create`)
- `errors/workflow.errors.ts` (`WorkflowConcurrencyError` — already thrown by
  `TypeOrmWorkflowStateStore.insert` on a duplicate primary key, confirmed in Loop 002's original
  wiring)

## Problems Found

**High**
- (the one named in Loop 017's "Known accepted tradeoff" — no new defect, closing a known gap)

## Changes Made

- `executor.ts`: `WorkflowExecutionOptions` gained an optional `workflowId` — overrides the
  generated one.
- `state/factory.ts`: `WorkflowStateFactory.create` uses `options?.workflowId ?? randomUUID()`
  instead of always generating fresh.
- `child-workflow.service.ts`: new private `spawnIdempotently(name, input, workflowId, options)` —
  calls `executor.execute` with a caller-supplied deterministic `workflowId`; on
  `WorkflowConcurrencyError` (duplicate primary key), loads the existing execution and returns it
  in place of throwing, rather than creating a duplicate.
  - `startChildren`: deterministic id = `` `${state.workflowId}:start:${childName}` `` (one child
    per class is the only valid `onStart` shape, so class name alone is a stable key).
  - `spawnFanOut`/`spawnFanOutFromNames`: deterministic id =
    `` `${state.workflowId}:${state.joinId}:${index}` `` — the array index disambiguates multiple
    specs of the *same* child class in one fan-out episode (a real, tested case — two specs of the
    same class with different `input` must both still spawn). Index ordering is preserved through
    the `WorkflowPendingEffect` JSON round-trip, so a replay computes the identical id as the
    original attempt for the same spec position.

## Why

Direct user follow-up to close the gap Loop 017 explicitly flagged rather than silently left. The
deterministic-id-plus-duplicate-catch approach was chosen over adding a new schema
field/idempotency-key column: `TypeOrmWorkflowStateStore.insert` already throws
`WorkflowConcurrencyError` on a primary-key collision, so reusing the *existing* primary key as the
dedup mechanism needed no migration, no new column, and no new store method — smaller diff, same
correctness guarantee. Considered a `startChildren`-style "check existing children before
creating" approach instead, but rejected it: `spawnFanOut`'s own test suite already covers
same-class-different-input fan-out as a legitimate case (two specs of `ChildWorkflowClass` with
different `branch` values), which a class-name-based existence check would have incorrectly
treated as a duplicate.

## Tests

4 new tests in `child-workflow.service.spec.ts`: `startChildren` gets one asserting the
deterministic `workflowId` shape and one asserting duplicate-key collision is a no-op (no cancel,
no `parentFailureHandler.failExecution`); `spawnFanOut` gets the equivalent pair, including the
index-scoped id for two same-class specs. `libs/workflow` suite: 48 spec files / 458 tests, all
passing (up from 454). Full monorepo suite: 135 suites / 1058 tests, all passing.

## Build

PASS (`npm run typecheck`; also explicitly verified `npx nest build server` and
`npx nest build worker` both compile clean)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- None outstanding for this library.

## Next Loop

- No Critical/High findings remain open. This closes the last item from Loop 017 — next loop
  would be a fresh Phase 1/2 pass on another library, or a Design Mode session if scope is being
  deliberately extended.

---

# Loop 019

**Library:** libs/workflow
**Date:** 2026-07-23

## Goal

Fresh adversarial Phase 1/2 pass. Traced `WorkflowExecutor`'s five entry points that call
`WorkflowRunner.run()` (`execute`, `resume`, `wake`, `resumeJoin`, `signal`) end to end against
`WorkflowTransactionRunner`'s actual `execute`/`executeOrJoin`/`isActive` semantics, rather than
re-verifying already-tested step-level logic in isolation.

## Files Reviewed

- `engine/executor/executor.ts` (all five entry points), `engine/executor/runner.ts` (`run()`'s
  `while (state.currentStep)` loop and its break conditions).
- `persistence/adapters/typeorm/stores/typeorm-workflow-transaction-runner.ts` and
  `persistence/adapters/database/database-workflow-transaction-runner.ts` (both
  `WorkflowTransactionRunner` implementations) — confirmed `execute()`/`executeOrJoin()` both
  resolve to "join if already active, else open fresh" in both backends, and that `afterCommit()`
  throws if called with no active transaction.
- `engine/lifecycle/lifecycle.service.ts` (`create`), `engine/lifecycle/failure.service.ts`
  (`failExecution`), `engine/lifecycle/completion.service.ts` (`completeIfFinished`),
  `engine/child-workflow/child-workflow.service.ts` (`onChildFailed`'s `'ignore'`/`'retry-child'`
  cases), `engine/executor/step-persistence.ts` (`completeStep`) — every `afterCommit()` call
  site in the engine, to determine which ones sit inside the same `executeOrJoin` frame as the
  write they defer past (safe) vs. which run afterward, relying on some *other* still-active
  transaction to attach to (broken once that other transaction is removed).
- `engine/executor/executor.spec.ts` — confirmed `transactionRunner` is mocked as a trivial
  passthrough (`execute: (op) => op()`), so this class of bug is invisible to the unit suite; only
  `public/workflow-retry.integration.spec.ts` (real `better-sqlite3` + real `WorkflowModule`)
  could have caught it, and that test only exercises a single-step workflow.

## Problems Found

**High**
- `WorkflowExecutor.execute()`/`resume()`/`wake()`/`resumeJoin()`/`signal()` each wrapped their
  call to `WorkflowRunner.run()` in one outer `transactionRunner.execute()`/`executeOrJoin()`
  call. `run()`'s loop processes steps sequentially until one pauses (`waitForSignal`/`sleepUntil`/
  `spawnChildren`) or the workflow completes — for any straight-line workflow with no waits, one
  `resume()`/`execute()` call can process many steps in a single pass. Every per-step persistence
  call (`WorkflowStepPersistenceService.startStep`/`completeStep`, `WorkflowLifecycleService.create`,
  `WorkflowFailureService.failExecution`, etc.) reaches `transactionRunner.executeOrJoin`, which —
  confirmed in both transaction-runner implementations — just runs inline once a transaction is
  already active, joining the outer one instead of committing independently. Net effect: all of a
  multi-step pass's state+history writes shared one still-open transaction, instead of one
  transaction per step. Consequences: (1) a DB connection/transaction held open across the combined
  duration of every step's handler execution in the pass — a real connection-pool/lock-duration
  risk; (2) every `afterCommit`-deferred side effect from an early step (child spawning, retry
  scheduling, lifecycle event publishing) didn't actually fire until the *entire* pass's
  transaction committed, not shortly after the step that scheduled it — directly contradicting the
  "fires once genuinely durable" guarantee `WorkflowPendingEffect` (Loop 017/018) was built around;
  (3) a crash mid-pass would roll back every step that pass had already run, not just the one that
  failed. Not a contrived edge case — this is the ordinary path for any multi-step workflow with no
  waits between steps. Undetected by 18 prior loops because the unit suite mocks
  `transactionRunner` as a no-op passthrough and the one real integration test only covers a
  single-step workflow.

## Changes Made

- `engine/executor/executor.ts`: removed the outer `transactionRunner.execute()`/`executeOrJoin()`
  wrap from `execute()`, `resume()`, `wake()`, `resumeJoin()`, and `signal()` — each now calls
  `lifecycle.create()`/`.resume()`, `runner.run()`, and the failure/finalize path directly, letting
  every inner persistence call manage its own transaction via its own `executeOrJoin`. The
  failed/pendingError deferred-throw pattern (needed previously so the outer transaction would
  still commit after recording a failure) is no longer needed — `throw error` directly is now
  correct, since `failureService.failExecution`/`handleFailure` already commits the failure state
  independently before the throw propagates. `signal()`'s post-`run()` `afterCommit` registration
  (for `signalProcessor.complete()`/`publisher.signalled()`) became a direct sequential call, since
  by that point every step in the pass (and `signalProcessor.prepare()`, which commits itself) has
  already committed independently — nothing is left to defer.
- New `shared/utils/after-commit-or-now.ts`: `afterCommitOrNow(runner, operation)` — defers via
  `runner.afterCommit()` when a transaction is still active (e.g. a caller-supplied ambient
  transaction the preceding write had to join rather than commit on its own), or runs `operation`
  immediately (awaited) when none is active, since in that case the write it was meant to follow
  has already committed independently.
- Updated the four `afterCommit()` call sites that sit *after* their relevant write's own
  `executeOrJoin` frame (not inside it) to use `afterCommitOrNow` instead of a bare
  `transactionRunner.afterCommit?.()`: `lifecycle.service.ts`'s `create()`, `failure.service.ts`'s
  `failExecution()`, `completion.service.ts`'s `completeIfFinished()` (both call sites), and
  `child-workflow.service.ts`'s `onChildFailed()` (`'ignore'` and `'retry-child'` cases). Two other
  `afterCommit()` call sites — `executor.ts`'s `cancel()` and `step-persistence.ts`'s
  `completeStep()` — sit *inside* the same `executeOrJoin` frame as their write and were left
  unchanged; they were never broken by this bug.
- New integration test in `public/workflow-retry.integration.spec.ts`: a real two-step workflow
  (`better-sqlite3`, real `WorkflowModule.forRoot({ persistence: 'typeorm' })`) whose second step
  asserts `transactionRunner.isActive()` is `false` and that the workflow's persisted history
  already has both of the first step's rows — proving each step commits independently rather than
  the whole pass sharing one transaction. This is the only test in the suite that exercises the
  real `TypeOrmWorkflowTransactionRunner`'s `isActive()`/`executeOrJoin` semantics rather than a
  mock.
- Extended four spec files' `transactionRunner` mocks (`lifecycle.service.spec.ts`,
  `failure.service.spec.ts`, `completion.service.spec.ts`, `child-workflow.service.spec.ts`) with
  `isActive: jest.fn(() => true)`, so their existing "afterCommit defers, test flushes manually"
  assertions keep exercising the deferred branch of `afterCommitOrNow` unchanged.

## Why

Direct instance of the workflow/queue-semantics + concurrency risk category ci.loop §18 flags as
HIGH — confirmed with the user via `AskUserQuestion` before touching anything, consistent with
how Loop 017 handled an equally deep transaction-semantics question in this same library. The
`afterCommitOrNow` design (rather than unconditionally calling every deferred operation directly)
specifically preserves the one legitimate reason these methods still accept
`transactionRunner.executeOrJoin` internally: a host application calling `WorkflowClient.execute()`/
`.resume()`/etc. from within its *own* already-active `@Transactional()` context, where the
workflow's own writes correctly join that ambient transaction and genuinely need to wait for it to
commit before firing side effects — a case this loop verified is real (it's the entire reason
`executeOrJoin` exists as distinct from `execute`) and confirmed still works via the `isActive():
true` mock path in the four updated spec files.

## Tests

`libs/workflow` suite is now 48 spec files / 460 tests (up from 458 — one new integration test file
extended, no new spec files). Full monorepo suite: 145 suites / 1174 tests, all passing. Also
explicitly verified `npx nest build server` and `npx nest build worker` both compile clean.

## Build

PASS (`npm run typecheck`; `npx nest build server`/`npx nest build worker` both compile clean)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- No `ARCH.md` update needed — this is a bug fix to existing documented behavior (per-step
  atomicity, `afterCommit` firing once genuinely durable), not a change to the design itself;
  `ARCH.md`'s existing description of the durability model is now actually true rather than
  aspirational.
- Not verified against a real MySQL connection-pool-under-load scenario (only `better-sqlite3` in
  the unit/integration suite) — the fix's correctness is verified, but its actual impact on
  connection-pool pressure under a real multi-step, high-throughput workload is not measured.

## Next Loop

- No further Critical/High findings this pass beyond the one fixed. Worth a follow-up sweep of
  `libs/queue`'s outbox/inbox and `libs/database`'s own `TransactionExecutor` call sites for the
  same "afterCommit-style deferral relying on an ambient transaction that may not actually be
  active by the time it's called" shape, though neither uses this exact multi-entry-point/shared-
  loop structure that made it reachable here.

---

# Loop 020

**Library:** libs/workflow
**Date:** 2026-07-23

## Goal

Second adversarial pass in the same session as Loop 019, matching the "two consecutive clean
passes" bar this session already reached for `libs/cache`/`libs/queue`/`libs/database`. Focus:
(1) confirm Loop 019's transaction-scope fix doesn't break any caller's assumptions, by checking
every caller of `WorkflowExecutor.execute`/`.resume`/`.wake`/`.resumeJoin`/`.signal`; (2) review
files not touched by Loop 019: `compensation/service.ts`, `scheduling/scheduler.service.ts`,
`schedule-registration.service.ts`, the TypeORM schedule/signal stores.

## Files Reviewed

- `engine/retry/auto-recovery.service.ts`, `engine/scheduling/scheduler.service.ts` — the only two
  callers of `WorkflowExecutor.execute`/`.resume`/`.wake` outside `executor.ts` itself. Confirmed
  neither wraps its call in a `transactionRunner.execute`/`executeOrJoin` of its own — both treat
  the executor call as an opaque, self-contained unit of work, so Loop 019's removal of the outer
  transaction wrap applies cleanly with no caller-side assumption broken.
- `engine/compensation/service.ts` (`compensate`/`compensateReverseOrder`/`compensateCustom`/
  `compensateSteps`/`compensateWithTimeout`) — no `WorkflowTransactionRunner` dependency at all;
  purely in-memory handler dispatch + `AbortController`-based timeout racing. Not affected by, and
  doesn't itself have, the transaction-scope bug class.
- `engine/scheduling/scheduler.service.ts`, `engine/scheduling/schedule-registration.service.ts`,
  `persistence/adapters/typeorm/stores/typeorm-workflow-schedule.store.ts` — `claimDue`'s
  select-candidates → conditional-UPDATE → re-select pattern re-verified as the same safe shape
  already confirmed for `libs/queue`'s outbox `claimBatch` and `libs/workflow`'s own schedule store
  in Loop 007.
- `persistence/adapters/typeorm/stores/typeorm-workflow-signal.store.ts` — re-confirmed the
  composite `(workflowId, signalId)` key from Loop 001's Critical fix is still the shape used by
  every method (`load`/`insert`/`exists`/`markProcessed`).

## Problems Found

**Critical / High / Medium / Low** — none this pass.

## Changes Made

None — nothing found that crossed the bar for a change.

## Why

Two consecutive clean adversarial passes (Loop 019 found and fixed one real High-severity
transaction-scope bug; this loop specifically hunted for callers that might have depended on the
old, buggy wrapping behavior, and reviewed every remaining unreviewed file, finding nothing) meets
the ci.loop §16 stopping condition for this library, matching `libs/cache`/`libs/queue`/
`libs/database`'s status this session.

## Tests

No test changes. Full monorepo suite: 145 suites / 1175 tests, all passing (unchanged — no code
touched this loop).

## Build

Not re-run — no code changed this loop.

## Lint

Not re-run — no code changed this loop.

## Remaining TODO

- Unchanged from Loop 019: no live-MySQL-under-load verification of the transaction-scope fix's
  connection-pool impact.

## Next Loop

- No Critical/High/Medium findings across two consecutive adversarial passes. `libs/workflow`
  remains at a natural stopping point per Section 16 until a new concrete finding or requirement
  surfaces.

---

# Loop 021

**Library:** libs/workflow
**Date:** 2026-07-23

## Goal

Close Loop 019/020's explicitly-flagged gap: the per-step transaction-scope fix (Loop 019, High —
removed the outer transaction wrap so each step commits/releases its connection independently
instead of one connection being held for an entire multi-step pass) was only verified against
in-memory sqlite, which has no connection pool and so can't detect a "held connection starves
other work" failure mode at all. Get real MySQL verification without touching the shared dev
database.

## Files Reviewed

- No source changes — this loop only adds verification infrastructure and a test.
- `engine/executor/executor.ts` (Loop 019's fix) re-read to confirm the change under test is
  still present and unmodified since Loop 019/020.

## Problems Found

None — this loop is verification-only, not a review pass.

## Changes Made

- Local dev infra: reuses the `app_scratch` MySQL scratch schema created this session for
  `libs/auth` Loop 019 (same `make compose-up` instance, same one-time `app` user grant — no
  additional infra change needed here).
- New `workflow-retry.mysql.integration.spec.ts`: a real 3-step workflow run against a real
  `mysql` `TypeOrmModule.forRoot` connection pool explicitly capped at 3 connections
  (`extra: { connectionLimit: 3 }`), with 8 instances executed concurrently
  (`Promise.all`). If Loop 019's bug were still present, a 3-step instance would hold its
  connection for the whole pass, and 8 concurrent 3-step instances against a 3-connection pool
  would deadlock or time out; instead all 8 complete, proving connections are actually released
  back to the pool between steps. Gated behind `RUN_MYSQL_INTEGRATION_TESTS=1` (`describe.skip`
  by default), matching `libs/auth`'s companion test — `npm test` stays hermetic.

## Why

- This is the exact scenario Loop 019's own "Remaining TODO" named ("no live-MySQL-under-load
  verification of the transaction-scope fix's connection-pool impact") — not a new finding, but
  closing a gap the library's own history had already flagged as open.
- Risk: LOW. No production code changed — only a new opt-in test file, reusing infra already
  provisioned for `libs/auth`'s companion fix this session.

## Tests

`libs/workflow` suite gains 1 spec file / 1 test (skipped by default). With
`RUN_MYSQL_INTEGRATION_TESTS=1`: passes — 8/8 concurrent 3-step instances complete against a
3-connection pool. Full monorepo default suite: 149 suites / 1194 tests, all passing (2
suites/2 tests skipped by default — this loop's addition plus `libs/auth`'s companion).

## Build

PASS (`npm run typecheck`)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- None outstanding for this library.

## Next Loop

- No Critical/High/Medium findings remain open, and the one previously-flagged verification gap
  is now closed. `libs/workflow` remains at a natural stopping point per Section 16 until a new
  concrete finding or requirement surfaces.
