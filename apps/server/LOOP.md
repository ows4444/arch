# Loop 001

**App:** server

**Date:** 2026-07-21

## Goal

First ci.loop pass over `apps/server` (previously only `libs/*` had been looped). `apps/server`
isn't a `libs/*` package so it has no `ARCH.md`/pre-existing `LOOP.md` — applying the same
Understand → Review discipline the protocol uses for libraries, scoped to what's actually
reviewable at the app-composition layer (module wiring, bootstrap, HTTP surface), not
library-internal logic already covered by each lib's own loop.

## Files Reviewed

- `apps/server/src/app.module.ts`, `main.ts`, `app.controller.ts`, `app.service.ts`
- `apps/server/src/redis/ioredis-client.adapter.ts`
- `apps/server/src/validation-rules/*` (already reviewed in `libs/validation`'s Loop 005-012;
  re-checked only for app-wiring concerns, not re-litigated)
- `apps/server/test/app.e2e-spec.ts`
- `.env.example`, `docker/compose/compose.yml`, `nest-cli.json`, root `package.json` scripts
- `node_modules/@nestjs/swagger/dist/swagger-ui/helpers.js` (confirmed how `SwaggerModule.setup`
  actually serializes a function-valued `responseInterceptor` — see Problems Found, not a defect)
- `libs/database/src/interfaces/database-bootstrap-options.interface.ts` (traced why
  `app.module.ts`'s `DatabaseModule.forRoot({ entities: [...] })` call needs an
  `as unknown as DatabaseBootstrapOptions['entities']` cast)

## Problems Found

**Critical**
- (none)

**High**
- No `@RMQConsumer`-decorated class exists anywhere in the repo (`apps/server`, `apps/worker`, or
  any `libs/*`), confirmed via repo-wide grep. `QueueModule.forRoot({ outbox: {}, inbox: true })`
  is wired into `apps/server`, so the transactional outbox will publish messages and the inbox
  dedup path is registered, but nothing in the codebase ever consumes a message —
  `RMQConsumerRuntime`'s `DiscoveryModule` scan will always find zero handlers. This isn't a code
  defect in `apps/server` itself (the module is wired correctly per `libs/queue`'s documented
  API), but it means the messaging half of the architecture described in the root `CLAUDE.md`
  (topology bootstrap, retry/DLQ, inbox dedup) is currently unreachable — there's no consumer
  process to exercise it. See `apps/worker/LOOP.md` Loop 001 for the other half of this finding
  (the natural home for consumers is empty).

**Medium**
- (none)

