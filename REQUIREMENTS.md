# Requirements Doc — Platform Roadmap

> Reference document for future development. Captures what's built, what's partial, what's planned, and why — so priority calls don't need to be re-derived every session. Reviewed against `ci.loop`'s Design Mode discipline (Section 0): nothing here is scoped to microservices/CQRS/event-sourcing/multi-tenant unless explicitly justified.

**Last updated:** 2026-07-23
**Status:** Living document — append/update, don't silently replace. Update the coverage table whenever a library/app changes; add a dated note under "Decision Log" when a prioritization call changes.

---

## 1. Current State — Coverage Map

The platform is **infrastructure-first**: seven mature shared libraries and two thin apps, with almost no domain/business modules built yet.

### Done

| Module | Where | Notes |
|---|---|---|
| Cache | `libs/cache` | memory/redis/multi-level backends, `@Cacheable`/`@CachePut`/`@CacheEvict`, single-flight dedup |
| Database access | `libs/database` | reader/writer datasource split, `@Transactional`, migrations, pagination, optimistic/pessimistic locking |
| Queue / messaging | `libs/queue` | topology-as-code, transactional outbox + inbox, retry/dead-letter semantics |
| Workflow / saga engine | `libs/workflow` | durable state machine, compensation, retry, distributed leases, child workflows |
| Validation | `libs/validation` | class-validator rule composition, persisted rule storage |

### Partial

| Module | Where | Missing |
|---|---|---|
| Authentication | `libs/auth` | login/logout, refresh tokens, JWT are done. Missing: MFA/2FA, forgot/reset password, device management, API keys, OAuth2, SSO |
| Authorization | `libs/auth/application/authorization.service.ts` | RBAC only. Missing: policy engine, resource-level/ownership checks, dynamic permissions |
| Rate limiting | `libs/ratelimit` | limiting itself is done. Missing: API versioning, API docs, API analytics — the rest of a full API-management layer |
| Health/monitoring | `apps/server/src/health` | liveness/readiness only. Missing: metrics, service-status aggregation, dependency health beyond the basics |
| Request context | `apps/server/src/request-context` | request ID middleware + propagation into structured (JSON) logs done. Missing: trace/span propagation (no APM backend chosen yet) |
| User Management | `libs/users` | `libs/users/ARCH.md` Design 001 + `LOOP.md` Loops 001–002 (2026-07-23): `UserProfile` CRUD (`getOrCreate`/`updateMine`/`getForUser`) and the ownership-check authorization consumer (`assertOwnerOrPermission`) implemented, tested at every level (unit, sqlite integration, live HTTP against real MySQL/Redis/RabbitMQ), wired into `apps/server`. Missing: admin-facing "list all profiles" (add only if a concrete need appears) |
| Audit | `libs/audit` | `libs/audit/ARCH.md` Design 001 + `LOOP.md` Loops 001–002 (2026-07-23): append-only `AuditEntry` + `AuditService.record(...)`, wired as a direct call from `libs/auth`'s 8 RBAC mutation methods and `libs/users`' `updateMine`, wired into `apps/server`, live-verified against real MySQL (all 9 audited actions confirmed; also caught and fixed a real bug in `profile.updated`'s metadata — see `libs/audit/LOOP.md` Loop 002). Missing: an HTTP read endpoint (deferred until a concrete need to view audit history appears) |
| Notification Service | `libs/notification` | `libs/notification/ARCH.md`/`LOOP.md` Loop 001 (2026-07-23): generic `NotificationService` + pluggable `EMAIL_SENDER` port (no-op default, `LoggingEmailSender` wired in both apps), wired as `libs/auth`'s first-ever real `AuthEventPublisher` (`apps/server`'s `QueueAuthEventPublisher`, for `PasswordResetRequestedEvent`/`EmailVerificationRequestedEvent` only) → outbox → RabbitMQ → `apps/worker`'s new `EmailNotificationConsumer` — live-verified end to end against real MySQL/RabbitMQ. Missing: SMS/push/in-app channels, a real SMTP/SendGrid/SES adapter, and wiring the other four auth events (all deferred until a concrete trigger appears) |

