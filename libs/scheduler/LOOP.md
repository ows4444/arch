# Loop 001

**Library:** libs/scheduler
**Date:** 2026-07-24

## Goal

Implement `libs/scheduler` from scratch per `libs/scheduler/ARCH.md` Design 001: `@ScheduledJob`
decorator-based recurring-job registration, discovered at boot the same way `@RMQConsumer` is,
firing exactly once across horizontally-scaled `apps/server` replicas via the same claim-batch DB
idiom `libs/queue`'s outbox and `libs/workflow`'s `WorkflowSchedule` already use. Greenfield
implementation following a completed Design Mode session, not a refactor.

## Files Reviewed

- `libs/queue/src/consumer/{rmq-consumer.decorator,rmq-handler.registry}.ts` — the
  `DiscoveryService`/`MetadataScanner`/`Reflector` scan shape and duplicate-detection strategy this
  library's `ScheduledJobRegistry` mirrors exactly.
- `libs/workflow/src/persistence/adapters/typeorm/{entities/workflow-schedule.entity,stores/typeorm-workflow-schedule.store}.ts`
  and `libs/workflow/src/engine/scheduling/{scheduler.service,schedule-registration.service}.ts` —
  the exact claim-batch query shape, misfire-policy vocabulary, and `cron` package (`CronTime`) reuse
  this library's `ScheduledJobRepository.claimDue`/`ScheduledJobSweepService`/`cron-time.util.ts`
  mirror.
- `libs/queue/src/outbox/outbox.repository.ts` — confirmed the `this.repository.createQueryBuilder()`
  + `this.runWrite(...)` wrapping convention `BaseRepository` subclasses use for custom
  multi-statement queries (candidate select + conditional update + refetch), since
  `createQueryBuilder` isn't itself wrapped by `BaseRepository`'s connectivity-retry logic the way
  `save`/`find`/`update` are.
- `libs/database/src/repository/repository-discovery.service.ts` — confirmed this is the service
  that actually connects the writer datasource, and that it uses `OnApplicationBootstrap`, not
  `OnModuleInit` — the precedent that resolved this loop's one real bug (see below).

## Problems Found

N/A at design/implementation time — greenfield build following a completed Design Mode session.
One **Critical** problem was found during this loop's own live boot verification (see Changes Made
and Why) rather than during the initial Understand/Review phase, since it only manifests once a real
`@ScheduledJob` consumer exists.

## Changes Made

- Scaffolded `libs/scheduler` (`nest-cli.json` library entry, `tsconfig.json` `@/scheduler` path
  alias, `tsconfig.lib.json`, Jest `moduleNameMapper` entry — no new npm dependencies; the `cron`
  package is already a transitive dependency of `@nestjs/schedule`, reused exactly the way
  `libs/workflow` already does).
