# Loop 001

**Library:** libs/auth
**Date:** 2026-07-19

## Goal

Implement `libs/auth` from scratch per `libs/auth/ARCH.md` Design 001:
register/login/logout/refresh with JWT access tokens + rotating refresh
tokens, and RBAC authorization, consistent with `libs/database`/
`libs/cache`/`libs/queue`/`libs/workflow` conventions. This was greenfield
implementation following a completed Design Mode session, not a refactor
of existing code.

## Files Reviewed

- `libs/database/src/{repository,decorators,transaction}` — `BaseRepository`,
  `@DatabaseRepository`, `@InjectRepository`, `@Transactional` conventions.
- `libs/queue/src/{outbox,queue.module.ts,persistence}` — flat entity-first
  persistence layout, `forRoot`/`forRootAsync` provider pattern, migration
  numbering convention.
- `libs/workflow/src/observability/noop-*` — no-op-default cross-cutting
  DI token pattern (`WORKFLOW_METRICS`, `WORKFLOW_EVENT_PUBLISHER`).
- `libs/cache/src/{cache-manager.ts,nest/cache.service.ts}` — `CacheManager`
  shape, used for the optional `CacheAccessTokenDenylist` adapter.
- `apps/server/src/app.module.ts` — module wiring conventions (`forRoot`/
  `forRootAsync`, entity/migration merging into a single `DatabaseModule`).

## Problems Found

N/A — greenfield implementation, not a review of existing code.

## Changes Made

- Scaffolded `libs/auth` (`nest-cli.json`, `tsconfig.json` path alias,
  `tsconfig.lib.json`, `package.json` deps `argon2`/`@nestjs/jwt`, jest
  `moduleNameMapper`).
- Domain: `UserEntity`, `RoleEntity`, `PermissionEntity`,
  `RefreshTokenEntity` + `UserRepository`/`RoleRepository`/
  `RefreshTokenRepository` extending `BaseRepository`.
- Ports + no-op-default adapters: `PASSWORD_HASHER`
  (`Argon2PasswordHasher`), `ACCESS_TOKEN_DENYLIST`
  (`NoopAccessTokenDenylist` default, optional `CacheAccessTokenDenylist`),
  `AUTH_EVENT_PUBLISHER` (`NoopAuthEventPublisher` default).
- Application: `TokenService` (JWT sign/verify via `@nestjs/jwt`),
  `RefreshTokenService` (issue/rotate/revoke with reuse-detection revoking
  the whole token family), `AuthService` (register/login/logout/
  logoutAll/refresh), `AuthorizationService` (RBAC assign/check).
- `JwtAuthGuard` + `PermissionsGuard`, `@CurrentUser()`/`@Public()`/
  `@Roles()`/`@Permissions()` decorators, DTOs, typed domain errors.
- Initial migration `1753000000000-InitialAuthSchema` (`auth_users`,
  `auth_roles`, `auth_permissions`, `auth_role_permissions`,
  `auth_user_roles`, `auth_refresh_tokens`).
- `AuthModule.forRoot`/`forRootAsync`, public barrel `index.ts`.
- Wired into `apps/server/src/app.module.ts`: entities/migrations merged
  into the existing `DatabaseModule.forRoot` call, `AuthModule.forRootAsync`
  reading `AUTH_JWT_SECRET`/`AUTH_ACCESS_TOKEN_TTL_SECONDS`/
  `AUTH_REFRESH_TOKEN_TTL_SECONDS` from `ConfigService`; documented the new
  env vars in `.env.example`.
- 35 unit tests across `TokenService`, `RefreshTokenService`, `AuthService`,
  `AuthorizationService`, `JwtAuthGuard`, `PermissionsGuard`,
  `Argon2PasswordHasher`.

## Why

See `libs/auth/ARCH.md` Design 001 for the full rationale (JWT+rotating-
refresh over sessions, argon2id over bcrypt, direct `@/database` dependency
instead of a swappable adapter, ports instead of direct `@/cache`/`@/queue`
imports, deferred password-reset/RBAC-policy-engine scope).

## Tests

35 new tests in `libs/auth` (7 spec files), all passing. Full monorepo
suite: 913 tests passing across 111 suites (no regressions).

## Build

PASS (`nest build`, webpack compiled successfully)

## Lint

PASS (`libs/auth/**/*.ts` and `apps/server/src/app.module.ts` clean;
pre-existing `apps/worker` lint/type issues are unrelated to this change
and were left untouched)

## Remaining TODO

- Password reset / email verification flows — deferred, see ARCH.md Open
  Questions. Needs an email-sending capability that doesn't exist yet.
- No HTTP controller/route layer was added in this loop — `AuthService`/
  `AuthorizationService`/guards are exported and ready to wire into
  `apps/server` controllers, but no `AuthController` (register/login/
  refresh/logout endpoints) was scaffolded. Confirm whether that belongs
  in `libs/auth` or in `apps/server` before adding it.
- `CacheAccessTokenDenylist` is implemented but not wired into
  `apps/server/src/app.module.ts` — `AuthModule.forRootAsync` currently
  uses the no-op default, so logout revokes the refresh token immediately
  but the access token remains valid until its natural (15 min default)
  expiry. Wire it if instant access-token revocation becomes a requirement.
- No admin-facing endpoints/CLI to create roles/permissions or call
  `AuthorizationService.assignRole` — only the service method exists.

## Next Loop

- If/when password reset is prioritized, extend via `AUTH_EVENT_PUBLISHER`
  rather than adding SMTP logic inside `libs/auth` (see ARCH.md).

---

# Loop 002

**Library:** libs/auth
**Date:** 2026-07-19

## Goal

Resolve the "Next Loop" item from Loop 001: add the HTTP presentation
layer (`AuthController`) that Loop 001 deliberately left out.

## Files Reviewed

