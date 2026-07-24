# Design 001

**Library / Bounded Context:** libs/ratelimit
**Date:** 2026-07-22

## Goal

Build a new rate-limiting library, using `libs/cache` for storage and `libs/database` only if
actually needed — per direct user request, flagged by the immediately-preceding conversation's
"login brute-force protection" gap in `libs/auth`. Scoped via three clarifying questions before
any code was written (see Key Decisions).

## Scale/Team Context Assumed

Single team, single monorepo, `apps/server` horizontally scaled behind a shared MySQL/Redis
(per root `CLAUDE.md`). No stated multi-region or multi-tenant requirement — Sections 0.9-0.18
(team topology, multi-region, etc.) collapse to "not applicable" per Section 0.1.

## Bounded Contexts Identified

- **Rate limiting** — a single, self-contained concern: given a (limiter name, key) pair, allow or
  reject one unit of quota per configured window. No upstream/downstream relationship to any other
  bounded context in this monorepo; it's a generic infrastructure library like `libs/cache`, not a
  domain library like `libs/auth`/`libs/workflow`.

## Context Map

- `libs/ratelimit` → `@/cache` (hard dependency: reuses `RedisClient`/`Clock`/`SystemClock`, the
  same way `libs/auth`/`libs/queue` hard-depend on `@/database`).
- `libs/ratelimit` → `@/database`: **not taken**. See Key Decisions (Rule Configuration).
- No other `libs/*` depends on `libs/ratelimit` yet — it isn't wired into `apps/server`'s
  `app.module.ts` in this pass (see Handoff to Improvement Loop). The most likely first consumer
  is `libs/auth`'s login endpoint (the gap that motivated building this), but that's a separate,
  explicit follow-up, not assumed here.

## Architecture Style Recommendation

Modular monolith library, matching every sibling `libs/*` package — no case for a standalone
service given the stated scale/team context.

## Module Breakdown

```
libs/ratelimit/src/
  ratelimit.module.ts            — forRoot/forRootAsync, matches libs/cache's shape
  ratelimit.module.validator.ts  — boot-time config validation (mirrors CacheModuleValidator)
  ratelimit.constants.ts         — DI tokens
  ratelimit.types.ts             — RateLimitModuleOptions, async-options shapes
  core/
    rate-limit-result.interface.ts
    rate-limit-store.interface.ts  — the pluggable-backend port
  stores/
    memory-rate-limit.store.ts     — single-instance, in-process
    redis-rate-limit.store.ts      — correct across replicas, needs RedisClient.eval
  application/
    rate-limiter.service.ts        — the programmatic entry point
  http/
    rate-limit.decorator.ts        — @RateLimit(name, { keyBy? })
    rate-limit.guard.ts            — reads the decorator, calls RateLimiterService, sets headers
  errors/
    ratelimit-configuration.error.ts
    too-many-requests.error.ts
```

## Aggregate Design

Not applicable — no persisted aggregate. The unit of state is a per-key counter (in-process `Map`
entry, or two Redis string keys), not a domain entity with identity/invariants of its own.

## Domain Model

- `RateLimiterConfig { limit, windowMs }` — a named limiter's quota shape.
- `RateLimitResult { allowed, limit, remaining, resetAt }` — the outcome of one `consume()` call.

## Application Layer (Use Cases)

- `RateLimiterService.consume(limiterName, key)` — the only use case. Resolves the named config,
  delegates to whichever `RateLimitStore` is wired, scopes the store key by limiter name so two
  differently-configured limiters never collide on the same identifier.

## Commands / Queries

Not applicable — one operation (`consume`), not a CQRS-shaped surface.

## Events

None. A rate-limit rejection is communicated synchronously (a thrown `TooManyRequestsError` /
returned `RateLimitResult`), not published — there's no other part of the system that needs to
react asynchronously to "this key got rate-limited" today. Revisit only if an audit/alerting
consumer for rate-limit events becomes a stated need.

## Engines / Policies / Specifications

- **Sliding-window-counter algorithm** is the one "engine" here — a weighted blend of the current
  and previous fixed windows. Chosen over a full sliding-log (accurate but O(requests) storage) and
  a naive fixed-window counter (allows up to 2x the limit right at a window boundary). Token bucket
  was considered and deliberately deferred (see Rejected Alternatives) — not built as an unused
  second strategy.

