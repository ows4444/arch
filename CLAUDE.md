# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run start:dev      # run the app with watch mode (nest start --watch)
npm run build          # nest build (compiles src + all libs)
npm run lint           # eslint --fix over src, apps, libs, test
npm run typecheck      # tsc --noEmit
npm test               # jest (unit specs, *.spec.ts, roots: src/ and libs/)
npm run test:watch
npm run test:cov
npm run test:e2e       # jest --config ./test/jest-e2e.json
npm run format         # prettier --write

# single test file / single test case (ts-jest, no path aliases needed in the pattern)
npx jest libs/workflow/src/engine/executor/executor.spec.ts
npx jest -t "name of the test"

make check             # typecheck && lint && test — run before considering work done
make compose-up        # docker compose up mysql/redis/rabbitmq (docker/compose/compose.yml)
make compose-down
make compose-logs
```

Local infra (MySQL on 3307, Redis on 6380, RabbitMQ on 5673) is defined in `docker/compose/compose.yml` and configured via `.env` (see `.env.example`). Bring it up with `make compose-up` before running the app or any test that touches a real backend.

## Architecture

This is an Nx-less Nest CLI monorepo: a thin application in `src/` composed almost entirely from four independent, publishable shared libraries in `libs/*`. `nest-cli.json` registers each as a `library` project with its own `tsconfig.lib.json`; TypeScript path aliases (`tsconfig.json`) and a matching Jest `moduleNameMapper` (`package.json`) map `@/cache`, `@/database`, `@/queue`, `@/workflow` to `libs/*/src`. Each library has a single barrel `index.ts` — that barrel is the library's public API; only import from a lib's barrel, never reach into its internals from `src/` or from another lib.

`src/app.module.ts` is the best entry point for understanding how the libraries compose in practice — it calls `forRoot`/`forRootAsync` on all four and shows the intended wiring (e.g. cache registry with a Redis default plus an in-memory L1 layered into a `multi-level` cache, queue module with outbox+inbox enabled, workflow module pointed at the `database` persistence backend, entities/migrations from `queue` and `workflow` merged into the single `DatabaseModule.forRoot`).

### libs/database

Generic TypeORM/MySQL data-access layer with reader/writer splitting.

- `DatabaseModule.forRoot/forRootAsync` → `DatabaseCoreModule` sets up datasources per `DatabaseRole` (`READ`/`WRITE`), driven by `config/mysql.schema.ts` (class-validator-checked env) and `DatasourceManager`/`DatasourceFactory`.
- `BaseRepository<T>` is the base every domain repository extends. All reads/writes funnel through `runRead`/`runWrite`, which detect connectivity errors (`isDatabaseConnectivityError`), report failure to the `RepositoryResolver`, and either retry (reads, after waiting for recovery) or fail fast with a `ServiceUnavailableException` (writes — never silently retried, since a write's commit state is unknown).
- Pessimistic/optimistic locking helpers (`findOneForUpdate`, `findOneForShare`, `findOneOptimistic`) assert an active transaction — pessimistic locks acquired outside `@Transactional()` are pointless since they're released before the caller sees the row.
- `@Transactional(options)` (propagation: REQUIRED/REQUIRES_NEW/etc., see `transaction.constants.ts`) is a metadata decorator consumed by `TransactionExecutor`; the active transaction/manager is threaded through an `AsyncLocalStorage`-backed `transactionContext`, not through explicit parameters — that's how `BaseRepository` methods "know" they're inside a transaction without a manager being passed in.
- `RepositoryResolver` picks the right `EntityManager`/`Repository` for the current role and transaction context; `ConnectionMonitor` + `DatabaseHealthService` track datasource health.

### libs/cache

Backend-agnostic caching with a named-instance registry.

- `CacheModule.forRoot/forRootAsync` builds a `CacheRegistry` from a declarative `caches: {}` map (see the example in `app.module.ts`). Each entry is `memory`, `redis`, or `multi-level` (composes two other named caches as L1/L2, built recursively via `CacheFactory`).
- `memory.cache.ts` uses a pluggable `ReplacementPolicy` (LRU/LFU/FIFO/MRU, `policies/replacement-policy.factory.ts`) and an injectable `Clock` (`system.clock.ts` / `fake.clock.ts` for deterministic tests).
- `redis.cache.ts` wraps an injected client via `RedisClient` interface (see `src/redis/ioredis-client.adapter.ts` for the app's ioredis adapter) — the cache lib is not coupled to ioredis directly.
- `@Cacheable`/`@CachePut`/`@CacheEvict` decorators + `CacheInterceptor` (registered as a global `APP_INTERCEPTOR` unless `registerInterceptor: false`) provide method-level caching; `SingleFlight` (`core/single-flight.ts`) collapses concurrent duplicate loads for the same key.
- A `CacheSerializer` and a plugin interface (`interfaces/cache-plugin.interface.ts`, with a configurable error handler) let cross-cutting concerns (metrics, logging) hook into every cache op without the core caches knowing about them.

### libs/queue

RabbitMQ wrapper (`amqp-connection-manager`) with topology-as-code and outbox/inbox reliability patterns.

- `QueueModule.forRoot` is `@Global()`; it registers `RMQConnection`, `RMQPublisher`, `RMQConsumerRuntime`, and `TopologyBootstrap` (declares exchanges/queues/bindings/DLQs from `RmqTopologyDefinition[]`, see `topology/topology.builder.ts` + `topology.contracts.ts`).
- Consumers are declared with the `@RMQConsumer` decorator (`consumer/rmq-consumer.decorator.ts`) and found via `DiscoveryModule` + `RMQHandlerRegistry`; retry/backoff and dead-lettering are computed in `consumer/rmq-retry.utils.ts` against each queue's `retryPolicy`.
- `RMQContext` carries `requestId`/`correlationId`/`causationId`/an `AbortSignal` per message (`context/rmq-context.factory.ts`); header parsing/validation (`context/rmq-header.*`) enforces that system headers can't be overridden by caller-supplied ones.
- Reliability: `outbox/` (transactional outbox — `OutboxService` persists messages in the same DB transaction as business writes, `OutboxDispatcherService` polls and publishes) and `inbox/` (`DatabaseQueueInboxService` dedups at-least-once deliveries; swappable for `NoopQueueInboxService` when `inbox: false`). Both are conditionally registered in `QueueModule.forRoot` based on `options.outbox`/`options.inbox`. Entities/migrations (`QUEUE_TYPEORM_ENTITIES`, `QUEUE_MIGRATIONS`) are exported for the host app to merge into its own `DatabaseModule.forRoot` call — the queue lib doesn't own the datasource.
- Errors are typed by retry semantics: `RetryableMessageError`, `NonRetryableMessageError`, `HandlerTimeoutError`, `UnroutableMessageError`, `QueueConfigurationError`.

### libs/workflow

A durable workflow/saga engine (packaged separately as `@ows4444/nest-workflow`, `libs/workflow/package.json` — treat its public API in `libs/workflow/src/index.ts` as a real semver-sensitive surface, not just an internal module). Backed by TypeORM.

- Workflows/steps are declared with `@Workflow`/`@Step` decorators (`workflow/workflow.decorator.ts`, `steps/step.decorator.ts`) plus `@Hook` and `@Signal` for lifecycle callbacks and external signal handling; `WorkflowDiscovery`/`WorkflowRegistry` find them via `DiscoveryModule`.
- Execution flow: `WorkflowExecutor` → `WorkflowRunner` → `WorkflowStepExecutor`/`WorkflowStepResolver`, with state persisted through `WorkflowStateService`/`WorkflowStateFactory` and validated by `WorkflowStateTransitions`/`WorkflowTransitionValidator` — this is a real state machine, not ad hoc status flags.
- Reliability primitives: `WorkflowRetryService` + pluggable `WORKFLOW_RETRY_JITTER`/`WORKFLOW_RETRY_SCHEDULER` tokens, `WorkflowCompensationService` (saga rollback), `WorkflowLeaseService` (distributed lease so only one runner drives a given workflow instance), `WorkflowExpirationService`, `WorkflowAutoRecoveryService`/`WorkflowRecoveryService` for crash recovery, `ChildWorkflowService` with a `WORKFLOW_PARENT_FAILURE_HANDLER` policy for parent/child failure propagation.
- Everything cross-cutting is a DI token with a no-op default the host can override: `WORKFLOW_METRICS` (default `NoopWorkflowMetricsService`), `WORKFLOW_EVENT_PUBLISHER` (default `NoopWorkflowEventPublisher`), `WORKFLOW_ARCHIVE_STORE` (default `NoopWorkflowArchiveStore`, used by `WorkflowRetentionService`). Pass real implementations via `WorkflowModule.forRoot({ metrics, eventPublisher })`.
- Persistence is swappable: `WorkflowModule.forRoot({ persistence: 'typeorm' | 'database' })` selects between `WorkflowPersistenceModule` (adapters under `persistence/adapters/typeorm/*`, its own entities/migrations) and `WorkflowDatabasePersistenceModule` (rides on `libs/database`'s repository/transaction abstractions instead). Check `persistence/adapters/typeorm/entities` and `persistence/adapters/typeorm/migrations` before touching schema.
- `WorkflowClient` / `WorkflowQueryService` (`public/api/*`) are the intended consumer-facing API for starting workflows and querying their state/history from outside the engine.

### Cross-cutting conventions

- Path aliases only: within `src/`/`libs/*` code, import other libraries via `@/cache`, `@/database`, `@/queue`, `@/workflow` — never relative paths across a `libs/*` boundary.
- Config is validated via `class-validator` schema classes (e.g. `libs/database/src/config/mysql.schema.ts`) rather than read ad hoc from `process.env`; follow that pattern for new env-driven config.
- Dynamic modules follow the same shape everywhere: a static `forRoot(options)` for direct config and `forRootAsync({ useFactory, inject, imports })` for config resolved from other providers (e.g. `ConfigService`). Cross-cutting behavior (metrics, event publishing, persistence backend, interceptor registration) is injected via tokens with no-op/default implementations, never hardcoded.
- `eslint.config.mjs` turns off `no-explicit-any` and downgrades `no-floating-promises`/`no-unsafe-argument` to warnings — don't "fix" these repo-wide; only address them where you're already touching the code.

## Agent operating protocol (`ci.loop`)

`ci.loop` (repo root, untracked) is a standing operating protocol for AI agents doing continuous-improvement passes over `libs/*`. If asked to do a review/refactor loop over one of the shared libraries, follow it: work in Understand → Review → Plan → Implement → Verify → Evaluate phases; rank findings Critical/High/Medium/Low; classify each change's risk (Low/Medium/High/Critical) and treat High/Critical changes (public API, schema, workflow/queue semantics, auth, caching, concurrency) as needing explicit justification; prefer improving existing code over rewriting; check whether a fix pattern (transaction propagation, retry semantics, provider registration, etc.) should be cross-checked against the other three libraries; and append (never overwrite) a dated entry to a per-library `libs/<lib>/LOOP.md` when a loop completes. Domain-specific review checklists (TypeORM, workflow determinism/compensation, queue retry/ack semantics, cache eviction/isolation, NestJS module internals) are spelled out in full in `ci.loop` itself — read it before starting a loop rather than relying on this summary.
