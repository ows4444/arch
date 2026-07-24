# Design 001

**Library / Bounded Context:** libs/database (Data Access)
**Date:** 2026-07-23

## Goal

Retroactively document `libs/database`'s architecture. This library was built and has gone
through 8 Improvement Loop passes (see `LOOP.md`) without a preceding Design Mode session —
unlike `libs/auth`/`libs/ratelimit`/`libs/validation`/`libs/workflow`, which each started from
one. This entry captures the design that already exists in the implementation (cross-checked
against the actual source, not just intent), so future loops have the same "bounded contexts and
aggregate boundaries actually honored in the code" reference point ci.loop's Phase 2 checks
against for the other libraries. Nothing here reflects a new decision being made now — every
choice below was already built; this is the record catching up to reality, in the same spirit as
`libs/auth/ARCH.md` Design 006's correction earlier this session.

## Scale/Team Context Assumed

Single maintainer, Nest monorepo, two runtime apps (`apps/server` HTTP, `apps/worker` background/
queue consumer). One MySQL primary (`DatabaseRole.WRITE`) plus zero or more read replicas
(`DatabaseRole.READ`), each modeled as an independent `DataSourceState`. No stated tenant-count or
throughput target — the reader/writer split and connectivity-retry machinery are built for
horizontal read scaling if/when replicas are added, not because a concrete load target demands it
today (`apps/server`'s actual config runs with zero configured readers, falling back to the
writer for every read — see `selectReader()`).

## Bounded Contexts Identified

- **Single bounded context: Data Access.** A **Generic Subdomain** (per the same DDD framing
  `libs/auth/ARCH.md` Design 001 uses for Identity & Access) — necessary infrastructure every
  other library and `apps/*` depends on, not itself part of any business domain. It owns exactly
  one concern: giving the rest of the monorepo a uniform, reliability-hardened way to read/write
  MySQL through TypeORM, without any library-specific business logic leaking in.
- Does **not** own schema/entities for any consuming library — `libs/queue`/`libs/workflow`/
  `libs/auth`/`libs/ratelimit`/`libs/validation` each define and own their own entities/migrations,
  merging them into one `DatabaseModule.forRoot({ entities, migrations })` call in `apps/server`'s
  `app.module.ts`. `libs/database` only owns the connection/transaction/repository *mechanism*.
- Does **not** own connection pooling/retry policy for any other backend (Redis, RabbitMQ) — those
  belong to `libs/cache`/`libs/queue` respectively, each with their own retry/backoff constants.

## Context Map

- **Upstream of every other `libs/*` package and both `apps/*` runtimes.** `libs/queue`,
  `libs/workflow`, `libs/auth`, `libs/ratelimit`, `libs/validation` all depend on `@/database`
  directly (not behind a port) for `BaseRepository`, `@DatabaseRepository`/`@InjectRepository`,
  and `@Transactional()`/`TransactionExecutor` — this is a deliberate **Shared Kernel**, not an
  Anti-Corruption Layer: every consumer speaks TypeORM's `EntityManager`/`Repository` vocabulary
  directly, since introducing an ORM-agnostic port here would mean re-abstracting TypeORM's own
  abstraction with no second ORM ever planned.
- **Downstream of TypeORM + `mysql2`.** No anti-corruption layer against TypeORM either — entities,
  `QueryBuilder`, `EntityManager` are used directly throughout this library and by every consumer.
  This is a monorepo-wide, already-settled choice (every sibling library's entities are TypeORM
  `@Entity()` classes), not something this library alone could change.