## Workflows / Sagas

Not applicable.

## Data Architecture

- **Memory store:** an in-process `Map<string, WindowEntry>`, no persistence, no cross-replica
  correctness — see the store's own doc comment for the accepted unbounded-growth limitation.
- **Redis store:** two string keys per (limiter, key, window-index) triple
  (`${prefix}:${limiterName}:${key}:${windowIndex}`), each `PEXPIRE`d to `2 * windowMs` (long enough
  to still exist as the "previous window" reference after rollover, short enough not to accumulate
  forever). No relational storage — counters are exactly the write-heavy, ephemeral, non-relational
  shape Redis is for for, matching `libs/cache`'s own reasoning for why `libs/database` was never a
  candidate for cache storage either.

## Messaging Architecture

Not applicable — no `libs/queue` involvement.

## Reliability Architecture

- **Atomicity via `RedisClient.eval`:** the entire reason `libs/cache`'s `RedisClient` interface
  gained a new optional `eval?` method this session. A plain `GET`-then-`SET` round trip races
  under concurrent requests hitting different `apps/server` replicas simultaneously — the exact
  failure mode an "Enterprise" rate limiter can't have. `RedisRateLimitStore` throws
  `RateLimitConfigurationError` at construction (and `RateLimitModuleValidator` throws the same at
  `forRoot`/`forRootAsync` registration time, even earlier) if the injected client lacks `eval`,
  rather than silently degrading to a racy fallback.
- **Fail-fast over silent degradation:** consistent throughout — an unconfigured limiter name, an
  invalid `limit`/`windowMs`, or a `redis`-store config without `eval` support all throw immediately
  (at boot for module-level misconfiguration, at first use for an unknown limiter name), never
  silently no-op or fall back to an unlimited pass-through.

## Security Architecture

- `RateLimitGuard` defaults the rate-limit key to the authenticated user's id (if present) or the
  request IP — never a caller-supplied value, so a client can't choose their own bucket and evade
  limiting by spoofing an identifier. A custom `keyBy` extractor is available for callers who need
  a different scoping key (e.g. per-API-key), but it's opt-in per route, not the default.
- No authentication/authorization surface of its own — this library only throttles, it doesn't
  gate access. `libs/auth`'s guards remain the source of truth for who's allowed to call a route at
  all.

## Scalability

- The Redis store is what makes this correct at `apps/server`'s actual horizontal-scale shape
  (multiple replicas sharing one Redis). The memory store is explicitly not that — see Data
  Architecture.
- Redis key volume: one key pair per (limiter, key) per active window — bounded by however many
  distinct keys (e.g. unique IPs/user ids) are actively hitting rate-limited routes at once, same
  general shape as `libs/cache`'s Redis-backed caches. No sharding/partitioning need identified at
  the stated scale.

## Folder Structure

See Module Breakdown — mirrors `libs/cache`'s `core/`/`caches(stores)/`/`nest(http)/` split and
`libs/auth`'s `application/`/`errors/` split, not inventing a new convention.

## Design Patterns

- **Strategy** (`RateLimitStore`, two implementations) — the one pattern actually used here,
  matching `libs/cache`'s `ReplacementPolicy` (LRU/LFU/FIFO/MRU) precedent for a pluggable backend
  abstraction with a DI-token-selected implementation.
- Repository, Unit of Work, Specification, Observer, Chain of Responsibility, Mediator: none apply
  — no persistence layer, no multi-step approval chain, no cross-cutting event bus here.

## CQRS Decision

Rejected — one operation (`consume`), no read/write model split need.

## Event Sourcing Decision

Rejected — a rate-limit counter's current value is all that ever matters; there's no business
value in replaying its history.

## Rejected Alternatives

- **Token bucket as a second pluggable strategy.** Confirmed explicitly with the user (recommended
  and chosen): sliding-window-counter only for v1. Token bucket would add real value for smoothing
  bursty legitimate traffic, but doubles the algorithm/test surface for a need that isn't stated
  yet — revisit if a concrete "we need to allow controlled bursts" requirement shows up.
- **DB-backed, admin-editable rate-limit rules** (mirroring `libs/validation`'s stored-rule
  pattern). Confirmed explicitly with the user (recommended and chosen): static, code/module-option
  config for v1 — no `libs/database` dependency taken. Changing a limit needs a redeploy under this
  choice; the dynamic alternative was offered and explicitly not chosen. Revisit if runtime
  reconfiguration without a redeploy becomes a stated operational need.
