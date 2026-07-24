# Loop 001

**Library:** libs/notification (+ apps/server, apps/worker wiring)
**Date:** 2026-07-23

## Goal

Implement `libs/notification` from scratch per `libs/notification/ARCH.md` Design 001: a generic
`NotificationService` + pluggable `EMAIL_SENDER` port, wired as `libs/auth`'s first real (non-no-op)
`AuthEventPublisher` in `apps/server`, consumed by a new `@RMQConsumer` handler in `apps/worker` —
the first real functionality that app has ever had beyond smoke-test scaffolding.

## Files Reviewed

- `libs/auth/src/ports/{auth-event-publisher.interface,auth.events}.ts` — confirmed
  `PasswordResetRequestedEvent`/`EmailVerificationRequestedEvent` already carry a raw token with
  nowhere to go (`NoopAuthEventPublisher` is the only implementation ever wired).
- `libs/queue/src/outbox/outbox.service.ts`, `topology/topology.builder.ts` — `OutboxService.
  enqueue({exchange, routingKey, payload})`, `defineTopology`/`queue`/`retry` helper shapes.
- `apps/worker/src/worker.module.ts`, `queue/worker-smoke-test.*` — confirmed `apps/worker` had only
  smoke-test scaffolding before this loop; confirmed the "apps/* don't import from each other"
  convention, which is why the shared topology/payload needed to live in a lib, not be duplicated.
- `apps/server/src/app.module.ts` — confirmed `OutboxService` is available globally (`QueueModule`
  is `@Global()`), so a new `AuthEventPublisher` implementation can inject it directly.

## Problems Found

N/A — greenfield implementation following a completed Design Mode session.

## Changes Made

- Scaffolded `libs/notification` (`nest-cli.json`, `tsconfig.json` `@/notification` alias,
  `tsconfig.lib.json`, jest `moduleNameMapper`) — no `libs/database` dependency at all (no
  persisted state in this design's scope).
- `EmailMessage`/`EmailSender` ports; `NoopEmailSender` (silent default, matching every other
  `Noop*` adapter in this monorepo) and `LoggingEmailSender` (logs the composed email at INFO
  level — the closest thing to a "real" adapter without an actual SMTP/SendGrid/SES dependency).
- `NotificationService.sendEmail(message)` — the only use case.
- `NotificationModule.forRoot`/`forRootAsync` (`@Global()`, options-token-then-fallback-factory
  shape, matching `AuthModule`'s pattern — simpler than `AuthModule`'s `AuthConfigModule` split
  since nothing here needs a nested dynamic module to inject the options token).
- `NOTIFICATION_EMAIL_TOPOLOGY` (exchange `notifications.email`, one queue `send`, dlq+retry) and
  `EmailMessagePayload` (class-validator) — defined once in `libs/notification` specifically so
  `apps/server` (publisher) and `apps/worker` (consumer) can't drift on exchange/queue/routing-key
  names by hardcoding them independently (see ARCH.md, Context Map).
- **`apps/server`**: new `QueueAuthEventPublisher` (`src/notifications/`) implementing
  `AuthEventPublisher` — `publishPasswordResetRequested`/`publishEmailVerificationRequested`
  compose the actual subject/body wording (this domain knowledge stays in `apps/server`, not inside
  the generic library) and enqueue via `OutboxService`; the other four methods stay no-op, matching
  `NoopAuthEventPublisher`'s existing behavior exactly (no new scope for a "welcome email"/security
  alert — see ARCH.md Open Questions). Wired into `AuthModule.forRootAsync`'s `eventPublisher`
  option — the first real (non-no-op) implementation this monorepo has ever wired.
  `NotificationModule.forRoot({ emailSender: new LoggingEmailSender() })` also registered.
- **`apps/worker`**: new `EmailNotificationConsumer` (`src/queue/`) — a thin `@RMQConsumer` handler
  that calls `NotificationService.sendEmail(payload)`. `NOTIFICATION_EMAIL_TOPOLOGY` added to
  `QueueModule.forRoot`'s `topology` array alongside the existing smoke-test topology;
  `NotificationModule.forRoot({ emailSender: new LoggingEmailSender() })` registered (same adapter
  as `apps/server`, for consistent observability).
- Tests: `notification.service.spec.ts` (2), `noop-email-sender.spec.ts` (1),
  `logging-email-sender.spec.ts` (2), `queue-auth-event-publisher.spec.ts` (3 — the two real
  publish paths + the four-events-stay-no-op assertion), `email-notification.consumer.spec.ts` (1).

## Why

See `libs/notification/ARCH.md` Design 001 for the full rationale — email-only scope and
`apps/worker`-owns-the-consumer mechanism were both confirmed with the user before designing
further; the shared-topology-in-a-lib decision was this design's own refinement once the
"apps/* don't share code" convention's actual risk (exchange/routing-key name drift between two
apps) became concrete.

## Tests

9 new tests across `libs/notification` (5) and the two apps' new files (4). Full monorepo suite:
159 suites (4 skipped, unchanged) / 1226 passing (5 skipped, unchanged) — up from 154/1217, no
regressions.

## Build

PASS (`npm run typecheck`; `npx nest build server` and `npx nest build worker` both compiled
successfully)

## Lint

PASS (`npm run lint` — one real fix: a nested `expect.objectContaining`/`expect.stringContaining`
inside a plain object literal in `queue-auth-event-publisher.spec.ts` tripped
`no-unsafe-assignment`; rewritten as explicit equality assertions against a typed `jest.fn()` mock
instead of nested matchers)

## Live verification performed (real MySQL/Redis/RabbitMQ)

- Booted `apps/server` and `apps/worker` together for the first time this session (found and
  restarted a stale `apps/worker` process left over from before this loop's build, same as every
  prior stale-process encounter this session).
- Registered a test user (auto-triggers `publishEmailVerificationRequested`) and separately called
  `POST /auth/password-reset/request` (`publishPasswordResetRequested`) — both produced a real
  RabbitMQ message that `apps/worker`'s new `EmailNotificationConsumer` received and logged via
  `LoggingEmailSender`, with the correct subject and the real raw token embedded in the text.
- Confirmed both `queue_outbox` rows reached `status: 'published'` — the full outbox → RabbitMQ →
  consumer pipeline, not just the enqueue half.
- Cleaned up all test data (user, tokens, outbox rows) after verification; stopped both dev servers.

## Remaining TODO

- No real SMTP/SendGrid/SES adapter — `LoggingEmailSender` is the interim default until a real
  deployment need exists (see ARCH.md Open Questions).
- SMS/push/in-app channels, and wiring the other four `libs/auth` events to send an email — both
  explicitly out of scope until a concrete trigger appears.

## Next Loop

- None forced. `libs/notification` has now been verified at every level this protocol
  distinguishes: unit (mocked), and live (real MySQL/Redis/RabbitMQ, real two-app HTTP-to-queue-to-
  consumer round trip). Next work should come from a concrete new requirement (most likely: a real
  email provider adapter, if/when this ever deploys somewhere that needs actual delivery).
