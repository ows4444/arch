# Design 001

**Library / Bounded Context:** libs/auth (Identity & Access)
**Date:** 2026-07-19

## Goal

Design a new `libs/auth` library from scratch — authentication (register,
login, logout, refresh) plus RBAC authorization — consistent with the
conventions already established by `libs/database`, `libs/cache`,
`libs/queue`, `libs/workflow`, and consumed first by `apps/server`.
Password-reset/email-verification flows and a generic attribute-based
policy engine were explicitly discussed and **deferred** (see Rejected
Alternatives) — this design's implementation scope is register/login/
logout/refresh + role/permission-based authorization only.

## Scale/Team Context Assumed

Single maintainer, Nest monorepo with two runtime apps (`apps/server`,
HTTP; `apps/worker`, background/queue consumer — currently an empty
scaffold with no imports). No stated tenant-count or throughput target.
Same assumption sibling libs already bake in (see `libs/workflow/ARCH.md`
Design 001): design for multi-replica horizontal scaling of `apps/server`
regardless of current team size — no in-memory session affinity, no
single-instance assumptions. `apps/worker` has no HTTP surface and no
login concern; it is not a consumer of this design unless a concrete need
to verify tokens for a privileged job appears later (flagged under Future
Evolution, not designed now).

## Bounded Contexts Identified

- **New bounded context: Identity & Access.** Owns `User`, credentials,
  `Role`/`Permission`, and refresh-token lifecycle. In DDD terms this is a
  **Generic Subdomain** relative to whatever this app's actual core domain
  is (workflow orchestration, per `libs/workflow`) — it's necessary
  infrastructure, not the thing that differentiates the business — but is
  being built in-house to match the existing in-house pattern of the other
  three libs, rather than pulled in as an off-the-shelf identity provider.
- Does **not** absorb RBAC into a separate context. Roles/permissions have
  no meaning without a `User` to attach to, so they're aggregates inside
  Identity & Access, not a sibling "authorization" library.
- Does **not** absorb a generic policy/rule engine (see Rejected
  Alternatives) — RBAC here is a static role→permission model, not an
  attribute-based rule evaluator.

## Context Map

`libs/auth` is consumed by `apps/server` only, alongside the other three
libraries (`DatabaseModule`, `CacheModule`, `QueueModule`, `WorkflowModule`
in `apps/server/src/app.module.ts`). Relationships to sibling libs:

- **`libs/database` (upstream, hard dependency):** `libs/auth` entities/
  repositories are written the same way `libs/queue`'s outbox/inbox
  entities are — plain TypeORM entities + `BaseRepository` subclasses
  registered via `@DatabaseRepository`, with `AUTH_TYPEORM_ENTITIES`/
  `AUTH_MIGRATIONS` exported for the host to merge into its single
  `DatabaseModule.forRoot` call. `libs/auth` does not reimplement
  `libs/workflow`'s dual typeorm/database adapter abstraction — that
  exists because `libs/workflow` is separately published
  (`@ows4444/nest-workflow`) and must run without `libs/database` present;
  `libs/auth`, like `libs/queue`, is not published standalone, so it can
  depend on `@/database` directly. This was a real choice (see Key
  Decisions, MEDIUM).
- **`libs/cache` (upstream, soft dependency via port):** used only for the
  optional access-token denylist (immediate revocation on logout/password
  change). `libs/auth` does not import `@/cache` directly in its core —
  it depends on an `ACCESS_TOKEN_DENYLIST` port, mirroring how
  `libs/workflow` depends on `WORKFLOW_EVENT_PUBLISHER` rather than
  importing `@/queue`. The host wires a real `CacheAccessTokenDenylist`
  (backed by `@/cache`) in `app.module.ts` if it wants instant revocation.
- **`libs/queue` (downstream, soft dependency via port):** `libs/auth`
  never imports `@/queue`. It exposes an `AUTH_EVENT_PUBLISHER` port
  (default no-op) that emits domain events (`UserRegistered`,
  `PasswordChanged`, `UserLoggedIn`, `UserLockedOut`). The host can wire
  this to `RMQPublisher` later to drive a notification/email consumer —
  today nothing consumes these events, but the port exists so adding a
  consumer later doesn't require touching `libs/auth`.
