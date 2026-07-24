# Loop 001

**Library:** libs/audit
**Date:** 2026-07-23

## Goal

Implement `libs/audit` from scratch per `libs/audit/ARCH.md` Design 001: an append-only
`AuditEntry` + `AuditService.record(...)`, wired as a direct call from `libs/auth`'s 8
`AuthorizationService` mutation methods and `libs/users`' `UserProfileService.updateMine`.
Greenfield implementation following a completed (lightweight) Design Mode session.

## Files Reviewed

- `libs/ratelimit/ARCH.md`/`libs/ratelimit/src` — the closest sibling precedent for a generic
  infrastructure library with no domain aggregate.
- `libs/auth/src/application/authorization.service.ts` — the 8 RBAC mutation methods this loop
  instruments (`createPermission`, `createRole`, `deleteRole`, `deletePermission`,
  `grantPermission`, `revokePermission`, `assignRole`, `revokeRole`).
- `libs/users/src/application/user-profile.service.ts` — `updateMine`, the one profile-mutation
  call site in scope.
- `libs/queue`/`libs/workflow`/`libs/validation` entities using `type: 'json'` columns — confirmed
  convention for `AuditEntryEntity.metadata`.

## Problems Found

N/A — greenfield implementation.

## Changes Made

- Scaffolded `libs/audit` (`nest-cli.json`, `tsconfig.json` `@/audit` alias, `tsconfig.lib.json`,
  jest `moduleNameMapper`).
- Domain: `AuditEntryEntity` (`audit_entries`: `actorId`/`targetType`/`targetId` nullable,
  `metadata` json nullable, `createdAt` only — append-only, no `updatedAt`) +
  `AuditLogRepository extends BaseRepository`.
- Application: `AuditService.record(input)` — the only method (no `list()`/query method added
  speculatively; nothing consumes one yet).
- Persistence: `1753600000000-InitialAuditSchema` migration (table + indexes on `actorId` and
  `(targetType, targetId)`).
- `AuditModule.forRoot()` — `@Global()`, no options (nothing to configure yet).
- **Wired into `libs/auth`**: `AuthorizationService` constructor-injects `AuditService`; each of
  its 8 mutation methods gained an optional trailing `actorId?: string` parameter (additive) and
  now calls `.record(...)` after its write succeeds. `RoleController` updated to forward
  `@CurrentUser().userId` as that argument on every route. Documented as `libs/auth/ARCH.md`
  Design 007 (new `@/audit` dependency).
- **Wired into `libs/users`**: `UserProfileService.updateMine` constructor-injects `AuditService`
  and records a `profile.updated` entry (actor and target are the same `userId`, since this method
  is self-only). Documented as `libs/users/ARCH.md` Design 002.
- Wired into `apps/server/src/app.module.ts`: `AUDIT_TYPEORM_ENTITIES`/`AUDIT_MIGRATIONS` merged
  into the existing `DatabaseModule.forRoot` call; `AuditModule.forRoot()` registered before
  `AuthModule`/`UsersModule` (both now depend on `AuditService`).
- Tests: `audit.service.spec.ts` (3 — full entry, defaulted-null fields, write-failure
  propagation), `1753600000000-InitialAuditSchema.migration.spec.ts` (2 — table round-trip via real
  sqlite entity mapping, including the `json` metadata column). Updated `libs/auth`'s
  `authorization.service.spec.ts` (added an `audit` mock + assertions on every mutation),
  `role.controller.spec.ts` (rewritten to forward an acting user and assert it's passed through),
  both integration specs (`auth.integration.spec.ts`, `auth-concurrency.mysql.integration.spec.ts`
  — stubbed `AuditService`, since real audit persistence isn't those suites' concern). Updated
  `libs/users`' `user-profile.service.spec.ts` (added an `audit` mock + assertion on
  `updateMine`).

## Why

See `libs/audit/ARCH.md` Design 001 for the full rationale — direct-service-call mechanism over a
new decorator/enhancer (both confirmed with the user before design), scope limited to RBAC +
profile mutations (also confirmed), no HTTP read surface (would create a `libs/auth`↔`libs/audit`
cycle via its guards; deferred to `apps/server` if ever needed).

## Tests

5 new tests in `libs/audit` (2 spec files). `libs/auth`: updated 8 existing mutation tests + full
`role.controller.spec.ts` rewrite. `libs/users`: updated 1 existing test. Full monorepo suite: 154
suites (4 skipped, unchanged) / 1216 passing (5 skipped, unchanged) — up from 152/1212 before this
loop, no regressions.

## Build

PASS (`npm run typecheck`; `npx nest build server` — webpack compiled successfully)

## Lint

