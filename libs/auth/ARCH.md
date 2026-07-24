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

- ~~No email-sending capability exists yet in this monorepo — password
  reset/email verification stay out of scope until one does (see
  Rejected Alternatives). When it's built, extend via the existing
  `AUTH_EVENT_PUBLISHER` port rather than adding SMTP logic inside
  `libs/auth`.~~ **Resolved — see Design 003.** Built exactly this way:
  extended `AUTH_EVENT_PUBLISHER` rather than adding SMTP logic here.
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

  > **Superseded in part by Design 002** — `libs/auth` now also depends
  > directly on `@/validation` (`Specification`, no port/token), for the
  > same reason it depends directly on `@/database`: both are
  > stateless/infrastructure libraries upstream of every domain lib, not
  > swappable side-effecting integrations like the cache/queue ports
  > above.

---

# Design 002

**Library / Bounded Context:** libs/auth
**Date:** 2026-07-20

## Goal

Express role/permission-name uniqueness as an async `Specification` (from `@/validation`) instead
of the ad hoc `if (await this.roles.findByName(name)) throw ...` checks already in
`AuthorizationService`, per the user's explicit request to complete this open item.

## Scale/Team Context Assumed

Unchanged from Design 001.

## Key Decisions (with risk tag)

**MEDIUM**
- `libs/auth` gains a direct dependency on `@/validation` (`Specification` interface only — no
  DTOs, no `ValidationModule`, no DI token). This is **not** the "generic policy/rule engine"
  Design 001's "Engines / Policies / Specifications" section explicitly deferred — that section
  was about attribute-based access control rules (a business-logic engine); this is reusing an
  already-shared, already-built primitive (`Specification<T>`) for two narrow existence checks
  that already existed as inline `if` statements. No new engine is being introduced into
  `libs/auth`, just a different shape for logic that was already there.
  - *Alternative rejected:* leave the inline `if (await repo.findByName(name))` checks as-is.
    Rejected only because the user explicitly asked for this specific refactor — on its own,
    per Section 18/"never refactor code that already satisfies readability/maintainability/
    correctness," the inline checks were not broken and this is a stated-preference change, not a
    bug fix.
- New classes live in `libs/auth/src/specifications/` (a new folder, since none existed):
  `UniqueRoleNameSpecification`, `UniquePermissionNameSpecification` — each takes its repository
  via constructor injection and implements `Specification<string>` (`isSatisfiedBy`/`explain`
  against a candidate name).
- **Addendum (same day):** `UniqueEmailSpecification` added, converting `AuthService.register`'s
  `if (await this.users.findByEmail(email)) throw new EmailAlreadyRegisteredError()` check — the
  exact same "does a row with this identity not already exist" shape as the two above. Found
  while investigating whether the pattern should extend further; other candidate checks in
  `libs/auth` (`assignRole`/`revokeRole`/`grantPermission`'s in-memory `.some()` membership
  checks, `refresh-token.service.ts`'s expiry/state-transition checks) do **not** fit this shape
  — they're either already-simple in-memory checks with no repository call to wrap, or operate on
  computed/temporal state rather than "does this identity exist," so they were left alone rather
  than forced into the pattern.

## Rejected Alternatives

- A generic ABAC/policy engine — already rejected in Design 001, not reopened here.
- Async validation via `libs/validation`'s `ValidationService`/`ValidationRuleService` (the full
  DB-stored-rule machinery) — rejected as overkill; role/permission-name uniqueness is a fixed
  invariant of this domain, not an admin-configurable business rule, so it doesn't belong in the
  stored-rule system at all. Only the bare `Specification` interface is reused, nothing else from
  `libs/validation`'s DI/module surface.

## CQRS / Event Sourcing Decisions

Unchanged from Design 001 (not applicable).

## Open Questions / Future Evolution

- None — this closes the specific item Design 001 flagged and deferred.

## Handoff to Improvement Loop

- **Public API surface (unchanged):** `UniqueRoleNameSpecification`/
  `UniquePermissionNameSpecification` are internal to `AuthorizationService`, not exported from
  `libs/auth/src/index.ts` — no public API change.