**Low**
- `libs/database/src/interfaces/database-bootstrap-options.interface.ts` declares
  `entities: MixedList<string | ((...args: any[]) => any) | EntitySchema<any>>` — a call-signature
  type, which TypeORM entity *classes* (construct signatures) don't structurally satisfy, forcing
  `app.module.ts`'s `DatabaseModule.forRoot({ entities: [...] as unknown as
  DatabaseBootstrapOptions['entities'] })` cast. `migrations` on the same interface uses
  `new (...args: any[]) => unknown` (a proper construct signature) and needs no such cast one line
  below. This is a `libs/database` interface issue surfacing as an `apps/server` type-safety hole
  (the cast defeats any check that the right entity classes were actually passed) — flagged here
  since it's this app that pays the cost, but the fix belongs in `libs/database`'s own loop, not
  this one.
- Root `CLAUDE.md`'s Architecture section describes "a thin application in `src/`" as the entry
  point; the actual entry points are `apps/server/src` and `apps/worker/src` (confirmed via
  `nest-cli.json`'s `projects` map — no top-level `src/` exists). Doc drift, not a code defect;
  not fixed in this loop since editing `CLAUDE.md` wasn't asked for and is a project-level
  document, not app code.

## Changes Made

- (none — see Remaining TODO; the High finding is a cross-app architectural gap that needs a
  product decision, not a code fix, and the Low findings both belong to other owners)

## Why

- No fix was made without a decision from the user on the High finding's scope (build real
  consumers now vs. leave `apps/worker`/messaging half-built until there's a concrete message to
  process — see Section 18: this would be a Medium/High-risk change, new consumer surface and
  queue semantics, warranting explicit justification before implementing).

## Tests

No test changes. Full repo suite: 133 suites / 1040 tests passing (unchanged from before this
loop — no code was modified).

## Build

PASS

## Lint

PASS

## Remaining TODO

- Decide whether `apps/worker` should host real `@RMQConsumer`/workflow-runner logic, or whether
  the outbox/inbox/topology wiring in `apps/server` is intentionally forward-looking
  infrastructure with no consumer yet. See `apps/worker/LOOP.md` Loop 001.
- `libs/database`'s `entities` type-cast — belongs in `libs/database`'s own next loop.

## Next Loop

- Driven by the user's answer to the `apps/worker` question above, not forced.

---

**Addendum (2026-07-22):** The `libs/database` `entities` type-cast noted above as a Remaining
TODO (Loop 001) is resolved — see `libs/database/LOOP.md` Loop 006. `apps/server/src/app.module.ts`
no longer needs the `as unknown as DatabaseBootstrapOptions['entities']` cast.

---

# Loop 002

**App:** server
**Date:** 2026-07-23

## Goal

Fresh adversarial pass over `apps/server`, the last app-level composition point not yet reviewed
in this session's broader `ci.loop` run across all seven `libs/*` packages. Confirmed whether
Loop 001's one open High finding (no real `@RMQConsumer` anywhere, `apps/worker` empty) still
holds, then re-read the full module-wiring surface with the same adversarial eye applied to every
library this session.

## Files Reviewed

- `apps/server/src/app.module.ts` (full re-read: every `forRoot`/`forRootAsync` call, the two
  independent Redis connections — `CacheModule`'s via `ConfigService`, `RateLimitModule`'s via raw
  `process.env` — and the DI-graph ordering question this raises)
- `apps/server/src/main.ts` (helmet/CORS/shutdown-hooks/`ValidationPipe`/Swagger setup, including
  the browser-side `responseInterceptor` function Loop 001 already traced through Swagger UI's
  actual serialization)
- `apps/server/src/redis/ioredis-client.adapter.ts`, `apps/server/src/validation-rules/
  validation-rule.controller.ts`, `apps/server/src/app.controller.ts`
- `apps/server/test/app.e2e-spec.ts`
- Repo-wide grep for `@RMQConsumer` — confirmed `apps/worker/src/queue/worker-smoke-test.consumer.ts`
  now exists, closing Loop 001's High finding (the messaging half of the architecture is reachable
  again, via `apps/worker`'s own subsequent loops, not this one).

## Problems Found

**Critical / High / Medium / Low** — none this pass.

- Specifically investigated whether `RateLimitModule.forRoot(...)`'s eager, synchronous
  `buildRedisConnectionOptions()` call (reading `process.env.REDIS_HOST`/`REDIS_PORT` directly,
  evaluated the moment `@Module({ imports: [...] })`'s array literal runs — i.e. at `app.module.ts`
  import time, not at Nest's async bootstrap time) could race `ConfigModule.forRoot({ isGlobal:
  true })`'s `.env`-loading side effect. Confirmed safe: `@nestjs/config`'s `ConfigModule.forRoot()`
  loads `.env` into `process.env` *synchronously* as part of that call, and `ConfigModule.forRoot`
  is the first element in the same `imports` array — JS evaluates array literals strictly
  left-to-right, so `process.env` is already populated by the time `buildRedisConnectionOptions()`
  runs later in the same expression. Same reasoning already applies to `buildRabbitMqUri()`
  (called the same way, one entry later in the array) — a real but currently-safe ordering
  dependency, worth knowing before ever reordering this file's `imports` array, not a defect.

## Changes Made

None — no finding this pass crossed the bar for a change; the one open item from Loop 001 is
confirmed resolved by work in a different app's own loop, not something to re-fix here.

## Why

`apps/server` is the composition root every `libs/*` package's own design assumes it's wired
into correctly — worth the same "does the actual wiring hold up" scrutiny this session applied to
each library's internals, especially given several of this session's real findings
(`libs/cache`/`libs/queue`/`libs/ratelimit`'s composite-key collisions, `libs/database`'s
health-check race) were exactly the kind of cross-cutting issue that could plausibly have
surfaced *here* instead, at the point where every library's config actually gets assembled. None
did.

## Tests

No test changes — no code changed. Full monorepo suite: 145 suites / 1175 tests, all passing.

## Build

PASS (`npm run typecheck`)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- None outstanding.

## Next Loop

- No Critical/High/Medium findings. `apps/server` is at a natural stopping point; further work
  would come from a concrete new requirement, not another speculative pass.

---

# Loop 003

**App:** server
**Date:** 2026-07-23

## Goal

Add HTTP request correlation ids — one of several cross-cutting, non-business-feature gaps
surfaced by actually running the app this session (live-testing found `libs/queue`'s `RMQContext`
carries `requestId`/`correlationId`/`causationId` per message, but nothing generates an
equivalent for HTTP requests, so a client-facing error can't be correlated with its server-side
log lines without timestamp-matching). Direct user request, picked from a list of several
similarly-scoped gaps (health endpoint, CI pipeline, migration CLI, production Dockerfile, e2e
coverage, `npm audit` findings) named but not all pursued.

## Files Reviewed

- `libs/queue/src/context/rmq-context.factory.ts` (the shape being mirrored for HTTP)
- `libs/database/src/transaction/transaction.context.ts` (the `AsyncLocalStorage` pattern already
  established in this monorepo, reused here rather than inventing a new mechanism)
- `node_modules/@nestjs/common/services/console-logger.service.d.ts` (confirmed `ConsoleLogger`'s
  `formatMessage` is the correct, minimal override point to prepend a prefix to every log line
  without reimplementing NestJS's own formatting/coloring/JSON-mode logic)

## Problems Found

None — this loop is purely additive, no existing behavior touched.

## Changes Made

- New `apps/server/src/request-context/` module:
  - `request-context.ts`: `AsyncLocalStorage`-backed carrier (`run`/`current`/`requestId`), same
    pattern as `libs/database`'s `transactionContext`/`libs/workflow`'s various contexts.
  - `request-id.middleware.ts`: `RequestIdMiddleware` — reuses an incoming `X-Request-Id` header
    if present *and* safe to log verbatim (alphanumeric/`-`/`_`, ≤128 chars; anything else,
    including empty, is replaced with a fresh `randomUUID()`), echoes it on the response, and
    runs the rest of the request inside `requestContext.run(...)`.
  - `request-context-logger.ts`: `RequestContextLogger extends ConsoleLogger`, overriding
    `formatMessage` to prepend `[requestId]` when a request is in scope (background work like the
    outbox dispatcher has no HTTP request in scope and is left unprefixed).
- `app.module.ts`: `AppModule implements NestModule`, applies `RequestIdMiddleware` to every route
  (`consumer.apply(RequestIdMiddleware).forRoutes('*')`).
- `main.ts`: `NestFactory.create(AppModule, { logger: new RequestContextLogger() })`.
- New spec files for all three new source files (15 tests): `request-context.spec.ts` (context
  isolation across concurrent `run()` calls, propagation across an async/await chain, cleared
  after `run()` returns), `request-id.middleware.spec.ts` (UUID generation, safe-header reuse,
  unsafe/oversized/empty-header rejection, availability inside `next()`),
  `request-context-logger.spec.ts` (matches base `ConsoleLogger` output with no request in scope,
  correctly prefixes when one is, doesn't leak a stale id into a later context-free call).

## Why

- Validating the incoming `X-Request-Id` header (rather than trusting it verbatim) matters because
  this value flows directly into every log line for the request — an unvalidated header would be a
  log-injection vector (newlines, control characters, unbounded length), the same class of concern
  `libs/queue`'s own header validation already guards against for message headers.
- `ConsoleLogger`'s `formatMessage` (not `log`/`error`/etc. directly) is the override point,
  specifically so every log level, and NestJS's own internal logging calls, get the prefix
  automatically rather than needing every call site to remember to include it.
- Verified live (not just via unit tests): started the real app, confirmed the header is echoed
  correctly for no-header/safe-header/malicious-header cases via `curl`, and confirmed the id
  actually appears on `libs/ratelimit`'s `RateLimiterService.consume()`'s warning log line —
  several layers away from the middleware — proving `AsyncLocalStorage` propagation holds across
  the real guard/service call chain, not just in a unit test's synchronous callback.
- Test coverage for the three new files was initially missing (caught on a follow-up "anything
  else" pass) and added in the same loop rather than left as a separate TODO, since it's this
  loop's own gap, not a pre-existing one.

## Tests

`apps/server` gains 3 new spec files / 15 tests. Full monorepo suite: 148 suites / 1190 tests, all
passing (up from 145/1175).

## Build

PASS (`npm run typecheck`)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- The other cross-cutting gaps named alongside this one in the same conversation (`/health`
  endpoint, CI pipeline, standalone migration CLI, `apps/worker` health surface, metrics/APM
  wiring, production Dockerfile, e2e test coverage, RabbitMQ fail-fast config validation,
  `npm audit`'s 2 findings) remain open — this loop deliberately scoped to the one item picked.

## Next Loop

- Any of the Remaining TODO items above, next time one is picked.

---

# Loop 004

**App:** server
**Date:** 2026-07-23

## Goal

Add a `/health` endpoint — the next item picked off the same cross-cutting-gaps list Loop 003
came from. `libs/database`'s `DatabaseHealthService` is fully built and exported but had no HTTP
surface anywhere in this app.

## Files Reviewed

- `libs/database/src/health/database-health.service.ts` (`DatabaseHealthReport`'s exact shape —
  specifically `metrics.lastError`/`metrics.hostname`, which is what shaped the split below)
- `libs/auth/src/http/auth.controller.ts` (the `@Public()`-on-every-unauthenticated-route
  convention, matched here despite no global guard existing — same reasoning that file's own
  class doc comment already gives)

## Problems Found

None — additive. Worth naming as a design constraint rather than a defect: `libs/cache`'s Redis
connections and `libs/queue`'s RabbitMQ connection are both constructed inline inside their own
module's `forRoot`/`forRootAsync` options in `app.module.ts`, never exposed as their own
injectable provider — so there's currently no way for `apps/server` to health-check either
without a wiring change to those two module registrations. This endpoint is database-only as a
result; documented directly in the controller's class doc comment so it isn't mistaken for
full-stack health.

## Changes Made

- New `apps/server/src/health/health.controller.ts`:
  - `GET /health` (`@Public()`, no guard) — coarse `{ status: 'ok' | 'degraded' }` only, derived
    from `DatabaseHealthService.report().healthy`. Deliberately *not* the full report: a fully
    anonymous caller (any load balancer/orchestrator probe) shouldn't see `metrics.lastError` (an
    `Error` whose `.message` can contain a connection detail like an internal host/IP) or
    `metrics.hostname` (the MySQL server's own reported hostname) — confirmed live that a real
    health check populates both fields with real infrastructure detail (`serverUuid`, container
    hostname `8866347e1c54`), not just placeholder values.
  - `GET /health/details` (`@UseGuards(JwtAuthGuard)`, no specific permission) — the full
    `DatabaseHealthReport`. Gated behind authentication only, not a permission like
    `roles:manage`, since this is diagnostic read access rather than an administrative action.
- `app.module.ts`: registered `HealthController`.
- New `health.controller.spec.ts` (4 tests): `ok`/`degraded` mapping, confirms the summary route
  never leaks `datasources` detail, confirms `details()` returns the report unmodified.

## Why

- The public/authenticated split is a direct, deliberate security decision, not scope creep — the
  full report contains real infrastructure detail (confirmed by actually reading a live response,
  not just the type signature), so a coarse public summary plus a gated detailed view is the
  minimum needed to make this endpoint safe to expose without a network-level access control in
  front of it.
- `JwtAuthGuard` alone (no specific permission) was chosen over inventing a new `health:read`
  permission — the latter would need its own seed migration (matching how `roles:manage` is
  bootstrapped) for no real benefit today, since every authenticated user in this app is already
  a trusted caller for read-only diagnostic data; revisit if a future need arises to restrict this
  further than "authenticated."

## Tests

`apps/server` gains 1 new spec file / 4 tests. Full monorepo suite: 149 suites / 1194 tests, all
passing (up from 148/1190).

## Build

PASS (`npm run typecheck`)

## Lint

PASS (`npm run lint`)

## Live verification performed

Started the real app: `GET /health` → `{"status":"ok"}`, 200. `GET /health/details` with no
token → 401. Registered + activated + logged in a real user, `GET /health/details` with a real
token → 200 with the full per-datasource report (confirming the `metrics.hostname`/`serverUuid`
sensitivity concern above was based on real output, not a hypothetical). Cleaned up the test user
afterward; server stopped.

## Remaining TODO

- Redis/RabbitMQ health is not covered (see Problems Found) — would need `IoRedisClientAdapter`'s
  underlying `Redis` instances and `libs/queue`'s `RMQConnection` exposed as their own providers,
  which neither module does today.
- The rest of the original gaps list (CI pipeline, standalone migration CLI, `apps/worker` health
  surface, metrics/APM wiring, production Dockerfile, e2e test coverage, RabbitMQ fail-fast config
  validation, `npm audit`'s 2 findings) remain open.

## Next Loop

- Any of the Remaining TODO items above, next time one is picked.

# Loop 005

**App:** server
**Date:** 2026-07-23

## Goal

Close `REQUIREMENTS.md`'s "Request context" gap: request/correlation id middleware existed
(Loop 003) but was only propagated into logs as a plain-text prefix, not a structured field —
not machine-parseable by a log aggregator, and not extensible to future fields (traces, tenant id,
etc.) without more string surgery.

## Files Reviewed

- `apps/server/src/request-context/request-context-logger.ts` (the plain-text prefix
  implementation being replaced)
- `node_modules/@nestjs/common/services/console-logger.service.d.ts`/`.js` — this Nest version
  already ships a built-in `json: true` `ConsoleLogger` mode with a `getJsonLogObject` override
  point, so structured logging didn't need a new dependency (no pino/winston in `package.json`)
  or a hand-rolled formatter.

## Problems Found

**Medium**
- `RequestContextLogger.formatMessage` prepended `[requestId] ` to the *already fully formatted*
  text log line — not structured, can't be queried by field (`requestId`, `level`, `context`)
  by a log aggregator without a parsing regex, and every future cross-cutting field (trace id,
  tenant id) would mean more ad hoc string concatenation.

## Changes Made

- `request-context-logger.ts`: rewritten to construct with `super({ json: true })` (Nest's
  built-in structured-JSON mode) and override the protected `getJsonLogObject` hook to merge in
  `requestId` from `requestContext` when one is in scope, leaving Nest's own
  `level`/`pid`/`timestamp`/`message`/`context`/`stack` fields untouched.
- `request-context-logger.spec.ts`: rewritten to capture real `process.stdout.write` output and
  assert on the parsed JSON object's fields, rather than calling the old `formatMessage` directly
  (that method is no longer the output path in JSON mode).

## Why

- Chose overriding `getJsonLogObject` over hand-rolling a JSON formatter or introducing a logging
  library (pino/winston): this repo has no existing logging dependency, and the installed
  `@nestjs/common` version already provides exactly this extension point — smallest correct diff,
  consistent with "prefer existing patterns over inventing new ones" (CLAUDE.md).
- `requestId` is merged in only when present (background work — outbox dispatcher, workflow
  recovery sweep — runs with no HTTP request in scope), matching the prior implementation's
  behavior of a request-id-free line outside request scope.
- No `ARCH.md` entry: `apps/server` isn't a `libs/*` bounded context and this doesn't change any
  public API or module boundary — it's an internal formatting change to an existing cross-cutting
  concern.

## Tests

`apps/server` logger spec rewritten (3 tests, same count as before). Full monorepo suite: 149
suites / 1197 tests, all passing (4 suites/5 tests skipped by default, unchanged).

## Build

PASS (`npm run typecheck`)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- No trace/span propagation yet (would require picking an APM/tracing backend — not yet
  justified per `REQUIREMENTS.md`'s Tier 1 framing, which scopes this gap as "logs" first).
- Redis/RabbitMQ health still not covered (carried over from Loop 004).

## Next Loop

- Any of the Remaining TODO items above, or the next `REQUIREMENTS.md` Tier 1 item (auth
  completeness or the authorization policy engine), next time one is picked.

---

# Loop 006

**App:** apps/server
**Date:** 2026-07-23

## Goal

Wire the new `libs/notification` (see `libs/notification/ARCH.md`/`LOOP.md` Loop 001) as
`libs/auth`'s first-ever real `AuthEventPublisher` — `AUTH_JWT`-gated password-reset and
email-verification requests previously went nowhere (`NoopAuthEventPublisher`).

## Changes Made

- New `src/notifications/queue-auth-event-publisher.ts` (`QueueAuthEventPublisher`): composes the
  actual reset/verification email wording and enqueues via `OutboxService`; the other four
  `AuthEventPublisher` methods stay no-op, matching prior behavior.
- `app.module.ts`: registered `NotificationModule.forRoot({ emailSender: new LoggingEmailSender() })`
  and wired `QueueAuthEventPublisher` into `AuthModule.forRootAsync`'s `eventPublisher` option
  (injecting `OutboxService` alongside the existing `CACHE_MANAGER`).

## Tests

3 new tests (`queue-auth-event-publisher.spec.ts`). See `libs/notification/LOOP.md` Loop 001 for
the combined before/after suite count and the live two-app verification that exercised this file.

## Build / Lint

PASS (see `libs/notification/LOOP.md` Loop 001 for details — this file's changes were verified as
part of that same pass, not a separate one).

## Next Loop

- None forced.