- **A raw Redis client bypassing `libs/cache` entirely**, to sidestep the missing-atomicity gap.
  Rejected — the user explicitly asked to build this "using `libs/cache`"; extending
  `RedisClient` with an optional `eval?` (same shape as its existing optional `pttl?`/`scan?`/
  `unlink?`) keeps the abstraction boundary intact instead of introducing a second,
  parallel Redis-access path.
- **A non-atomic get-then-set fallback** when `eval` isn't available. Rejected outright — see
  Reliability Architecture's fail-fast reasoning. An "Enterprise" rate limiter that silently
  degrades to a racy implementation under the one condition (missing `eval`) that most needs
  atomicity would be worse than refusing to start.

## Key Decisions (with risk tag)

**HIGH**
1. **Extending `libs/cache`'s public `RedisClient` interface** with a new optional `eval?` method.
   Benefits: gives `libs/ratelimit` (and any future consumer needing real Redis atomicity) a path
   to it through the existing port, rather than forcing a parallel abstraction. Risk: this is a
   cross-library interface change to a shared, already-consumed port — mitigated by making it
   *optional* (existing `RedisClient` implementations, and `RedisCacheStore` itself, are
   unaffected; only `IoRedisClientAdapter` in `apps/server` was extended to implement it).
   Alternative: bypass `libs/cache` with a raw client (see Rejected Alternatives).
2. **Sliding-window-counter as the only algorithm.** See Rejected Alternatives (token bucket).
3. **Static, code-declared limiter config — no `libs/database` dependency.** See Rejected
   Alternatives (DB-backed rules).

**MEDIUM**
- `RateLimitGuard` is registered as a global `APP_GUARD` by default (`registerGuard: false` opts
  out, mirroring `libs/cache`'s `registerInterceptor` shape) — safe because it's a no-op for any
  route without `@RateLimit()`.
- `forRootAsync` does not honor `registerGuard: false` (always registers the guard) — a static
  provider-list decision can't depend on a value only known after async config resolution; since
  the guard is a safe no-op without the decorator, always-on was preferred over adding a second
  config-resolution pass just to gate this one list. Documented directly in the module's own doc
  comment, not just here.
- Default rate-limit key is the authenticated user's id (if present) then request IP, never a
  caller-supplied value — see Security Architecture.

**LOW**
- Folder layout, file naming — see Module Breakdown.
- `MemoryRateLimitStore`'s unbounded key growth — documented accepted limitation, not fixed (no
  concrete incident driving cleanup logic yet).

## Open Questions / Future Evolution

- Wiring this into `apps/server` (e.g. `@RateLimit('login')` on `AuthController.login`) is the
  natural next step given what motivated this build, but wasn't done in this pass — the user asked
  for the library itself, not yet its application to a specific route. A follow-up loop should
  either wire it in or explicitly confirm it's not needed yet.
- Token bucket and DB-backed dynamic rules (see Rejected Alternatives) are the two most likely
  future extensions if a concrete need for either surfaces.