- Domain: `ScheduledJobEntity` (`scheduled_jobs`: `name` is the primary key, not a synthetic id — see
  ARCH.md Key Decisions MEDIUM #1) + `ScheduledJobRepository extends BaseRepository`
  (`findByName`, `claimDue`, `recordFired`, `release`); `ScheduledJobMisfirePolicy` enum
  (`skip`/`fire-once`, mirroring `WorkflowSchedule`'s vocabulary exactly).
- Decorator: `@ScheduledJob(name, cronExpression, options?)` — `SetMetadata`-based, code is the
  source of truth for cron timing (no runtime admin API — see ARCH.md's confirmed scope decision).
- Discovery: `ScheduledJobRegistry` — scans every provider for `@ScheduledJob`-decorated methods,
  builds an in-memory `Map<name, definition>`, throws `SchedulerConfigurationError` on a duplicate
  name, and upserts each job's DB row (insert-if-missing; otherwise refresh metadata but only
  recompute `nextFireAt` when the cron expression/timezone actually changed — ARCH.md Key Decisions
  HIGH #1). Recovers from a duplicate-key race against another replica booting concurrently, the same
  `getOrCreateMine`-style pattern `libs/users` already established.
- Engine: `ScheduledJobSweepService` — `setInterval` + `SchedulerRegistry` bookkeeping (never
  `@Cron`/`@Interval`, per this codebase's established convention), claims due jobs via
  `ScheduledJobRepository.claimDue`, applies the missed-fire/misfire-policy check, invokes the
  registered handler, and — on a handler error — releases without advancing `nextFireAt`, letting the
  next sweep's misfire-policy check convert it into a skip-and-reschedule (no separate backoff
  mechanism needed, reusing `WorkflowSchedulerService`'s exact self-healing behavior). Also handles an
  orphaned row gracefully (a claimed job with no registered handler in this process — e.g. code
  removed the decorator but the row wasn't cleaned up): logs and releases without firing.
- `cron-time.util.ts`: `computeNextFireAt` via `cron`'s `CronTime`, same reuse
  `WorkflowScheduleRegistrationService` established (also doubles as expression validation).
- Persistence: `InitialSchedulerSchema1753800000000` migration (table + `(enabled, nextFireAt)`
  composite index) — continues the existing migration-timestamp sequence directly after
  `libs/organizations`' `1753710000000-SeedOrganizationsManagePermission`. No seed migration — this
  library grants no permission and has no RBAC involvement at all (no HTTP surface exists).
- Wired into `apps/server/src/app.module.ts`: `SCHEDULER_TYPEORM_ENTITIES`/`SCHEDULER_MIGRATIONS`
  merged into the existing `DatabaseModule.forRoot` call, `SchedulerModule.forRoot()` added to the
  imports list.
- Test coverage: 28 unit/integration tests across 4 spec files —
  `cron-time.util.spec.ts` (valid/invalid expressions, timezone), `scheduled-job.repository.spec.ts`
  (a real sqlite-backed integration test of `claimDue`'s candidate-select-then-conditional-update
  logic, mirroring `OutboxRepository.claimBatch`'s own spec style — enabled/disabled, stale-claim
  reclaim, limit, `recordFired`/`release` semantics), `scheduled-job.registry.spec.ts` (discovery,
  duplicate detection, instance binding, insert-vs-metadata-sync-vs-recompute-nextFireAt branches,
  the duplicate-key race recovery), `scheduled-job-sweep.service.spec.ts` (fire/skip/fire-once/
  release-on-error/orphaned-row branches, mirroring `WorkflowSchedulerService`'s own spec style).

## Why

- `name`-as-primary-key, decorator-only registration (no runtime admin API), and reusing the
  claim-batch idiom instead of `WorkflowLeaseService`'s lease-with-keepalive were all confirmed
  directly with the user during Design Mode (see ARCH.md) — not independently re-decided here.
- The self-healing "release without advancing `nextFireAt` on failure" behavior and the
  `'skip' | 'fire-once'` misfire vocabulary were deliberately copied from `WorkflowSchedulerService`
  rather than redesigned, per Section 17 (prefer existing patterns over inventing new ones) — this is
  the second library in this monorepo to use this exact idiom (after `libs/workflow` itself), and it
  needed zero adaptation.

## Live Verification (real MySQL/RabbitMQ)

Booted `apps/server` fresh (on an alternate port, since port 3000 was held by an unrelated process
this session) with `MYSQL_MIGRATIONS_RUN=true`:

- Confirmed the migration ran cleanly against real MySQL: `scheduled_jobs` table + the
  `(enabled, nextFireAt)` composite index both created exactly as designed, `ScheduledJobRepository`
  registered alongside the other 13 repositories.
- **Found and fixed a Critical bug**: a throwaway `@ScheduledJob('smoke-test-job', '* * * * * *')`
  provider, temporarily wired into `apps/server` to verify end-to-end firing, **crashed the entire
  process at boot** with `ServiceUnavailableException: Datasource 'writer' is not available.`
  `ScheduledJobRegistry.onModuleInit()` was running — and attempting a real DB call via
  `syncJob` — before `libs/database`'s own `RepositoryDiscoveryService` (which actually connects the
  writer datasource) had run its own lifecycle hook. Root cause: `RepositoryDiscoveryService` itself
  uses `OnApplicationBootstrap`, not `OnModuleInit` (confirmed by reading it directly) — Nest runs
  every `OnApplicationBootstrap` hook across the whole app only after *all* modules'
  `OnModuleInit` hooks have resolved, so a `OnModuleInit`-based consumer of the database can easily
  race ahead of the datasource actually being ready. Fixed by switching `ScheduledJobRegistry` to
  implement `OnApplicationBootstrap` instead — re-verified with the same smoke-test provider:
  7 consecutive fires over 21 seconds, zero errors, `nextFireAt`/`lastFiredAt` advancing correctly and
  `claimedBy`/`claimedAt` clearing after each fire. Removed the throwaway provider and its DB row
  afterward; `apps/server/src/app.module.ts` reverted to its real (non-smoke-test) configuration.

This is exactly the kind of defect Design Mode's own reasoning can't catch — every prior library that
implements `OnModuleInit` in this codebase (`RMQHandlerRegistry`, `WorkflowDiscovery`) does pure
in-memory work with no DB access, so this lifecycle-ordering hazard had never been exercised before
this library's DB-touching discovery step existed.

## Tests

`npx jest libs/scheduler` — 4 suites, 28 tests, all passing. Full monorepo suite (`npx jest`) —
167 of 172 suites run (5 pre-existing skips, unrelated), 1302 of 1310 tests passing, no regressions.

## Build

PASS (`npm run typecheck`)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- No consumer wired yet — this library has zero real `@ScheduledJob` registrations anywhere in
  `apps/server`/`apps/worker` today (the smoke-test provider used for verification was removed). That
  is expected: `REQUIREMENTS.md` Tier 3 scoped this as "justified infra ahead of a concrete
  consumer," the same way `libs/cache`/`libs/queue`/`libs/workflow` originally were.

## Next Loop

- No further work queued until a concrete job needs scheduling somewhere in this platform, or until
  one of ARCH.md's Open Questions (runtime admin API, failure alerting, longer-running-job escape
  hatch) gets a real trigger.

---

# Loop 002

**Library:** libs/scheduler
**Date:** 2026-07-24

## Goal

First ordinary review pass (Phase 1–6, `ci.loop` Sections 1–19) now that Loop 001 (greenfield build +
live verification, combined into one loop) is done — the point in this repo's established rhythm
where a freshly built library gets a review-focused loop next (e.g. `libs/organizations` Loop 003,
`libs/audit` Loop 003).

## Files Reviewed

- `libs/scheduler/src/engine/scheduled-job-sweep.service.ts` — re-read line by line against
  `ci.loop`'s Structural Review Checklist (Section 19) and Performance Checklist (Section 12),
  specifically the "what happens to a claimed row across repeated sweeps" question for every branch
  (fire / skip-by-misfire / handler-throws / no-handler-registered).
- `libs/scheduler/src/discovery/scheduled-job.registry.ts` — re-checked the insert/metadata-sync/
  duplicate-key-race branches for any remaining correctness gap after Loop 001's lifecycle-hook fix.

## Problems Found

**Medium**
- The "no handler registered for this claimed job" branch (an orphaned DB row — its `@ScheduledJob`
  decorator was removed from code but the row wasn't cleaned up) called `release()` without ever
  advancing `nextFireAt`. Since every `apps/server` replica runs the same deployed code, if one
  replica has no handler for a given job name, **no** replica does — so the row's `nextFireAt` would
  stay in the past forever, getting reclaimed and logging the same warning on *every single sweep*
  indefinitely, instead of the intended "log once, then leave it alone until someone cleans up the
  row." The original comment's stated reasoning ("so another replica that still has the handler can
  pick it up") doesn't hold given this codebase's single-deployment-unit model — there is no replica
  running different code than any other.

**Low**
- None beyond the above.

## Changes Made

- `ScheduledJobSweepService.fire`'s no-handler branch now computes `nextFireAt` from the job's own
  stored `cronExpression`/`timezone` (the same computation the normal fire path already does) and
  calls `recordFired` instead of `release` — advancing the row past its current due time so it's
  next reclaimed only at its next real cron trigger, not on the very next sweep.
- Updated the corresponding unit test (`scheduled-job-sweep.service.spec.ts`) to assert
  `recordFired` is called and `release` is not, with an explanatory comment recording why the old
  behavior was wrong.

## Why

A `release`-only recovery path silently assumed "some other replica might still have this handler,"
which doesn't match how this platform actually deploys (one code version across all replicas at a
time) — the same category of assumption-not-matching-reality `ci.loop` Phase 2 exists to catch. The
fix reuses the exact `computeNextFireAt`/`recordFired` pair the normal fire path already calls, so no
new mechanism was introduced — just the correct one applied to a branch that had been skipping it.

## Tests

`npx jest libs/scheduler` — 4 suites, 28 tests (same count as Loop 001; one test's assertions changed
to match the fixed behavior), all passing. Full monorepo suite: 167 of 172 suites run (5 pre-existing
skips), 1302 of 1310 tests passing, no regressions.

## Build

PASS (`npm run typecheck`)

## Lint

PASS (`npx eslint "libs/scheduler/**/*.ts"`)

## Remaining TODO

- Unchanged from Loop 001: no real `@ScheduledJob` consumer exists anywhere yet; a runtime admin API
  and failure alerting remain deferred (see ARCH.md Open Questions).

## Next Loop

- No further work queued until a concrete job needs scheduling, or one of ARCH.md's Open Questions
  gets a real trigger.

---

# Loop 003

**Library:** libs/scheduler
**Date:** 2026-07-24

## Goal

Cross-reference entry only — the actual work happened in `libs/auth` (Loop 024, wiring
`auth.refresh-token-purge` as this library's first real `@ScheduledJob` consumer, closing the
"no real consumer exists yet" gap Loop 001/002 both left open). Recorded here per `ci.loop`'s
cross-checking discipline, since the bug found belongs to this library's own code.

## Files Reviewed

- `engine/cron-time.util.ts` (`computeNextFireAt`) — the site of the bug, reviewed in response to a
  live-verification failure while wiring `libs/auth`'s consumer, not as a fresh scheduled pass.

## Problems Found

**Critical**
- `computeNextFireAt(cronExpression, timezone)` calls `new CronTime(cronExpression, timezone)` with
  `timezone` passed through as-is from `ScheduledJobOptions.timezone` — `undefined` whenever a
  `@ScheduledJob` call omits it (as `auth.refresh-token-purge` initially did). The underlying `cron`
  package defaults an undefined timezone to the **Node process's local system timezone**, not UTC.
  Every job's cron schedule silently evaluates against local time instead of UTC unless every single
  call site remembers to pass `{ timezone: 'UTC' }` explicitly. Invisible in this library's own
  Loop 001/002 live verification because those checks confirmed fires *happened*, not that they
  happened at the *correct absolute UTC instant* — this sandbox's local TZ (`Asia/Karachi`, UTC+5)
  happened to make the drift large enough to notice once `libs/auth`'s test manually cross-checked
  `nextFireAt` against true wall-clock time. Fixed at the process level for this session
  (`TZ=UTC` in `.env`/`.env.example`, `libs/auth/LOOP.md` Loop 024) rather than in this library's
  code — see Remaining TODO below for the still-open library-level question.

## Changes Made

- None in this library's own source — see `libs/auth/LOOP.md` Loop 024 for the actual fix
  (process-level `TZ=UTC`, plus a defense-in-depth explicit `{ timezone: 'UTC' }` on the one real
  consumer).

## Why

Per `ci.loop` §4 Phase 3 ("note if the fix pattern should be back-ported or cross-checked against
another `libs/*` package") — the bug lives in this library's `computeNextFireAt`, so it's recorded
here even though the fix that shipped this session was process-level, not a code change to this
library.

## Tests

Unchanged — this library's own suite (28 tests) wasn't touched this loop. See `libs/auth/LOOP.md`
Loop 024 for the live verification that surfaced this.

## Build

Unchanged (no source touched).

## Lint

Unchanged (no source touched).

## Remaining TODO

- **Open design question for the next loop:** should `ScheduledJobOptions.timezone` default to
  `'UTC'` instead of `undefined` (silently inheriting host-local time), or should
  `computeNextFireAt`/the `@ScheduledJob` decorator require an explicit `timezone` and throw a
  `SchedulerConfigurationError` if omitted (fail loud instead of silently defaulting to something a
  job author likely didn't intend)? Both are real options with different tradeoffs (convenience vs.
  explicitness) — deliberately not decided in this cross-reference entry, since it's a genuine
  Section 0.5 HIGH-risk API-shape decision (changes what every future `@ScheduledJob` call site
  looks like), not a bug-fix-in-passing.
- Unchanged from Loop 001/002: a runtime admin API and failure alerting remain deferred.

## Next Loop

- Decide the open timezone-default question above, the next time this library gets a scheduled
  review pass or a second `@ScheduledJob` consumer appears.

---

# Loop 004

**Library:** libs/scheduler
**Date:** 2026-07-24

## Goal

Resolve Loop 003's open design question: should an omitted `timezone` default to `'UTC'`, or fail
loud? Decided with the user: default to UTC.

## Files Reviewed

- `decorators/scheduled-job.decorator.ts`, `scheduler.constants.ts` — the only two files touched.

## Problems Found

None new — this loop closes the Critical finding from Loop 003 at the library level (the process-
level `TZ=UTC` fix from `libs/auth` Loop 024 remains in place as defense-in-depth, but is no longer
the only thing preventing drift).

## Changes Made

- `scheduler.constants.ts`: added `DEFAULT_SCHEDULED_JOB_TIMEZONE = 'UTC'`.
- `scheduled-job.decorator.ts`: `ScheduledJob(...)` now sets `timezone: options.timezone ??
  DEFAULT_SCHEDULED_JOB_TIMEZONE` instead of only including `timezone` in the metadata when the
  caller explicitly passed one. `ScheduledJobMetadata.timezone` changed from `string | undefined` to
  `string` (always present) to make the guarantee visible in the type, not just the runtime value.
- `libs/auth`'s `auth.refresh-token-purge` no longer passes `{ timezone: 'UTC' }` explicitly — it
  was defense-in-depth against exactly this gap, now redundant with the library's own default.
- New unit test (`scheduled-job.registry.spec.ts`): the existing `HourlyDigest` fixture (which
  already omitted `timezone`, present since Loop 001 but never actually asserted on) now has a
  dedicated test confirming `metadata.timezone === 'UTC'`.

## Why

Per the user's explicit choice between "default to UTC," "fail loud," and "leave as-is": defaulting
closes the root cause at the one place it can never be forgotten again (every future
`@ScheduledJob` call site, not just the ones an author remembers to annotate), and is non-breaking —
every existing call site that already passed an explicit `timezone` (`nightly-cleanup` in this
library's own test fixtures) is unaffected, since `options.timezone ?? DEFAULT` only changes
behavior for the omitted case. "Fail loud" was the safer-in-principle alternative but was rejected
as unnecessarily punitive for what should be a sane, low-surprise default — nothing about a plain
recurring job's schedule benefits from an author being forced to type `'UTC'` every time.

## Tests

Full monorepo suite: 1306/1314 passing (8 pre-existing skips, up from 1305/1313 — the new default-
timezone test), `typecheck` and `lint` both clean.

**Live-verified** against real MySQL (`make compose-up`): booted `apps/server` with the new default
(no `{ timezone: 'UTC' }` on `auth.refresh-token-purge` anymore) and confirmed
`scheduled_jobs.timezone = 'UTC'` (previously `NULL`) and `nextFireAt` computed to the correct true-
UTC next-top-of-hour, matching real wall clock.

## Build

PASS (`npm run typecheck`)

## Lint

PASS (`npx eslint "libs/scheduler/**/*.ts"`)

## Remaining TODO

- None new. Unchanged from Loop 001/002: a runtime admin API and failure alerting remain deferred.

## Next Loop

- No further work queued until a concrete job needs scheduling, or one of ARCH.md's Open Questions
  gets a real trigger. The timezone-default question from Loop 003 is now closed.