- **Module boundaries (revised):** `libs/auth` may now import `@/validation` directly (see note
  above superseding Design 001's module-boundary list).

---

# Design 003

**Library / Bounded Context:** libs/auth
**Date:** 2026-07-22

## Goal

Build password reset and email verification — the exact item Design 001 deferred (see Open
Questions, now marked resolved above) — per direct user request. Retroactively documents
`libs/auth/LOOP.md` Loop 014, which implemented this without a preceding Design Mode session; this
entry closes that gap per Section 0.7 ("architecture decisions and code-improvement history are
different logs worth keeping independently").

## Scale/Team Context Assumed

Unchanged from Design 001.

## Key Decisions (with risk tag)

**HIGH**
1. **Login now blocks on `UserStatus.UNVERIFIED`.** `register()` previously set every new user
   `ACTIVE` immediately, silently bypassing the `UNVERIFIED` enum value and `emailVerifiedAt`
   column Design 001's domain model already carried. Confirmed directly with the user (this
   changes an existing, live login code path, not a greenfield addition) before implementing —
   see the two-option question in the Loop 014 conversation. Benefits: fulfills what the domain
   model was already built for; matches conventional practice (an unverified email shouldn't be
   able to authenticate). Risks: any existing registered user created before this change is
   `ACTIVE` already (unaffected — the migration doesn't touch existing rows), but any *new*
   integration test or consumer that assumed immediate post-registration login now needs an
   explicit verification step (see Loop 014's `activate()` test helper). Alternative rejected:
   track-only (informational `emailVerifiedAt`, no login gate) — offered to the user as the
   lower-risk option; not chosen. Evolution: if a product need emerges for "grace period" logins
   (allow N days unverified before locking out), that's a new decision, not implied by this one.
2. **One `auth_tokens` table for both password-reset and email-verification tokens**, not two.
   The prediction in Design 001's Rejected Alternatives — that this would need "an email-sending
   dependency (`libs/queue` consumer)" — did **not** materialize: the actual implementation adds
   zero new dependency on `libs/queue`, only two new methods on the already-existing
   `AUTH_EVENT_PUBLISHER` port, exactly as Design 001's Open Questions anticipated ("extend via
   the existing `AUTH_EVENT_PUBLISHER` port rather than adding SMTP logic inside `libs/auth`").
   Benefits: one migration/entity/repository instead of two identical ones; a `purpose` column is
   the only thing distinguishing rows. Risk: a bug in purpose-scoping (`findActiveByHash`,
   `invalidateActiveForUser`) would let a password-reset token be replayed as an email-verification
   token or vice versa — mitigated by every query taking `purpose` as an explicit, required
   parameter, not an optional filter. Alternative rejected: two separate tables — would have been
   pure duplication of an identical schema (see `AuthTokenEntity`'s own doc comment).

**MEDIUM**
- Password reset revokes every existing refresh token for the user on success (same reasoning
  `AuthService.logoutAll` already exists for — a reset is exactly the moment a possibly-compromised
  session should be forced to re-authenticate). Not applied to email verification, which doesn't
  touch credentials and has no equivalent "possibly compromised" story.
- `AuthEventPublisher` gained two **required** (not optional) methods
  (`publishPasswordResetRequested`/`publishEmailVerificationRequested`). Confirmed no custom
  implementation of this interface exists anywhere in `apps/server` today (only
  `NoopAuthEventPublisher`), and that `libs/auth` — unlike `libs/workflow` — has no separate
  `package.json`, so it isn't a semver-sensitive external package a required-method addition could
  break. Kept the interface uniform (all four prior methods were already required) rather than
  introducing `libs/workflow`'s optional-method precedent (`compensationFailed?`,
  `sweepPendingEffectsReplayed?`) without a reason specific to this interface.
- Both "request" endpoints (`password-reset/request`, `email-verification/request`) always
  respond `204` regardless of whether the email exists or is already verified — the services
  themselves silently no-op rather than the controller swallowing an error, so there's no
  code path that could accidentally leak account existence/state through a differently-timed
  error response.

## Rejected Alternatives

- **Track-only email verification** (no login gate) — offered explicitly to the user as the
  lower-risk option; not chosen (see HIGH #1).
- **Two separate token tables** (`password_reset_tokens`, `email_verification_tokens`) — rejected
  as pure schema duplication; see HIGH #2.
- **A dedicated "email sender" port** distinct from `AUTH_EVENT_PUBLISHER` — rejected; the raw
  token is carried inside the existing event payload instead, since sending the email is exactly
  the same "cross-cutting concern the host app supplies a real implementation for" shape every
  other `AuthEventPublisher` method already has. Inventing a second, parallel port for the same
  concern would fragment the one extension point Design 001 already established.

## CQRS / Event Sourcing Decisions

Unchanged from Design 001 (not applicable).

## Open Questions / Future Evolution

- None new. This closes the specific item Design 001 flagged and deferred (see Design 001's Open
  Questions, now marked resolved).

## Handoff to Improvement Loop

- **Public API surface (revised):** `libs/auth/src/index.ts` now also exports
  `PasswordResetService`, `EmailVerificationService`, `AuthTokenEntity`/`AuthTokenPurpose`/
  `AuthTokenRepository`, the four new DTOs (`RequestPasswordResetDto`, `ConfirmPasswordResetDto`,
  `RequestEmailVerificationDto`, `ConfirmEmailVerificationDto`), and the three new error classes
  (`PasswordResetTokenInvalidError`, `EmailVerificationTokenInvalidError`,
  `EmailNotVerifiedError`).
- **Module boundaries:** unchanged — no new external dependency introduced (see HIGH #2).

---

# Design 004

**Library / Bounded Context:** libs/auth
**Date:** 2026-07-22

## Goal

Record the new `@/ratelimit` dependency taken on directly by `libs/auth` when
`libs/ratelimit`'s ARCH.md Design 002 applied `@RateLimit('login')` to `AuthController.login` —
this file's own module-boundary record needs to reflect that, not just `libs/ratelimit`'s.

## Key Decisions (with risk tag)

**MEDIUM**
- `libs/auth` imports `@RateLimit()`/`RATE_LIMIT_METADATA` from `@/ratelimit` — metadata-only
  (`SetMetadata`), no service call or constructor injection, materially lighter than the existing
  `@/database`/`@/validation` dependencies. See `libs/ratelimit/ARCH.md` Design 002 for the full
  reasoning (including why this was applied inside `libs/auth` rather than at the `apps/server`
  layer).

## Handoff to Improvement Loop

- **Module boundaries (revised):** `libs/auth` → `@/ratelimit` (decorator metadata only), in
  addition to the already-established `@/database`/`@/validation` dependencies.

---

# Design 005

**Library / Bounded Context:** libs/auth
**Date:** 2026-07-22

## Goal

Add a per-user concurrent device/session cap. Direct user request ("device limit?"), scoped via
two clarifying questions before implementing (eviction vs. rejection on exceeding the cap; default
value and configurability).

## Key Decisions (with risk tag)

**MEDIUM**
- **Evict oldest, don't reject the new login.** Confirmed directly with the user (offered as the
  recommended option): a 6th concurrent login always succeeds; the least-recently-issued active
  refresh token is silently revoked to make room. Matches common consumer-app behavior ("you've
  been logged out on your other device") rather than a stricter enterprise/security-tool denial.
- **Default 5, configurable via `AuthModuleOptions.maxActiveSessionsPerUser`** — confirmed
  directly with the user, same override shape as `refreshTokenTtlSeconds`.
- **"Active" excludes naturally-expired-but-not-yet-revoked rows**, not just explicitly-revoked
  ones (`RefreshTokenRepository.findActiveForUser` filters `expiresAt > now`) — otherwise stale
  rows nobody ever explicitly revoked would count against the cap forever, eventually evicting
  genuinely active sessions for accounts with old dead tokens sitting in the table.
- **Enforcement lives inside `RefreshTokenService.issue`, not `AuthService.login`.** `issue()` is
  the one place both `login()` (a fresh session) and `rotate()` (continuing an existing session)
  ultimately go through — since `rotate()` already revokes the old row for its family before
  calling `issue()` again, the active count never actually grows during rotation, so enforcement
  naturally only bites on a genuinely new login (or an account already over a newly-lowered cap).
  No special-casing needed between the two call paths.

## Rejected Alternatives

- **Reject the new login instead of evicting** — offered explicitly to the user as the stricter
  alternative; not chosen (see MEDIUM above).
- **Enforcing the cap in `AuthService.login`** — rejected in favor of `RefreshTokenService.issue`,
  since the latter is the single choke point both `login()` and `rotate()` already share; putting
  it in `login()` would miss the (admittedly rare) case of an account already over a newly-lowered
  cap being trimmed down on its next token rotation rather than only on fresh logins.

## Handoff to Improvement Loop

- **Public API surface (revised):** `AuthModuleOptions.maxActiveSessionsPerUser?: number`;
  `RefreshTokenRepository` gained `findActiveForUser`/`revokeMany`.
- **Module boundaries:** unchanged.

---

# Design 006

**Library / Bounded Context:** libs/auth (Identity & Access)
**Date:** 2026-07-23

## Goal

Correct a factual drift Design 001's "Workflows / Sagas" section introduced: it claimed every use
case in this library runs inside `@Transactional()` (`REQUIRED` propagation) from `@/database`.
`LOOP.md` Loop 018 found this was never true — `@Transactional()` had zero consumers anywhere in
`libs/auth`, or in fact anywhere in this entire monorepo, before that loop attempted (and then
reverted) using it. This entry doesn't change any design decision; it corrects the record to match
what the code has always actually done, per this protocol's own rule that `ARCH.md` should reflect
implementation reality (or document an intentional divergence) rather than aspirational intent
nobody circled back to verify.

## What Actually Happens (correcting Design 001's "Workflows / Sagas" claim)

- No code path in `libs/auth` uses `@Transactional()`. Most use cases are a single call into one
  repository method (`save()`/`insert()`/`update()`), which is already atomic on its own — no
  explicit transaction wrapper needed for a single write.
- Multi-write flows (e.g. `AuthService.register()`: check uniqueness, hash password, save the
  user, issue an email-verification token, publish an event) are **not** wrapped in one database
  transaction today. This has been true since Design 001's original implementation; it was never
  actually built the way that section described.
- The one place a real concurrency hazard existed — `AuthorizationService`'s RBAC
  grant/revoke methods racing on a shared many-to-many array (Loop 018) — was fixed **without**
  transactions at all: `UserRepository.addRole`/`removeRole` and `RoleRepository.addPermission`/
  `removePermission` write a single row directly to the join table via TypeORM's relation query
  builder, which is atomic at the database level on its own. Loop 018 tried `@Transactional()` +
  pessimistic row locking first and reverted it — see that loop's entry for why (the decorator
  requires a real Nest DI bootstrap to take effect at all, and `better-sqlite3`, which every
  integration test in this repo depends on, can't execute `SELECT ... FOR UPDATE` regardless).

## Key Decisions (with risk tag)

**LOW**
- Documentation-only correction — no code, schema, or public API change. Classified LOW per
  ci.loop §18 (the equivalent of "folder naming" for a design decision: this doesn't move a
  bounded-context or aggregate boundary, it just makes the written record match what already
  existed).

## Rejected Alternatives

- Silently leaving Design 001's claim uncorrected — rejected because a future loop or reader
  relying on "`@Transactional()` protects every use case" as a design invariant would be reasoning
  from a false premise, exactly the kind of drift ci.loop's Phase 2 review checklist calls out
  ("has an aggregate boundary been violated... has an event contract changed shape without
  updating the design log").

## CQRS Decision

Not applicable — unchanged from Design 001.

## Event Sourcing Decision

Not applicable — unchanged from Design 001.

## Open Questions / Future Evolution

- If a future concrete need arises for true multi-write atomicity (e.g. `register()`'s user-save
  and verification-token-insert needing to succeed or fail together), revisit then — no such need
  has surfaced as of this entry, and per ci.loop §17, adding transaction wrapping without a
  concrete driving requirement would be speculative.

## Handoff to Improvement Loop

- **Public API surface:** unchanged.
- **Module boundaries:** unchanged.

---

# Design 007

**Library / Bounded Context:** libs/auth
**Date:** 2026-07-23

## Goal

Record the new `@/audit` dependency taken on by `AuthorizationService` when `libs/audit/ARCH.md`
Design 001 wired RBAC mutations (create/delete role & permission, grant/revoke, assign/revoke role)
into the new Audit Module — this file's own module-boundary record needs to reflect that, not just
`libs/audit`'s.

## Key Decisions (with risk tag)

**MEDIUM**
- `AuthorizationService` now constructor-injects `AuditService` and calls `.record(...)` at the end
  of each of its 8 mutation methods. Each method also gained an optional trailing `actorId?: string`
  parameter (additive, not a breaking signature change) so the audit entry can capture who performed
  the action; `RoleController` now forwards `@CurrentUser().userId` as that argument on every route.
  See `libs/audit/ARCH.md` Design 001 for the full reasoning (direct-service-call mechanism, no
  cycle since `libs/audit` takes no dependency back on `libs/auth`).

## Handoff to Improvement Loop

- **Public API surface (revised):** `AuthorizationService`'s 8 mutation methods each gained an
  optional trailing `actorId?: string` parameter. No other public API change.
- **Module boundaries (revised):** `libs/auth` → `@/audit` (direct dependency on `AuditService`), in
  addition to the already-established `@/database`/`@/validation`/`@/ratelimit` dependencies.

---

# Design 008

**Library / Bounded Context:** libs/auth
**Date:** 2026-07-23

## Goal

Record that `AUTH_EVENT_PUBLISHER` now has a real (non-no-op) implementation for the first time —
`apps/server`'s new `QueueAuthEventPublisher` (see `libs/notification/ARCH.md` Design 001) — closing
the exact gap Design 001's Open Questions flagged ("the host can wire this to `RMQPublisher` later
to drive a notification/email consumer — today nothing consumes these events").

## Key Decisions (with risk tag)

**LOW**
- No change to `libs/auth` itself — `AuthEventPublisher`'s interface, `NoopAuthEventPublisher`, and
  every call site were already built exactly to support this (Design 001's own stated intent).
  This entry exists only to mark the "today nothing consumes these events" caveat as resolved and
  to record which two of the six events (`PasswordResetRequestedEvent`/
  `EmailVerificationRequestedEvent`) gained a real consumer; the other four remain no-op by design
  (see `libs/notification/ARCH.md` Open Questions) — not a partial/broken implementation, a
  deliberately scoped one.

## Handoff to Improvement Loop

- **Public API surface / Module boundaries:** unchanged — the new publisher lives in `apps/server`,
  not in `libs/auth`.

---

# Design 009

**Library / Bounded Context:** libs/auth
**Date:** 2026-07-24

## Goal

Close the first of the three remaining "Auth completeness" gaps `REQUIREMENTS.md` Tier 1 names
(MFA/2FA, API keys, OAuth2/SSO) — TOTP-based MFA/2FA, chosen with the user over the other two as
the highest security value for an account/session model that already exists, with no external
IdP/infra dependency. Scoped via three clarifying questions confirmed with the user before
designing: (1) a two-step login flow (password → challenge → verify), (2) `otplib` for TOTP, (3)
single-use recovery codes issued at enrollment confirmation.

## Scale/Team Context Assumed

Unchanged from Design 001 — single team, single monorepo, `apps/server` horizontally scaled behind
shared MySQL/Redis. This is an internal capability of the existing Authentication bounded context,
not a new one.

## Bounded Contexts Identified

- No new bounded context — MFA is internal to the existing Authentication context (`libs/auth`),
  the same way password-reset/email-verification (Design 003-ish work, pre-dates this log) and
  device management (Loop 022) were additive capabilities on the same aggregate rather than new
  contexts of their own.

## Key Decisions (with risk tag)

**HIGH**
1. **`AuthService.login`'s return type widens from `AuthSession` to `AuthSession | MfaChallenge`.**
   An MFA-enabled account's login no longer issues a JWT/refresh token in one call — it returns a
   short-lived (`DEFAULT_MFA_CHALLENGE_TTL_SECONDS`, 5 min) opaque `challengeToken`, exchanged via
   the new `POST /auth/mfa/verify` for the real session. This is the only way to add a second
   factor without either (a) issuing a session before the second factor is checked (defeats the
   point) or (b) making every caller of `login` pass a TOTP code up front (breaks non-MFA accounts).
   Risk: every caller of `AuthService.login`/`AuthController.login` must now narrow the union
   (`mfaRequired` discriminant) — mitigated by keeping the discriminant optional-`false` on
   `AuthSession` so existing non-MFA call sites narrow with a single `if (result.mfaRequired)`
   check, and by every integration/unit test call site being updated in this same pass (see
   `libs/auth/LOOP.md` Loop 025).
2. **TOTP secrets are encrypted at rest (AES-256-GCM), not hashed.** Unlike password-reset/
   email-verification tokens (`AuthTokenEntity`, one-way hash — the raw value is never needed
   again), verifying a TOTP code requires the raw secret back, so hashing isn't an option. New
   `MfaSecretCipher` port + `AesGcmMfaSecretCipher` default adapter, keyed by SHA-256 of
   `AuthModuleOptions.mfa.encryptionKey` (`AUTH_MFA_ENCRYPTION_KEY`). Fails **lazily**, not at
   `AuthModule` boot — `AesGcmMfaSecretCipher` throws `MfaConfigurationError` only when
   `encrypt`/`decrypt` is actually invoked, so existing deployments that never set the env var keep
   booting exactly as before (MFA is simply unusable, not a boot-time break). Mirrors `libs/auth`'s
   own `PasswordHasher` port shape and `libs/ratelimit`'s fail-fast-at-first-use precedent (unknown
   limiter name), not a new pattern.
3. **`otplib` is a new dependency.** No existing TOTP/HOTP implementation anywhere in the monorepo.
   Pinned to v12 (the classic `authenticator` singleton API) rather than v13 (a functional/
   plugin-based rewrite requiring separate crypto-plugin wiring) — v12 is simpler, stable, and
   sufficient for this scope; revisit only if a concrete v13-only capability becomes needed.

**MEDIUM**
- **Recovery codes reuse `AuthTokenEntity`/`AuthTokenPurpose`** (new `MFA_CHALLENGE`/
  `MFA_RECOVERY_CODE` purposes) rather than a new entity — structurally identical to
  password-reset/email-verification tokens (single-use, hashed, user-scoped), just with an
  effectively-non-expiring `expiresAt` (a far-future sentinel date) since a recovery code's
  lifetime is "until used or MFA disabled/re-enrolled," not TTL-bound. 10 codes issued at
  `confirmEnrollment`, shown exactly once.
- **The MFA challenge token is consumed only on a *successful* code check**, not on every attempt
  — unlike password-reset/email-verification (where the token itself *is* the whole credential), a
  wrong TOTP code shouldn't burn the one chance to retry a typo. Abuse is bounded by the
  challenge's own short TTL and `@RateLimit('mfa-verify')` (5/15min per IP, same shape as
  password-reset/email-verification), not single-shot consumption.
- **Disabling MFA requires re-verifying the current password** (not a TOTP code) — same "prove
  you're still you" gate `AuthService.changePassword` already applies, and specifically avoids
  locking out a user who lost their authenticator device and is relying on disable-then-re-enroll.
- **A new `mfa-verify` rate limiter** in `apps/server`'s `RateLimitModule.forRoot`, matching
  password-reset/email-verification's `5/15min` shape exactly — see
  `libs/ratelimit/ARCH.md` for the underlying pattern.

**LOW**
- Folder layout: `MfaService` in `application/`, `MfaSecretEntity`/`MfaSecretRepository` in
  `domain/`, `MfaSecretCipher` in `ports/`, `AesGcmMfaSecretCipher` in `adapters/` — mirrors every
  existing capability in this library, no new convention introduced.
- `MfaSecretRepository.upsertPending` uses find-then-`save()`, not `BaseRepository.upsert()` —
  caught live: `upsert()` builds a raw INSERT that bypasses TypeORM's `@CreateDateColumn`/
  `@UpdateDateColumn` auto-population (MySQL rejects the resulting `DEFAULT` keyword since those
  columns have no DB-level default without an explicit migration default — see Loop 025's Critical
  finding). No other repository in this codebase uses `upsert()`, so this isn't a regression from
  an established pattern.

## Rejected Alternatives

- **API keys or OAuth2/SSO instead of/alongside MFA in this pass.** Confirmed with the user: MFA
  first, the other two remain open `REQUIREMENTS.md` Tier 1 items with no concrete trigger yet.
- **A generic "second factor" abstraction supporting multiple MFA methods (TOTP, SMS, WebAuthn) up
  front.** Rejected as premature — no concrete need for a second method exists yet, and
  `MfaSecretCipher`/`AuthTokenPurpose.MFA_CHALLENGE` are narrow enough to extend later without a
  rewrite if one appears (same "don't build the abstraction before the second consumer" discipline
  `libs/audit/ARCH.md` and `libs/users/ARCH.md` already apply to their own generalization
  questions).
- **`otplib` v13.** See Key Decisions HIGH #3.

## CQRS Decision

Not applicable — unchanged from Design 001.

## Event Sourcing Decision

Not applicable — unchanged from Design 001.

## Open Questions / Future Evolution

- **API keys, OAuth2/SSO** — the two remaining Tier 1 "Auth completeness" items, still without a
  concrete trigger.
- **Admin-assisted recovery** for a user who both loses their authenticator device *and* exhausts
  their 10 recovery codes — no such path exists (they'd be locked out of MFA-gated login
  entirely, though `disableMfa` itself only needs the password, not a second factor, so this isn't
  a full account lockout). No concrete incident has driven this; revisit if one does.
- **WebAuthn/passkeys or SMS as additional MFA methods** — see Rejected Alternatives; add only if a
  concrete need appears.

## Handoff to Improvement Loop

- **Public API surface (additions):** `MfaService`, `MfaSecretCipher` (type), `AesGcmMfaSecretCipher`,
  `MfaSecretEntity`/`MfaSecretRepository`, `AuthTokenPurpose.MFA_CHALLENGE`/`MFA_RECOVERY_CODE`,
  six new DTOs (`MfaEnrollResponseDto`, `ConfirmMfaEnrollmentDto`, `MfaRecoveryCodesResponseDto`,
  `DisableMfaDto`, `MfaChallengeResponseDto`, `VerifyMfaDto`), six new error classes
  (`MfaConfigurationError`, `MfaChallengeInvalidError`, `MfaCodeInvalidError`,
  `MfaEnrollmentNotPendingError`, `MfaAlreadyEnabledError`, `MfaNotEnabledError`).
- **Public API surface (revised, breaking within the module but not for external callers of the
  HTTP API):** `AuthService.login` returns `Promise<AuthSession | MfaChallenge>` instead of
  `Promise<AuthSession>`; `AuthService`'s constructor gains a required trailing `MfaService`
  parameter.
- **Module boundaries:** unchanged — `libs/auth` already depended on `@/audit` (Design 007);
  `MfaService` reuses that existing dependency for `mfa.enabled`/`mfa.disabled` audit entries
  rather than introducing a new one.
- `apps/server/src/app.module.ts`: new `AUTH_MFA_ENCRYPTION_KEY` env var (optional — MFA stays
  inert without it), new `mfa-verify` rate limiter, new `MfaSecrets1753400000000` migration merged
  into the existing `AUTH_MIGRATIONS` array (already wired into `DatabaseModule.forRoot`).