- No stated tenant model — if multi-tenancy is introduced later, limiter keys would need explicit
  tenant scoping (the same flag already carried in `libs/auth`'s ARCH.md).

## Handoff to Improvement Loop

- **Public API surface (`libs/ratelimit/src/index.ts`):** `RateLimitModule`
  (`forRoot`/`forRootAsync`), `RateLimiterService`, `RateLimitGuard`, `@RateLimit()`,
  `RateLimitStore`/`RateLimitResult` (types), `MemoryRateLimitStore`/`RedisRateLimitStore`,
  `RateLimitConfigurationError`/`TooManyRequestsError`, the module-options types.
- **Module boundaries:** `libs/ratelimit` → `@/cache` only (hard dependency for `RedisClient`/
  `Clock`). No dependency on `@/database`, `@/queue`, `@/workflow`, or `@/auth` — this library
  doesn't know `libs/auth` exists; any future login-specific wiring lives in `apps/server` or
  `libs/auth`, not here.
- **Not yet wired into `apps/server`'s `app.module.ts`** — this library builds and passes its own
  suite standalone but has no live consumer yet. That's the natural first thing for the next loop
  to pick up.

---

# Design 002

**Library / Bounded Context:** libs/ratelimit
**Date:** 2026-07-22

## Goal

Wire the library into `apps/server` and apply it to `AuthController.login` — the "natural next
step" Design 001 named and deliberately left undone. Direct user follow-up ("continue").

## Key Decisions (with risk tag)

**HIGH**
- **`libs/auth` now depends directly on `@/ratelimit`** (`RATE_LIMIT_METADATA`/`@RateLimit()` on
  `AuthController.login`) — a real, new entry in `libs/auth/ARCH.md`'s Context Map. Considered
  applying the decorator at the `apps/server` layer instead (e.g. a route-group-level guard) to
  keep `libs/auth` dependency-free of `@/ratelimit`, but `AuthController` is defined entirely
  inside `libs/auth` with no equivalent app-level wrapper to attach a decorator to — the only
  practical place to mark `login` as rate-limited is on the handler itself. Justified the same way
  `libs/auth`'s existing `@/database`/`@/validation` dependencies were: `@RateLimit()` is metadata
  only (no service call, no constructor injection), a materially lighter coupling than either of
  those two already-accepted dependencies.

**MEDIUM**
- **A second, dedicated Redis connection** for `RateLimitModule`, separate from `CacheModule`'s.
  Rejected refactoring `CacheModule`'s inline client construction in `app.module.ts` to share one
  connection — same reasoning `TopologyBootstrap`'s own separate raw AMQP connection in
  `libs/queue` already established (a distinct concern not worth threading through an existing
  module's internals for one extra connection's cost).
- **Limit chosen: 5 attempts per 60 seconds, keyed by IP** (the guard's default key — no
  authenticated user exists yet at the login route). A starting value, not derived from any
  stated traffic/abuse data; revisit if real login traffic patterns turn out to need a different
  number.

## Rejected Alternatives

- Also rate-limiting `register`/`password-reset`/`email-verification` requests — out of scope for
  this pass; the stated need was specifically login brute-force protection. Revisit each on its
  own merits if a concrete abuse pattern shows up for any of them.

## Handoff to Improvement Loop

- **Public API surface:** unchanged.
- **Module boundaries (revised):** `libs/auth` → `@/ratelimit` (decorator metadata only, see HIGH
  above) is now a real dependency, alongside its existing `@/database`/`@/validation` ones.
- `apps/server/src/app.module.ts` now registers `RateLimitModule.forRootAsync(...)` with one
  limiter (`login`).

---

# Design 003

**Library / Bounded Context:** libs/ratelimit
**Date:** 2026-07-22

## Goal

Extend rate limiting to `AuthController.register` and both `password-reset` endpoints — direct
user follow-up, closing part of Design 002's Rejected Alternatives note ("also rate-limiting
register/password-reset/email-verification — out of scope for this pass").

## Key Decisions (with risk tag)

**MEDIUM**
- **One shared `password-reset` limiter covers both `password-reset/request` and
  `password-reset/confirm`.** They're one flow, not two independent surfaces — `request` needs
  throttling against email-spam abuse, `confirm` against token-guessing, and a single IP-keyed
  limiter across both is simpler than two separately-tracked ones for what's really one user
  journey. Alternative (a distinct limiter per endpoint) rejected as unnecessary granularity with
  no stated need for tracking them separately.
- **`register`: 5/hour; `password-reset`: 5/15min** — both starting values, not derived from real
  traffic data, same caveat as `login`'s `5/60s` in Design 002. `register`'s longer window reflects
  that legitimate users register once, so a much lower velocity is expected than login attempts.

## Rejected Alternatives

- `email-verification/request` and `email-verification/confirm` — still not rate-limited. No
  concrete abuse pattern named for these yet; revisit if one surfaces, same as Design 002 already
  noted.

## Handoff to Improvement Loop

- **Module boundaries:** unchanged.
- `apps/server/src/app.module.ts`'s `RateLimitModule.forRootAsync` now configures three limiters:
  `login`, `register`, `password-reset`.

---

# Design 004

**Library / Bounded Context:** libs/ratelimit
**Date:** 2026-07-22

## Goal

Close the last item Design 003 left open: rate-limit `email-verification/request` and
`email-verification/confirm`. Direct user follow-up.

## Key Decisions (with risk tag)

**MEDIUM**
- Same shape as `password-reset` (Design 003): one shared `email-verification` limiter across
  both `request` and `confirm`, `5/15min` per IP — same one-flow reasoning, same starting-value
  caveat.

## Rejected Alternatives

- None new — this applies the exact pattern Design 003 already established, not a fresh design
  question.

## Handoff to Improvement Loop

- **Module boundaries:** unchanged.
- `apps/server/src/app.module.ts`'s `RateLimitModule.forRootAsync` now configures four limiters:
  `login`, `register`, `password-reset`, `email-verification`. Every public, unauthenticated
  `AuthController` route is now rate-limited.

---

# Design 005

**Library / Bounded Context:** libs/ratelimit
**Date:** 2026-07-22

## Goal

Tier 1 of the "what should be added next" list (fail-open on store failure, structured logging,
IETF-draft `RateLimit-*` headers) — direct user request.

## Key Decisions (with risk tag)

**HIGH**
- **Fail-open is now the default** when the configured `RateLimitStore` throws (e.g. Redis
  unreachable) — `RateLimiterService.consume` catches the error, logs it, and returns a synthetic
  "allowed" result instead of propagating. Previously this was an accidental gap, not a considered
  decision: an uncaught error meant every rate-limited route (including `login`) would 500 during
  a Redis outage — worse than simply not rate-limiting for that window. `failOpen: false` is
  available as an explicit opt-in for anyone who wants the stricter fail-closed behavior instead
  (e.g. if being unable to enforce a limit is considered worse than rejecting traffic). Risk: an
  attacker who can knock out the Redis connection could use that to bypass rate limiting entirely
  — accepted, since a rate limiter's whole job is to protect availability, and the alternative
  (self-inflicted total outage of every protected route) is strictly worse for the common case
  (Redis blips, not attacker-induced).

**MEDIUM**
- Structured logging added at exactly two points: a `warn` when a limiter actually rejects a
  request (operationally useful — "is this limiter even doing anything") and an `error` when the
  store itself fails (the fail-open path). Not added anywhere else — no log-per-successful-request
  noise.
- IETF-draft `RateLimit-Limit`/`RateLimit-Remaining`/`RateLimit-Reset` headers added *alongside*
  the existing informal `X-RateLimit-*` ones, not replacing them — additive, no breaking change
  for anything already reading the `X-` names. Note the semantic difference: `RateLimit-Reset` is
  delta-seconds until reset (per the draft spec), while `X-RateLimit-Reset` was already an epoch
  timestamp — kept both conventions faithful to their own norms rather than unifying them.

## Rejected Alternatives

- Removing the `X-RateLimit-*` headers in favor of only the RFC ones — rejected as an unnecessary
  breaking change; additive costs nothing.
- Making fail-open the *only* behavior (no opt-out) — rejected; some deployments may have a
  compliance/security reason to prefer fail-closed, so it's a real option, not removed entirely.

## Handoff to Improvement Loop

- **Public API surface (revised):** `RateLimitModuleOptions` gained `failOpen?: boolean`.
- **Module boundaries:** unchanged.

---

# Design 006

**Library / Bounded Context:** libs/ratelimit
**Date:** 2026-07-22

## Goal

Tier 2 of the "what should be added next" list: a metrics hook, skip conditions, and
allowlist/denylist. Direct user request.

## Key Decisions (with risk tag)

**MEDIUM**
- **`RATE_LIMIT_METRICS` mirrors `libs/workflow`'s `WORKFLOW_METRICS` shape** (a DI token with a
  no-op default), but the *wiring* mechanism follows `libs/auth`'s `options.xxx ?? fallback`
  pattern (a plain instance on `RateLimitModuleOptions.metrics`) rather than `libs/workflow`'s
  "supply a whole `Provider` object" style — chosen for internal consistency with
  `libs/ratelimit`'s own existing `clock?: Clock` option, which already uses the plain-instance
  shape, not to diverge from `libs/workflow` for its own sake.