PASS (`npm run lint` — two real fixes: two integration-spec `AuditService` stubs used `async () =>
undefined` with no `await`, tripping `require-await`; rewritten as `() => Promise.resolve()`)

## Remaining TODO

- No HTTP read endpoint (`GET /audit`) — deliberately deferred to `apps/server`, if/when a concrete
  need to view audit history appears (see ARCH.md Open Questions).
- If a third/fourth mutation surface needs auditing later and the direct-dependency-per-consumer
  pattern starts feeling repetitive, that's the trigger to revisit the decorator/enhancer
  alternative rejected in ARCH.md — not before.

## Next Loop

- Closed by Loop 002: live verification against real MySQL/Redis/RabbitMQ, which found and fixed a
  real bug in `libs/users`' `profile.updated` audit metadata.

---

# Loop 002

**Library:** libs/audit (+ libs/users fix)
**Date:** 2026-07-23

## Goal

Live-verify `libs/audit` against real MySQL/Redis/RabbitMQ (Docker already up), mirroring
`libs/auth` Loop 007 / `libs/users` Loop 002's approach — this loop's own unit/sqlite-integration
tests never exercised the real call path from an HTTP request through `AuthorizationService`/
`UserProfileService` into a real `audit_entries` row.

## Files Reviewed

- Live HTTP walkthrough of all 9 audited actions (8 RBAC mutations + 1 profile update), then a
  direct `SELECT` against `audit_entries`.

## Problems Found

**Medium**
- `UserProfileService.updateMine`'s audit metadata (`libs/users/src/application/
  user-profile.service.ts`) used `Object.keys(patch)` to record which fields changed. Live-tested
  with `PATCH /users/me` sending only `{ displayName, bio }` — the recorded `audit_entries` row
  showed `metadata.fields` as **all five** possible `UpdateProfileDto` fields
  (`displayName, avatarUrl, bio, locale, timezone`), not just the two actually sent. Root cause:
  NestJS's `ValidationPipe` (`transform: true`) builds the DTO via `class-transformer`, and under
  this project's `useDefineForClassFields`-on TS target, every declared class field becomes an own
  property (set to `undefined`) at construction time, whether or not the caller sent it — so
  `Object.keys()` on the DTO instance always returns every declared key. No unit test caught this
  because the existing test passed a plain object literal (`{ displayName: 'Jane Doe' }`), which
  doesn't have that shape — only a real DTO instance (or an object with an explicit `undefined`
  value) reproduces it.

## Changes Made

- `UserProfileService.updateMine`: `metadata.fields` now filters to keys whose value is not
  `undefined`, not just `Object.keys(patch)`.
- Added a regression test (`user-profile.service.spec.ts`) using a patch object with explicit
  `undefined` values for the unset fields, reproducing the real-DTO shape without a full Nest
  `ValidationPipe` round trip.
- Documented in `libs/users/LOOP.md` is unnecessary (this is `libs/audit`'s consumer wiring being
  corrected, tracked here) — no `libs/users` ARCH.md change, since this is a bug fix, not a design
  decision.

## Live verification performed (real MySQL/Redis/RabbitMQ)

- Registered + verified a test user, bootstrapped `admin` via direct SQL (documented ops step, same
  as every prior loop's precedent).
- Drove all 8 RBAC mutations (create permission, create role, grant, assign to self, revoke from
  self, revoke permission, delete role, delete permission) and one `PATCH /users/me` — all 9
  produced a matching row in `audit_entries` with the correct `actorId`/`action`/`targetType`/
  `targetId`/`metadata`.
- Found the `metadata.fields` bug above from the `profile.updated` row's contents.
- After the fix: rebuilt, restarted the server, repeated the same `PATCH /users/me` call — the new
  row's `metadata.fields` correctly showed only `["displayName", "bio"]`.
- Cleaned up all test data (audit entries, profile, user, tokens, role grant) after verification.

## Why

Same reasoning as every prior live-verification loop in this repo: a mocked/plain-object unit test
can make a "what changed" assumption look correct without ever constructing the object the way the
real HTTP pipeline does. This is exactly the kind of DTO-instance-vs-plain-object gap that's
invisible until something runs the real `ValidationPipe` transform.

## Tests

1 new regression test in `libs/users`. Full monorepo suite: 154 suites / 1217 tests passing (up
from 1216), no regressions.

## Build

PASS (`npm run typecheck`; rebuilt via `npx nest build server` to restart the dev server with the
fix)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- Unchanged from Loop 001: no HTTP read endpoint (deferred).

## Next Loop

- None forced. `libs/audit` has now been verified at every level this protocol distinguishes: unit
  (mocked), integration (sqlite, real migration/entity round-trip), and live (real MySQL/Redis/
  RabbitMQ, real HTTP, all 9 audited actions confirmed end to end).