- **`libs/workflow`:** no relationship. Nothing here needs durable
  orchestration; login/refresh are single-transaction operations, not
  multi-step sagas.

No cyclic or contradictory dependency: `libs/auth` depends on
`libs/database` and (via ports only) is agnostic to `libs/cache`/
`libs/queue`; nothing in those three libs depends back on `libs/auth`.

## Architecture Style Recommendation

Modular monolith, unchanged. `libs/auth` is one more Nest dynamic module
consumed by `apps/server`, same shape as the other three. Nothing about
authentication at this scale/team size justifies a separate
auth-microservice, a shared token-issuing service, or an external IdP —
that would be premature per Section 0.1's justify-or-reject discipline,
and there is no stated multi-service/multi-team need driving it.

## Module Breakdown

```
libs/auth/src/
  index.ts                                # public barrel — only surface other code may import

  auth.module.ts                          # AuthModule.forRoot/forRootAsync
  auth.constants.ts                       # DI tokens
  auth.types.ts                           # AuthModuleOptions / AuthModuleAsyncOptions

  domain/
    user.entity.ts                        # TypeORM entity (aggregate root)
    role.entity.ts
    permission.entity.ts
    refresh-token.entity.ts
    user-status.enum.ts
    user.repository.ts                    # extends BaseRepository<UserEntity>
    role.repository.ts
    refresh-token.repository.ts

  application/
    auth.service.ts                       # register/login/logout/logoutAll/refresh
    authorization.service.ts              # role/permission checks, assignRole, grantPermission
    token.service.ts                      # access-token sign/verify (JWT)
    refresh-token.service.ts              # issue/rotate/revoke, reuse detection

  ports/
    password-hasher.interface.ts          # PASSWORD_HASHER token
    access-token-denylist.interface.ts    # ACCESS_TOKEN_DENYLIST token, Noop default
    auth-event-publisher.interface.ts     # AUTH_EVENT_PUBLISHER token, Noop default
    auth.events.ts                       # UserRegistered / UserLoggedIn / PasswordChanged / UserLockedOut

  adapters/
    argon2-password-hasher.ts             # default PASSWORD_HASHER implementation
    noop-access-token-denylist.ts
    cache-access-token-denylist.ts        # optional, host-wired, depends on CacheManager from @/cache
    noop-auth-event-publisher.ts

  guards/
    jwt-auth.guard.ts
    permissions.guard.ts

  decorators/
    current-user.decorator.ts
    public.decorator.ts                   # marks a route as bypassing JwtAuthGuard
    roles.decorator.ts
    permissions.decorator.ts

  dto/
    register.dto.ts
    login.dto.ts
    refresh.dto.ts

  errors/
    invalid-credentials.error.ts
    account-disabled.error.ts
    token-revoked.error.ts
    insufficient-permissions.error.ts

  persistence/
    entities/index.ts                     # AUTH_TYPEORM_ENTITIES
    migrations/index.ts                   # AUTH_MIGRATIONS
      1753000000000-InitialAuthSchema.migration.ts
```

This mirrors `libs/queue`'s flat, entity-first layout (no adapter-swapping
abstraction) while borrowing `libs/workflow`'s "ports + no-op default"
convention for every cross-cutting concern, and `libs/database`'s
decorator-based repository registration
(`@DatabaseRepository`/`RepositoryRegistry`).

## Aggregate Design

- **`User` (aggregate root).** Invariants: `email` unique and normalized
  (lowercased) at the repository boundary; `passwordHash` never exposed
  outside `application/`; `status` transitions (`unverified → active →
  disabled`) are one-way except `active ↔ disabled` (admin action).
  Owns its `RefreshToken`s (cascade-scoped) but not its `Role`
  assignments — those are a many-to-many association, not ownership,
  since a `Role` outlives any single user.