- **`skip`/`allowlist`/`denylist` live on the same `@RateLimit()` decorator options as `keyBy`**,
  not a separate decorator — they're all "how do I decide whether/how to limit this request"
  concerns, evaluated in one place (`RateLimitGuard`) in a fixed order: `skip` → `allowlist` →
  `denylist` → normal `consume()`.
- **`denylist` reuses `TooManyRequestsError`** rather than introducing a distinct
  "forbidden by policy" error type — from the caller's perspective both are a 429, and the repo's
  own `ci.loop` principle (avoid premature abstraction) argues against a second error class for a
  distinction only the server-side guard cares about. Its `Retry-After` is a fixed
  `3600` seconds, since a policy block has no natural window to compute a real reset time against
  (documented as a constant with that reasoning in the guard itself).
- **`denylist` never touches the store** — checked and rejected before `RateLimiterService.consume`
  is ever called, so a denylisted key doesn't consume real quota that a legitimate request under
  the same limiter might need.

## Rejected Alternatives

- A distinct `ForbiddenByPolicyError` for `denylist` rejections — rejected, see above.
- A separate `@Skip()`/`@Allowlist()`/`@Denylist()` decorator family — rejected; these are all
  facets of the same per-route rate-limiting configuration, not independent concerns deserving
  their own decorators.