- `libs/auth/src/application/auth.service.ts` — confirmed `logout`/
  `logoutAll` signatures needed from a controller (`jti`,
  `tokenExpiresAt`, raw refresh token; userId).
- `apps/server/src/main.ts` — confirmed a global `ValidationPipe`
  (`whitelist`, `forbidNonWhitelisted`, `transform`) already runs, so the
  existing DTOs (`RegisterDto`/`LoginDto`/`RefreshDto`) need no additional
  validation wiring.

## Problems Found

**Medium**
- `apps/server` has pre-existing, unrelated routes (`AppController`) that
  must keep working unauthenticated. Registering `JwtAuthGuard` as a
  global `APP_GUARD` from `libs/auth` would silently start requiring a
  bearer token on every existing route in the host app — a breaking
  behavior change outside this loop's scope.

## Changes Made

- Decided: `AuthController` lives inside `libs/auth`
  (`libs/auth/src/http/auth.controller.ts`), registered directly in
  `AuthModule.forRoot`/`forRootAsync`'s `controllers` array — not
  hand-written per-host in `apps/server`. `libs/auth` isn't separately
  published (see ARCH.md, Rejected Alternatives on the persistence
  adapter decision — same reasoning applies here), so a self-contained,
  batteries-included controller is simpler than asking every host to
  re-implement the same thin DTO→service translation.
- Routes: `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`
  (all `@Public()`), `POST /auth/logout`, `POST /auth/logout-all`,
  `GET /auth/me` (all `@UseGuards(JwtAuthGuard)` applied per-route, not
  globally — see Problems Found).
- Added `auth.controller.spec.ts` (6 tests).

## Why

Per-route `@UseGuards(JwtAuthGuard)` instead of a global `APP_GUARD`
keeps `libs/auth`'s footprint additive: mounting `AuthModule` never
changes the auth requirements of routes it doesn't own. A host that wants
every route protected by default can still register `JwtAuthGuard`/
`PermissionsGuard` as `APP_GUARD` itself in its own `app.module.ts` — the
guards are exported for exactly that.

## Tests

6 new tests (`auth.controller.spec.ts`). Full monorepo suite: 919 tests
passing across 112 suites (no regressions).

## Build

PASS (`nest build`, webpack compiled successfully)

## Lint

PASS

## Remaining TODO

- Same as Loop 001: password reset/email verification, admin-facing
  role/permission management, and wiring `CacheAccessTokenDenylist` for
  instant access-token revocation are all still deferred.

## Next Loop

- None queued at the time — see Loop 003, which found real issues on a
  self-review pass despite this note.

---

# Loop 003

**Library:** libs/auth
**Date:** 2026-07-19

## Goal

Self-review pass (ci.loop Phase 1–2) over the code written in Loops 001–002,
since "no meaningful improvements remain" should be verified, not assumed.

## Files Reviewed

- `libs/auth/src/application/refresh-token.service.ts` +
  `libs/auth/src/domain/refresh-token.repository.ts` (rotation/reuse path)
- `libs/auth/src/dto/register.dto.ts`, `libs/auth/src/dto/login.dto.ts`
- `libs/auth/src/adapters/cache-access-token-denylist.ts` vs.
  `libs/cache`'s `set()` ttl unit (verified consistent — both milliseconds)

## Problems Found

**Critical**
- `RefreshTokenService.rotate()` had a TOCTOU race: it read the token,
  checked `revokedAt` in application code, then issued a separate
  `update()` — two concurrent requests replaying the same refresh token
  could both pass the check before either write landed, defeating
  reuse-detection in exactly the scenario (a stolen token replayed
  alongside the legitimate rotation) it exists to catch.

**Medium**
- `RegisterDto`/`LoginDto` had no upper bound on password length.
  `argon2.hash`/`argon2.verify` cost scales with input, so an unbounded
  password is a cheap DoS lever against the auth endpoints.

## Changes Made

- Added `RefreshTokenRepository.revokeIfActive(id)`: a single atomic
  `UPDATE ... WHERE id = ? AND revokedAt IS NULL`, using TypeORM's
  `IsNull()` operator, returning whether *this* call was the one that
  revoked the row (`result.affected > 0`).
- `RefreshTokenService.rotate()` now calls `revokeIfActive` instead of an
  unconditional `update()`; `revokeIfActive` returning `false` (lost the
  race, or was already revoked) is now the single code path that triggers
  reuse-detection — replacing the old separate `if (existing.revokedAt)`
  branch, which only caught the "already known revoked" case and missed
  the concurrent-rotation race entirely.
- Added `@MaxLength(128)` to both DTOs' `password` field and
  `@MaxLength(254)` to `email` (RFC 5321 max).
- Updated `refresh-token.service.spec.ts` for the new `revokeIfActive`
  call shape; added a test asserting the race case (mock returns `false`
  with `revokedAt: null`) is treated identically to the already-known-
  revoked case.

## Why

The previous two-step check-then-write is a classic TOCTOU bug in a
security-critical path — worth fixing regardless of whether it was ever
observed in practice, since the entire point of refresh-token rotation is
to detect exactly this kind of replay. An atomic conditional `UPDATE` is
the standard fix and needs no new locking primitive or transaction scope.

## Tests

43 tests in `libs/auth` (added 1 new race-case test), all passing. Full
monorepo suite: 920 tests passing across 112 suites (no regressions).

## Build

PASS

## Lint

PASS

## Remaining TODO

- Unchanged from Loop 002: password reset/email verification, admin
  role/permission management UI, `CacheAccessTokenDenylist` wiring.

## Next Loop

- Closed by Loop 004: `CacheAccessTokenDenylist` wiring and its missing
  test coverage.

---

# Loop 004

**Library:** libs/auth
**Date:** 2026-07-19

## Goal