- **`RefreshToken` (separate aggregate, not a `User` value object).** It
  has its own lifecycle independent of a single request (issued →
  rotated-out-of → revoked/expired) and its own invariant (a rotated
  token's replacement chain must be traceable for reuse detection), which
  is more than a value object's worth of behavior — this justifies a
  second aggregate root rather than an embedded collection on `User`.
- **`Role` (aggregate root).** Owns its `Permission` set via a join table
  (`role_permissions`); permissions have no independent lifecycle outside
  a role's grant, so they are modeled as plain entities referenced by the
  join, not aggregates of their own.
- **`Permission`** is close to a value object (just a stable string key
  like `workflow:read` + description) but is kept as a lightweight entity
  so role→permission grants can be foreign-keyed and queried, matching
  how `libs/workflow` models similarly small, referenced concepts
  (e.g. `WorkflowScheduleEntity`) as entities rather than embedded JSON.

## Domain Model

- `UserEntity`: `id (uuid)`, `email (unique, citext-like via lowercase
  normalization)`, `passwordHash`, `passwordAlgo` (records which hasher
  produced it, e.g. `'argon2id'`, so the hasher can be rotated without a
  breaking migration), `status`, `emailVerifiedAt?`, `createdAt`,
  `updatedAt`.
- `RoleEntity`: `id`, `name (unique)`, `description?`.
- `PermissionEntity`: `id`, `name (unique, e.g. 'workflow:read')`,
  `description?`.
- `RefreshTokenEntity`: `id`, `userId (fk)`, `tokenHash` (SHA-256 of the
  raw token — the raw token is never persisted, mirroring how
  `passwordHash` never stores a plaintext password), `familyId` (groups a
  rotation chain for reuse detection), `expiresAt`, `revokedAt?`,
  `createdByIp?`, `userAgent?`.
- Join tables: `user_roles`, `role_permissions` (plain TypeORM
  `@ManyToMany`/`@JoinTable`, no dedicated entity class — consistent with
  not over-modeling a pure association).
- Domain exceptions (`errors/`): `InvalidCredentialsError`,
  `AccountDisabledError`, `TokenRevokedError`,
  `InsufficientPermissionsError` — each extends the corresponding Nest
  HTTP exception (`UnauthorizedException`/`ForbiddenException`) so
  controllers don't need a translation layer, matching how
  `libs/queue`'s typed errors (`RetryableMessageError`, etc.) carry their
  handling semantics in the type itself.

## Application Layer (Use Cases)

- `AuthService.register(dto)` → validates uniqueness, hashes password via
  `PASSWORD_HASHER`, persists `User` (status `unverified` if email
  verification is ever turned on, `active` by default today since
  verification is out of scope), emits `UserRegistered` via
  `AUTH_EVENT_PUBLISHER`.
- `AuthService.login(dto)` → verifies credentials, checks `status ===
  active`, issues an access token (`TokenService.sign`) + a refresh token
  (`RefreshTokenService.issue`), emits `UserLoggedIn`.
- `AuthService.refresh(refreshToken)` → `RefreshTokenService.rotate`:
  looks up by `tokenHash`, checks `revokedAt`/`expiresAt`, and **on reuse
  of an already-rotated token, revokes the entire `familyId` chain**
  (standard refresh-token-reuse-detection response to a stolen token) and
  emits `UserLockedOut`-style event flagged for the host to act on
  (e.g. force re-login). Issues a new access+refresh pair.
- `AuthService.logout(refreshToken)` → revokes that one refresh token;
  adds the current access token's `jti` to `ACCESS_TOKEN_DENYLIST` if a
  real (non-no-op) denylist is wired.
- `AuthService.logoutAll(userId)` → revokes every refresh token for the
  user (e.g. on password change).
- `AuthorizationService.assignRole/grantPermission/hasPermission` —
  read/write the RBAC association tables; `hasPermission` is what
  `PermissionsGuard` calls per request.
- DTOs (`RegisterDto`, `LoginDto`, `RefreshDto`) validated via
  `class-validator`, matching the existing repo-wide convention (already
  a dependency, per `package.json`) rather than introducing a new
  validation library.

## Commands / Queries

CQRS was rejected (see below), so there is no separate command/query
bus — but the read/write split above still separates cleanly:
"commands" are the `AuthService`/`AuthorizationService` mutating methods
above; "queries" are `AuthorizationService.hasPermission`,
`UserRepository.findByEmail`, and whatever `AuthClient`-style read method
`apps/server` needs for a "get current user" endpoint — all plain
repository/service methods, not a formal query object model.

## Events

Domain events (`ports/auth.events.ts`), published only through
`AUTH_EVENT_PUBLISHER` (default no-op, so nothing breaks if the host
never wires a real publisher):

- `UserRegistered { userId, email }`
- `UserLoggedIn { userId, at }`
- `PasswordChanged { userId }`
- `RefreshTokenReuseDetected { userId, familyId }` — the signal a host
  would use to force logout-everywhere / alert, if it wires the port.

These are **integration events** (cross-boundary, for a future
notification consumer), not domain events consumed inside `libs/auth`
itself — there is no internal event bus here, consistent with rejecting
Event Sourcing/CQRS below.

## Engines / Policies / Specifications

None. RBAC here is a static role→permission lookup (a set-membership
check), not a rule engine, a specification pattern, or a policy engine —
per the explicit discussion to defer a generic policy/rule engine until a
concrete attribute-based ("user can edit order only if same tenant and
order is a draft") need actually appears somewhere in the codebase. If
that need appears, it should be designed against its real consumer, not
spent speculatively here.

## Workflows / Sagas

None. Every use case above is a single DB transaction
(`@Transactional()` from `@/database`, `REQUIRED` propagation) — nothing
here spans multiple services or needs compensation.

## Data Architecture

Single transactional datastore: MySQL via `@/database`, same
writer/reader-split datasource `apps/server` already runs. No separate
reporting/analytical store — auth data volume (users, roles, refresh
tokens) never approaches the scale where that split would matter here.
`RefreshToken` rows are the only high-write-volume table (one write per
login/refresh); acceptable on the existing writer datasource with no
special sharding/partitioning — flagged as the first thing to revisit
under Future Evolution if login volume ever changes materially.

## Messaging Architecture

No direct broker dependency. See Context Map — `AUTH_EVENT_PUBLISHER` is
the only messaging-shaped surface, and it's a port, not a `libs/queue`
import. If/when a real publisher is wired, it rides `libs/queue`'s
existing outbox (transactional with the same write that changed
`User`/`RefreshToken` state) — never publish directly without the outbox,
per `libs/queue`'s established reliability pattern.

## Reliability Architecture

- **Outbox** (if/when `AUTH_EVENT_PUBLISHER` is wired to `libs/queue`):
  reuse `libs/queue`'s `OutboxService` exactly as-is — do not build a
  second outbox implementation inside `libs/auth`.
- **Refresh-token rotation + reuse detection** is this library's own
  reliability primitive (the auth-specific analogue of idempotency): a
  stolen-and-replayed refresh token is detected and its whole token
  family is revoked, rather than silently accepted.
- No Saga/Compensation/Circuit-Breaker/Bulkhead/DLQ — none of the use
  cases are multi-step or call an unreliable external dependency that
  would need them.

## Security Architecture

- **Password hashing: `argon2id`** (new `argon2` dependency), not
  `bcrypt`. **HIGH** — justified below.
- **Access tokens: JWT, `HS256`**, short-lived (recommend 15 min),
  signed with a single shared secret from config (`class-validator`
  schema, following `libs/database/src/config/mysql.schema.ts`'s
  pattern) — never hardcoded, never logged.
- **Refresh tokens:** opaque random value, only its SHA-256 hash
  persisted (never the raw value) — same "never store the secret
  in cleartext" principle applied to passwords, applied here too.
- **RBAC enforcement:** `PermissionsGuard` reads `@Permissions(...)`
  metadata and calls `AuthorizationService.hasPermission` —
  fail-closed (missing metadata does not implicitly allow).
- **`@Public()`** decorator is the only way to bypass `JwtAuthGuard`,
  checked via `Reflector` the same way NestJS's own guard-bypass pattern
  works — explicit opt-out per route, not a default-open guard.
- No PII/credentials/tokens in logs — enforced by never passing
  `passwordHash`/raw tokens to any logger call in `application/`.
- Multi-tenancy: **not applicable** — no stated tenant model exists
  anywhere else in this monorepo; flagged under Future Evolution rather
  than designed speculatively now.

## Scalability

Stateless access-token verification means any `apps/server` replica can
authenticate a request without shared state — the only shared state is
the refresh-token table (already behind `@/database`'s reader/writer
split) and, optionally, the access-token denylist cache (already
Redis-backed via `@/cache`, which is inherently shared across replicas).
No bottleneck introduced beyond what `libs/database`/`libs/cache` already
carry.

## Folder Structure

See Module Breakdown above — matches this monorepo's existing
`libs/*/src/{constants,interfaces,decorators,module-or-top-level}`
convention; no new folder convention invented.

## Design Patterns

- **Repository** (`UserRepository`, `RoleRepository`,
  `RefreshTokenRepository` extending `BaseRepository`) — used, matches
  every sibling lib.
- **Adapter** (`Argon2PasswordHasher` behind `PASSWORD_HASHER`,
  `CacheAccessTokenDenylist` behind `ACCESS_TOKEN_DENYLIST`) — used, so
  the hashing algorithm and denylist backing store are swappable without
  touching `application/`.
- **Strategy**: not introduced as a named pattern — `PASSWORD_HASHER`
  already gives swappable hashing behavior via DI, a second Strategy
  layer on top would be redundant.
- **Factory/Builder:** not needed — entities are simple enough for
  direct construction.
- **Specification/Policy:** explicitly not used here (see Engines/
  Policies above).
- **Facade:** `AuthService` already reads as a thin facade over
  `TokenService`/`RefreshTokenService`/repositories — no additional
  facade layer needed on top of it.

## CQRS Decision

**Rejected.** Write volume (register/login/refresh/logout) and read
volume (permission checks) are both low and simple key-lookups — no read
model divergent enough from the write model to justify a separate query
side, and no team-size pressure to split command/query ownership.

## Event Sourcing Decision

**Rejected.** `User`/`Role`/`RefreshToken` current-state-only rows are
sufficient; nothing here needs point-in-time replay, and adding an event
store would only add operational cost with no consumer that needs it.

## Rejected Alternatives

- **Password-reset / email-verification flows in this design's
  implementation scope.** Discussed explicitly; deferred because it pulls
  in an email-sending dependency (`libs/queue` consumer) that doesn't
  exist yet and isn't needed for the core register/login/refresh/RBAC
  slice. The event contract (`UserRegistered`, `PasswordChanged`) is
  designed to make adding it later additive, not a breaking change.
- **Generic policy/rule engine as a peer library or as part of this
  design.** Discussed explicitly; rejected as speculative generality with
  no concrete consumer yet (Section 0.1). RBAC's static role→permission
  model covers every authorization need identified so far.
- **`libs/workflow`-style dual typeorm/database persistence adapters.**
  Rejected for `libs/auth` specifically because, unlike `libs/workflow`,
  this library is not separately published and can safely hard-depend on
  `@/database`, exactly like `libs/queue` already does. Building the
  swappable-adapter abstraction here would be premature complexity with
  no second backend ever planned.
- **`bcrypt` instead of `argon2id`.** `bcrypt` remains an acceptable
  choice and was considered; `argon2id` was preferred as the current OWASP
  password-hashing recommendation and because it has no 72-byte input
  truncation footgun that `bcrypt` has.
- **RS256 (asymmetric) JWT signing instead of HS256.** Rejected for now
  — `apps/worker` doesn't currently verify tokens, so there's no service
  boundary that needs to verify without holding the signing secret. Flagged
  under Future Evolution as the trigger that would flip this decision.
- **Sessions (server-side, cookie-based) instead of JWT.** Rejected —
  JWT access tokens avoid sticky-session/shared-session-store concerns
  for a horizontally-scaled `apps/server`, and the refresh-token table
  already gives the same revocation control a session store would, without
  needing session state on the hot path of every request.

## Key Decisions (with risk tag)

**CRITICAL**
- None. Nothing here reaches monolith-vs-microservices, broker-choice, or
  multi-tenant-isolation-model territory.

**HIGH**
1. **JWT access token + persisted, rotating refresh token**, not sessions
   and not JWT-only. Benefits: stateless verification across replicas,
   real revocation via the refresh-token table, reuse detection catches
   stolen tokens. Risks: access tokens remain valid until natural expiry
   unless the denylist port is wired. Tradeoff accepted: 15-minute access
   token lifetime bounds that exposure without requiring a cache
   round-trip on every request by default. Alternatives: sessions (see
   Rejected Alternatives). Evolution: move to RS256 if a second service
   ever needs read-only verification.
2. **`argon2id` for password hashing.** Benefits: current best-practice
   resistance to GPU/ASIC cracking, no input-length footgun. Risks: new
   native dependency (`argon2` npm package needs a native binding —
   confirm it builds in whatever deployment environment `apps/server`
   ships to before merging). Tradeoff accepted: build complexity for
   security margin. Alternative: `bcrypt` (pure-JS `bcryptjs` available if
   native builds prove unworkable in deployment — flagged as the fallback
   to revisit if `argon2`'s native binding causes deployment friction).
3. **Refresh-token-reuse detection revokes the entire token family.**
   Benefits: a stolen refresh token, once the legitimate user rotates
   again, poisons the thief's copy too (both get revoked), rather than
   the thief silently riding along. Risk: a legitimate user with two
   devices racing a rotation could get spuriously logged out on both —
   accepted as a rare edge case with a low cost (re-login) against a much
   higher-value security property.

**MEDIUM**
1. `libs/auth` depends directly on `@/database` (no swappable persistence
   adapter), unlike `libs/workflow` — justified above (Context Map,
   Rejected Alternatives): not separately published, no second backend
   ever planned.
2. RBAC modeled as plain `Role`/`Permission` entities + join tables, not a
   claims/scopes-in-JWT model — keeps permission changes effective
   immediately (a JWT-embedded claim would be stale until the token's
   next refresh).
3. `ACCESS_TOKEN_DENYLIST` defaults to a no-op — logout revokes the
   refresh token immediately but an already-issued access token remains
   valid until its short natural expiry unless the host wires
   `CacheAccessTokenDenylist`. Consistent with `libs/workflow`'s
   no-op-default-for-optional-cross-cutting-concern pattern
   (`WORKFLOW_METRICS`, `WORKFLOW_EVENT_PUBLISHER`).

**LOW**
- Folder layout, file naming — see Module Breakdown.
- Migration timestamp numbering continues the existing convention
  (`libs/queue`'s `1752100000000...`, `libs/workflow`'s up to
  `1752500000000...`) — `libs/auth`'s initial migration is
  `1753000000000-InitialAuthSchema`.

## Open Questions / Future Evolution

- No email-sending capability exists yet in this monorepo — password
  reset/email verification stay out of scope until one does (see
  Rejected Alternatives). When it's built, extend via the existing
  `AUTH_EVENT_PUBLISHER` port rather than adding SMTP logic inside
  `libs/auth`.
- No stated tenant model anywhere in this monorepo — if multi-tenancy is
  introduced later, `User`/`Role`/`Permission` all need a `tenantId`
  column and every repository query needs tenant scoping; flagged now so
  it isn't forgotten, not designed now (no concrete tenant requirement
  exists to design against).
- If `apps/worker` ever needs to verify a JWT (e.g. to authorize a
  privileged background job triggered by a user action), revisit the
  HS256-vs-RS256 decision above — sharing an HS256 secret across two apps
  is workable but RS256 (verify-only public key in the worker) would be
  the cleaner boundary at that point.
- `RefreshToken` write volume is the first thing to revisit if login
  throughput ever becomes a stated concern (see Data Architecture).

## Handoff to Improvement Loop

- **Public API surface (`libs/auth/src/index.ts`):** `AuthModule`
  (`forRoot`/`forRootAsync`), `AuthService`, `AuthorizationService`,
  `JwtAuthGuard`, `PermissionsGuard`, `@CurrentUser()`, `@Public()`,
  `@Permissions()`, `@Roles()`, `PASSWORD_HASHER`/`PasswordHasher`,
  `ACCESS_TOKEN_DENYLIST`/`AccessTokenDenylist`,
  `AUTH_EVENT_PUBLISHER`/`AuthEventPublisher`, `AUTH_TYPEORM_ENTITIES`,
  `AUTH_MIGRATIONS`, the domain error classes, and the DTOs.
- **Module boundaries:** `libs/auth` → `@/database` (hard dependency,
  entities/repositories/`@Transactional`); `@/cache` and `@/queue` are
  never imported directly — only reachable through the
  `ACCESS_TOKEN_DENYLIST`/`AUTH_EVENT_PUBLISHER` ports, wired by the host
  in `apps/server/src/app.module.ts` exactly the way `WORKFLOW_METRICS`/
  `WORKFLOW_EVENT_PUBLISHER` are wired today. `apps/worker` is out of
  scope for this design (see Open Questions).