## Handoff to Improvement Loop

- **Public API surface (revised):** `RateLimitModuleOptions` gained `metrics?: RateLimitMetrics`;
  `RateLimitMetadata`/`@RateLimit()`'s options gained `skip?`/`allowlist?`/`denylist?`;
  new exports `RateLimitMetrics` (type) and `NoopRateLimitMetrics`.
- **Module boundaries:** unchanged.

---

# Design 007

**Library / Bounded Context:** libs/ratelimit
**Date:** 2026-07-22

## Goal

Tier 3 of the "what should be added next" list: token bucket, dynamic/DB-backed rules, and
role-based limits. Direct user request ("do tier 3"), following the same "a direct user request is
itself the driving need" standard already applied earlier in this monorepo (e.g. `libs/queue`
Loop 004/005) — the original Design 001/003 deferrals were "no concrete need yet," not "never."

## Key Decisions (with risk tag)

**HIGH**
1. **`libs/ratelimit` now optionally depends on `@/database`** — the exact dependency Design 001
   explicitly declined to take. Scoped narrowly: only `DatabaseRateLimiterRuleResolver` (used only
   when `RateLimitModuleOptions.rules.enabled === true`) touches `@/database`; every other part of
   the library (stores, guard, metrics, static resolver) remains dependency-free of it. A host that
   never sets `rules.enabled` never needs to merge `RATELIMIT_TYPEORM_ENTITIES`/
   `RATELIMIT_MIGRATIONS` into `DatabaseModule.forRoot` at all. `apps/server`'s actual
   `RateLimitModule.forRootAsync(...)` call was **not** changed to enable this — the four existing
   limiters (`login`/`register`/`password-reset`/`email-verification`) remain static. This mirrors
   how building `libs/ratelimit` itself (Design 001) didn't imply immediately wiring it into
   `apps/server` (that was Design 002, a separate decision) — building a capability and adopting it
   for the app's actual config are different decisions.
2. **DB-backed rules are `forRoot`-only, not `forRootAsync`.** `DatabaseRateLimiterRuleResolver`
   needs `RateLimitRuleRepository` to be a *statically* known provider dependency (via
   `@InjectRepository`), but `rules.enabled` is only known once `forRootAsync`'s factory resolves
   at runtime — the same category of constraint `registerGuard: false` already hit in Design 001.
   Rather than forcing every `forRootAsync` consumer to unconditionally depend on `@/database`
   (defeating the "optional" point), `forRootAsync` always wires the static resolver; DB-backed
   rules require the synchronous `forRoot` path. Documented directly in the module's own doc
   comment.
3. **Role-based limits reuse the *same* resolver mechanism as DB-backed rules, not a separate
   system.** A `"${limiterName}:role:${role}"` naming convention works identically whether the
   entry lives in the static `limiters` map or a DB row — `StaticRateLimiterRuleResolver` alone is
   enough for role-based limits with zero `@/database` dependency; `DatabaseRateLimiterRuleResolver`
   just extends the same lookup to also check the DB. One mechanism serves both Tier 3 items
   instead of two.

**MEDIUM**
- **Token bucket is a second algorithm inside the existing `RateLimitStore` implementations**, not
  a new store type. `RateLimiterConfig.algorithm` (`'sliding-window'` default | `'token-bucket'`)
  selects it; both `MemoryRateLimitStore` and `RedisRateLimitStore` dispatch on it internally. The
  `RateLimitStore.consume` signature changed from `(key, limit, windowMs)` to `(key, config)` to
  carry `algorithm` through — a breaking change to an internal port with no external consumers
  outside this same repo, so made cleanly rather than bolting on a fourth positional parameter.
