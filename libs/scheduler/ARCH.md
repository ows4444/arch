# Design 001

**Library / Bounded Context:** libs/scheduler (Recurring Job Scheduling)
**Date:** 2026-07-24

## Goal

Scope `libs/scheduler` — `REQUIREMENTS.md` Tier 3's Scheduler Module — the one remaining roadmap
item classified as already-justified-to-build rather than trigger-gated ("`libs/queue` +
`libs/workflow` already provide retry/state-machine primitives; mostly cron-trigger wiring on top").
This session establishes the bounded context and its relationship to the scheduling capability that
turned out to **already exist** in `libs/workflow` (`WorkflowSchedule`/`WorkflowSchedulerService`,
found during this session's research pass) before any code is written.

Two scope decisions confirmed directly with the user before designing (both HIGH-risk, same
confirm-before-design discipline every prior session in this monorepo has used):

- **A new, separate `libs/scheduler` library** — not an extension of `libs/workflow`, and not a
  thin front-end that auto-generates single-step workflows under the hood. `libs/workflow`'s
  scheduling feature stays exactly as-is, scoped to cron-triggered *workflow starts* (full
  durability, state persistence, compensation slots). `libs/scheduler` is for plain recurring jobs —
  "call this function periodically" — that don't need any of that machinery.
- **Decorator + `DiscoveryModule` registration** (`@ScheduledJob(name, cronExpression, options)` on
  a method, discovered at boot the same way `@RMQConsumer` is), not a runtime-editable
  database-backed admin API the way `WorkflowSchedule` is. Jobs are code-defined; the database is
  used purely for cross-replica execution-claiming, not as an admin-facing resource.

## Scale/Team Context Assumed

Unchanged from every prior Design Mode session: single maintainer, single Nest monorepo,
`apps/server` horizontally scaled behind shared MySQL/Redis, no stated throughput target. As with
every sibling library, this design assumes **multi-replica horizontal scaling regardless of current
team size** — a naive per-replica timer (`@Cron()`/`@Interval()`) would fire the same job on every
replica simultaneously, so cross-replica mutual exclusion is a hard requirement here, not a
nice-to-have (see Key Decisions HIGH #2).

## Context Gathering (Section 0.2)

A research pass across the monorepo before designing (this session) found:

- **`@nestjs/schedule` is used in exactly two places today (`libs/workflow`, `libs/queue`), always
  via `SchedulerRegistry` for bookkeeping only — never the `@Cron`/`@Interval` decorators.** Four
  services (`WorkflowAutoRecoveryService`, `WorkflowRetentionService`, `WorkflowSchedulerService`,
  `OutboxDispatcherService`) all follow the identical hand-rolled shape: `onModuleInit` computes an
  interval, `setInterval(fn, ms).unref()`, registers the timer with
  `scheduler.addInterval(name, timer)` (for `SchedulerRegistry` visibility/testability, not
  correctness), tears down via `scheduler.deleteInterval(name)` in `onModuleDestroy`. This is the
  established convention this design reuses rather than inventing a third scheduling idiom.
- **Every timer fires identically on every replica; per-item mutual exclusion is enforced by a DB-row
  claim, not by leader election or a single timer owner.** The proven idiom (`OutboxRepository
  .claimBatch`, `TypeOrmWorkflowScheduleStore.claimDue`) is: select candidate rows, then a
  conditional `UPDATE ... WHERE id IN (...) AND (unclaimed OR claim-stale)` — the second replica's
  `UPDATE` simply matches zero of the rows the first already claimed. This is the pattern
  `libs/scheduler` reuses (see Key Decisions HIGH #2), not `WorkflowLeaseService`'s
  acquire/renew/keepalive lease (that idiom fits a long-held lock across a multi-step execution;
  scheduled jobs here are meant to be short, discrete units of work, the same shape the outbox
  already solved).
- **`libs/workflow` already has a complete cron-scheduling feature**: `WorkflowSchedule` (entity:
  `scheduleId`, `workflowName`, `workflowVersion?`, `cronExpression`, `timezone?`, `inputTemplate`,
  `enabled`, `nextFireAt`, `misfirePolicy: 'skip' | 'fire-once'`, `lastFiredAt?`, `claimedBy?`,
  `claimedAt?`), a `WorkflowScheduleStore` port with `claimDue`/`recordFired`/`release`, and
  `WorkflowSchedulerService` sweeping on a fixed interval, applying the misfire policy, and calling
  `WorkflowExecutor.execute(...)` to fire. `WorkflowScheduleRegistrationService` computes
  `nextFireAt` via the `cron` package's `CronTime` — already a transitive dependency of
  `@nestjs/schedule`, deliberately reused instead of adding a new cron-parsing dependency (its own
  ARCH.md note). **This design reuses that exact same `CronTime` reuse, and the same
  `'skip' | 'fire-once'` misfire vocabulary**, rather than inventing new ones (Section 17: prefer
  existing patterns).
- **No RabbitMQ delayed-message plugin, no generic Redis-backed distributed-lock primitive
  anywhere in this codebase** (`libs/ratelimit`'s Redis store is a purpose-built rate-limit
  token-bucket/sliding-window Lua script, not a general "acquire a named lock" helper). The only two
  distributed-exclusion idioms that exist are both MySQL/TypeORM-based (the lease-with-keepalive
  idiom and the claim-batch idiom above) — this design picks the claim-batch idiom, the one built for
  exactly this shape of problem, rather than introducing a new Redis-based lock this codebase has
  never needed before.

## Bounded Contexts Identified

- **New bounded context: Recurring Job Scheduling (`libs/scheduler`).** Owns exactly one concern:
  "given a set of code-registered named jobs with cron expressions, ensure each fires on schedule
  exactly once across however many `apps/server` replicas are running." It is a **Generic
  Subdomain** — necessary infrastructure, not a differentiator — same classification `libs/auth` gave
  itself.
- **Does not absorb `libs/workflow`'s scheduling feature.** `WorkflowSchedule` continues to own
  "cron-triggered workflow starts" exactly as today; nothing here changes it, extends it, or
  competes with it. The two features solve visibly different problems (durable multi-step
  orchestration vs. a plain periodic function call) and deliberately share only a *pattern*
  (claim-batch-then-release), not a table, a store interface, or a runtime dependency.
- **Does not absorb `libs/queue`'s outbox.** The outbox dispatches *messages already written by a
  business transaction*; `libs/scheduler` invokes *application-code handlers on a timer*. No
  message broker involvement, no transactional-outbox shape.
- **Does not become a runtime admin-configuration surface.** Job existence, cron expression, and
  enabled/disabled state are all fixed in code and change only on redeploy — this library does not
  absorb any part of `REQUIREMENTS.md`'s separate, unscoped "Configuration Module (runtime
  app/feature-flag settings)" item. If a concrete need for runtime-editable schedules appears later,
  that is a new, separate decision (see Open Questions) — not something to speculatively build room
  for now.

## Context Map

- **`libs/database` (upstream, hard dependency).** Same pattern as every other domain/infra lib:
  `ScheduledJobEntity` + `ScheduledJobRepository extends BaseRepository`,
  `SCHEDULER_TYPEORM_ENTITIES`/`SCHEDULER_MIGRATIONS` exported for the host to merge into its single
  `DatabaseModule.forRoot` call (becomes the eighth library merged there).
- **`@nestjs/schedule` (already a dependency, via `SchedulerRegistry` only).** Same "bookkeeping,
  not decorator API" usage as `libs/workflow`/`libs/queue` — see Context Gathering.
- **`cron` package (already a transitive dependency via `@nestjs/schedule`).** Reused for
  `CronTime`-based `nextFireAt` computation and expression validation — no new dependency added.
- **`libs/workflow`, `libs/queue`, `libs/auth`, `libs/users`, `libs/organizations`, `libs/audit`,
  `libs/cache`, `libs/ratelimit`, `libs/validation`, `libs/notification`:** no relationship. This is
  a small, self-contained infra library with a single upstream dependency (`libs/database`) and no
  HTTP surface, so nothing downstream references it either (see Security Architecture on why no
  controller exists in this design).

No cyclic dependency: `libs/scheduler` depends only on `libs/database` (and framework-level
`@nestjs/core`'s `DiscoveryService`/`MetadataScanner`/`Reflector`, `@nestjs/schedule`'s
`SchedulerRegistry`, and the `cron` package) — the shallowest dependency graph of any library in this
monorepo so far.

## Architecture Style Recommendation

Modular monolith, unchanged. One more Nest dynamic module consumed by `apps/server`.

## Module Breakdown

```
libs/scheduler/src/
  index.ts                              # public barrel

  scheduler.module.ts                   # SchedulerModule.forRoot/forRootAsync
  scheduler.constants.ts                # DI tokens, default interval/batch constants
  scheduler.types.ts                    # SchedulerModuleOptions / *AsyncOptions

  domain/
    scheduled-job.entity.ts             # TypeORM entity (own table, name is the primary key)
    scheduled-job.repository.ts         # extends BaseRepository<ScheduledJobEntity>
    scheduled-job-misfire-policy.enum.ts   # 'skip' | 'fire-once' — mirrors WorkflowSchedule's enum

  decorators/
    scheduled-job.decorator.ts          # @ScheduledJob(name, cronExpression, options?)

  discovery/
    scheduled-job.registry.ts           # onModuleInit: DiscoveryService scan -> in-memory handler
                                         # map + DB upsert, mirrors RMQHandlerRegistry's shape

  engine/
    scheduled-job-sweep.service.ts      # onModuleInit/onModuleDestroy setInterval + claim + invoke,
                                         # mirrors WorkflowSchedulerService exactly
    cron-time.util.ts                   # computeNextFireAt(cronExpression, timezone) via `cron`'s
                                         # CronTime — same reuse WorkflowScheduleRegistrationService
                                         # already established

  errors/
    scheduler-configuration.error.ts    # duplicate job name at boot (mirrors QueueConfigurationError)

  persistence/
    entities/index.ts                  # SCHEDULER_TYPEORM_ENTITIES
    migrations/index.ts                 # SCHEDULER_MIGRATIONS
      1753800000000-InitialSchedulerSchema.migration.ts
```

No `http/`, `dto/`, or `application/` folder — there is no HTTP surface and no separate
"application service" beyond the sweep/discovery engine itself (see Security Architecture).

## Aggregate Design

- **`ScheduledJob` (single aggregate root, no child entities).** Invariants: `name` unique (it *is*
  the primary key — see Key Decisions MEDIUM #1); `cronExpression` must parse via `CronTime`;
  `nextFireAt` is always the aggregate's own computed next-trigger time, never client-supplied.
  Deliberately as thin as `WorkflowSchedule` but without `workflowName`/`inputTemplate`/`version`
  (nothing here fires a workflow) — the row exists purely to hold cross-replica claim state
  (`claimedBy`/`claimedAt`) plus the cron/enabled metadata mirrored from code at boot.

## Domain Model

- `ScheduledJobEntity`: `name (varchar, primary key — the same stable identifier a developer already
  writes in the `@ScheduledJob(...)` decorator, so there is no separate synthetic id to reconcile
  against it)`, `cronExpression`, `timezone?`, `enabled`, `misfirePolicy ('skip' | 'fire-once')`,
  `nextFireAt`, `lastFiredAt?`, `claimedBy?`, `claimedAt?`, `createdAt`, `updatedAt`. Composite index
  on `(enabled, nextFireAt)` — identical shape to `WorkflowSchedule`'s, for the identical claim-query
  access pattern.
- Domain exception: `SchedulerConfigurationError` (extends the same base class
  `QueueConfigurationError`/`WorkflowConfigurationError` do) — thrown at boot on a duplicate
  `@ScheduledJob` name across discovered providers.

## Application Layer (Use Cases)

There is no traditional CRUD "application service" — the two moving parts are:

- **`ScheduledJobRegistry` (`discovery/scheduled-job.registry.ts`), `OnModuleInit`.** Scans
  `DiscoveryService.getProviders()` for `@ScheduledJob`-decorated methods (identical scan shape to
  `RMQHandlerRegistry.onModuleInit`: `MetadataScanner.getAllMethodNames` + `Reflector.get` per
  method), builds an in-memory `Map<name, { cronExpression, timezone, misfirePolicy, enabled, invoke:
  boundFn }>`, throwing `SchedulerConfigurationError` on a duplicate `name` (mirrors
  `RMQHandlerRegistry`'s `registeredKeys` duplicate check exactly). For each discovered job, computes
  `nextFireAt` via `cron-time.util.ts` and **upserts** the DB row — see Key Decisions HIGH #1 for the
  precise upsert semantics (this is the one place this design most needs to get right, since it runs
  on every single boot/redeploy).
- **`ScheduledJobSweepService` (`engine/scheduled-job-sweep.service.ts`), `OnModuleInit` +
  `OnModuleDestroy`.** Same shape as `WorkflowSchedulerService` exactly: `setInterval` on
  `sweepIntervalMs` (default matching the existing `DEFAULT_SCHEDULER_SWEEP_INTERVAL_MS`
  precedent), `.unref()`'d, registered/torn down via `SchedulerRegistry`. Each sweep: `claimDue(owner,
  now, claimStaleMs, batchSize)` against `ScheduledJobRepository`, then for each claimed row, looks up
  its handler in `ScheduledJobRegistry`'s in-memory map by `name` and invokes it; applies the same
  missed-fire/misfire-policy check `WorkflowSchedulerService.fire` does (`missed = now - nextFireAt >
  sweepIntervalMs`; skip-vs-fire-once); on success or on a skipped-due-to-misfire fire, computes the
  next `nextFireAt` and calls `recordFired`; on a handler-thrown error, logs and calls `release`
  **without** advancing `nextFireAt` — which (per the existing precedent's own self-healing property,
  see Key Decisions MEDIUM #2) naturally converts into a misfire-policy-driven skip-and-reschedule on
  the very next sweep rather than an infinite immediate-retry loop, so no separate backoff mechanism
  is needed.

## Commands / Queries

Not applicable in the CQRS sense — there are only two operations that matter (discover-and-upsert at
boot, sweep-and-fire on a timer), neither shaped like a command/query split worth naming.

## Events

None. No other bounded context needs to react to a job firing or failing — if that need appears
(e.g. an alert on repeated job failures), it is an additive port (mirroring `AUTH_EVENT_PUBLISHER`'s
no-op-default-port shape), not designed speculatively now.

## Engines / Policies / Specifications

- **`ScheduledJobSweepService` is the closest thing to an "engine" here** — a small, fixed sweep
  loop, not a generalized rule engine. No `Specification`/`Policy` pattern needed; there is exactly
  one invariant (`name` uniqueness), enforced as a plain `Set`/`Map` check at discovery time, the same
  restraint every sibling library has shown for a single fixed rule.

## Workflows / Sagas

None — by design (see Bounded Contexts: this library explicitly does not absorb or reimplement
`libs/workflow`'s orchestration capability). If a registered job's logic ever needs to be multi-step,
resumable, or compensating, that is the signal to define it as an actual `@Workflow` and use
`libs/workflow`'s existing scheduling feature instead — not a reason to grow this library toward
workflow-engine shape.

## Data Architecture

Single transactional datastore — MySQL via `@/database`, same writer/reader-split datasource every
other library rides. `scheduled_jobs` is an extremely low-volume table (one row per distinct job
name, a handful at most) with moderate read/write churn only from the sweep's own claim cycle — no
special sharding/partitioning need, same conclusion every sibling library reached.

## Messaging Architecture

None — no broker dependency in this design's scope.

## Reliability Architecture

- **Cross-replica exclusivity**: the claim-batch idiom (see Context Gathering / Key Decisions HIGH
  #2) — proven twice already in this codebase (outbox, `WorkflowSchedule`), reused verbatim rather
  than inventing a third mechanism.
- **Self-healing after a handler failure**: see Application Layer — a failed fire isn't retried
  immediately; the misfire policy naturally converts it into a skip-and-reschedule on the next sweep.
  No Saga/Compensation/Circuit-Breaker/DLQ — none of this library's single-shot handler invocations
  are multi-step or call an unreliable external dependency that would need them.
- **Known, accepted risk (documented, not fixed)**: `claimStaleMs` bounds how long a claim is
  considered valid before another replica can reclaim a supposedly-abandoned job. If a handler
  actually runs *longer* than `claimStaleMs` (rather than having genuinely crashed), a second replica
  could reclaim and re-invoke it concurrently — the same class of risk `libs/organizations/ARCH.md`
  already documented for its last-owner check, and the same resolution: this library is explicitly
  scoped to *short* jobs (see Workflows/Sagas above); a job that needs to safely run longer than a
  generous `claimStaleMs` is a signal to move it to `libs/workflow` instead, not a reason to add
  lease-keepalive machinery to this lightweight library.

## Security Architecture

- **No HTTP surface, no controller, no DTO, no user input anywhere in this design.** Job identity,
  cron expression, and handler logic are 100% code-defined by whoever writes the
  `@ScheduledJob`-decorated method — there is no runtime API surface for an unauthenticated or
  under-privileged caller to reach, which eliminates the entire authorization-boundary concern every
  other domain library in this monorepo has had to design around. This is the direct consequence of
  the "decorator + discovery, not a runtime admin API" scope decision confirmed with the user.
- No PII, no credentials, no secrets pass through this library — the only data it persists is
  scheduling metadata (name, cron expression, timestamps).
- Multi-tenancy: not applicable — no tenant model exists anywhere in this platform.

## Scalability

This is the primary property this design exists to get right: correctness under horizontal scaling
of `apps/server`, via the claim-batch idiom (see Reliability Architecture). No additional bottleneck
introduced beyond what `libs/database` already carries; sweep frequency is bounded by
`sweepIntervalMs`, not by job count (a single query claims up to `batchSize` due jobs per sweep).

## Folder Structure

See Module Breakdown — mirrors the flat `domain/persistence/errors` shape every sibling library
uses, with `decorators/`/`discovery/`/`engine/` folders named after `libs/queue`'s
`decorators/`/`consumer/` split and `libs/workflow`'s `engine/` folder, rather than inventing new
folder names for equivalent concepts.

## Design Patterns

- **Repository** (`ScheduledJobRepository extends BaseRepository`) — used, matches every sibling lib.
- **Adapter/Strategy**: not introduced — there is exactly one execution mechanism (the sweep), no
  swappable backend.
- **Specification/Policy**: not used (see Engines/Policies above).
- **Facade**: not needed — `ScheduledJobSweepService` and `ScheduledJobRegistry` are each already a
  single, small, focused class; adding a facade over two classes this thin would be pure indirection.

## CQRS Decision

**Rejected.** No read/write model divergence of any kind exists here.

## Event Sourcing Decision

**Rejected.** Current-state-only rows are sufficient; nothing needs point-in-time replay of a job's
firing history (if firing history/audit ever becomes a real requirement, that's an additive `firedAt`
log table to design against a real consumer then, not now).

## Rejected Alternatives

- **Extending `libs/workflow`'s existing scheduling feature instead of a new library.** Offered
  explicitly to the user; not chosen. Would force every trivial periodic job (e.g. "clean up expired
  sessions nightly") through full workflow-engine ceremony — state persistence, an unused
  compensation slot, versioning — for logic that is, by definition, a single function call.
- **A thin `libs/scheduler` that auto-generates a one-step workflow per registered job and delegates
  to `WorkflowSchedule` under the hood.** Also offered explicitly; not chosen. Avoids duplicating the
  claim-batch logic, but adds a hard `libs/scheduler` → `libs/workflow` dependency and persists every
  trivial job as a full `WorkflowExecutionState` row — more machinery than "call this function
  periodically" warrants, and couples this library's fate to workflow-engine internals for no
  reason.
- **Raw `@Cron()`/`@Interval()` decorators from `@nestjs/schedule`.** Rejected for a sharper reason
  than `libs/workflow/ARCH.md`'s original rationale (that one was about runtime-DB-editability, which
  doesn't apply here since jobs are code-fixed): `@Cron()` has **no built-in cross-replica mutual
  exclusion** — every horizontally-scaled `apps/server` replica would independently fire the same job
  at the same time, which is exactly the hazard this whole design exists to prevent. The claim-batch
  sweep is required regardless of whether schedules are code-fixed or DB-editable.
- **A runtime admin API to enable/disable/reschedule a job without redeploying.** Considered (it
  would mirror `WorkflowSchedule`'s API-driven CRUD) and explicitly rejected for v1 — no concrete need
  stated, and it would blur this library's boundary with `REQUIREMENTS.md`'s separate, unscoped
  "Configuration Module" item. Flagged under Open Questions as the natural extension if that need
  ever appears.
- **A Redis-based distributed lock (`SETNX`-style) for claim exclusivity.** Considered, since Redis
  is already in this platform's stack via `libs/cache`/`libs/ratelimit`. Rejected because no generic
  lock primitive exists to reuse (see Context Gathering) and building one now, for this library only,
  would be new infrastructure introduced for a single narrow consumer — the existing MySQL claim-batch
  idiom already solves this correctness problem twice in this codebase with zero new infrastructure.

## Key Decisions (with risk tag)

**CRITICAL**
- None. Nothing here reaches monolith-vs-microservices, broker-choice, or multi-tenant-isolation
  territory.

**HIGH**
1. **Discovery-time upsert semantics are "metadata always syncs from code; timing state only resets
   when the cron expression or timezone actually changed."** Concretely: if a job's row doesn't
   exist yet, insert it with a freshly computed `nextFireAt`. If it already exists, always refresh
   `cronExpression`/`timezone`/`misfirePolicy`/`enabled` from the decorator (code is the source of
   truth for these), but only **recompute `nextFireAt`** when the stored `cronExpression`/`timezone`
   differ from the decorator's current values — otherwise leave `nextFireAt`/`lastFiredAt`/claim
   state untouched. Benefits: a job's due-time survives ordinary redeploys (a rolling restart doesn't
   silently postpone or double-fire anything); changing a job's schedule in code takes effect
   immediately on the next boot. Risk: if a deploy changes a job's *behavior* without changing its
   cron expression, there's no way to signal "treat this as a fresh schedule" — accepted, since that's
   a rare case and the job's own logic, not its schedule, changed. Alternative rejected: always reset
   `nextFireAt` to "now + one interval" on every boot — rejected because frequent redeploys would
   effectively randomize/delay every job's real cadence. Evolution: none anticipated.
2. **Cross-replica exclusivity via the claim-batch idiom (select candidates, then a conditional
   `UPDATE ... WHERE` still-unclaimed-or-stale), not `@Cron()`/`@Interval()` and not
   `WorkflowLeaseService`'s acquire/renew/keepalive lease.** Benefits: reuses a pattern already proven
   twice in this codebase (outbox, `WorkflowSchedule`) with zero new infrastructure; naturally fits
   "short, discrete unit of work" semantics better than a held-open lease would. Risk: a handler that
   runs longer than `claimStaleMs` can be concurrently reclaimed and re-invoked by another replica —
   accepted as a known, documented risk scoped to this library's explicit "short jobs only" boundary
   (see Reliability Architecture), with "move it to `libs/workflow`" as the stated escape hatch for
   anything that doesn't fit that boundary. Alternative rejected: adopt `WorkflowLeaseService`'s
   lease-with-keepalive shape instead — rejected as more machinery than a short-job scheduler needs,
   and that idiom is already coupled to `workflow_state` row semantics rather than being a standalone
   reusable primitive (confirmed during this session's research). Evolution: if a registered job
   legitimately needs to run longer than any reasonable `claimStaleMs`, that's the signal to convert
   it to a `libs/workflow` workflow, not to add lease-keepalive here.

**MEDIUM**
1. **`ScheduledJobEntity.name` is the primary key**, not a separate synthetic `id`. Benefits: `name`
   is already the natural, stable, developer-chosen identifier (the first argument to
   `@ScheduledJob(...)`); there is no external client ever referencing a job by a different id (no
   HTTP surface at all — see Security Architecture), so a synthetic id would be pure ceremony.
   Diverges from every other library in this monorepo (`libs/users`, `libs/organizations`, etc. all
   use a random-uuid PK plus a separately-unique business key) — justified specifically because those
   libraries expose their aggregates over HTTP to external callers who need a stable opaque id
   independent of a mutable business field, which does not apply here (`name` is effectively
   immutable — renaming a job in code is indistinguishable from deleting the old one and creating a
   new one, which is the correct semantics: a renamed job has no fire history to preserve).
2. **A failed handler invocation is not retried immediately** — `release()` without advancing
   `nextFireAt`, relying on the existing misfire-policy mechanism (see Application Layer) to convert
   the next sweep's "missed" detection into a skip-and-reschedule. Reuses `WorkflowSchedulerService`'s
   exact existing self-healing behavior rather than building a separate backoff/retry-count mechanism
   for this smaller library.
3. `libs/scheduler` depends only on `libs/database` plus framework-level NestJS/`@nestjs/schedule`
   plumbing — no `@/audit` dependency (job firing is an automatic, non-actor-attributable action, not
   an RBAC/profile-style mutation `libs/audit`'s stated scope covers) and no `@/auth` dependency (no
   HTTP surface to guard).

**LOW**
- Library named `libs/scheduler` (singular, matches the generic-infrastructure naming style of
  `libs/cache`/`libs/queue`/`libs/workflow`/`libs/validation`/`libs/ratelimit`, not the
  plural-resource style of the domain libraries `libs/users`/`libs/organizations`).
- Folder layout — see Module Breakdown; `decorators/`/`discovery/`/`engine/` names chosen to match
  existing sibling-library naming for equivalent concepts rather than inventing new ones.
- Migration timestamp continues the existing sequence directly after `libs/organizations`'
  `1753710000000-SeedOrganizationsManagePermission`: `1753800000000-InitialSchedulerSchema`.

## Open Questions / Future Evolution

- **A runtime admin API for enabling/disabling/rescheduling jobs without a redeploy** — not needed
  today (see Rejected Alternatives); the trigger would be a concrete operational need (e.g., an
  incident requiring a job disabled faster than a deploy cycle allows).
- **Job-failure alerting/observability** — deferred, same as the rest of this platform's Tier 1
  Observability item (blocked on an APM backend choice, not something to design speculatively here).
  If a concrete need for "alert on repeated scheduled-job failure" appears, it's an additive port
  (mirroring `AUTH_EVENT_PUBLISHER`'s shape), not a redesign.
- **Longer-running jobs that don't fit the `claimStaleMs` boundary** — the stated escape hatch is
  "convert it to a `libs/workflow` workflow," not extending this library toward lease-keepalive.

## Handoff to Improvement Loop

- **Public API surface (`libs/scheduler/src/index.ts`, once implemented):** `SchedulerModule`
  (`forRoot`/`forRootAsync`), `@ScheduledJob()` decorator, `ScheduledJobMisfirePolicy` enum,
  `SchedulerConfigurationError`, `SCHEDULER_TYPEORM_ENTITIES`, `SCHEDULER_MIGRATIONS`.
- **Module boundaries:** `libs/scheduler` → `@/database` (hard dependency, entity/repository) only.
  No dependency on `@/workflow`, `@/queue`, `@/auth`, or `@/audit` in either direction.
  `apps/server/src/app.module.ts` needs `SCHEDULER_TYPEORM_ENTITIES`/`SCHEDULER_MIGRATIONS` merged
  into its existing `DatabaseModule.forRoot` call and a new `@/scheduler` path alias, matching every
  other library's wiring.
- **First Improvement Loop should implement exactly this scope** — `ScheduledJobEntity` +
  `@ScheduledJob` decorator + `ScheduledJobRegistry` (discovery + upsert) +
  `ScheduledJobSweepService` (claim + invoke + misfire handling) + the one migration — and no more.
  A runtime admin API, failure alerting, and any workflow-engine integration are explicitly out of
  scope until their own stated trigger (see Open Questions).
