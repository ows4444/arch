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

- None queued. Next work should come from a concrete new requirement.