Close the two remaining concrete TODOs from Loops 001–003: missing test
coverage for `CacheAccessTokenDenylist`, and wiring it into
`apps/server` so logout gets instant access-token revocation instead of
relying on the no-op default's natural-expiry fallback.

## Files Reviewed

- `libs/auth/src/adapters/cache-access-token-denylist.ts` — confirmed no
  spec existed for it (a real test-coverage gap, not speculative work).
- `libs/cache/src/nest/cache.module.ts` — confirmed `CacheModule` is
  `@Global()`, so `CACHE_MANAGER` is injectable from `AuthModule` without
  `libs/auth` needing to import `CacheModule` itself.
- `apps/server/src/app.module.ts` — confirmed a `default` Redis-backed
  cache instance already exists there for exactly this kind of use.

## Problems Found

**Low**
- `CacheAccessTokenDenylist` (part of the public API surface, exported
  from the barrel) had zero test coverage.
- The host app (`apps/server`) never wired the denylist it already has
  the infrastructure for, leaving `AuthModule.forRootAsync` on the no-op
  default silently.

## Changes Made

- Added `cache-access-token-denylist.spec.ts` (5 tests: default cache
  name, ttl-from-expiry math, skip-if-already-expired, `isDenied`
  true/false).
- Wired `CacheAccessTokenDenylist` into
  `apps/server/src/app.module.ts`'s `AuthModule.forRootAsync`, injecting
  `CACHE_MANAGER` from `@/cache` alongside the existing `ConfigService`
  and passing it as `accessTokenDenylist`. Uses the `default` cache
  instance already configured for Redis — no new infra.

## Why

Both were already-designed, already-scoped follow-ups from prior loops
(not new speculative scope) — closing them removes the last known gap
between what `libs/auth` can do and what `apps/server` actually uses.
`libs/auth` itself is unchanged; only its host wiring and test coverage
grew.

## Tests

5 new tests. Full monorepo suite: 925 tests passing across 113 suites (no
regressions).

## Build

PASS

## Lint

PASS

## Remaining TODO

- Password reset/email verification and admin-facing role/permission
  management are still deferred — both still need a concrete trigger
  (an email-sending capability; an admin UI/CLI requirement) that doesn't
  exist yet in this monorepo.

## Next Loop

- Closed by Loop 005: dead `@Roles()` decorator (no consuming guard) and
  unused `AuthEnvironmentSchema` (never wired into any validation path),
  both found on request when asked "what's left" and to check `apps/server`.

---

# Loop 005

**Library:** libs/auth (+ apps/server wiring)
**Date:** 2026-07-19

## Goal

Fix two real gaps surfaced when asked to review `libs/auth` and
`apps/server` together: a decorator with no consuming guard, and a
validation schema that was written but never wired up anywhere.

## Files Reviewed

- `libs/auth/src/decorators/roles.decorator.ts` — confirmed `ROLES_KEY`
  had no reader anywhere in the codebase.
- `libs/auth/src/config/auth.schema.ts` — confirmed `AuthEnvironmentSchema`
  had zero references outside its own file.
- `apps/server/src/{app.module.ts,app.controller.ts,app.service.ts,main.ts,
  redis/ioredis-client.adapter.ts}` — reviewed the whole app for other
  auth-adjacent gaps.
- `libs/database/src/config/{mysql.loader.ts,database-config.module.ts}` —
  the sibling pattern for env validation, to decide how to wire
  `AuthEnvironmentSchema` consistently.

## Problems Found

**Medium**
- `@Roles(...)` set `ROLES_KEY` metadata that nothing read — the decorator
  compiled and appeared to work but silently had no authorization effect.
- `AuthEnvironmentSchema` (min-32-char `AUTH_JWT_SECRET`, etc.) was dead
  code — `apps/server/src/app.module.ts` read `AUTH_JWT_SECRET` via
  `ConfigService.getOrThrow` with no length/format check, so a 5-character
  secret would have been silently accepted at startup.

**Low**
- `apps/server` has no `enableShutdownHooks()`, no CORS/Helmet
  configuration. Noted but **not fixed** — pre-existing, unrelated to
  auth, and out of scope for this pass; flagging for awareness only.

## Changes Made

- Added `RolesGuard` (`libs/auth/src/guards/roles.guard.ts`, fail-closed,
  mirrors `PermissionsGuard`) + `InsufficientRoleError`; registered in
  `AuthModule`'s providers/exports; added `roles.guard.spec.ts` (3 tests).