### Not started

| Module | Notes |
|---|---|
| Organization Management | depends on User Management |
| Configuration Module (runtime app/feature-flag settings) | — |
| File Service (upload/storage/signed URLs) | — |
| Search Module | — |
| Reporting Module | — |
| Scheduler Module (cron/recurring jobs) | — |
| Integration Module (webhooks, third-party clients) | — |
| Compliance Module (data retention, PII, consent) | — |
| DevOps Module (deployment/build info, maintenance mode) | — |
| Background Services beyond queue consumers | `apps/worker` now has one real consumer (`EmailNotificationConsumer`, 2026-07-23) alongside its smoke-test scaffolding |
| Analytics Module | — |
| AI Module | optional/no current use case |
| Observability (tracing, metrics export) | — |

`apps/`: `server` (health, request-context, redis wiring, validation-rules, `libs/auth`'s real event publisher) and `worker` (smoke-test scaffolding + the real `EmailNotificationConsumer`) — neither has domain HTTP endpoints of its own yet.

---

## 2. Roadmap — Prioritized, Risk-Tagged

Risk scale per `ci.loop` §18: LOW / MEDIUM / HIGH / CRITICAL.

### Tier 1 — Complete existing infra before adding new domains

| Item | Risk | Why this order |
|---|---|---|
| Auth completeness: MFA, forgot/reset password, device management | HIGH (auth surface) | `libs/auth` already exists; this closes a correctness gap rather than opening a new bounded context |
| Authorization: policy engine, resource-level/ownership checks | HIGH | Every future domain module (Users, Compliance, ...) will need scoped checks, not just role checks |
| Audit Module | MEDIUM | Hooks into existing `libs/database` repositories/transactions; no new architecture required |
| Structured Logging / Observability | MEDIUM | Logs → structured JSON done (2026-07-23, `apps/server/LOOP.md` Loop 005). Remaining: metrics export, trace/span propagation (needs an APM backend choice) |

### Tier 2 — First real domain library

| Item | Risk | Why this order |
|---|---|---|
| User Management | HIGH | This is the platform's actual Core Domain and the first non-infra library — **run `ci.loop` Section 0 (Design Mode) before implementation** to fix the aggregate boundary and its relationship to `libs/auth`, since every later domain module depends on it |
| Organization Management | MEDIUM | Depends on User Management's Design Mode output — don't scope this bounded context in isolation from User |

### Tier 3 — Justified infra additions (cheap given existing primitives)

| Item | Risk | Why |
|---|---|---|
| Scheduler Module | LOW/MEDIUM | `libs/queue` + `libs/workflow` already provide retry/state-machine primitives; mostly cron-trigger wiring on top |
| Notification Service | MEDIUM | Natural consumer of `libs/queue` outbox → publish → `apps/worker`, which already exists but is empty |
| File Service | MEDIUM | Only once there's an actual near-term need for uploads; no storage adapter exists yet |

### Deferred / Rejected (justify-or-reject, per `ci.loop` §0.1)

| Item | Reason |
|---|---|
| Search Module | Elasticsearch/OpenSearch is real infra cost; nothing today needs full-text search |
| AI Module | No concrete use case in the platform today |
| Analytics / Reporting | Depend on User/Org/Audit existing first; premature |
| Compliance Module | Depends on User/Org existing; premature |
| Any multi-tenant framing | Platform is single-tenant; don't let Compliance/DevOps work pull in tenant-isolation complexity uninvited |

---

## 3. Process Notes

- Before starting **User Management** or any other first-of-its-kind domain library, run `ci.loop` Section 0 (Design Mode) and record the result in a new `libs/<name>/ARCH.md` — this is the first non-infrastructure bounded context in the platform, so its boundary decisions set precedent for everything downstream (Org, Audit, Notification, Compliance).
- Once a library exists, ordinary work on it follows the `ci.loop` Improvement Loop (Sections 1–19), with completed passes logged in that library's `LOOP.md`.
- Update the coverage tables in Section 1 whenever a `libs/*` or `apps/*` module changes status — this doc should stay accurate without needing to be regenerated from scratch.

## 4. Decision Log

- **2026-07-23** — Initial doc created from a full audit of `apps/*` and `libs/*`. Tiering and reject list as above.
- **2026-07-23** — Started Tier 1's Structured Logging item: `RequestContextLogger` moved from a
  plain-text `[requestId]` prefix to Nest's built-in structured-JSON logging mode with
  `requestId` merged into every log object (`apps/server/LOOP.md` Loop 005). Metrics export and
  trace/span propagation remain open — deferred until an APM backend is chosen.
- **2026-07-23** — Deprioritized Tier 1's Authorization item (policy engine, resource-level/
  ownership checks) relative to starting Tier 2 (User Management) early: `libs/auth/ARCH.md`
  explicitly deferred the policy-engine work until a concrete owned resource exists to design it
  against, and no such resource existed anywhere in the codebase (every prior aggregate is
  auth-internal). Ran `ci.loop` Section 0 (Design Mode) for User Management instead —
  `libs/users/ARCH.md` Design 001 resolves the aggregate boundary against `libs/auth` and resolves
  the deferred authorization item as a concrete two-branch ownership check
  (`assertOwnerOrPermission`) rather than a generic policy engine.
