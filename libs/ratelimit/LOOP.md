# Loop 001

**Library:** ratelimit
**Date:** 2026-07-22

## Goal

Build out the library per `ARCH.md` Design 001's handoff: sliding-window-counter algorithm,
memory + Redis stores, programmatic service, NestJS guard/decorator, dynamic module
(`forRoot`/`forRootAsync`), registered into the monorepo's build/path-alias/jest wiring.

## Files Reviewed

- `libs/cache/src/caches/redis.cache.ts` (`RedisClient` interface — confirmed no atomic
  increment/eval existed, the gap this loop's `eval?` addition closes)
- `libs/cache/src/index.ts` (confirmed `Clock`/`SystemClock`/`FakeClock` were already exported —
  reused directly rather than duplicating an identical abstraction)
- `apps/server/src/redis/ioredis-client.adapter.ts` (the one real `RedisClient` implementation in
  the monorepo, extended to implement `eval`)
- `libs/cache/src/nest/cache.module.ts` / `cache.module.validator.ts` (the
  forRoot/forRootAsync/`registerInterceptor`-opt-out/boot-time-validator shape this library's
  module mirrors)
- `libs/queue/src/errors/queue-configuration.error.ts` (the plain-`Error`-subclass shape
  `RateLimitConfigurationError` follows)
- `libs/auth/src/guards/jwt-auth.guard.ts` (the inline-typed-request `getRequest<{...}>()` pattern
  `RateLimitGuard` follows, rather than importing `express` types directly)
- `nest-cli.json`, root `tsconfig.json`, root `package.json` (jest `moduleNameMapper`) — the
  registration points every sibling `libs/*` package needed, now including `ratelimit`/`@/ratelimit`

## Problems Found

**Critical / High**
- None — this is new-library scaffolding per an already-completed Design Mode session (Design
  001), not a review of existing code.

## Changes Made

- **`libs/cache/src/caches/redis.cache.ts`:** `RedisClient` gained an optional `eval?(script,
  numKeys, keys, args): Promise<unknown>` — additive, no existing behavior changed.
- **`apps/server/src/redis/ioredis-client.adapter.ts`:** implements `eval` via ioredis's native
  variadic `eval(script, numkeys, ...rest)`.
- **New library `libs/ratelimit`:** see `ARCH.md` Design 001's Module Breakdown for the full file
  list. Core pieces: `RateLimitStore` port with `MemoryRateLimitStore`/`RedisRateLimitStore`
  implementations (sliding-window-counter algorithm in both, the latter via a Lua script for
  atomicity); `RateLimiterService.consume(limiterName, key)`; `@RateLimit()` decorator +
  `RateLimitGuard` (defaults the limit key to the authenticated user id, then IP); `RateLimitModule`
  (`forRoot`/`forRootAsync`, boot-time `RateLimitModuleValidator`).
- **Registered `ratelimit` as a library project:** `nest-cli.json`, `tsconfig.json`'s `@/ratelimit`
  path alias, root `package.json`'s jest `moduleNameMapper` entry, `libs/ratelimit/tsconfig.lib.json`
  — the same four touch points every existing `libs/*` package required.
- Tests: 27 new tests across 6 spec files (`MemoryRateLimitStore`'s sliding-window-counter
  correctness including the weighted-blend-at-the-boundary property and the
  more-than-one-window-stale case; `RedisRateLimitStore`'s Lua-script argument shape and
  eval-support boot check via a mocked `eval`; `RateLimiterService`'s config resolution and
  unconfigured-limiter error; `RateLimitGuard`'s no-op-without-decorator/default-key/custom-keyBy/
  429-with-Retry-After behavior; `RateLimitModuleValidator`'s five validation rules;
  `RateLimitModule`'s `APP_GUARD` registration/opt-out and validate-before-any-provider-resolves
  ordering).

## Why

Every design choice here traces back to Design 001's Key Decisions — see `ARCH.md` rather than
duplicating the reasoning here. The one thing worth calling out at the code-review level: the
Lua script's atomicity requirement is enforced at *two* points (module validator at
`forRoot`/`forRootAsync`, and `RedisRateLimitStore`'s own constructor) — deliberate redundancy, not
duplicated logic, so a store constructed outside the module (tests, or future direct programmatic
use) still fails fast rather than only being protected when going through DI.

## Tests

`libs/ratelimit` suite: 6 spec files / 27 tests, all passing. Full monorepo suite: 143 suites /
1125 tests, all passing (up from 137/1098 before this loop).

## Build

PASS (`npm run typecheck`; also explicitly verified `npx nest build ratelimit`,
`npx nest build server`, and `npx nest build worker` all compile clean)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- Not wired into `apps/server`'s `app.module.ts` yet — no live consumer. See `ARCH.md`'s Open
  Questions: applying `@RateLimit('login')` to `AuthController.login` is the natural next step
  given what motivated building this, but is a separate decision from building the library itself.
- Token bucket strategy and DB-backed dynamic rules — both deliberately deferred in Design 001,
  not forgotten.

## Next Loop

- Wire `RateLimitModule.forRoot(...)` into `apps/server/src/app.module.ts` and apply
  `@RateLimit('login')` (or similar) to the login route, if/when that's explicitly requested —
  this loop only built the library itself.

---

# Loop 002

**Library:** ratelimit
**Date:** 2026-07-22

## Goal

Close Loop 001's Remaining TODO: wire `RateLimitModule` into `apps/server` and apply it to
`AuthController.login`. See `ARCH.md` Design 002 for the design-level decisions.

## Files Reviewed

- `apps/server/src/app.module.ts` (`CacheModule.forRootAsync`'s inline `Redis`/
  `IoRedisClientAdapter` construction pattern, reused for `RateLimitModule`'s own connection)
- `libs/auth/src/http/auth.controller.ts` (the `login` handler `@RateLimit()` was applied to)

## Problems Found

None — this closes a previously-identified TODO, not a fresh review.

## Changes Made

- `apps/server/src/app.module.ts`: added `RateLimitModule.forRootAsync(...)` with one limiter
  (`login: { limit: 5, windowMs: 60_000 }`), backed by its own dedicated Redis connection
  (separate from `CacheModule`'s — see `ARCH.md` Design 002).
- `libs/auth/src/http/auth.controller.ts`: `AuthController.login` tagged `@RateLimit('login')`,
  plus a `429` `@ApiResponse`.
- `libs/auth/src/http/auth.controller.spec.ts`: added a test asserting the `RATE_LIMIT_METADATA`
  reflect-metadata is actually present on `login` (`{ limiterName: 'login' }`) — a regression
  guard, since a delegation test alone wouldn't catch a decorator silently being removed.

## Why

See `ARCH.md` Design 002 — the one decision worth restating here: this is a new, real dependency
of `libs/auth` on `libs/ratelimit`, not just an `apps/server`-level wiring change, since
`AuthController` (and therefore the only place `login` can practically be tagged) lives in
`libs/auth`.

## Tests

`libs/auth` suite gains 1 test (134 total, up from 133). Full monorepo suite: 143 suites / 1126
tests, all passing.

## Build

PASS (`npm run typecheck`; explicitly verified `npx nest build ratelimit`,
`npx nest build server`, and `npx nest build worker` all compile clean)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- The `login` limiter's `5/60s` values are a starting point, not derived from real traffic data —
  revisit if actual login patterns call for a different number.
- `register`/`password-reset`/`email-verification` remain unlimited — deliberately out of scope
  (see `ARCH.md` Design 002's Rejected Alternatives).

## Next Loop

- No Critical/High findings open. Next candidate (not forced): rate-limit the other auth-adjacent
  endpoints above, if a concrete abuse pattern surfaces for any of them.

---

# Loop 003

**Library:** ratelimit
**Date:** 2026-07-22

## Goal

Extend rate limiting to `register` and both `password-reset` endpoints. Direct user request. See
`ARCH.md` Design 003 for the design-level decisions.

## Files Reviewed

- `libs/auth/src/http/auth.controller.ts` (`register`, `requestPasswordReset`,
  `confirmPasswordReset` handlers)
- `apps/server/src/app.module.ts` (`RateLimitModule.forRootAsync`'s `limiters` map)

## Problems Found

None — extends existing wiring, no defect.

## Changes Made

- `auth.controller.ts`: `@RateLimit('register')` on `register`; `@RateLimit('password-reset')` on
  both `requestPasswordReset` and `confirmPasswordReset` (one shared limiter for the one flow —
  see `ARCH.md`). Added matching `429` `@ApiResponse`s.
- `app.module.ts`: added `register: { limit: 5, windowMs: 60 * 60_000 }` and
  `'password-reset': { limit: 5, windowMs: 15 * 60_000 }` to the configured limiters.
- `auth.controller.spec.ts`: 2 new tests asserting the `RATE_LIMIT_METADATA` reflect-metadata on
  all three newly-tagged handlers.

## Why

See `ARCH.md` Design 003.

## Tests

`libs/auth` suite gains 2 tests (136 total). Full monorepo suite: 143 suites / 1128 tests, all
passing.

## Build

PASS (`npm run typecheck`; explicitly verified `npx nest build server` and
`npx nest build worker` both compile clean)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- `email-verification/request`/`confirm` remain unlimited — no concrete abuse pattern named yet.
- All three configured limiters' numbers are starting values, not derived from real traffic data.

## Next Loop

- No Critical/High findings open. Next candidate (not forced): email-verification endpoints, if a
  concrete abuse pattern surfaces.

---

# Loop 004

**Library:** ratelimit
**Date:** 2026-07-22

## Goal

Extend rate limiting to `email-verification/request` and `email-verification/confirm` — closing
the last item Design 003/Loop 003 left open. Direct user request.

## Files Reviewed

- `libs/auth/src/http/auth.controller.ts` (`requestEmailVerification`/`confirmEmailVerification`)
- `apps/server/src/app.module.ts` (`RateLimitModule.forRootAsync`'s `limiters` map)

## Problems Found

None — extends existing wiring.

## Changes Made

- `auth.controller.ts`: `@RateLimit('email-verification')` on both
  `requestEmailVerification`/`confirmEmailVerification`, plus matching `429` `@ApiResponse`s.
- `app.module.ts`: added `'email-verification': { limit: 5, windowMs: 15 * 60_000 }`.
- `auth.controller.spec.ts`: 1 new test asserting both handlers carry the metadata.

## Why

Same reasoning as `password-reset` (Design 003) — one shared limiter for one flow. See `ARCH.md`
Design 004.

## Tests

`libs/auth` suite gains 1 test (137 total). Full monorepo suite: 143 suites / 1129 tests, all
passing.

## Build

PASS (`npm run typecheck`; explicitly verified `npx nest build server` and
`npx nest build worker` both compile clean)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- Every public `AuthController` route is now rate-limited. All four limiters' numbers are
  starting values, not derived from real traffic data — revisit if actual traffic calls for
  different ones.

## Next Loop

- No Critical/High findings open. `libs/ratelimit` and its application to `libs/auth` are both at
  a natural stopping point.

---

# Loop 005

**Library:** ratelimit
**Date:** 2026-07-22

## Goal

Implement Tier 1 of the "what should be added next" recommendation list: fail-open on Redis
failure, structured logging, IETF-draft `RateLimit-*` headers. See `ARCH.md` Design 005.

## Files Reviewed

- `application/rate-limiter.service.ts` (confirmed no try/catch existed around `store.consume`,
  and zero `Logger` usage anywhere in the library — both gaps named in the prior audit)
- `http/rate-limit.guard.ts` (the existing informal `X-RateLimit-*` header set)

## Problems Found

**High**
- Confirmed: an unhandled `RateLimitStore.consume` rejection (e.g. Redis down) propagated all the
  way through `RateLimitGuard`, turning into a 500 for every request on every rate-limited route
  — including `login`/`register`/`password-reset`/`email-verification`. A Redis blip would have
  taken down account access entirely, a worse outcome than temporarily not rate-limiting.

## Changes Made

- `ratelimit.types.ts`: `RateLimitModuleOptions` gained `failOpen?: boolean` (default: fail open).
- `application/rate-limiter.service.ts`: wraps `store.consume` in try/catch. On success with
  `allowed: false`, logs a `warn`. On a thrown error: logs an `error` and returns a synthetic
  allowed result (fail-open default), or rethrows if `failOpen: false`.
- `http/rate-limit.guard.ts`: adds `RateLimit-Limit`/`RateLimit-Remaining`/`RateLimit-Reset`
  headers (IETF draft naming, `Reset` as delta-seconds) alongside the existing
  `X-RateLimit-*`/`Retry-After` headers; the 429 branch's `retryAfterSeconds` now reuses the same
  `resetSeconds` computation instead of a duplicate calculation.
- Tests: 3 new `RateLimiterService` tests (default fail-open, explicit `failOpen: true`, explicit
  `failOpen: false` propagates), 1 new `RateLimitGuard` test (RFC headers present alongside the
  informal ones).

## Why

See `ARCH.md` Design 005 — the fail-open default is the one decision worth restating here: this
closes a real availability bug (not just a missing feature), since the previous behavior meant a
rate limiter's own infrastructure failing could 500 every protected route including login.

## Tests

`libs/ratelimit` suite: 6 spec files / 31 tests (up from 27). Full monorepo suite: 143 suites /
1133 tests, all passing.

## Build

PASS (`npm run typecheck`; explicitly verified `npx nest build ratelimit`,
`npx nest build server`, and `npx nest build worker` all compile clean)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- Tier 2 (metrics hook, skip conditions, whitelist/blacklist) and Tier 3 (token bucket, dynamic
  rules, tenant/role limits) from the prior audit remain open, each still needing either more
  design work (Tier 2) or a concrete driving need (Tier 3) before implementation.

## Next Loop

- Tier 2 is the next candidate if prioritized: a `RATE_LIMIT_METRICS` DI token (mirroring
  `libs/workflow`'s `WORKFLOW_METRICS` no-op-default pattern) is the most straightforward next
  piece.

---

# Loop 006

**Library:** ratelimit
**Date:** 2026-07-22

## Goal

Implement Tier 2 of the "what should be added next" recommendation list: metrics hook, skip
conditions, allowlist/denylist. See `ARCH.md` Design 006.

## Files Reviewed

- `libs/workflow/src/public/workflow.module.ts` (the `WORKFLOW_METRICS` no-op-default DI-token
  pattern this loop's `RATE_LIMIT_METRICS` mirrors)
- `libs/auth/src/auth.module.ts` (the `options.xxx ?? fallback` plain-instance wiring style, used
  instead of workflow's "supply a whole `Provider`" style, for consistency with `ratelimit`'s own
  existing `clock?: Clock` option)

## Problems Found

None — extends the library per the prior audit's Tier 2 items, not a defect review.

## Changes Made

- `core/rate-limit-metrics.interface.ts` (new): `RateLimitMetrics` — `requestAllowed`/
  `requestRejected`/`storeFailure`.
- `metrics/noop-rate-limit-metrics.ts` (new): `NoopRateLimitMetrics`, the default.
- `ratelimit.constants.ts`: `RATE_LIMIT_METRICS` token.
- `ratelimit.types.ts`: `RateLimitModuleOptions.metrics?: RateLimitMetrics`.
- `ratelimit.module.ts`: wires `RATE_LIMIT_METRICS` in both `forRoot` (`useValue`) and
  `forRootAsync` (`useFactory`, reading `moduleOptions.metrics`), defaulting to
  `NoopRateLimitMetrics` in both.
- `application/rate-limiter.service.ts`: injects `RateLimitMetrics`, calls `requestAllowed`/
  `requestRejected` on a resolved result and `storeFailure` on the fail-open path.
- `http/rate-limit.decorator.ts`: `RateLimitMetadata` gained `skip?`, `allowlist?`, `denylist?`.
- `http/rate-limit.guard.ts`: evaluates `skip` → `allowlist` → `denylist` → normal `consume()`, in
  that order. `denylist` rejects with the existing `TooManyRequestsError` and a fixed
  `Retry-After: 3600` (a `DENYLIST_RETRY_AFTER_SECONDS` constant, documented inline), without ever
  calling `consume()`.
- Tests: 3 new `RateLimiterService` metrics tests, 6 new `RateLimitGuard` tests (skip bypass,
  allowlist bypass + non-match still limited, denylist rejection without consuming quota), 2 new
  `RateLimitModule` tests (metrics defaults to `NoopRateLimitMetrics`, accepts a supplied instance
  via a real `Test.createTestingModule` compile).

## Why

See `ARCH.md` Design 006 for the design-level reasoning.

## Tests

`libs/ratelimit` suite: 6 spec files / 38 tests (up from 31). Full monorepo suite: 143 suites /
1142 tests, all passing.

## Build

PASS (`npm run typecheck`; explicitly verified `npx nest build ratelimit`,
`npx nest build server`, and `npx nest build worker` all compile clean)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- Tier 3 (token bucket, dynamic/DB-backed rules, tenant/role-based limits) remains open, each
  still needing a concrete driving case before implementation.
- The new `skip`/`allowlist`/`denylist` options aren't used by any `AuthController` route yet —
  they're available, not yet applied anywhere.

## Next Loop

- No Critical/High findings open. Tier 3 is the next candidate if prioritized, or applying
  `skip`/`allowlist` to a concrete route (e.g. exempting an internal health-check caller) if a
  real need for that surfaces.

---

# Loop 007

**Library:** ratelimit
**Date:** 2026-07-22

## Goal

Implement Tier 3: token bucket algorithm, dynamic/DB-backed rules, and role-based limits. See
`ARCH.md` Design 007.

## Files Reviewed

- `libs/validation/src/persistence/entities/validation-rule.entity.ts` /
  `validation-rule.repository.ts` (the entity/repository shape this loop's `RateLimitRuleEntity`/
  `RateLimitRuleRepository` mirror)
- `libs/database/src/decorators/database-repository.decorator.ts` (confirmed `@DatabaseRepository`
  self-registers into a static `RepositoryRegistry`, not a normal Nest provider — repositories
  never need to appear in a module's own `providers` array, only their *entities* need merging
  into the host's `DatabaseModule.forRoot`)
- `libs/database/src/decorators/inject-repository.decorator.ts` (confirmed `@InjectRepository` is
  `@Inject(getRepositoryToken(...))`, and that `getRepositoryToken` isn't exported from `@/database`'s
  barrel — meaning a repository can only be injected via the parameter-decorator form on a normal
  class constructor, not via a raw token in a `useFactory`'s `inject` array. This is why
  `DatabaseRateLimiterRuleResolver` and `StaticRateLimiterRuleResolver` are both regular
  `@Injectable()` classes wired via `useExisting`, not constructed with `new` inside a factory.)

## Problems Found

None — implements the prior audit's Tier 3 items, not a defect review.

## Changes Made

**Token bucket:**
- `ratelimit.types.ts`: `RateLimitAlgorithm` (`'sliding-window' | 'token-bucket'`),
  `RateLimiterConfig.algorithm?`.
- `core/rate-limit-store.interface.ts`: `consume(key, limit, windowMs)` → `consume(key, config)`.
- `stores/memory-rate-limit.store.ts` / `stores/redis-rate-limit.store.ts`: both dispatch on
  `config.algorithm`; token-bucket starts full, refills continuously at `limit/windowMs`
  tokens/ms. Redis's `TOKEN_BUCKET_SCRIPT` stores bucket state as one `"<tokens>:<lastRefillAt>"`
  string per key (one Lua GET+SET instead of the sliding-window algorithm's two counter keys).

**Dynamic/DB-backed rules + role-based limits (one mechanism):**
- `core/rate-limiter-rule-context.interface.ts` (new): `RateLimiterRuleContext { role? }`.
- `core/rate-limiter-rule-resolver.interface.ts` (new): `RateLimiterRuleResolver.resolve(name,
  context?)`.
- `resolvers/static-rate-limiter-rule.resolver.ts` (new): wraps `options.limiters`; checks
  `"${name}:role:${role}"` before the plain name when a role is given.
- `resolvers/database-rate-limiter-rule.resolver.ts` (new): checks `ratelimit_rules` (role-scoped
  name, then plain name), falling back to a wrapped resolver (`StaticRateLimiterRuleResolver`) on
  a miss; small fixed-TTL (`rules.cacheTtlMs`, default 10s) in-memory cache per resolved name.
- `domain/rate-limit-rule.entity.ts` / `rate-limit-rule.repository.ts` (new), migration
  `1753400000000-RateLimitRules`, `persistence/entities|migrations/index.ts` (new) —
  `RATELIMIT_TYPEORM_ENTITIES`/`RATELIMIT_MIGRATIONS` for the host to merge in, same pattern every
  other `libs/*` package already uses.
- `ratelimit.types.ts`: `RateLimitModuleOptions.rules?: { enabled?, cacheTtlMs? }`.
- `ratelimit.module.ts`: `forRoot` conditionally registers `DatabaseRateLimiterRuleResolver` and
  wires `RATE_LIMIT_RULE_RESOLVER` to it via `useExisting` when `rules.enabled`, else to
  `StaticRateLimiterRuleResolver`. `forRootAsync` always wires the static one (see ARCH.md HIGH #2).
- `application/rate-limiter.service.ts`: now resolves config through `RateLimiterRuleResolver`
  instead of reading `options.limiters` directly; `consume` gained an optional third `context?`
  parameter.
- `http/rate-limit.guard.ts`: extracts `request.user?.roles?.[0]` and passes it as
  `context.role` to `consume()` — the first role only (documented simplification for multi-role
  users).

## Why

See `ARCH.md` Design 007 for the full reasoning, especially the `forRoot`-only constraint on
DB-backed rules and the deliberate exclusion of true tenant-based limits.

## Tests

`libs/ratelimit` suite: 9 spec files / 62 tests (up from 41 — 4 token-bucket tests each for
memory/Redis stores, 4 `StaticRateLimiterRuleResolver` tests, 6 `DatabaseRateLimiterRuleResolver`
tests, 4 new `RateLimitModule` resolver-wiring tests, 2 new `RateLimiterService` context-passthrough
tests, plus fixing every existing store-spec call site for the `consume(key, config)` signature
change). Full monorepo suite: 145 suites / 1164 tests, all passing.

## Build

PASS (`npm run typecheck`; explicitly verified `npx nest build ratelimit`, `npx nest build server`,
and `npx nest build worker` all compile clean — `apps/server` still builds against the changed
`RateLimiterService.consume` signature since the added third parameter is optional)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- `apps/server`'s actual `RateLimitModule.forRootAsync(...)` call is unchanged — the four existing
  limiters remain static config. Enabling `rules.enabled`/switching to `forRoot` (to actually use
  DB-backed rules in production) is a separate decision, not implied by building the capability.
- True per-tenant limits remain unbuilt — no tenant concept exists anywhere in this monorepo to
  attach one to (see `ARCH.md` Design 007).
- No live-Redis verification of the new `TOKEN_BUCKET_SCRIPT` Lua script was performed (same
  standing gap as the sliding-window script — unit-tested against a mocked `eval`, not exercised
  against a real Redis).

## Next Loop

- No Critical/High findings open. `libs/ratelimit` has now closed all 9 items from the original
  "what should be added" audit (6 fully, item 9 partially — role-based done, tenant-based
  explicitly deferred). No further work is forced; next steps would be either applying
  `rules.enabled`/role-scoped limiters to a concrete `apps/server` need, or a fresh Phase 1/2 pass.

# Loop 008

**Library:** ratelimit
**Date:** 2026-07-22

## Goal

Wire Design 007's `rules.enabled` (DB-backed dynamic rules) and role-scoped limits into
`apps/server`'s actual configuration — the "adopt it for the app" step Design 007 explicitly
deferred. See `ARCH.md` Design 008.

## Files Reviewed

- `apps/server/src/app.module.ts` — the only place `RateLimitModule` is registered for this repo's
  app; confirmed `RateLimitModule.forRootAsync(...)` was the only blocker to `rules.enabled` (per
  Design 007 HIGH #2), and that all four existing limiters (`login`/`register`/`password-reset`/
  `email-verification`) sit on `@Public()` routes, meaning role-scoping would be inert for any of
  them.
- `libs/auth/src/http/auth.controller.ts` — confirmed `changePassword` is the only endpoint both
  worth rate-limiting and already behind `JwtAuthGuard` (has an authenticated `request.user`).

## Problems Found

None — adopting an already-built capability, not a defect review.

## Changes Made

- `apps/server/src/app.module.ts`: `RateLimitModule.forRootAsync({...})` → `RateLimitModule.forRoot({...})`.
  New `buildRedisConnectionOptions()` helper (reads `REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD`/
  `REDIS_TLS` from `process.env` directly, mirroring `buildRabbitMqUri()`/`validateAuthEnvironment()`'s
  existing pattern for synchronously-needed config). `DatabaseModule.forRoot`'s `entities`/
  `migrations` arrays now include `...RATELIMIT_TYPEORM_ENTITIES`/`...RATELIMIT_MIGRATIONS`. Added
  `rules: { enabled: true }` and two new limiter entries: `'change-password': { limit: 10, windowMs:
  60 * 60_000 }` and `'change-password:role:admin': { limit: 50, windowMs: 60 * 60_000 }`.
- `libs/auth/src/http/auth.controller.ts`: added `@RateLimit('change-password')` and a `429`
  `@ApiResponse` to `changePassword`.
- `libs/auth/src/http/auth.controller.spec.ts`: added a regression test asserting
  `changePassword` carries `RATE_LIMIT_METADATA` of `{ limiterName: 'change-password' }`.

## Verification

- `npx tsc --noEmit -p tsconfig.json` — clean.
- `npx eslint apps/server/src/app.module.ts libs/auth/src/http/auth.controller.ts libs/auth/src/http/auth.controller.spec.ts` — clean.
- `npm run lint` (full repo) — clean.
- `npm test` (full repo) — 145 suites / 1169 tests passing.
- `npx nest build server` / `npx nest build worker` — both compiled successfully.
- **Live boot against real Docker Compose infra** (MySQL 3307 / Redis 6380 / RabbitMQ 5673),
  since this touches a new migration, a new `@InjectRepository` DI edge, and switches
  `forRootAsync` → `forRoot`:
  - App started cleanly, no DI resolution errors.
  - `ratelimit_rules` table and the `RateLimitRules1753400000000` migration both present in the
    dev DB after boot (confirmed via direct DB query — TypeORM doesn't log migration execution
    through Nest's own logger, so the boot log alone was inconclusive).
  - `POST /auth/register` succeeded (201) through the new `forRoot`-based static rule.
  - `POST /auth/login` with bad credentials: attempts 1-5 returned 401, attempt 6 returned 429.
  - Inserted a `ratelimit_rules` row overriding `register` to `limit: 1`; subsequent
    `POST /auth/register` calls immediately returned 429, confirming
    `DatabaseRateLimiterRuleResolver` picks up DB rows live.
  - Cleaned up test data (fake users, inserted rule row) and terminated the background server
    process afterward.

## Next Loop Candidates

- None outstanding from the original 44-item checklist or the Tier 1/2/3 list — this closes the
  last item ("wire `rules.enabled` + role-scoped limits into `apps/server`") that Design 007 left
  as a deferred adoption decision.

---

# Loop 009

**Library:** ratelimit
**Date:** 2026-07-23

## Goal

Cross-check triggered by a `libs/queue` loop (same day): that loop found and fixed a naive
`${a}:${b}` composite-key concatenation bug in the inbox dedup key (collision when either
component contains `:`), following an identical bug already fixed in `libs/cache`'s Redis
namespacing earlier the same session. Grepped every other `libs/*` for the same concatenation
shape to check whether it recurred a third time.

## Files Reviewed

- Grepped `libs/auth`, `libs/workflow`, `libs/validation`, `libs/ratelimit` for
  `` `${x}:${y}` `` -style key construction.
- `libs/workflow`'s hits (`registry.ts`, `step-executor.ts`, `compensation/service.ts`,
  `step-persistence.ts`, `child-workflow.service.ts`) — all keyed off an internally-generated
  `workflowId` (UUID, cannot contain `:`) plus developer-defined step names/numeric indices.
  Low risk, not the same bug class in practice — not changed.
- `libs/ratelimit`'s hits — `application/rate-limiter.service.ts:53` (`` `${limiterName}:${key}` ``)
  and `stores/redis-rate-limit.store.ts` (`` `${keyPrefix}:${key}:${windowIndex}` ``,
  `` `${keyPrefix}:${key}:bucket` ``) — confirmed as a real instance (below).
- `http/rate-limit.guard.ts`'s `defaultKey()` — confirmed `request.ip` is used as the default
  rate-limit key with no transformation, and that IPv6 addresses (e.g. `2001:db8::1`, `::1`)
  contain `:` natively — not a contrived edge case, the literal default behavior for any
  `@RateLimit()` route without a custom `keyBy`.

## Problems Found

**Critical** — (none)
**High** — (none)

**Medium**
- `RateLimiterService.consume` built the store key via `` `${limiterName}:${key}` `` with no
  escaping. `limiterName` is a fixed literal declared in this app's own rate-limit config;
  `key` is free-form — the default is `request.ip` (colon-bearing for IPv6) or `userId`, and a
  custom `keyBy` resolver can return anything. Two limiter/key pairs whose concatenation
  produces the same string (e.g. `limiterName="a:b", key="c"` vs. `limiterName="a", key="b:c"`)
  would share one counter/bucket — a client's requests silently counting against a different
  route's or a different client's rate limit. `RedisRateLimitStore`'s further
  `${keyPrefix}:${key}:...` concatenation was not independently at risk (`keyPrefix` is fixed
  per store instance, not variable per-call), so the fix only needed to happen at the
  `RateLimiterService` layer where the ambiguity actually originates.

**Low** — (none)

## Changes Made

- `application/rate-limiter.service.ts`: `store.consume` now receives
  `` `${limiterName}:${encodeURIComponent(key)}` `` — only `key` (the free-form component) is
  escaped, not `limiterName` (the fixed literal), which is sufficient to make every
  `(limiterName, key)` pair produce a distinct string.
- `application/rate-limiter.service.spec.ts`: added a regression test with
  `limiterName="a:b"/key="c"` vs. `limiterName="a"/key="b:c"`, asserting the store receives
  `'a:b:c'` and `'a:b%3Ac'` respectively — distinct strings, no collision. Existing tests using
  plain IPv4-shaped keys (`'1.2.3.4'`) were unaffected since `encodeURIComponent` is a no-op on
  strings with no reserved characters.

## Why

- Same root cause and same fix shape as the `libs/cache` Redis-namespace collision and the
  `libs/queue` inbox-key collision fixed earlier this session — a third confirmed instance of
  the identical bug class across three different libraries makes this worth checking for
  everywhere the pattern appears, per ci.loop's "a pattern fixed in one library should be
  checked against how sibling libs solved the same problem" principle. Arguably the most
  concretely exploitable of the three: `request.ip` (the literal default key) contains a
  real-world, non-contrived colon-bearing value (IPv6) with no attacker crafting required at
  all, unlike the queue's messageId (producer-controlled but usually a UUID) or the cache's
  namespace (developer-configured).
- Only `key` needed escaping, not `limiterName` — `limiterName` is a small, fixed set of
  literals declared once in `apps/server/src/app.module.ts`'s `RateLimitModuleOptions.limiters`,
  never influenced by request data, so escaping the one free-form component is sufficient to
  eliminate the ambiguity; escaping both would be unnecessary extra transformation with no
  additional safety benefit.
- `libs/workflow`'s superficially-similar concatenations were investigated and left unchanged —
  every one is keyed off an internally-generated UUID plus developer-defined literals, not
  attacker- or request-influenced data, so per ci.loop §17 ("never refactor code that already
  satisfies correctness") no fix was warranted there.

## Tests

`libs/ratelimit` suite is now 8 spec files / 63 tests (up from 62 — Loop 007/008's spec-file
count included `rate-limit.guard.spec.ts`/`ratelimit.module.spec.ts` etc.; +1 net this loop).
Full monorepo suite: 145 suites / 1172 tests, all passing.

## Build

PASS (`npm run typecheck`)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- None new from this cross-check.

## Next Loop

- No further Critical/High/Medium findings from this cross-check. If a fourth instance of the
  same "naive `${a}:${b}` composite key" pattern is ever found in `libs/auth`/`libs/validation`/
  `libs/database`, apply the same fix shape (escape the free-form component only).

---

# Loop 010

**Library:** ratelimit
**Date:** 2026-07-23

## Goal

Second adversarial pass in the same session as Loop 009, matching the "two consecutive clean
passes" bar this session already reached for `libs/cache`/`libs/queue`/`libs/database`/
`libs/workflow`. Targeted files not individually reviewed in Loop 009's fix-focused pass:
`database-rate-limiter-rule.resolver.ts`, `static-rate-limiter-rule.resolver.ts`,
`ratelimit.module.validator.ts`, `http/rate-limit.decorator.ts`, `domain/rate-limit-rule.entity.ts`.

## Files Reviewed

- `resolvers/database-rate-limiter-rule.resolver.ts` — found a same-shape `` `${limiterName}:role:
  ${context.role}` `` concatenation as Loop 009's fixed finding (below).
- `resolvers/static-rate-limiter-rule.resolver.ts` — same concatenation shape, but purely a lookup
  key into a compile-time-authored object literal (`options.limiters`) — both sides are
  developer-controlled, no external actor can influence either component, so no collision surface
  exists here at all.
- `domain/rate-limit-rule.entity.ts`, `domain/rate-limit-rule.repository.ts` — confirmed no HTTP
  admin controller exists in this library for `ratelimit_rules` (rows are edited via direct
  SQL/ops, per the entity's own doc comment) — there is no authenticated-user-reachable path to
  writing an arbitrary `name` value.
- `ratelimit.module.validator.ts`, `http/rate-limit.decorator.ts` — boot-time config validation and
  the `@RateLimit()` metadata decorator; both unchanged/correct on re-read.

## Problems Found

**Critical / High / Medium** — none.

**Low**
- `DatabaseRateLimiterRuleResolver.resolveOne` builds its DB-lookup/cache key as `` `${limiterName}
  :role:${context.role}` ``. `limiterName` is a fixed literal from application code; `role` comes
  from `RateLimitGuard`'s `request.user?.roles?.[0]` — a role *name*, settable only by an already
  `roles:manage`-permissioned admin (`libs/auth`'s `POST /auth/roles`), not by an arbitrary
  end user. A collision would require an admin to deliberately create a role literally named to
  straddle the `:role:` boundary of another limiter's name (e.g. role `"X:role:Y"` for limiter
  `"login"` colliding with limiter `"login:role:X"` + role `"Y"`) — both components are already
  behind meaningfully higher trust barriers than the unauthenticated, IPv6-reachable case Loop 009
  fixed. Not fixed this loop: the blast radius requires an actor who already has `roles:manage`
  (and thus far more direct ways to cause damage) or direct DB access to `ratelimit_rules` (an
  ops-level actor), so per ci.loop §17 ("every refactor must have measurable value") this doesn't
  clear the bar for a change — noted here so a future loop doesn't need to rediscover it, and so it
  gets the same fix (escape only the free-form `role` component) if the trust model around role
  creation ever changes.

## Changes Made

None — the Low finding's blast radius doesn't justify a change per ci.loop §17, and nothing else
surfaced.

## Why

Two consecutive clean adversarial passes (Loop 009 found and fixed one real Medium — the
unauthenticated IP-based key collision; this loop found only a much-lower-trust-bar instance of
the same pattern shape, correctly left unfixed) meets the ci.loop §16 stopping condition for this
library, matching the other four libraries' status this session.

## Tests

No test changes. Full monorepo suite: 145 suites / 1175 tests, all passing (unchanged — no code
touched this loop).

## Build

Not re-run — no code changed this loop.

## Lint

Not re-run — no code changed this loop.

## Remaining TODO

- The `role`-scoped DB-resolver key collision noted above — deferred, not forgotten. Revisit if
  role-name creation is ever opened to a lower-trust actor than `roles:manage`.

## Next Loop

- No Critical/High/Medium findings across two consecutive adversarial passes. `libs/ratelimit`
  remains at a natural stopping point per Section 16 until a new concrete finding or requirement
  surfaces.

---

# Loop 011

**Library:** libs/ratelimit
**Date:** 2026-07-23

## Goal

Following the same-day live-infra verification pattern applied to `libs/auth`, `libs/workflow`,
and `libs/queue`, close the analogous gap here: Loop 009's limiterName/key-collision fix
(`encodeURIComponent`-escaping the free-form `key` component so `limiterName="a:b"/key="c"` and
`limiterName="a"/key="b:c"` can't collide) was only ever verified against a fully mocked
`RateLimitStore` and a mocked `RedisClient` in `redis-rate-limit.store.spec.ts` — neither test
proves the escaped string actually produces two independent counters once it reaches a real
Redis keyspace and the store's real Lua script, which is the thing an attacker exploiting the
original bug (an unauthenticated, IPv6-shaped `request.ip` value) actually cared about.

## Files Reviewed

- No source changes — this loop only adds a test.
- `application/rate-limiter.service.ts` (the escaping fix) and `stores/redis-rate-limit.store.ts`
  (the real Lua sliding-window script the fix's escaped key is fed into), re-read to confirm both
  are unmodified since Loop 009.

## Problems Found

None — this loop is verification-only, not a review pass.

## Changes Made

- New `application/rate-limiter.redis.integration.spec.ts`: wires a real `ioredis` client (via a
  small local `RedisClient` adapter mirroring `apps/server/src/redis/ioredis-client.adapter.ts`,
  kept local to the test rather than importing across the lib/app boundary) into a real
  `RedisRateLimitStore` and `RateLimiterService`, then reruns the Loop 009 regression: two
  limiter/key pairs that collide under naive concatenation stay independent — each allows exactly
  one request before its own real Redis-backed counter (via the actual Lua `EVAL` script) starts
  rejecting. Gated behind `RUN_REDIS_INTEGRATION_TESTS=1` (`describe.skip` by default) so
  `npm test` stays hermetic.

## Why

- Same reasoning as this session's other live-verification loops: the fix was already correct by
  inspection, but its correctness specifically depends on real Redis key-space and Lua-script
  behavior that a mocked `RedisClient` can't exercise. This was arguably the highest-value of this
  session's four live-verification additions, since Loop 009 itself flagged this bug as "the most
  concretely exploitable of the three" (a real IPv6 address, no attacker crafting required).
- Risk: LOW. No production code changed — only a new opt-in test file.

## Tests

`libs/ratelimit` suite gains 1 spec file / 1 test (skipped by default). With
`RUN_REDIS_INTEGRATION_TESTS=1`: passes against real Redis. Full monorepo default suite: 149
suites / 1194 tests, all passing (4 suites/5 tests skipped by default across this session's
auth/workflow/queue/ratelimit MySQL/Redis-gated additions).

## Build

PASS (`npm run typecheck`)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- Unchanged: the role-scoped DB-resolver key collision (Low, deferred pending a trust-model
  change that hasn't occurred).

## Next Loop

- No Critical/High/Medium findings remain open, and the one previously-implicit live-verification
  gap for the key-collision fix is now closed. `libs/ratelimit` remains at a natural stopping
  point per Section 16 until a new concrete finding or requirement surfaces.

# Loop 012

**Library:** libs/ratelimit
**Date:** 2026-07-24

## Goal

Fresh Phase 1/2 review pass (`ci.loop` §§1–2), prompted by returning to this library after
several loops elsewhere. Re-inspected the whole module with no assumption that "11 prior loops"
meant nothing was left.

## Files Reviewed

- `application/rate-limiter.service.ts` — the fail-open contract (`consume`'s try/catch) and
  exactly what it does and doesn't cover.
- `resolvers/database-rate-limiter-rule.resolver.ts` / `static-rate-limiter-rule.resolver.ts` —
  the DB-backed rule path Design 007/008 added and actually adopted in `apps/server`.
- `stores/{memory,redis}-rate-limit.store.ts` (incl. both Lua scripts), `http/rate-limit.guard.ts`,
  `http/rate-limit.decorator.ts`, `ratelimit.module.ts`, `ratelimit.module.validator.ts`,
  `domain/rate-limit-rule.{entity,repository}.ts`, all `core/*.interface.ts`, `index.ts` barrel —
  re-read end to end; no defects found beyond the one below.
- Existing spec files for each of the above, to confirm what was and wasn't already covered before
  concluding something was actually missing rather than just untested-but-fine.

## Problems Found

**High**
- `RateLimiterService.consume` resolves the limiter config
  (`await this.resolver.resolve(limiterName, context)`) *before* entering the method's fail-open
  `try`/`catch` — that block only ever wrapped `this.store.consume(...)`. Design 005's whole
  premise was "an unavailable rate limiter shouldn't take every protected route down"; Design 007
  then added `DatabaseRateLimiterRuleResolver`, which does its own DB I/O
  (`RateLimitRuleRepository.findByName`) on every cache-miss/expiry, and Design 008 actually wired
  `rules.enabled: true` into `apps/server`'s live config. Once that happened, a MySQL connectivity
  blip during a DB-rule cache miss would throw straight out of `consume()`, uncaught — 5xx'ing
  every currently rate-limited route (`login`, `register`, `password-reset/*`,
  `email-verification/*`, `change-password`) even though Redis (the actual store) is completely
  healthy. No test exercised this: `database-rate-limiter-rule.resolver.spec.ts` never simulated
  `repository.findByName` throwing, and `rate-limiter.service.spec.ts`'s "fail-open behavior"
  tests only ever made `store.consume` throw. Neither Design 007 nor 008 called this out as a
  known gap — it reads as an oversight, not an accepted tradeoff.

## Changes Made

- `DatabaseRateLimiterRuleResolver.resolveOne`: wraps `this.repository.findByName(name)` in a
  try/catch. On failure, logs (`Logger.error`, same shape as `RateLimiterService`'s own
  store-failure log) and returns `undefined` **without caching** the failure — letting `resolve()`'s
  already-existing "no DB row" fallback path (to `StaticRateLimiterRuleResolver`) handle it exactly
  like a genuine miss. Not caching the failure means the very next request retries the DB rather
  than being stuck on the static fallback for a full `cacheTtlMs` after the DB has already
  recovered.
- Three new tests in `database-rate-limiter-rule.resolver.spec.ts`: falls back instead of throwing
  on a DB error, doesn't cache the failure (next call retries and can succeed), and the
  role-scoped lookup path falls back the same way.

## Why

Fixed inside `DatabaseRateLimiterRuleResolver` rather than widening `RateLimiterService`'s
try/catch to also wrap `resolver.resolve(...)`: the service's catch block builds its synthetic
"allowed" `RateLimitResult` from `config.limit`/`config.windowMs`, which don't exist yet if
`resolve()` itself is what failed — wrapping there would need a second, differently-shaped
fail-open result with no real config in it. `DatabaseRateLimiterRuleResolver.resolve()` already
has a designed fallback path for "no DB row found"; treating "DB unreachable" as the same case is
a one-line, design-consistent extension of behavior that already exists, not a new failure-handling
category. This also means the fix generalizes for free to any future `RateLimiterRuleResolver`
implementation that becomes I/O-capable — `RateLimiterService` never needs to know.

## Tests

`libs/ratelimit` suite: 8 of 9 suites passing (1 Redis-integration suite skipped by design), 66
tests (up from 63). Full monorepo `make check`: 159 of 164 suites passing (5 skipped by design),
1237 tests passing.

## Build

PASS (`npm run typecheck`)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- Unchanged: the role-scoped DB-resolver key collision (Low, deferred pending a trust-model
  change that hasn't occurred — see Loop 010).

## Next Loop

- No Critical/High findings remain open. `libs/ratelimit` returns to a natural stopping point per
  Section 16 until a new concrete finding or requirement surfaces.