- `apps/server/src/app.module.ts`: added `validateAuthEnvironment()`,
  which runs `AuthEnvironmentSchema` through `plainToInstance`/
  `validateSync` (same shape as `libs/database`'s `mysql.loader.ts`) before
  extracting `AUTH_JWT_SECRET`/TTLs — the app now fails fast at startup on
  a missing or too-short secret instead of accepting it silently.
  `AuthModuleOptions` still comes from a host-supplied `forRootAsync`
  factory (matching `libs/cache`/`libs/queue`'s pattern) rather than
  `libs/auth` owning its own `ConfigModule.forFeature` loader like
  `libs/database` does — deliberately not copying that heavier pattern
  for a single secret + two optional TTLs.
- Added `auth.schema.spec.ts` (4 tests) covering: valid env passes and
  coerces TTL strings to numbers, optional TTLs absent still passes, too-
  short secret rejected, missing secret rejected.

## Why

Both were genuine defects, not stylistic nits: one was a security control
that looked wired up but wasn't (`@Roles()`), the other was a validation
rule that existed in source but was never executed (`AuthEnvironmentSchema`).
Neither required new design decisions — both closed by connecting existing
code to where it was always supposed to plug in.

## Tests

7 new tests. Full monorepo suite: 932 tests passing across 115 suites (no
regressions).

## Build

PASS

## Lint

PASS

## Remaining TODO

- Unchanged: password reset/email verification, admin-facing role/
  permission management UI.
- Noted, not fixed: `apps/server` has no graceful shutdown hooks, CORS, or
  Helmet configuration — pre-existing and orthogonal to `libs/auth`.

## Next Loop

- Closed by Loop 006: real-database integration coverage (everything
  before this was mocked).

---

# Loop 006

**Library:** libs/auth
**Date:** 2026-07-19

## Goal

Close a verification gap: every test up to this point mocked
`UserRepository`/`RoleRepository`/`RefreshTokenRepository`, so nothing had
actually exercised TypeORM's many-to-many RBAC persistence or the atomic
`revokeIfActive` conditional `UPDATE` (added in Loop 003 specifically to
fix a race) against a real database engine. Docker wasn't available in
this environment to test against real MySQL, so this uses the same
`better-sqlite3` in-memory pattern already established in
`libs/workflow`/`libs/database` for exactly this purpose.

## Files Reviewed

- `libs/workflow/src/testing/typeorm-test-datasource.ts` and
  `.../1752000000000-InitialWorkflowSchema.migration.spec.ts` — the
  existing sqlite-migration-integration-test pattern.
- `libs/database/src/transaction/transaction-hooks.integration.spec.ts` —
  pattern for wrapping a real `DataSource` in a minimal fake
  `DataSourceManager` to exercise `RepositoryResolver`/`BaseRepository`
  for real, without a full Nest DI bootstrap.
- `libs/database/src/repository/repository-resolver.ts` +
  `datasource.manager.ts` — confirmed which three methods
  (`manager`/`dataSource`/`repository`) the happy path actually calls, so
  the fake only needs to implement those.

## Problems Found

None — this loop added coverage, it didn't find a bug. (Loop 003's
`revokeIfActive` fix is now verified against a real conditional `UPDATE`
execution, not just a mocked return value, and it holds.)

## Changes Made

- `persistence/migrations/1753000000000-InitialAuthSchema.migration.spec.ts`:
  runs the real migration against sqlite, verifies all 6 tables
  (including both join tables) are created, round-trips a
  user+role+permission+refresh-token through the actual migrated schema,
  then verifies `down()` drops everything.
- `auth.integration.spec.ts`: constructs a real `RepositoryResolver` over
  a real in-memory `DataSource`, real `UserRepository`/`RoleRepository`/
  `RefreshTokenRepository`, and real `AuthService`/`AuthorizationService`/
  `TokenService`/`RefreshTokenService` (real `argon2`, real signed JWTs) —
  no mocks. Covers: register→login→real-signed-token, wrong-password
  rejection against a real hash, `AuthorizationService.assignRole`
  reflected through a real many-to-many reload, and the full
  rotate-once/reject-reuse/whole-family-revoked sequence end to end.
- Avoided reaching into `libs/database`'s internals for the fake: since
  `DataSourceManager` isn't exported from `@/database`'s barrel (correctly
  — it's not part of the public API), used
  `ConstructorParameters<typeof RepositoryResolver>[0]` to get the
  parameter type without an internal import.

## Why

Mocked unit tests can make a broken atomic-update assumption look correct
(a mock returns whatever you tell it to). The two things this loop
targeted — many-to-many RBAC persistence and the reuse-detection race fix
— are exactly the kind of logic where "the mock says it works" and "it
actually works against the real query planner" can diverge. Running it
for real removes that risk without needing Docker/MySQL, since TypeORM's
migration/entity code is dialect-abstracted.

## Tests

6 new tests (1 migration spec, 5 integration spec). Full monorepo suite:
938 tests passing across 117 suites (no regressions).

## Build

PASS

## Lint

PASS

## Remaining TODO

- Unchanged: password reset/email verification, admin-facing role/
  permission management UI, `apps/server` shutdown-hooks/CORS/Helmet
  (noted, out of scope).
- This loop used sqlite as a MySQL stand-in (dialect-abstracted via
  TypeORM). If a MySQL-specific behavior ever matters (e.g. collation-
  sensitive unique constraints on `email`), verify against real MySQL via
  `make compose-up` — not yet done in this environment since Docker
  wasn't running.

## Next Loop

- Closed by Loop 007: Docker became available, so the real-MySQL/Redis/
  RabbitMQ verification flagged as outstanding was actually done — and
  found two real bugs neither mocks nor sqlite integration tests caught.

---

# Loop 007

**Library:** libs/auth (+ apps/server wiring)
**Date:** 2026-07-19

## Goal

Docker became available mid-session (it wasn't in Loop 006). Follow
through on Loop 006's open item: verify `libs/auth` against real MySQL/
Redis/RabbitMQ via `make compose-up`, and actually exercise the live HTTP
endpoints end to end — not just unit/sqlite-integration tests.

## Files Reviewed

- Booted `apps/server` for real (`nest start server`) against
  docker-composed MySQL/Redis/RabbitMQ.
- Full HTTP walkthrough via `curl` against every `/auth/*` route:
  register, login, `/auth/me` (with/without token), refresh, refresh-
  token reuse (both the stolen token and the one that replaced it),
  duplicate registration, wrong password, logout, and post-logout access-
  token rejection via the real Redis-backed denylist.

## Problems Found

**Critical**
1. **`AuthModule` failed to boot at all.**
   `UnknownDependenciesException`: `JwtModule.registerAsync({ inject:
   [AUTH_MODULE_OPTIONS] })` was declared as a nested `imports` entry
   inside `AuthModule`, but `AUTH_MODULE_OPTIONS` was a provider on
   `AuthModule` itself. A dynamic module can't inject a token from its
   *parent* module's own `providers` array — only from its own providers,
   modules it explicitly imports, or `@Global()` modules. This was
   invisible to every unit test because none of them went through real
   Nest module resolution (services were constructed directly with `new
   Xxx(...)`), and invisible to the sqlite integration test because that
   test also builds services directly rather than booting `AuthModule`.

2. **`POST /auth/register` returned 500 against real MySQL.**
   `QueryFailedError: Field 'createdAt' doesn't have a default value`.
   `UserEntity.createdAt`/`updatedAt` use `@CreateDateColumn`/
   `@UpdateDateColumn`, which TypeORM expects to have a DB-level default
   so a bare `.save()` (no explicit timestamp) works — but the hand-
   written migration defined those columns with no default at all. The
   sqlite integration test (Loop 006) used `synchronize: true`, which
   derives the schema straight from the entity decorators, so the
   migration's own drift from the entity was invisible there.

## Changes Made

1. Added `libs/auth/src/auth-config.module.ts`: a separate `@Global()`
   `AuthConfigModule` that owns the `AUTH_MODULE_OPTIONS` provider
   (`forRoot`/`forRootAsync`, moved the `createAsyncOptionsProviders`
   logic here from `AuthModule`). `AuthModule.forRoot`/`forRootAsync` now
   import `AuthConfigModule` as a sibling of `JwtModule.register(Async)`
   instead of declaring `AUTH_MODULE_OPTIONS` inline — both `JwtModule`
   and `AuthModule`'s own providers can now see it via `@Global()`.
2. Fixed `1753000000000-InitialAuthSchema.migration.ts`: `auth_users.
   createdAt` now has `default: 'CURRENT_TIMESTAMP'`; `updatedAt` has
   `default: 'CURRENT_TIMESTAMP'` + `onUpdate: 'CURRENT_TIMESTAMP'` —
   matching what `@CreateDateColumn`/`@UpdateDateColumn` actually need at
   the DB level. (No down-migration in production yet — this is the
   initial schema, so the fix is to the not-yet-shipped migration itself,
   not a new migration on top.)
3. Recreated the local MySQL volume (`docker compose down -v` +
   `make compose-up`) since the buggy migration had already run once
   against it; re-verified clean.

## Why

Both bugs are the exact class of thing mocked unit tests and even a
sqlite-with-`synchronize:true` integration test structurally cannot catch:
(1) is a real Nest DI *module-graph* wiring bug, invisible unless Nest
actually resolves the dependency graph; (2) is a *migration-vs-entity
drift* bug, invisible unless something runs the literal migration SQL
against a database that enforces column defaults the way MySQL does
(sqlite's `synchronize: true` sidesteps migrations entirely). This is why
Loop 006's note ("verify against real MySQL... not yet done") mattered —
the gap was real, not hypothetical.

## Tests

No new automated tests this loop (this was live/manual HTTP verification,
not something naturally expressed as a unit test — the bug was "does the
app boot and serve traffic at all"). Full monorepo suite re-run after the
fix: 938 tests passing across 117 suites, still no regressions.

## Build

PASS

## Lint

PASS

## Live verification performed (via curl against real infra)

- Register → 201-equivalent, returns only `{id, email}` (no hash leak).
- Login → real signed JWT (3-part), real opaque refresh token.
- `/auth/me` with valid token → 200 with decoded claims;
  without token → 401.
- Refresh → rotates successfully; reusing the old (already-rotated) token
  → 401 "reuse detected"; the token that *replaced* it is also dead
  (whole family revoked) → 401. Confirms Loop 003's atomic-revoke fix
  holds under a real MySQL conditional `UPDATE`, not just sqlite.
- Duplicate registration → 409. Wrong password → 401.
- Logout → 204; the same still-unexpired access token is rejected
  immediately afterward (401 "revoked") — confirmed the
  `CacheAccessTokenDenylist` key actually lands in real Redis
  (`app:auth:denylist:<jti>`, `app:` from the host's cache namespace).

## Remaining TODO

- Unchanged: password reset/email verification, admin-facing role/
  permission management UI, `apps/server` shutdown-hooks/CORS/Helmet.

## Next Loop

- None queued. `libs/auth` has now been verified at every level this
  protocol distinguishes: unit (mocked), integration (sqlite, real
  repositories/services), and live (real MySQL/Redis/RabbitMQ, real HTTP).
  Next work should come from a concrete new requirement.

---

# Loop 008

**Library:** libs/auth
**Date:** 2026-07-19

## Goal

Concrete new requirement: expose `AuthorizationService`'s RBAC operations
over HTTP. Previously the biggest usable-today gap — `assignRole`/
`hasPermission` existed but had zero HTTP surface, so nothing outside a
direct service call could actually manage roles.

## Files Reviewed

- `guards/permissions.guard.ts` / `guards/roles.guard.ts` — found they
  checked the `permissions`/`roles` claims embedded in the access token at
  login time, not a live DB read via `AuthorizationService`.
- `libs/auth/ARCH.md`, Key Decisions MEDIUM #2 — the design already
  stated the intended rationale for RBAC as plain entities instead of
  JWT claims: "keeps permission changes effective immediately (a
  JWT-embedded claim would be stale until the token's next refresh)."
  The guards just hadn't been wired to match that intent.

## Problems Found

**High**
- `PermissionsGuard`/`RolesGuard` trusted the JWT's embedded
  `permissions`/`roles` claims rather than calling
  `AuthorizationService.hasPermission`/(new) `hasRole`. This meant a role
  or permission granted after a user's last login/refresh had **no
  effect** until they got a new token — directly contradicting
  `ARCH.md`'s own stated design rationale, and something that would have
  made the new RBAC management endpoints confusing in practice ("I
  granted the role, why is it still 403?").

## Changes Made

1. Added `PermissionRepository` (`domain/permission.repository.ts`,
   `findByName`/`findByNames`).
2. Extended `AuthorizationService`: `createPermission`, `createRole`
   (validates every referenced permission exists first),
   `listRoles`, `revokeRole`, `hasRole` — alongside the existing
   `assignRole`/`hasPermission`/`assertPermission`. `assignRole`/
   `revokeRole` now throw `UserNotFoundError`/`RoleNotFoundError`
   instead of silently no-op'ing on an unknown user/role (silent success
   is misleading for an HTTP-exposed operation).
3. Fixed `PermissionsGuard`/`RolesGuard` to call
   `AuthorizationService.hasPermission`/`hasRole` (a live DB read) per
   request, instead of trusting the token's embedded claims. The token
   still carries `roles`/`permissions` for display purposes (`/auth/me`),
   but they are no longer the authorization source of truth.
4. Added `RoleController` (`POST /auth/permissions`, `POST /auth/roles`,
   `GET /auth/roles`, `POST`/`DELETE /auth/users/:userId/roles/:roleName`),
   every route gated by `@Permissions('roles:manage')`.
5. Added migration `1753100000000-SeedRolesManagePermission`: seeds the
   `roles:manage` permission and an `admin` role granting it.
   Deliberately does **not** auto-assign `admin` to anyone (e.g. "first
   registered user becomes admin") — that would be a real security
   decision made silently. Bootstrapping the first admin is a documented
   manual/ops step (direct SQL or `AuthorizationService.assignRole`).
6. New error types: `RoleAlreadyExistsError`, `PermissionAlreadyExistsError`,
   `PermissionNotFoundError`, `RoleNotFoundError`, `UserNotFoundError`.
7. New DTOs: `CreateRoleDto`, `CreatePermissionDto`,
   `RoleResponseDto`, `PermissionResponseDto` (with Swagger annotations,
   consistent with the existing `AuthController` DTOs).

## Why

See Problems Found — the guard fix isn't new scope, it's making the code
match a decision `ARCH.md` already made. The bootstrap-via-migration
(not auto-admin) choice follows the same "no silent security decisions"
principle applied throughout this library (e.g. `ACCESS_TOKEN_DENYLIST`'s
explicit no-op default, refresh-token reuse detection).

## Tests

15 new/changed tests (`authorization.service.spec.ts` expanded to 19
cases, `permissions.guard.spec.ts`/`roles.guard.spec.ts` rewritten for
live checks, new `role.controller.spec.ts`, `auth.integration.spec.ts`
gained a full create-permission→create-role→assign→check→revoke case
against real sqlite tables). Full monorepo suite: 958 tests passing
across 118 suites, no regressions.

## Build

PASS

## Lint

PASS

## Live verification performed (real MySQL/Redis/RabbitMQ)

- Confirmed the seed migration ran and `roles:manage`/`admin` exist in
  real MySQL after a fresh boot.
- Registered an admin user, manually bootstrapped it via direct SQL
  (the documented ops step), logged in, and drove the entire RBAC surface
  live: `GET /auth/roles`, `POST /auth/permissions` (+ 409 on duplicate),
  `POST /auth/roles` (+ 400 on a role referencing an unknown permission),
  `POST`/`DELETE /auth/users/:userId/roles/:roleName` (+ 404 on an
  unknown role), unauthenticated access (401).
- **The decisive test**: logged in a second user with no role (JWT
  `permissions` claim `[]`), confirmed `GET /auth/roles` was 403 for
  them, then — using the *admin's* session — granted that exact user the
  `admin` role, and replayed the *same, already-issued, untouched* first
  user's access token against `GET /auth/roles` again: 200, immediately.
  Then revoked the role and replayed the same old token once more: back
  to 403, immediately. Confirms the guard fix actually delivers "changes
  effective immediately" rather than just compiling.

## Remaining TODO

- Unchanged: password reset/email verification, `apps/server`
  shutdown-hooks/CORS/Helmet (noted, out of scope).
- No endpoint to delete a role/permission or list a single user's roles —
  kept the surface to what's needed for management, not full CRUD; add if
  a concrete need for deletion/listing-by-user shows up.

## Next Loop

- None queued. Next work should come from a concrete new requirement.

---

# Loop 009

**Library:** libs/auth
**Date:** 2026-07-20

## Goal

Concrete new requirement (user's explicit request): express role/permission-name uniqueness as an
async `Specification` (from `@/validation`) instead of the inline
`if (await repo.findByName(name)) throw ...` checks in `AuthorizationService`. See `ARCH.md`
Design 002.

## Files Reviewed

- `application/authorization.service.ts` — the two inline uniqueness checks (`createPermission`,
  `createRole`).
- `ARCH.md`'s "Engines / Policies / Specifications" section (Design 001) — confirmed this refactor
  does not reopen the generic-ABAC-engine rejection there: reusing `@/validation`'s existing
  `Specification` interface for two narrow, already-existing checks is not "a rule engine."

## Problems Found

**Critical / High / Medium / Low**
- None — this loop only restates existing logic through a different, explicitly requested shape.
  Per Section 18, this would not have been picked up as an unprompted refactor (the inline checks
  already satisfied readability/maintainability/correctness).

## Changes Made

- Added `libs/auth/src/specifications/unique-role-name.specification.ts` and
  `unique-permission-name.specification.ts` — each implements `Specification<string>` from
  `@/validation`, wrapping the same `repo.findByName` call the inline checks used.
- `AuthorizationService.createPermission`/`createRole` now construct the relevant Specification
  and call `isSatisfiedBy` instead of checking `findByName` directly. Same repository calls, same
  thrown errors (`PermissionAlreadyExistsError`/`RoleAlreadyExistsError`) — behavior unchanged.
- Appended Design 002 to `ARCH.md`, documenting the new `@/validation` dependency (direct, like
  `@/database` — not a port like `@/cache`/`@/queue`).

## Why

- Explicit user request, not a discovered defect — `ARCH.md` Design 002's goal section says so
  directly, and Section 18 backs treating an already-correct inline check as a stated-preference
  change rather than a bug fix.

## Tests

4 new tests (one spec file per Specification). Full repo suite: 130 suites / 1014 tests passing;
existing `authorization.service.spec.ts` passed unmodified, confirming behavior parity.

## Build

PASS

## Lint

PASS

## Remaining TODO

- Unchanged from Loop 008.

## Next Loop

- None queued.

---

# Loop 010

**Library:** libs/auth
**Date:** 2026-07-20

## Goal

Close a gap surfaced during `libs/validation`'s live-testing loop: there was no way to grant an
existing permission to an existing role over HTTP — only `createRole` grants permissions, and
only at creation time. Raw SQL was needed during that verification pass.

## Files Reviewed

- `application/authorization.service.ts`'s `assignRole`/`revokeRole` (the pattern to mirror for
  the role↔user relation, applied here to the role↔permission relation).
- `errors/role-not-found.error.ts` (`NotFoundException`, 404) vs
  `errors/permission-not-found.error.ts` (`BadRequestException`, 400) — confirmed these are
  already different status codes for different reasons (missing role = 404 resource-not-found;
  referencing a permission that doesn't exist = 400 bad client reference, same semantics
  `createRole` already uses for its "unknown permission in the list" case).

## Problems Found

**Critical / High**
- (none)

**Medium**
- First draft of the new endpoints' Swagger annotations claimed `404` for both the
  "role not found" and "permission not found" cases. Live-tested against the real server and
  found the permission-not-found path actually returns `400` (inherited from the existing
  `PermissionNotFoundError extends BadRequestException`) — corrected the annotations to two
  separate `@ApiResponse` entries with accurate codes, rather than leave inaccurate docs.

**Low**
- (none)

## Changes Made

- `AuthorizationService.grantPermission(roleName, permissionName)` /
  `revokePermission(roleName, permissionName)` — same shape as `assignRole`/`revokeRole`:
  `RoleNotFoundError` (404) if the role doesn't exist, `PermissionNotFoundError` (400) if the
  permission doesn't exist, no-op-and-return-unchanged if granting a permission the role already
  has, `roles.save({ id, permissions: [...] })` otherwise (identical partial-save pattern to how
  `assignRole` updates `user.roles`).
- `RoleController`: `POST /auth/roles/:roleName/permissions/:permissionName` (grant),
  `DELETE /auth/roles/:roleName/permissions/:permissionName` (revoke) — both return the updated
  `RoleResponseDto`, guarded the same as every other route on this controller
  (`roles:manage`).

## Why

- User asked to complete this specific open item, flagged during the prior loop's live-testing
  pass as something that required a manual SQL workaround.

## Tests

9 new tests (4 service-level in `authorization.service.spec.ts`, 2 controller-delegation in
`role.controller.spec.ts`, covering grant/revoke/no-op/unknown-role/unknown-permission).

## Live verification performed (real MySQL/Redis/RabbitMQ)

- Registered a user, bootstrapped `admin` via SQL, logged in, created a `viewer` role and a
  `workflow:read` permission via existing endpoints.
- `POST .../permissions/workflow:read` → granted, returned the role with the permission attached.
- Repeated the same grant → no-op, same response, confirmed via `roles.save` not being called at
  the service level too.
- `POST` against an unknown role → `404`. `POST` against an unknown permission → `400` (this is
  where the Swagger annotation inaccuracy above was caught).
- `DELETE .../permissions/workflow:read` → revoked, returned the role with an empty
  `permissions` array.
- Cleaned up all test data (role, permission, user, grants) after verification.

## Build

PASS

## Lint

PASS

## Remaining TODO

- Unchanged from Loop 008.

## Next Loop

- None forced.

---

# Loop 011

**Library:** libs/auth
**Date:** 2026-07-20

## Goal

Investigate whether the `Specification` pattern (Loop 009) should extend to other ad hoc checks
in `libs/auth`, per the user's request to complete open items.

## Files Reviewed

- `application/auth.service.ts`, `application/authorization.service.ts`,
  `application/refresh-token.service.ts` — every `if (await ...)` / existence-check call site.

## Problems Found

None — this was an investigation, not a review pass.

## Changes Made

- `specifications/unique-email.specification.ts`: new — `UniqueEmailSpecification`, same shape
  as `UniqueRoleNameSpecification`/`UniquePermissionNameSpecification`.
- `AuthService.register` now uses it instead of `if (await this.users.findByEmail(email))`.
- Documented as an addendum to `ARCH.md` Design 002 rather than a new Design entry — it's the
  same decision applied to a third call site, not a new decision.

## Why

- `AuthService.register`'s email-uniqueness check is structurally identical to the two checks
  already converted: "does a row with this identity not already exist." Everything else
  considered and rejected as a poor fit:
  - `assignRole`/`revokeRole`/`grantPermission`'s "already has this role/permission" checks are
    in-memory `.some()` calls on an already-loaded array — no repository call to wrap, and
    already about as simple as they can be.
  - `refresh-token.service.ts`'s checks are expiry/state-transition logic on an already-fetched
    entity (`expiresAt < now`, `revokedAt !== null`), not identity-existence checks — a different
    shape entirely.

## Tests

2 new tests (`unique-email.specification.spec.ts`). Full repo suite: 132 suites / 1034 tests
passing; existing `auth.service.spec.ts` passed unmodified, confirming behavior parity.

## Live verification performed (real MySQL/Redis/RabbitMQ)

- `POST /auth/register` with a fresh email → `201`.
- Same email again → `409 Conflict`, unchanged from before this refactor.

## Build

PASS

## Lint

PASS

## Remaining TODO

- Unchanged from Loop 008.

## Next Loop

- None forced. No further Specification-shaped candidates remain in `libs/auth` as of this pass.

---

# Loop 012

**Library:** libs/auth

**Date:** 2026-07-21

## Goal

Fresh, adversarial Phase 1/2 review of `libs/auth` after 11 prior loops (per ci.loop, no rubber-
stamping "nothing found" without actually re-reading the security-critical paths: authz
boundaries, token handling, password/secret handling, sensitive-data logging).

## Files Reviewed

- `application/{auth.service,token.service,refresh-token.service,authorization.service}.ts`
- `guards/{jwt-auth.guard,permissions.guard,roles.guard}.ts`
- `http/{auth.controller,role.controller}.ts` + their specs
- `domain/{user.entity,role.entity,refresh-token.entity,user.repository,role.repository,
  refresh-token.repository}.ts`
- `adapters/{argon2-password-hasher,cache-access-token-denylist}.ts`
- `auth.module.ts`, `auth-config.module.ts`, `config/auth.schema.ts`
- `dto/{login.dto,register.dto,refresh.dto,authenticated-user-response.dto}.ts`
- `index.ts` (public barrel), `apps/server/src/main.ts` (body-size/helmet/CORS context)

## Problems Found

**Critical**
- None.

**High**
- None.

**Medium**
- `RefreshTokenEntity.createdByIp`/`userAgent` are fully modeled end-to-end (migration column,
  `RefreshTokenMetadata` parameter threaded through `RefreshTokenService.issue`/`rotate`) but the
  only production caller — `AuthController.login`/`refresh` — never supplied them. Every stored
  refresh-token row therefore had `createdByIp = NULL`, `userAgent = NULL` in practice, silently
  defeating the forensic purpose these columns exist for (ARCH.md's Domain Model section: tracing
  a rotation chain / spotting a stolen refresh token replayed from an unfamiliar device or IP).
  This is a real gap between designed capability and delivered behavior, not a cosmetic nit — it
  directly weakens investigation of exactly the reuse-detection scenario Loop 003/007 hardened.

**Low**
- `RefreshDto.refreshToken` had no `@MaxLength`, unlike `LoginDto`/`RegisterDto`'s password fields
  (bounded in Loop 003 specifically to avoid an unbounded-input DoS lever against a public,
  unauthenticated endpoint). `POST /auth/refresh` is `@Public()` and hashes the input with SHA-256
  before any length check — cheap per byte, but still inconsistent with the established pattern of
  bounding every public-endpoint string input. Express's default body-size limit already bounds the
  worst case, so this was Low, not Medium/High, but fit the same fix pattern as the earlier one.

Everything else re-checked and found already correct, not re-litigated: `PermissionsGuard`/
`RolesGuard` do live DB reads (not stale JWT claims, confirmed against Loop 008's fix);
`revokeIfActive`'s atomic conditional `UPDATE` still holds (Loop 003/007); passwords/tokens are
never logged; `argon2id` hashing and SHA-256-only-persisted refresh tokens are unchanged;
`@Public()`/guard wiring is fail-closed; RBAC management routes are still gated behind
`roles:manage` with no auto-admin bootstrap; module DI wiring (`AuthConfigModule` sidestepping the
parent-can't-inject-into-child-import Nest limitation) is unchanged and correct.

## Changes Made

- `libs/auth/src/http/auth.controller.ts`: `login`/`refresh` now accept `@Ip()` and
  `@Headers('user-agent')` and forward them as `RefreshTokenMetadata` to `AuthService.login`/
  `refresh`, via a small private `metadata()` helper (built to satisfy `exactOptionalPropertyTypes`
  — omits `userAgent` entirely rather than assigning it `undefined`).
- `libs/auth/src/dto/refresh.dto.ts`: added `@MaxLength(512)` to `refreshToken` (actual issued
  tokens are 96 hex chars; 512 leaves headroom without being unbounded).
- `libs/auth/src/http/auth.controller.spec.ts`: updated the `login`/`refresh` delegation tests to
  assert the new IP/user-agent arguments and the resulting `RefreshTokenMetadata` passed to
  `AuthService`.

## Why

Both changes connect already-designed, already-built code to where it was always supposed to plug
in (same category as Loop 005's `@Roles()`/`AuthEnvironmentSchema` fixes) rather than introducing
new scope — `RefreshTokenMetadata` and its DTO/entity/migration support already existed; only the
one real caller wiring it was missing. No public API shape changed (`AuthController`'s route
signatures, request/response DTOs, and `RefreshTokenMetadata`'s own shape are unchanged) and no
new dependency was introduced — `@Ip()`/`@Headers()` are existing `@nestjs/common` decorators
already usable in this Express-based app.

## Tests

Updated 2 existing tests in `auth.controller.spec.ts` (no new test files needed — the change is a
controller wiring fix, not new branching logic). `libs/auth`: 95/95 tests passing across 17 suites.
Full monorepo suite: 1040/1040 tests passing across 133 suites (no regressions). (One-time
environment fix along the way, unrelated to the code change: `better-sqlite3`'s native binding was
built against a different Node version than the one running tests; `npm rebuild better-sqlite3`
resolved it before any test ran — flagging in case a fresh checkout hits the same thing.)

## Build

PASS (`npm run typecheck` — `tsc --noEmit` clean)

## Lint

PASS (`npm run lint`, auto-fixed formatting only)

## Remaining TODO

- Unchanged from Loop 008: password reset/email verification and `apps/server` shutdown-hooks/
  CORS/Helmet status (helmet/CORS/shutdown hooks are in fact now present in `apps/server/src/
  main.ts` as of this pass — worth a follow-up loop closing that stale TODO line explicitly, but
  out of scope to touch here since it's outside `libs/auth`).
- No endpoint to delete a role/permission or list a single user's roles (unchanged from Loop 008).

## Next Loop

- None forced. If a future loop revisits `apps/server`, confirm/close the stale "no shutdown
  hooks/CORS/Helmet" TODO line noted above — it appears to already be resolved outside this
  library's scope.