- **2026-07-23** — Implemented User Management (`libs/users` Loops 001–002): `UserProfile` CRUD +
  `assertOwnerOrPermission` per `libs/users/ARCH.md` Design 001's handoff scope, wired into
  `apps/server`, then live-verified end to end against real MySQL/Redis/RabbitMQ (lazy-create,
  ownership 403, live permission-grant taking effect on an already-issued token, and the
  403-before-404 no-existence-leak ordering all confirmed). Moves User Management from
  "Not started" to "Partial" — only admin-facing listing remains open; Organization Management is
  the next Design Mode session once a concrete need to attach membership to `UserProfile` exists.
- **2026-07-23** — Implemented Tier 1's Audit Module (`libs/audit` Loop 001): append-only
  `AuditEntry` + `AuditService.record(...)`, confirmed with the user as a direct-service-call
  mechanism (not a new decorator/enhancer) scoped to RBAC + profile mutations (not every write in
  every lib). Wired into `libs/auth`'s 8 `AuthorizationService` mutation methods (each gained an
  optional trailing `actorId?` parameter) and `libs/users`' `updateMine`, and into `apps/server`.
  Deliberately no HTTP read endpoint yet — would create a `libs/auth`↔`libs/audit` cycle via
  `libs/auth`'s guards; deferred to `apps/server` if a concrete need to view audit history appears.
  Moves the Audit Module from "Not started" to "Partial".
- **2026-07-23** — Live-verified the Audit Module (`libs/audit` Loop 002) against real MySQL: all 9
  audited actions (8 RBAC mutations + profile update) produced correct `audit_entries` rows. Found
  and fixed a real bug along the way — `UserProfileService.updateMine`'s `metadata.fields` recorded
  every possible `UpdateProfileDto` field, not just the ones actually sent, because a real DTO
  instance has every declared field present (as `undefined`) regardless of what the caller sent;
  no unit test had caught it since the existing test used a plain object literal instead of a real
  DTO shape.
- **2026-07-23** — Implemented Tier 3's Notification Service (`libs/notification` Loop 001), scoped
  via two confirmed decisions: email-only for v1 (the only channel with a concrete trigger —
  `libs/auth`'s password-reset/email-verification events already carry a raw token with nowhere to
  go) and `apps/worker` owns the real send (a generic `NotificationService`/`EMAIL_SENDER` port in
  the lib, no domain-specific event knowledge). `apps/server`'s new `QueueAuthEventPublisher` is
  `libs/auth`'s first-ever real `AuthEventPublisher` — composes the reset/verification email
  wording and publishes via the outbox; `apps/worker`'s new `EmailNotificationConsumer` receives it
  and calls `NotificationService.sendEmail`. Live-verified end to end against real MySQL/RabbitMQ
  (both apps booted together for the first time this session; outbox rows confirmed `published`).
  Moves the Notification Service from "Not started" to "Partial" and gives `apps/worker` its first
  real functionality beyond smoke-test scaffolding.