- **Peer relationship with `libs/workflow`'s two persistence backends.** `WorkflowModule.forRoot({
  persistence: 'database' })` rides directly on `libs/database`'s `BaseRepository`/
  `TransactionExecutor` (via `WorkflowDatabasePersistenceModule`) as an alternative to
  `libs/workflow`'s own bundled TypeORM adapters (`persistence: 'typeorm'`) — the only place in the
  monorepo where a sibling library's persistence layer is *itself* pluggable against this one.

## Architecture Style Recommendation

Not applicable in the "monolith vs. microservices" sense — this is a library inside one Nest
monorepo, not a deployable service of its own. The one architecture-style-shaped decision that
does apply: **reader/writer datasource splitting**, modeled as N independent `DataSourceState`
entries (one `isWriter: true`, zero-or-more readers) rather than a single pooled datasource with
routing logic bolted on after the fact. Chosen because MySQL read replicas are a real, common
scaling lever for a single-primary relational database, and modeling each datasource's health/
connection state independently (rather than one shared pool object) is what makes per-reader
failure isolation (Loop 007's fix) and round-robin-with-health-gating (`selectReader()`) possible
at all.

## Module Breakdown

- **`DatabaseModule`** (public entry point) — thin wrapper exposing `forRoot`/`forRootAsync`,
  delegating to `DatabaseCoreModule` and `DatabaseConfigModule`.
- **`DatabaseCoreModule`** (`@Global()`, empty static `@Module({})` — the dynamic-module/decorator
  gotcha every sibling library's module also avoids) — registers `DataSourceFactory`/
  `DataSourceManager`/`RepositoryResolver`/`TransactionExecutor`/`TransactionProviderEnhancer`/
  `ConnectionMonitor`/`DatabaseHealthService`/`RepositoryDiscoveryService`, plus one
  `RepositoryProviderFactory`-generated pair of DI tokens (`READ`/`WRITE`) per
  `@DatabaseRepository`-decorated class discovered via `RepositoryRegistry`'s static,
  import-order-dependent registration (documented directly on the decorator since Loop 001).
- **`DatabaseConfigModule`** — owns `MySQLEnvironmentSchema` validation (`class-validator`, fails
  fast at boot on a malformed/missing env var) and `mysql.loader.ts`'s translation from validated
  env vars into `DatabaseConnectionOptions` for both the writer and (if `MYSQL_REPLICA=true`) the
  reader.
- **`repository/`** — `BaseRepository<TEntity>` (the funnel every domain repository extends),
  `RepositoryResolver` (role/transaction/read-pin-aware `EntityManager`/`Repository` resolution),
  `RepositoryRegistry`/`RepositoryProviderFactory`/`RepositoryDiscoveryService` (DI wiring),
  `datasource.tokens.ts`/`repository.tokens.ts` (per-role token identity, `Map`-cached `Symbol()`
  rather than `Symbol.for()` — Loop 002's fix for the process-wide-registry collision risk).
- **`datasource/`** — `DataSourceManager` (owns every `DataSourceState`, health/reconnect/
  round-robin-reader-selection), `DataSourceFactory` (raw TypeORM `DataSource` lifecycle:
  create/destroy/recreate), `ConnectionMonitor` (periodic health-check sweep),
  `read-pin.context.ts` (`AsyncLocalStorage`, pins one automatic read-retry to the exact reader it
  started on).
- **`transaction/`** — `TransactionExecutor` (propagation-aware transaction driver:
  `REQUIRED`/`REQUIRES_NEW`/`NESTED`/`MANDATORY`/`NEVER`/`SUPPORTS`/`NOT_SUPPORTED`),
  `transaction.context.ts` (`AsyncLocalStorage`-backed active-manager + commit/rollback hook
  registry), `transaction.hooks.ts` (`runOnTransactionCommit`/`Rollback`/`Complete`),
  `@Transactional()` decorator + `TransactionProviderEnhancer` (`DiscoveryService`-driven method
  wrapping at `onModuleInit` — the only thing that makes the decorator do anything; see Reliability
  Architecture for why this matters).
- **`health/`** — `DatabaseHealthService`, a thin read-only facade over `DataSourceManager`'s
  per-datasource health/metrics state for host apps to expose (e.g. a `/health` endpoint).
- **`pagination/`** — `paginateOffset()` + `OffsetPaginationResult` (page/limit-clamped, bounded at
  `MAX_LIMIT`). `CursorPagination*` types existed with zero implementation and were removed
  (Loop 002) rather than built speculatively.

## Aggregate Design

Not applicable in the DDD business-aggregate sense — this library has no business entities.
The closest analogue is **`DataSourceState`** (one per configured writer/reader): a
non-persisted, in-memory-only runtime object (`name`, `configuration`, `status`, `healthy`,
`dataSource`, `reconnectPromise`, `metrics`) that `DataSourceManager` is the sole owner/mutator
of — every other component (`ConnectionMonitor`, `RepositoryResolver`, `BaseRepository`) reads it
through `DataSourceManager`'s methods, never mutates it directly. This "one owner, everyone else
reads through it" shape is the practical equivalent of aggregate-root encapsulation here, even
though nothing is ever persisted to a database as a `DataSourceState`.

## Domain Model

- **`DataSourceState`** — see Aggregate Design.
- **`DatabaseRole`** (`READ` | `WRITE`) — the one piece of vocabulary every consumer touches
  directly (`@InjectRepository(X, DatabaseRole.READ)`, `BaseRepository`'s constructor param).
- **`DataSourceStatus`** (`STOPPED`/`INITIALIZING`/`READY`/`DEGRADED`/`RECONNECTING`/`FAILED`/
  `SHUTTING_DOWN`) — a real state machine `DataSourceManager` drives (`markConnected`/
  `markFailed`/`updateHealth`/`performReconnect`), not just a status label; `selectReader()`'s
  eligibility gate (`healthy && status === READY`) is the reason Loop 007's status-stomping bug
  (a `RECONNECTING` datasource briefly readable as `READY` again) was a real, not cosmetic, defect.
- **`TransactionMetadata`** (`propagation`/`isolationLevel`/`timeoutMs`) — the `@Transactional()`
  decorator's payload, read by `TransactionProviderEnhancer` via `reflect-metadata`.
- **Domain Exceptions:** `ServiceUnavailableException` (thrown, never silently retried, for every
  write-role connectivity failure and for a read failing inside an active transaction — see
  Reliability Architecture); repository-level errors surface as whatever TypeORM/the driver
  throws, translated only where a consumer needs to distinguish a specific failure mode (e.g.
  `isDatabaseConnectivityError`'s retry-vs-fail-fast decision).

## Commands / Queries / Events

Not applicable — no command bus, no query bus, no domain event publisher exists in this library
(unlike `libs/workflow`'s `WORKFLOW_EVENT_PUBLISHER`/`libs/auth`'s `AUTH_EVENT_PUBLISHER` ports).
The closest thing to "events" are `ResolvedDatabaseOptions.lifecycle`'s three optional callbacks
(`onConnected`/`onHealthChanged`/`onReconnect`) — plain fire-and-forget hooks for host-app
observability (metrics/alerting), not a pub/sub mechanism other code in this library reacts to.

## Engines / Policies / Specifications

- **Reader-selection policy:** round-robin across healthy readers (`selectReader()`), falling back
  to the writer (and incrementing `readerFallbackCount`, an observability signal) when no reader is
  currently `healthy && READY`. A policy, not an engine — one fixed rule, not a pluggable
  rule-evaluator, and correctly so: nothing in this library's actual usage has ever needed a second
  reader-selection strategy.
- **Retry policy:** `DatabaseRetryOptions` (`maxAttempts`/`initialDelayMs`/`maxDelayMs`/
  `reconnectCooldownMs`/`readRecoveryTimeoutMs`), consumed by `retry.util.ts`'s exponential backoff
  and `DataSourceManager`'s reconnect-cooldown gate (prevents a reconnect storm when a datasource
  is failing continuously).
- **Specification-shaped check:** `isDatabaseConnectivityError(error)` (`utils/database-error.util.ts`)
  is the single function deciding retry-vs-fail-fast for every DB operation in the library — not
  built on `libs/validation`'s `Specification` interface (that library didn't exist yet when this
  check was written, and retrofitting it now would be a cosmetic-only change per ci.loop §18).

## Workflows / Sagas

Not applicable — no multi-step business process lives in this library. `TransactionExecutor`'s
propagation handling (`REQUIRES_NEW` suspending an ambient transaction, `NESTED` using savepoints)
is transaction-boundary plumbing, not a saga/compensation mechanism; sagas belong to
`libs/workflow`, which consumes this library's transactions as a building block, not the other
way around.

## Data Architecture

Single transactional datastore: MySQL, accessed exclusively through TypeORM. Reader/writer split
is the only data-architecture decision of note (see Architecture Style Recommendation) — no
separate reporting/analytical store, no polyglot persistence; every consuming library's schema
lives in the same MySQL instance, migrated through the same `DatabaseModule.forRoot({ migrations
})` call. `MySQLEnvironmentSchema` validates connection config (host/port/credentials/pool size/
SSL/timezone) for both the writer and an optional replica at boot, failing fast rather than
connecting with bad config and failing on first query.

## Messaging Architecture

Not applicable — no broker dependency of any kind. `libs/queue`'s outbox pattern is what bridges
this library's transactional writes to RabbitMQ; `libs/database` itself has no messaging surface.

## Reliability Architecture

This is where nearly all of this library's actual complexity lives, and where 6 of 8 Improvement
Loop passes found real defects — worth being explicit about, since it's the part of the design
most worth a future loop re-verifying against:

- **Connectivity retry, fail-fast on writes.** `BaseRepository.execute()` retries reads
  automatically on a detected connectivity error (`isDatabaseConnectivityError`), waiting for
  `DataSourceManager.waitForRecovery()` and retrying against the *same pinned reader*
  (`read-pin.context.ts`, Loop 001's fix for reader misattribution). Writes are **never** silently
  retried — a write's commit state is unknown after a connectivity error, so it always fails fast
  with `ServiceUnavailableException` (this exact principle, stated once in `CLAUDE.md`, had to be
  enforced twice: once for the explicit-role case at the library's first pass, and again for a
  read issued on a WRITE-role repository *inside an active transaction* — Loop 004's Critical fix,
  since that case resolves to the same non-recoverable transactional manager regardless of role).
- **Health monitoring drives routing, not just observability.** `ConnectionMonitor`'s periodic
  sweep calls `DataSourceManager.updateHealth`/`updateServerIdentity`, which directly gates
  `selectReader()`'s eligibility — Loop 007's fix (a `RECONNECTING` status must not be stomped back
  to `READY` by a health check racing a just-triggered reconnect) is a correctness fix to request
  routing, not merely to a dashboard number.
- **Transaction commit-hook ordering matches physical commit, not callback resolution.**
  `TransactionExecutor`'s default (fresh `REQUIRED`) and `REQUIRES_NEW` paths manually drive a
  `QueryRunner` rather than using `dataSource.transaction()`, specifically so
  `runOnTransactionCommit()`/`Rollback()` hooks fire *after* the physical `COMMIT`/`ROLLBACK`, not
  merely after the caller's callback settles (Loop 005's Critical fix) — every downstream consumer
  of `afterCommit`-style deferral (`libs/workflow`'s `DatabaseWorkflowTransactionRunner`, built on
  `runOnTransactionCommit` directly) depends on this guarantee holding.
- **`@Transactional()` requires a real Nest DI bootstrap to do anything.** The decorator is
  metadata-only; `TransactionProviderEnhancer`'s `DiscoveryService`-driven method wrapping at
  `onModuleInit` is what actually intercepts calls — a service constructed manually (`new Foo(...)`,
  the pattern every library's fast/Docker-optional integration tests use) never gets wrapped. This
  was previously undocumented and unverified anywhere in the monorepo until `libs/auth`'s Loop 018
  (this session) discovered it while trying to use the decorator for the first time ever outside
  this library's own unit specs — worth stating explicitly here so a future consumer doesn't
  rediscover it the same way.
- **Pessimistic/optimistic locking only works inside an active transaction, and only on drivers
  that support it.** `findOneForUpdate`/`findOneForShare` assert an active write transaction
  (locks acquired outside one are released before the caller ever sees the row) — but neither
  works at all against `better-sqlite3` (`LockNotSupportedOnGivenDriverError`), which every fast
  integration test elsewhere in this monorepo depends on. This is a real constraint on *any* future
  use of these two helpers, not specific to the one place it was discovered (`libs/auth`'s RBAC
  race, Loop 018) — a consumer needing row-level locking must accept that its tests either mock
  the lock entirely or run against real MySQL, never sqlite.

## Security Architecture

- **Secret redaction.** `DataSourceManager.state(role)`/`states()` redact `password` before
  returning a `DataSourceState` snapshot to any caller (e.g. `DatabaseHealthService`, which a host
  app might expose over an HTTP health endpoint) — connection credentials are never logged or
  surfaced through this library's own observability surface.
- **SQL injection.** Every query path goes through TypeORM's parameterized `QueryBuilder`/
  `Repository` methods or `EntityManager.query(sql, parameters)` with bound parameters — no raw
  string-interpolated SQL exists in this library.
- **No authN/authZ surface.** This library has no concept of a caller's identity or permissions —
  that's `libs/auth`'s responsibility entirely; `libs/database` trusts every caller inside the
  process equally.

## Folder Structure

Matches the breakdown already given under Module Breakdown — `config/`, `constants/`, `database/`
(the `DatabaseAccessor` port), `datasource/`, `decorators/`, `health/`, `interfaces/`,
`module/`, `pagination/`, `repository/`, `transaction/`, `utils/`, plus a single barrel
`index.ts`. This layout was already established before this entry and matches the convention
every sibling library's own folder structure follows (a flat, concern-named top level, no nested
"domain/application/infrastructure" layering — `libs/database` predates that heavier convention
`libs/auth`/`libs/ratelimit` later adopted for their own, genuinely domain-shaped bounded
contexts).

## Deployment Architecture

One writer datasource, zero-or-more reader datasources, all pointed at the same logical MySQL
service (`docker/compose/compose.yml`'s single `mysql` container in dev; a real replica topology
in any environment that sets `MYSQL_REPLICA=true`). Migrations run at boot when
`MYSQL_MIGRATIONS_RUN=true` (the documented default), merged from every consuming library's own
`*_MIGRATIONS` export into one `DatabaseModule.forRoot({ migrations })` call in `apps/server`.
`apps/worker` shares the identical `DatabaseModule` wiring pattern, not a separate one.

## Team Ownership Model

Not applicable — single maintainer.

## Tradeoff Analysis

- **Shared-kernel TypeORM coupling vs. an ORM-agnostic port.** Chosen (implicitly, by every
  consumer importing `BaseRepository` directly) for simplicity: an abstraction layer over TypeORM
  would need to re-expose most of what `QueryBuilder`/`EntityManager` already provide, for a
  second-ORM scenario nobody has ever needed. Revisit only if a genuine second persistence
  technology is ever required by a consumer.
- **Never-retry writes vs. idempotent-write retry.** Writes fail fast on any connectivity error
  rather than being retried, even for operations that happen to be idempotent (e.g. an `UPSERT`) —
  a deliberate, blanket conservative choice (Loop 004 restated it, didn't relax it) since
  `BaseRepository` has no general way to know a given write is safe to retry. A consumer needing
  idempotent-write retry must build it explicitly at its own call site (e.g. `libs/queue`'s outbox
  `claimBatch`'s own idempotent conditional-`UPDATE` pattern), not rely on this library doing it
  silently.
- **Round-robin reader selection vs. latency/load-aware routing.** Round-robin with a health gate
  is the entire policy — no latency-based or load-aware reader selection exists. Acceptable given
  the stated scale/team context (no throughput target driving a need for smarter routing); revisit
  if reader latency variance ever becomes an observed problem.

## Future Scalability Plan

Not applicable in detail given no stated scale target — the reader/writer split itself *is* this
library's answer to "what happens if read load grows": add reader `DataSourceConnectionOptions`
entries, no code change needed. The one named bottleneck: `selectReader()`'s round-robin has no
awareness of reader lag/replication delay, so a badly-lagging reader is still selected as
"healthy" as long as it answers the health-check query — worth revisiting if read-after-write
staleness from a lagging replica ever becomes a real, observed problem.

## Open Questions

- None outstanding — every open item from the library's own `LOOP.md` history has either been
  closed or is explicitly deferred pending a concrete driving need (see each Loop's own "Next Loop"
  notes, most recently Loop 008's two consecutive clean adversarial passes).

## Handoff to Improvement Loop

- **Public API surface:** `libs/database/src/index.ts`'s barrel — `BaseRepository`,
  `@DatabaseRepository`/`@InjectRepository`/`@InjectDatabase`, `DatabaseAccessor`,
  `@Transactional()`/`TransactionExecutor`/`runOnTransactionCommit`/`Rollback`/`Complete`,
  `DatabaseModule`, `DatabaseRole`, `DataSourceManager`, `RepositoryResolver`,
  `DatabaseHealthService`, pagination types/utilities, and the full `interfaces/` surface
  (`DatabaseModuleOptions`, `DatabaseConnectionOptions`, `DatabaseRetryOptions`, etc.).
- **Module boundaries:** as described under Module Breakdown — unchanged from what's already
  implemented; this entry documents, not proposes, the boundary.

---

## Executive Summary

`libs/database` is the shared kernel every other library and both runtime apps build their
persistence on: a reader/writer-split TypeORM/MySQL access layer (`BaseRepository`, funneled
through `runRead`/`runWrite`), a propagation-aware transaction executor (`@Transactional()`/
`TransactionExecutor`), and a self-healing connection layer (`DataSourceManager`/
`ConnectionMonitor`) that retries reads against a pinned reader, never silently retries writes,
and gates read routing on live health rather than just logging it. It owns no business domain of
its own — every consuming library's schema and business logic lives elsewhere — and its design
surface is almost entirely about reliability: eight Improvement Loop passes have found and fixed
real defects in exactly that reliability machinery (reader misattribution, transactional-write
retry safety, commit-hook ordering vs. physical commit, and a health-check race that could route
reads to a datasource mid-teardown), each now covered by a regression test. The two standing,
deliberately-undesigned properties worth any future consumer knowing before they lean on them:
`@Transactional()` only works through a real Nest DI bootstrap (not a manually-constructed
service), and pessimistic/optimistic row locking doesn't work at all against `better-sqlite3` —
both discovered this session, both now documented here rather than left for a future loop to
rediscover the hard way.