- **Token bucket starts full**, not empty — a fresh key's first burst isn't penalized for traffic
  the caller never actually sent. Refills continuously (fractional tokens tracked internally), not
  just on whole-token boundaries.
- **`DatabaseRateLimiterRuleResolver` has its own small fixed-TTL cache** (default 10s, not
  `@/cache`'s full abstraction) rather than querying `ratelimit_rules` on every request — same
  reasoning as `libs/validation`'s `CachedValidationRuleStore`, scaled down since the cached shape
  (a handful of named rules, one resolver instance's lifetime) doesn't need eviction policies or a
  Redis-backed L2.
- **Per-tenant limits (the other half of Tier 3's item 9) were *not* built** — deliberately, and
  distinctly from the "revisit if a need arises" deferrals elsewhere. No tenant concept exists
  anywhere in this monorepo (no `tenantId` column, no tenant model in `libs/auth` or anywhere
  else) — building tenant-scoped limits now would mean inventing a tenant concept with nothing
  real to attach it to, which is different in kind from role-based limits (a real, already-existing
  `libs/auth` concept). Flagged explicitly rather than silently doing nothing, per this loop's own
  standard of not letting a scope decision look like an oversight.

## Rejected Alternatives

- **Per-tenant limits** — rejected for this pass; see MEDIUM above. Revisit only if a real
  multi-tenant model is introduced anywhere in this monorepo (flagged as a "when this happens,
  revisit" item in both `libs/auth`'s and this library's ARCH.md already).
- **A fourth positional parameter on `RateLimitStore.consume`** (`algorithm`) instead of changing
  the signature to take the whole config — rejected as a worse shape than just passing the config
  object once `algorithm` needed to travel alongside `limit`/`windowMs` anyway.
- **Forcing `@/database` as a hard dependency** so DB-backed rules could work through
  `forRootAsync` too — rejected; see HIGH #2.
- **A generic `@/cache`-backed cache for `DatabaseRateLimiterRuleResolver`** instead of its own
  small `Map` — rejected as more machinery than the actual cached shape needs; see MEDIUM above.

## Handoff to Improvement Loop

- **Public API surface (revised):** new exports — `RateLimitAlgorithm`, `RateLimiterRuleResolver`
  (type), `RateLimiterRuleContext` (type), `StaticRateLimiterRuleResolver`,
  `DatabaseRateLimiterRuleResolver`, `RateLimitRuleEntity`, `RateLimitRuleRepository`,
  `RATELIMIT_TYPEORM_ENTITIES`, `RATELIMIT_MIGRATIONS`, `RATE_LIMIT_RULE_RESOLVER`.
  **Breaking (internal-only) change:** `RateLimitStore.consume(key, limit, windowMs)` →
  `consume(key, config)`. `RateLimiterConfig` gained `algorithm?`. `RateLimitModuleOptions` gained
  `rules?: { enabled?, cacheTtlMs? }`. `RateLimiterService.consume` gained an optional third
  `context?: RateLimiterRuleContext` parameter. `RateLimitMetadata`/`@RateLimit()` unchanged by
  this design (role resolution happens automatically in `RateLimitGuard` from `request.user.roles`).
- **Module boundaries (revised):** `libs/ratelimit` → `@/database`, conditionally (only exercised
  when a host sets `rules.enabled: true` via `forRoot`). Not adopted by `apps/server`'s actual
  configuration in this pass.

# Design 008

**Library / Bounded Context:** libs/ratelimit
**Date:** 2026-07-22

## Goal

Adopt Design 007's `rules.enabled`/role-scoping capability in `apps/server`'s actual
configuration — direct user request ("wire rules.enabled and role-scoped limits into
apps/server"). Design 007 built the capability but explicitly left `apps/server` on the static,
`forRootAsync`-only configuration; this design is the "adopt it for the app's actual config"
decision that 007 called out as separate.

## Key Decisions (with risk tag)

**HIGH**
1. **`apps/server`'s `RateLimitModule.forRootAsync(...)` call replaced with `RateLimitModule.forRoot(...)`.**
   Required by Design 007's `forRoot`-only constraint on `rules.enabled` (`DatabaseRateLimiterRuleResolver`
   needs `RateLimitRuleRepository` statically injectable). `forRoot` needs synchronous options, so a
   new `buildRedisConnectionOptions()` helper in `app.module.ts` reads `REDIS_HOST`/`REDIS_PORT`/
   `REDIS_PASSWORD`/`REDIS_TLS` from `process.env` directly — the same "read `process.env` directly
   for a value needed synchronously at module-registration time" pattern `buildRabbitMqUri()` and
   `validateAuthEnvironment()` already use in this file, just for a second, independent Redis
   connection (mirroring `TopologyBootstrap`'s own separate raw AMQP connection in `libs/queue` —
   a distinct concern, not worth threading through `CacheModule`'s inline client construction).
   `RATELIMIT_TYPEORM_ENTITIES`/`RATELIMIT_MIGRATIONS` are now merged into `DatabaseModule.forRoot`'s
   entities/migrations arrays, and `rules: { enabled: true }` is set.
2. **Role-scoping introduced via a new `change-password` limiter, not retrofitted onto the four
   existing ones.** All four pre-existing limiters (`login`, `register`, `password-reset`,
   `email-verification`) protect `@Public()` routes, where `RateLimitGuard` never has an
   authenticated `request.user` to read a role from — role-scoping would be silently inert there.
   `AuthController.changePassword` is the one existing endpoint that's both rate-limit-worthy and
   already behind `JwtAuthGuard`, making it the only real place role-scoping has an observable
   effect today. Configured as `'change-password': { limit: 10, windowMs: 60 * 60_000 }` (base) plus
   `'change-password:role:admin': { limit: 50, windowMs: 60 * 60_000 }` (higher ceiling for
   legitimate admin account-cleanup work), per the user's explicit choice among the options offered.

## Rejected Alternatives

- **Retrofitting role-scoping onto `login`/`register`/`password-reset`/`email-verification`** —
  rejected; none of these run behind an auth guard, so there is no `request.user.roles` for
  `RateLimitGuard` to key off of. Adding role-scoped entries for them would be dead configuration.
- **Keeping `forRootAsync` and duplicating rule-resolution logic to fake DB-backed rules** —
  rejected; Design 007 already settled this constraint as a hard `forRoot`-only requirement, and
  working around it would reintroduce the exact complexity 007 chose not to build.

## Verification

Beyond the standard `typecheck`/`lint`/`test`/`nest build` suite, this change (new migration,
new `@InjectRepository` DI edge, `forRootAsync` → `forRoot` switch) was live-booted against real
Docker Compose infra (MySQL/Redis/RabbitMQ) rather than trusting compile-only checks:

- `Nest application successfully started` with no DI resolution errors.
- `ratelimit_rules` table and the `RateLimitRules1753400000000` migration both present in the
  dev database after boot (`MYSQL_MIGRATIONS_RUN=true` ran it automatically — TypeORM doesn't log
  migration execution through Nest's logger, so the DB state was checked directly rather than
  the boot log).
- `POST /auth/register` succeeded end-to-end (201) through the new `forRoot`-based static rule.
- `POST /auth/login` with bad credentials: 5 attempts returned 401, the 6th returned 429 —
  confirms the static `login` rule and Redis store are correctly wired.
- Inserted a `ratelimit_rules` row overriding `register` to `limit: 1`; subsequent
  `POST /auth/register` calls immediately returned 429 — confirms
  `DatabaseRateLimiterRuleResolver` reads and applies DB overrides live, not just at startup.
- Test data (fake users, the inserted rule row) and the background server process were cleaned
  up after verification.

## Handoff to Improvement Loop

- **Module boundaries (revised):** `apps/server` now depends on `libs/ratelimit`'s `@/database`
  path (Design 007's conditional dependency is now actually exercised) — `RATELIMIT_TYPEORM_ENTITIES`/
  `RATELIMIT_MIGRATIONS` are merged into the app's `DatabaseModule.forRoot`.
- **Config surface (new):** `apps/server` reads `REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD`/
  `REDIS_TLS` a second time (independently of `CacheModule`'s factory-injected `ConfigService`
  read) via `buildRedisConnectionOptions()`, for the rate-limit store's own Redis connection.
- **Operational note:** `ratelimit_rules` is now a live, admin-editable table in the dev/prod
  database — a row for `"<limiter>:role:<role>"` overrides that role's limit for any configured
  limiter, not just `change-password`, without a redeploy.
