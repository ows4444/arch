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

---

# Loop 013

**Library:** libs/auth
**Date:** 2026-07-22

## Goal

Close two product-scope gaps carried since Loop 008: no endpoint to delete a role/permission, and
no endpoint to list a single user's roles. Direct user request.

## Files Reviewed

- `application/authorization.service.ts`
- `http/role.controller.ts`
- `persistence/migrations/1753000000000-InitialAuthSchema.migration.ts` (confirmed
  `auth_role_permissions`/`auth_user_roles`'s foreign keys already declare `onDelete: 'CASCADE'`
  on `roleId`/`permissionId` — a deliberate schema choice already in place, not something this
  loop needed to add)
- `domain/role.repository.ts`, `domain/permission.repository.ts`, `libs/database`'s
  `BaseRepository.delete` (confirmed the generic `delete(where)` method already exists — no new
  repository method needed)

## Problems Found

**Medium**
- (the two gaps named above — product-scope omissions, not defects; closing per direct request)

## Changes Made

- `authorization.service.ts`: added `listUserRoles(userId)` (throws `UserNotFoundError` if the
  user doesn't exist, otherwise returns `user.roles`), `deleteRole(roleName)` and
  `deletePermission(permissionName)` (both throw their existing `*NotFoundError` if the target
  doesn't exist, otherwise delegate to `BaseRepository.delete({ id })`).
- `role.controller.ts`: three new routes — `DELETE /auth/roles/:roleName`,
  `DELETE /auth/permissions/:permissionName`, `GET /auth/users/:userId/roles` — all gated behind
  the same `roles:manage` permission as every other route in this controller. The two delete
  routes' Swagger descriptions call out the cascade behavior explicitly (see Why).
- Added tests: 6 new `AuthorizationService` tests (`listUserRoles` happy path + not-found,
  `deleteRole` happy path + not-found, `deletePermission` happy path + not-found) and 3 new
  `RoleController` delegation tests.

## Why

- Deletion relies on the join tables' pre-existing `onDelete: 'CASCADE'` rather than adding an
  "in use" guard: the schema was already deliberately built to allow cascading cleanup on delete
  (confirmed in the original migration, not something added this loop), so blocking deletion while
  a role/permission is still assigned would fight an existing, intentional design decision rather
  than respect it. Documented the cascade behavior in each endpoint's Swagger description so it's
  not a silent surprise to API consumers (deleting a role in active use does revoke it from every
  holder, immediately).
- `deletePermission`'s not-found response stays 400 (`PermissionNotFoundError`, matching
  `grantPermission`/`revokePermission`'s existing convention for this exact error) rather than 404,
  for consistency with the sibling permission-reference endpoints already in this controller —
  `RoleNotFoundError` (404) and `UserNotFoundError` were left as their existing status codes.
- No new repository method was needed — `BaseRepository.delete(where)` already covers this; the fix
  is purely at the service/controller layer.

## Tests

`libs/auth` suite: 17 suites / 104 tests (up from 95). Full monorepo suite: 135 suites / 1069
tests, all passing.

## Build

PASS (`npm run typecheck`; also explicitly verified `npx nest build server` and
`npx nest build worker` both compile clean)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- Password reset / email verification still unbuilt (unchanged — a larger feature, not attempted
  this loop).

## Next Loop

- No Critical/High findings remain open. This closes the role/permission-delete and
  list-user-roles gaps named since Loop 008 — next loop would be password reset/email
  verification (if prioritized) or a fresh Phase 1/2 pass if none of that is in scope yet.

---

# Loop 014

**Library:** libs/auth
**Date:** 2026-07-22

## Goal

Build password reset and email verification — the last product-scope gap named since Loop 008.
Direct user request.

## Files Reviewed

- `domain/user.entity.ts` — confirmed `emailVerifiedAt`/`UserStatus.UNVERIFIED` already existed in
  the domain model but were never wired to anything (`register()` set every user `ACTIVE`
  immediately).
- `application/refresh-token.service.ts` / `domain/refresh-token.{entity,repository}.ts` — the
  hashed-single-use-token pattern (raw token to the caller, sha256 hash persisted, atomic
  compare-and-consume) this loop's new tokens reuse directly.
- `ports/auth-event-publisher.interface.ts` / `adapters/noop-auth-event-publisher.ts` — the
  existing "cross-cutting DI token with a no-op default" pattern; confirmed no custom
  `AuthEventPublisher` implementation exists anywhere in `apps/server` today (only the no-op), and
  that `libs/auth` (unlike `libs/workflow`) has no separate `package.json` — it isn't a
  semver-sensitive external package, so adding required interface methods here doesn't risk
  breaking an external consumer the way it would for `libs/workflow`'s `WorkflowMetrics`.
- `persistence/migrations/1753000000000-InitialAuthSchema.migration.ts` — confirmed
  `auth_refresh_tokens.userId` has no FK constraint (just an indexed column), the pattern the new
  `auth_tokens` table follows.
- `application/auth.service.ts`, `http/auth.controller.ts`, `auth.module.ts` — the existing
  register/login/DTO/module-wiring conventions this loop's additions had to slot into.

## Problems Found

**Medium**
- (the gap named above — a product-scope omission, not a defect; the domain model had already
  anticipated it)

## Changes Made

- **New `auth_tokens` table** (`domain/auth-token.entity.ts`,
  `domain/auth-token-purpose.enum.ts`, `domain/auth-token.repository.ts`, migration
  `1753200000000-AuthTokens`): one table backs both password reset and email verification (a
  `purpose` column distinguishes them) rather than duplicating an identical schema twice — see the
  entity's own doc comment for why. `AuthTokenRepository` mirrors `RefreshTokenRepository`'s
  `findActiveByHash`/atomic `markUsedIfActive`/`invalidateActiveForUser` shape.
- **`EmailVerificationService`** (new): `issue(userId, email)` (invalidate-then-issue-then-publish,
  shared by both registration and resend), `requestVerification(email)` (silent no-op for unknown
  email or a user that isn't currently `UNVERIFIED`), `confirm(rawToken)` (activates the user,
  stamps `emailVerifiedAt`).
- **`PasswordResetService`** (new): `requestReset(email)` (silent no-op for unknown email — never
  reveals account existence), `confirmReset(rawToken, newPassword)` (rehashes the password,
  consumes the token, **revokes every existing refresh token for the user** — a password reset is
  exactly the moment a possibly-compromised session should be forced to re-authenticate, same
  reasoning `AuthService.logoutAll` already exists for — and publishes the existing
  `PasswordChangedEvent`).
- **`AuthService.register()`**: now persists `status: UserStatus.UNVERIFIED` (was `ACTIVE`) and
  calls `emailVerification.issue(user.id, user.email)` right after creating the user.
- **`AuthService.login()`**: now throws the new `EmailNotVerifiedError` for `UNVERIFIED` status,
  checked before the existing `AccountDisabledError` check (kept distinct from "disabled" — a
  different, actionable condition).
- **`AuthEventPublisher`**: two new required methods, `publishPasswordResetRequested`/
  `publishEmailVerificationRequested` — both carry the *raw* token (not the hash), since libs/auth
  has no email-sending capability of its own; the host app's real publisher is what actually
  emails the link, using the raw token, before it's ever persisted only as a hash.
  `NoopAuthEventPublisher` implements both as no-ops.
- **Four new `AuthController` routes** (all `@Public()`, always `204` regardless of outcome for
  the two "request" endpoints so the response never leaks account existence/state):
  `POST /auth/password-reset/request`, `POST /auth/password-reset/confirm`,
  `POST /auth/email-verification/request`, `POST /auth/email-verification/confirm`.
- New DTOs (`RequestPasswordResetDto`, `ConfirmPasswordResetDto`,
  `RequestEmailVerificationDto`, `ConfirmEmailVerificationDto`) and new errors
  (`PasswordResetTokenInvalidError`, `EmailVerificationTokenInvalidError`,
  `EmailNotVerifiedError`), following this library's existing DTO/error conventions.
- `auth.constants.ts`/`auth.types.ts`: `DEFAULT_PASSWORD_RESET_TOKEN_TTL_SECONDS` (1 hour),
  `DEFAULT_EMAIL_VERIFICATION_TOKEN_TTL_SECONDS` (24 hours), both overridable via
  `AuthModuleOptions`.
- `auth.module.ts`: registered both new services as providers/exports.
- Updated existing tests across `auth.service.spec.ts`, `refresh-token.service.spec.ts`,
  `auth.controller.spec.ts`, and `auth.integration.spec.ts` (added an `activate()` helper so
  tests unrelated to verification can bypass it) to account for the new constructor params and
  the `UNVERIFIED`-by-default registration behavior. Added dedicated unit spec files for both new
  services plus 5 new real-`DataSource` integration tests (full verify-then-login flow, rejecting
  an already-used verification token, full reset-then-relogin-then-old-sessions-revoked flow,
  rejecting an invalid reset token without touching the password, silent no-op on an unknown
  reset email).

## Why

- **Block login until verified** (rather than track-only) per direct user confirmation —
  `UserStatus.UNVERIFIED` was clearly built for this and had simply never been wired up; leaving
  it purely informational would have left the existing domain model's intent unfulfilled for no
  stated reason.
- **One `auth_tokens` table instead of two** — password-reset and email-verification tokens are
  structurally identical (single-use, hashed, expiring, scoped to a user); duplicating the schema
  would violate Section 17's "shared utilities only when justified" in the direction of *not*
  sharing something that genuinely warrants it, unlike the `retry-child`/`ignore` case in
  `libs/workflow` where forcing a shared abstraction was explicitly rejected for good reason.
- **Raw token carried in the published event, not looked up separately** — libs/auth has no
  email-sending capability and was never going to grow one in this loop (that's an app-level
  concern); the existing "DI token + no-op default, host supplies the real implementation" pattern
  already used for `AuthEventPublisher` was the natural fit, so this loop extended that interface
  rather than inventing a parallel "email sender" port.
- **Password reset revokes every session** — matches the security reasoning already established
  for `logoutAll`; leaving old sessions alive after a reset would undermine the point of resetting
  a possibly-compromised password.
- **Required (not optional) new `AuthEventPublisher` methods** — confirmed `libs/auth` has no
  separate `package.json` (unlike `libs/workflow`), so it isn't a semver-sensitive external
  package; no host code currently implements this interface directly (only the no-op), so a
  required-method addition is safe within this repo and keeps the interface uniform (no
  precedent here yet for a mixed required/optional interface, unlike `libs/workflow`'s
  `WorkflowMetrics`).

## Tests

`libs/auth` suite: 19 spec files / 128 tests (up from 104). Full monorepo suite: 137 suites / 1093
tests, all passing.

## Build

PASS (`npm run typecheck`; also explicitly verified `npx nest build server` and
`npx nest build worker` both compile clean)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- None outstanding for this library. This was the last named product-scope gap from Loop 008.

## Next Loop

- No Critical/High findings remain open, and no further product-scope gaps are currently named.
  Next loop would be a fresh Phase 1/2 adversarial pass (per this library's own history of
  periodic re-review, e.g. Loop 012), or driven by whatever concrete need surfaces next.

---

# Loop 015

**Library:** libs/auth
**Date:** 2026-07-22

## Goal

Add a change-password endpoint for an already-authenticated user — distinct from the anonymous,
email-token-based `PasswordResetService` flow built in Loop 014. Direct user request, following up
on an exploratory "what's missing" question that also flagged login brute-force protection as a
bigger, separate design decision not attempted here.

## Files Reviewed

- `application/auth.service.ts`, `application/password-reset.service.ts` (confirmed no existing
  "change password while logged in" path — `PasswordResetService.confirmReset` requires an
  emailed token, not a known current password)
- `http/auth.controller.ts` (existing `@CurrentUser()`/`JwtAuthGuard` pattern used by
  `logout`/`logoutAll`/`me`)

## Problems Found

**Low**
- (the gap named above — a product-scope omission, not a defect)

## Changes Made

- `AuthService.changePassword(userId, currentPassword, newPassword)`: verifies the current
  password, rehashes, saves, revokes every refresh token for the user, and publishes the existing
  `PasswordChangedEvent` — same revoke-everything reasoning already applied to
  `PasswordResetService.confirmReset`/`logoutAll`.
- `ChangePasswordDto` (new).
- `AuthController.changePassword`: `POST /auth/change-password`, `@UseGuards(JwtAuthGuard)`,
  takes the current user's id from `@CurrentUser()` rather than the request body (a user can only
  change their own password through this endpoint).
- Tests: 2 new `AuthService` unit tests, 1 new controller delegation test, 2 new real-`DataSource`
  integration tests (full change-then-relogin-then-old-sessions-revoked flow; wrong-current-
  password rejected without touching anything).

## Why

Distinct endpoint rather than reusing `PasswordResetService.confirmReset` because the two flows
authenticate the caller differently (a known current password vs. a possession-of-email proof via
token) and serve different UX moments (settings-page password change vs. "I forgot my password").
Forcing them through one method would mean threading an `isAuthenticatedFlow` branch through
`confirmReset`'s token-lookup logic for no shared benefit — same reasoning already applied
elsewhere in this library (Design 002's rejected-alternatives note) against forcing a shared
abstraction where the two paths don't actually share meaningful logic beyond "hash and save."

## Tests

`libs/auth` suite: 19 spec files / 133 tests (up from 128). Full monorepo suite: 137 suites / 1098
tests, all passing.

## Build

PASS (`npm run typecheck`; also explicitly verified `npx nest build server` and
`npx nest build worker` both compile clean)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- Login brute-force protection (rate limiting / account lockout) — flagged during the same
  conversation as a bigger, separate design decision (lockout vs. rate-limit vs. CAPTCHA, plus a
  choice of attempt-count store) not attempted this loop.

## Next Loop

- No Critical/High findings remain open. Login brute-force protection above is the next
  candidate if prioritized — needs a design decision first, not a straight implementation.

---

# Loop 016

**Library:** libs/auth
**Date:** 2026-07-22

## Goal

Add a per-user concurrent device/session limit. Direct user request ("device limit?"). See
`ARCH.md` Design 005 for the two scoping decisions confirmed before implementing.

## Files Reviewed

- `application/refresh-token.service.ts` (`issue`/`rotate` — confirmed `rotate()` already revokes
  the old row for its family before calling `issue()` again, meaning the active-session count
  never actually grows during rotation, only on a genuinely new `login()`)
- `domain/refresh-token.repository.ts` (existing `revokeIfActive`/`revokeFamily`/`revokeAllForUser`
  shape the two new methods follow)

## Problems Found

**Medium**
- Confirmed the gap: no cap existed on concurrent active refresh tokens per user — a single
  account could log into unlimited devices simultaneously with no eviction or rejection.

## Changes Made

- `auth.constants.ts`: `DEFAULT_MAX_ACTIVE_SESSIONS_PER_USER = 5`.
- `auth.types.ts`: `AuthModuleOptions.maxActiveSessionsPerUser?: number`.
- `domain/refresh-token.repository.ts`: `findActiveForUser(userId, now?)` (not revoked, not
  expired, oldest-first) and `revokeMany(ids)`.
- `application/refresh-token.service.ts`: `issue()` now calls a new private
  `enforceSessionLimit(userId)` after saving the new token — loads active sessions, and if over
  `maxActiveSessions`, revokes the oldest excess via `revokeMany`.
- Tests: 3 new `RefreshTokenService` unit tests (within-limit no-op, eviction on exceeding the
  default, respecting a configured override) plus 2 existing tests updated for the new repository
  methods; 1 new real-`DataSource` integration test (register → 5 logins → a 6th succeeds and
  evicts the oldest, the other 4 original sessions plus the new one remain usable).

## Why

See `ARCH.md` Design 005.

## Tests

`libs/auth` suite: 19 spec files / 141 tests (up from 137). Full monorepo suite: 145 suites / 1168
tests, all passing.

## Build

PASS (`npm run typecheck`; explicitly verified `npx nest build server` and `npx nest build worker`
both compile clean)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- None outstanding for this library.

## Next Loop

- No Critical/High findings remain open. `libs/auth` is at a natural stopping point again.

---

# Loop 017

**Library:** libs/auth
**Date:** 2026-07-23

## Goal

Fresh adversarial Phase 1/2 pass, prompted by the same-day discovery of a real transaction-scope
bug in `libs/workflow` and a composite-key-collision bug found across `libs/cache`/`libs/queue`/
`libs/ratelimit` — checking whether either bug class recurs here, plus a general re-read of the
highest-risk security surfaces (refresh-token rotation/reuse, login, password reset, email
verification, JWT guard, access-token denylist).

## Files Reviewed

- `application/refresh-token.service.ts` (`issue`/`rotate`/`enforceSessionLimit`/`revoke`),
  `application/auth.service.ts` (`register`/`login`/`refresh`/`changePassword`),
  `application/password-reset.service.ts`, `application/email-verification.service.ts`,
  `application/token.service.ts`, `guards/jwt-auth.guard.ts`, `adapters/cache-access-token-denylist.ts`.
- `persistence/migrations/1753000000000-InitialAuthSchema.migration.ts` — confirmed `auth_users.email`
  has a DB-level `isUnique` constraint backstopping `register()`'s app-level
  `UniqueEmailSpecification` check against the TOCTOU race two concurrent registrations could
  otherwise hit.
- Checked every hash-key/cache-key construction in this library (`cache-access-token-denylist.ts`'s
  `auth:denylist:${jti}`, refresh/reset/verification tokens' plain SHA-256 hash-as-primary-key) for
  the same naive-concatenation collision shape found in `libs/cache`/`libs/queue`/`libs/ratelimit`
  this session — none apply here: `jti` is a `randomUUID()` (no `:`), and token lookups key off a
  SHA-256 hash of the raw token, not a concatenation of two independent free-form values.

## Problems Found

**Critical / High** — none.

**Low**
- `password-reset.service.ts`'s `requestReset()` doc comment states it "never reveals whether an
  account exists via response timing/shape," but the existing-user path does two extra DB writes
  (`invalidateActiveForUser`, `save`) plus an event publish that the unknown-email path skips —
  a real, if minor, timing asymmetry the comment overstates. Not fixed: `POST
  /auth/request-password-reset` already sits behind a rate limiter (`libs/ratelimit` Loop 003),
  which substantially caps an attacker's ability to gather enough timing samples to distinguish
  the two paths reliably over a network. `email-verification.service.ts`'s `requestVerification`
  has the identical shape/mitigation.

## Changes Made

None — no finding this pass crossed the bar for a code change. The Low finding above is a
documentation-precision nit with an existing, adequate mitigation (rate limiting), not a gap
worth a diff.

## Why

- Confirmed neither of this session's two recurring bug classes (naive composite-key
  concatenation; an outer transaction unintentionally absorbing multiple independent commits)
  appears in `libs/auth` — its token/session writes are all single, independent `save()`/`update()`
  calls with no multi-step-in-one-transaction shape and no `${a}:${b}`-style key construction.
- The timing-asymmetry Low finding was investigated seriously (is the doc comment's claim actually
  true?) before being left as a Low/documented-mitigation item rather than manufacturing a fix for
  a risk the existing rate limiter already substantially closes — per ci.loop §17, a fix without
  measurable value isn't warranted here.

## Tests

No test changes — no code changed. `libs/auth` suite unchanged, all passing as part of the full
monorepo run (145 suites / 1174 tests).

## Build

PASS (`npm run typecheck`)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- Unchanged: login brute-force protection (Loop 015's carried-over item, needs a design decision).
- The `password-reset.service.ts`/`email-verification.service.ts` doc-comment overstatement noted
  above — cosmetic, not urgent.

## Next Loop

- No Critical/High/Medium findings this pass. `libs/auth` remains at a natural stopping point;
  login brute-force protection is the only named, undecided item if a future loop wants to pick
  it up.

---

# Loop 018

**Library:** libs/auth
**Date:** 2026-07-23

## Goal

Second adversarial pass in the same session as Loop 017, targeting `AuthorizationService`'s RBAC
management surface (`assignRole`/`revokeRole`/`grantPermission`/`revokePermission`), which hadn't
had a dedicated concurrency-focused review before.

## Files Reviewed

- `application/authorization.service.ts` — traced `assignRole`/`revokeRole`/`grantPermission`/
  `revokePermission`'s read-modify-write shape: each loads an entity, computes a full new
  `roles`/`permissions` array from the loaded (possibly stale) one, then `save()`s it.
- `domain/user.entity.ts`, `domain/role.entity.ts` — confirmed `roles`/`permissions` are
  `@ManyToMany` + `@JoinTable()` with no cascade options, meaning TypeORM's default `save()`
  behavior for the owning side is a *full sync* of the join table against the given array (both
  inserts and deletes), not an incremental add/remove — found a real race (below).
- `libs/database/src/transaction/transaction-provider-enhancer.ts`,
  `libs/database/src/module/database-core.module.ts` — confirmed `@Transactional()` only takes
  effect via `TransactionProviderEnhancer`'s `DiscoveryService`-driven method wrapping at
  `onModuleInit`, and that **no service in this entire monorepo had ever used `@Transactional()`
  before this loop** — the mechanism itself was untested outside its own library's unit specs
  (which mock `DiscoveryService` entirely).
- `libs/queue/src/inbox/database-queue-inbox.service.ts` — the established pattern for injecting
  `TransactionExecutor` directly and calling `.execute()`, considered as an alternative to
  `@Transactional()`.
- Attempted a first fix using `@Transactional()` + pessimistic row locking
  (`findOneForUpdate`-style query builders added to `UserRepository`/`RoleRepository`); this
  surfaced two escalating problems documented under Why, both discovered by actually running the
  existing sqlite-backed integration suite rather than assuming the fix worked.

## Problems Found

**Medium**
- `assignRole`/`revokeRole`/`grantPermission`/`revokePermission` all had a read-modify-write race:
  two concurrent calls affecting the *same* user or role (e.g. two admins granting different roles
  to the same user within the same window) each load the same starting array, each compute their
  own "desired final state," and whichever `save()` (a full many-to-many sync) lands second
  silently overwrites the first's grant — a lost update, not a privilege escalation (fails toward
  *less* permissive), but a real data-integrity gap in the RBAC admin surface with zero existing
  test coverage of concurrent calls.

## Changes Made

- **Rejected first attempt (pessimistic locking):** added `findByIdForUpdate`/`findByNameForUpdate`
  to `UserRepository`/`RoleRepository` (`SELECT ... FOR UPDATE` via TypeORM's locked query
  builder) and wrapped the four methods in `@Transactional()`. Running the existing integration
  suite immediately surfaced that `@Transactional()`'s metadata-only decoration has no effect
  unless the service is resolved through a real Nest DI bootstrap (this repo's `libs/auth`
  integration tests construct services with plain `new`, matching every other library's fast,
  Docker-optional integration-test convention) — switching to directly injecting
  `TransactionExecutor` and calling `.execute()` (matching `libs/queue`'s
  `DatabaseQueueInboxService`) fixed that, but then revealed a second, harder blocker:
  `better-sqlite3` — the driver every integration test in this repo depends on — cannot execute
  `SELECT ... FOR UPDATE` at all (`LockNotSupportedOnGivenDriverError`), unconditionally, not just
  under contention. Pessimistic locking would have made these four methods permanently broken
  against the test suite's driver, not just introduced a new capability.
- **Actual fix (direct join-table writes):** new `is-duplicate-key-error.ts` (same shape as
  `libs/queue`/`libs/workflow`'s own copies — MySQL `ER_DUP_ENTRY`/Postgres `23505`/SQLite
  `SQLITE_CONSTRAINT_PRIMARYKEY`/`SQLITE_CONSTRAINT_UNIQUE`). `UserRepository` gained
  `addRole`/`removeRole`; `RoleRepository` gained `addPermission`/`removePermission` — each uses
  TypeORM's relation query builder (`.createQueryBuilder().relation(Entity, 'relationName').of(id)
  .add(otherId)`/`.remove(otherId)`) to write a single `(userId, roleId)`/`(roleId, permissionId)`
  row directly to the join table, instead of loading the full array and `save()`-ing a recomputed
  one. A single-row `INSERT` has no read-modify-write race — it's atomic at the database level on
  every driver, including sqlite. `.add()` hitting the join table's own composite primary key
  (already-granted case) is caught via `isDuplicateKeyError` and treated as a no-op, matching the
  previous behavior; `.remove()` matching zero rows (never-granted case) is already a normal no-op
  DELETE. `AuthorizationService.assignRole`/`revokeRole`/`grantPermission`/`revokePermission`
  rewritten to call these instead of `save()` with a computed array — no `TransactionExecutor`/
  `@Transactional()` needed at all in the final version, since each operation is already atomic.
- Updated `authorization.service.spec.ts`'s mocks and the four affected `describe` blocks for the
  new call shape; updated `auth.integration.spec.ts`'s two RBAC tests that broke during the
  pessimistic-locking attempt (now pass again, unmodified from the original approach's perspective
  — the service's public behavior is unchanged for the happy path). Added two new integration
  tests: assigning the same role twice is idempotent, and — the direct regression test for the bug
  this loop fixes — concurrent `assignRole` calls granting *different* roles to the same user both
  land (previously, the losing call's grant would have been silently overwritten).

## Why

- The race is real and previously unflagged — RBAC read-modify-write via a full-relation-array
  `save()` is exactly the RBAC surface's own version of the "load stale state, write your own
  computed version back" shape, distinct from (but same root cause as) the composite-key-collision
  bugs found elsewhere this session.
- The pivot away from pessimistic locking wasn't a style preference — it was forced by verifying
  the fix against this library's actual, established test infrastructure (sqlite, Docker-optional)
  rather than assuming a textbook-correct fix would work here. Direct join-table writes are
  strictly better for this codebase: no locking primitive needed at all, works identically on
  every driver, and is a smaller, more targeted diff than either transactional approach.
- Live verification against the real MySQL running in this environment's Docker was attempted
  (per this library's own Loop 007 precedent for driver-specific behavior) but abandoned partway:
  the `app` database user lacks `CREATE DATABASE` privileges to build an isolated scratch schema,
  and running `synchronize: true` against the shared dev `app` database surfaced a pre-existing
  schema mismatch on the first attempt — continuing risked corrupting real dev data for a
  verification that the sqlite integration suite (including the new concurrent-race regression
  test) and the already-proven `isDuplicateKeyError`/MySQL-`ER_DUP_ENTRY` pattern (used
  successfully elsewhere in this codebase) already provide adequate confidence for. No changes
  were made to the shared MySQL database.

## Tests

`libs/auth` suite: 19 spec files / 142 tests (up from 140 — 2 new integration tests, net of the
4 rewritten `describe` blocks). Full monorepo suite: 145 suites / 1175 tests, all passing.

## Build

PASS (`npm run typecheck`)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- Unchanged: login brute-force protection (Loop 015's carried-over item, needs a design decision).
- The pessimistic-locking dead end (repository methods added then removed, `@Transactional()`
  considered then dropped) is fully backed out — no residual code from that attempt remains.

## Next Loop

- No Critical/High findings remain open. `libs/auth` now has two consecutive adversarial passes
  this session (Loop 017 clean, Loop 018 one real Medium found and fixed) — matching the "two
  consecutive clean/resolved passes" stopping point the rest of this session's libraries reached.

---

**Addendum (2026-07-23):** The "login brute-force protection" item carried as an open TODO since
Loop 015 (and incorrectly re-carried as still-open by Loops 017/018 above) was already resolved
before either of those loops ran: `libs/ratelimit/LOOP.md` Loop 002 (2026-07-22, the day *after*
Loop 015 wrote this file but the day *before* Loop 017/018) added a `login: { limit: 5, windowMs:
60_000 }` rate limiter and applied `@RateLimit('login')` to `AuthController.login` directly
(confirmed still present in `libs/auth/src/http/auth.controller.ts`, and in
`apps/server/src/app.module.ts`'s configured limiters). No design decision or further work is
needed here — rate-limiting (the option this item's own text named) is what got built, not
account lockout or CAPTCHA. Closing this out; it should not be carried forward again.

---

# Loop 019

**Library:** libs/auth
**Date:** 2026-07-23

## Goal

Close Loop 018's explicitly-flagged gap: the concurrent-`assignRole` race fix was verified only
against in-memory sqlite (`better-sqlite3` serializes every query onto one connection, so two
"concurrent" `Promise.all` calls never actually race at the storage engine) because the `app`
MySQL user lacked `CREATE DATABASE` privileges to build an isolated scratch schema, and
`synchronize: true` against the shared dev `app` database was correctly judged too risky to
attempt. Get real MySQL verification without touching the shared dev database.

## Files Reviewed

- No source changes — this loop only adds verification infrastructure and a test.
- `domain/user.repository.ts`'s `addRole`/`removeRole` (Loop 018's fix) and
  `domain/is-duplicate-key-error.ts` (confirmed `ER_DUP_ENTRY` — MySQL's real duplicate-key error
  code — was already handled, alongside the sqlite/Postgres codes the existing test suite
  exercises).

## Problems Found

None — this loop is verification-only, not a review pass.

## Changes Made

- Local dev infra: created a scratch database (`app_scratch`) in the `make compose-up` MySQL
  instance and granted the `app` user `CREATE`/`DROP` privileges plus full rights on that schema
  only — the shared `app` database's privileges are unchanged. This is a one-time local
  environment change, not a code or migration change.
- New `auth-concurrency.mysql.integration.spec.ts`: the same concurrent-`assignRole` regression
  as `auth.integration.spec.ts`, rebuilt against a real `mysql` `DataSource` (via `mysql2`) instead
  of `better-sqlite3`, so two `Promise.all`-concurrent calls actually land on separate pooled
  connections. Runs the race 20 times per test run (a single pair can pass by luck even against a
  genuinely racy implementation) — all 20 land both grants with real MySQL under real connection
  concurrency. Gated behind `RUN_MYSQL_INTEGRATION_TESTS=1` (skipped by default via
  `describe.skip`) so `npm test` stays hermetic and doesn't require `make compose-up` for
  contributors without Docker running.

## Why

- Loop 018's fix (direct join-table `INSERT` via `addRole` instead of load-modify-`save()`) was
  already correct by inspection and passed under sqlite, but ci.loop's own workflow-lib precedent
  (Loop 007) established that driver-specific behavior deserves live verification when available,
  not just unit-level confidence — this closes that exact gap for `libs/auth`, using the same
  environment the workflow-lib fix (Loop 021, same day) verifies against.
- Risk: LOW. No production code changed — only a new opt-in test file and a local-only DB grant
  scoped to a scratch schema that doesn't touch `app`'s existing tables or data.

## Tests

`libs/auth` suite: 20 spec files / 143 tests (up from 142 — one new MySQL-gated test, skipped by
default). With `RUN_MYSQL_INTEGRATION_TESTS=1`: 143/143 passing including the new MySQL spec.
Full monorepo default suite: 149 suites / 1194 tests, all passing (2 suites/2 tests skipped by
default — this loop's addition plus `libs/workflow`'s companion).

## Build

PASS (`npm run typecheck`)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- None outstanding for this library.

## Next Loop

- No Critical/High/Medium findings remain open, and the one previously-flagged verification gap
  is now closed. `libs/auth` remains at a natural stopping point per Section 16 until a new
  concrete finding or requirement surfaces.

---

# Loop 020

**Library:** libs/auth
**Date:** 2026-07-23

## Goal

User-requested feature: track a client-supplied `deviceId` on issued refresh tokens, matching
the scope the user explicitly chose over two richer alternatives (session-listing/revocation
endpoints, or replace-on-relogin eviction semantics) — pure storage, no behavior change, smallest
safe diff for a schema-touching change.

## Files Reviewed

- `domain/refresh-token.entity.ts`, `application/refresh-token.service.ts` (`RefreshTokenMetadata`,
  `issue()`), `http/auth.controller.ts` (`metadata()` helper, `login`/`refresh` handlers),
  `dto/login.dto.ts`, `dto/refresh.dto.ts` — confirmed `createdByIp`/`userAgent` already
  established the exact pattern being extended (nullable forensic-metadata column, populated only
  by the controller's `login`/`refresh` handlers, no lookup/uniqueness semantics).

## Problems Found

None — this is a feature addition, not a review pass.

## Changes Made

- `domain/refresh-token.entity.ts`: added nullable `deviceId` column, same shape as
  `createdByIp`/`userAgent`.
- New migration `1753300000000-RefreshTokenDeviceId.migration.ts`: additive `ALTER TABLE ADD
  COLUMN`, nullable, no backfill needed. Registered in `persistence/migrations/index.ts`.
- `application/refresh-token.service.ts`: `RefreshTokenMetadata` gained an optional `deviceId`;
  `issue()` persists it (`null` when omitted, preserving existing behavior for every caller that
  doesn't send one).
- `dto/login.dto.ts`/`dto/refresh.dto.ts`: optional `deviceId` field (`@IsOptional() @IsString()
  @MaxLength(255)`), documented in Swagger as opaque client metadata, not validated for format.
- `http/auth.controller.ts`: `metadata()` helper now also threads `deviceId` from the DTO into
  `RefreshTokenMetadata` (IP/user-agent stay derived from the request itself; `deviceId` is the
  one field that can only come from the caller, since it isn't observable server-side).
- Tests: `refresh-token.service.spec.ts` (deviceId persisted or `null`), `auth.controller.spec.ts`
  (deviceId forwarded from DTO to metadata), `auth.integration.spec.ts` (real DataSource
  round-trip: login with a deviceId → stored on the refresh-token row), and updated
  `1753000000000-InitialAuthSchema.migration.spec.ts` to also run the new migration (that spec
  inserts real `RefreshTokenEntity` rows against the migrated schema, so it needs every migration
  that alters a table it touches, not just the initial one — undoes both migrations at teardown).

## Why

- Risk: MEDIUM (schema change) per ci.loop §18, despite being purely additive/nullable and
  behavior-preserving — any schema change gets that floor regardless of blast radius. Confirmed
  scope with the user via `AskUserQuestion` before touching anything, given two materially
  different (and higher-risk) alternatives existed: session-listing/revocation endpoints would
  add public API surface, and replace-on-relogin eviction would change
  `maxActiveSessionsPerUser`'s existing semantics (libs/auth/ARCH.md).
- No ARCH.md entry: this doesn't move a bounded-context or aggregate boundary — it's a new column
  on an already-existing aggregate, following an already-established pattern (`createdByIp`/
  `userAgent`) exactly. Section 0.7's bar for an ARCH.md entry (a design-level decision) isn't met.
- The migration was **not** run against the shared `make compose-up` `app` database this loop —
  only exercised via sqlite (`synchronize: true`) and the `app_scratch` scratch schema (via the
  existing MySQL-gated auth spec, which uses `synchronize: true` from the current entity and so
  picked up the new column automatically). It will apply automatically the next time the real app
  starts, via `.env`'s `MYSQL_MIGRATIONS_RUN=true` — consistent with this session's established
  caution around not touching the shared dev database directly.

## Tests

`libs/auth` suite: 21 spec files / 148 tests (up from 145 — 3 new tests, one existing migration
spec extended). Full monorepo default suite: 149 suites / 1197 tests, all passing (4 suites/5
tests skipped by default, unchanged from Loop 019). MySQL-gated `auth-concurrency.mysql`
re-verified passing with the new column present via `synchronize: true`.

## Build

PASS (`npm run typecheck`)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- None outstanding for this addition. Session-listing/revocation endpoints and replace-on-relogin
  eviction remain available as future scope if the user wants either later — deliberately not
  built now, per the scope they chose.

## Next Loop

- No Critical/High/Medium findings open. `libs/auth` remains at a natural stopping point per
  Section 16 until a new concrete finding or requirement surfaces.

---

# Loop 021

**Library:** libs/auth
**Date:** 2026-07-23

## Goal

Wire `AuthorizationService`'s 8 RBAC mutation methods into the new `libs/audit` Audit Module
(`libs/audit/ARCH.md` Design 001; `libs/audit/LOOP.md` Loop 001) — a concrete new requirement, not
a discovered defect.

## Files Reviewed

- `application/authorization.service.ts` — every mutation method's write path (the point to record
  after, not before, since a failed write should never produce a false audit entry).
- `http/role.controller.ts` — confirmed `@CurrentUser()` was already available to every route via
  `JwtAuthGuard`, so forwarding the acting user's id needed no new guard/decorator.

## Problems Found

N/A — feature addition, not a review pass.

## Changes Made

- `AuthorizationService` constructor-injects `AuditService` (`@/audit`). Each of `createPermission`,
  `createRole`, `deleteRole`, `deletePermission`, `grantPermission`, `revokePermission`,
  `assignRole`, `revokeRole` gained an optional trailing `actorId?: string` parameter (additive —
  not a breaking signature change) and now calls `this.audit.record(...)` immediately after its
  write succeeds.
- `RoleController`: every route now also takes `@CurrentUser()` and forwards `user.userId` as the
  new `actorId` argument.
- Updated `authorization.service.spec.ts` (audit mock + assertion added to all 8 happy-path tests)
  and rewrote `role.controller.spec.ts` (every delegation test now passes and asserts the acting
  user). Stubbed `AuditService` in both real-DataSource integration specs
  (`auth.integration.spec.ts`, `auth-concurrency.mysql.integration.spec.ts`) — real audit
  persistence is `libs/audit`'s own test's concern, not these suites'.
- Documented as `libs/auth/ARCH.md` Design 007 (new `@/audit` dependency).

## Why

See `libs/audit/ARCH.md` Design 001 for the full cross-lib rationale. Recording *after* the write
(not wrapping both in a transaction) matches this monorepo's existing reality that no code path
anywhere uses `@Transactional()` (`libs/auth/ARCH.md` Design 006) — inventing that guarantee for
one new write wasn't justified by a stated requirement.

## Tests

`libs/auth` suite: unchanged test-file count, 8 existing tests extended with audit assertions, full
`role.controller.spec.ts` rewritten (11 tests, all delegation + acting-user forwarding). Full
monorepo suite: 154 suites / 1216 tests passing (see `libs/audit/LOOP.md` Loop 001 for the combined
before/after count across all three touched libraries).

## Build

PASS (`npm run typecheck`)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- Unchanged from Loop 020.

## Next Loop

- No Critical/High/Medium findings open. `libs/auth` remains at a natural stopping point per
  Section 16 until a new concrete finding or requirement surfaces.

# Loop 022

**Library:** libs/auth
**Date:** 2026-07-24

## Goal

Close REQUIREMENTS.md Tier 1's "device management" gap: `RefreshTokenEntity.deviceId` (Loop 020)
landed as write-only forensic metadata — recorded on login/refresh, never read back anywhere. This
loop surfaces it: let a user see and revoke their own active sessions/devices.

## Files Reviewed

- `domain/refresh-token.repository.ts` — `findActiveForUser`/`revokeIfActive` already existed
  (session-limit eviction, Loop 019/020); neither is scoped to "one session, one caller."
- `application/refresh-token.service.ts` / `application/auth.service.ts` — existing
  `logout`/`logoutAll` delegation pattern (thin `AuthService` passthrough to
  `RefreshTokenService`) reused rather than inventing a new one.
- `http/auth.controller.ts` — existing `@CurrentUser()` + `JwtAuthGuard` pattern from
  `logout-all`/`change-password` reused; no new guard/decorator needed since this is
  self-service-only (no "manage another user's sessions" case exists or was requested).

## Problems Found

N/A — feature addition (closing a documented `REQUIREMENTS.md` gap), not a review pass.

## Changes Made

- `RefreshTokenRepository.revokeIfActiveForUser(id, userId)`: same atomic compare-and-revoke as
  `revokeIfActive`, additionally scoped to `userId` in the `WHERE` clause — the ownership check and
  the revoke happen in one statement, so there's no separate read-then-check race window.
- `RefreshTokenService`: new `ActiveSession` interface (id/createdByIp/userAgent/deviceId/
  createdAt/expiresAt — deliberately omits `tokenHash`/`familyId`/`userId`/`revokedAt`),
  `listActiveForUser(userId)`, and `revokeOne(userId, sessionId)` (throws the new
  `SessionNotFoundError` — a 404 — when the id doesn't exist, doesn't belong to the caller, or is
  already revoked; all three cases are indistinguishable on purpose, so a 403 never confirms a
  session id belongs to someone else).
- `AuthService`: thin `listSessions`/`revokeSession` passthroughs, same shape as existing
  `logoutAll`.
- `AuthController`: `GET /auth/sessions` and `DELETE /auth/sessions/:id`, both behind
  `JwtAuthGuard`, no rate limiting (matches `logout`/`logout-all`/`me` — only the unauthenticated
  `@Public()` routes are rate-limited).
- New `ActiveSessionResponseDto` (Swagger mirror, per the existing `AuthSessionResponseDto`
  pattern) and `SessionNotFoundError`, both exported from the barrel.
- Tests: unit coverage in `refresh-token.service.spec.ts` (mapping + ownership-scoped revoke) and
  `auth.service.spec.ts`/`auth.controller.spec.ts` (delegation), plus one new
  `auth.integration.spec.ts` case against a real (sqlite) DataSource covering the full flow —
  list two devices, revoke one, confirm the other and a *different user's* session are
  untouched, confirm cross-user revoke and double-revoke both 404.

## Why

Per `ci.loop` §17 (prefer existing patterns): this is entirely new read/write surface on an
existing aggregate (`RefreshTokenEntity`), not a new bounded context, so no `ARCH.md` entry — no
aggregate boundary moved. Scoped to self-service only (no admin "revoke someone else's session"
endpoint) since no concrete need for that exists yet, consistent with how `libs/users`/`libs/audit`
each deferred their own admin-facing surface until a concrete trigger appeared.

## Tests

`libs/auth` suite: 19 of 20 suites passing (1 mysql-gated suite skipped, as before), 153 tests (up
from ~145). Full monorepo `make check`: 159 of 164 suites passing (5 skipped by design), 1234 tests
passing.

## Build

PASS (`npm run typecheck`)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- REQUIREMENTS.md Tier 1 "Auth completeness" still has MFA/2FA, API keys, OAuth2/SSO open — none
  have a concrete trigger yet.

## Next Loop

- No Critical/High/Medium findings open. `libs/auth` remains at a natural stopping point per
  Section 16 until a new concrete finding or requirement surfaces.
