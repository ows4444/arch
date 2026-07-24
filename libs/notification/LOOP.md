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

# Loop 002

**Library:** libs/notification (+ apps/worker's EmailNotificationConsumer)
**Date:** 2026-07-24

## Goal

Fresh Phase 1/2 review pass (`ci.loop` §§1–2) — the first since Loop 001's initial build and
live-verification. Loop 001 verified the happy path end to end; this loop specifically asked "what
happens when the email actually fails to send," since that path was never exercised (both shipped
adapters, `NoopEmailSender`/`LoggingEmailSender`, never throw).

## Files Reviewed

- `application/notification.service.ts`, both `adapters/*.ts`, `ports/*.interface.ts`,
  `notification.module.ts`, `notification.types.ts`, `notification.constants.ts`,
  `queue/notification-email.topology.ts`, `queue/email-message.payload.ts`, `index.ts` — re-read
  end to end.
- `apps/worker/src/queue/email-notification.consumer.ts` — the one place a thrown `EmailSender`
  failure actually goes.
- `libs/queue/src/consumer/rmq-consumer.runtime.ts` (`getRetryDecision`,
  `invokeHandler`/the main catch block) and `libs/queue/src/consumer/rmq-payload-validator.ts` —
  to understand exactly what `libs/queue` does with a handler's thrown error, rather than assuming.
- `apps/server/src/notifications/queue-auth-event-publisher.ts` — the enqueue side; confirmed
  clean (delegates to `OutboxService.enqueue`, no notification-specific concern).

## Problems Found

**Medium**
- `NOTIFICATION_EMAIL_TOPOLOGY.QUEUES.send` declares `retry: retry({ strategy: [1, 5, 15] })`, but
  `RMQConsumerRuntime.getRetryDecision` only retries an error that's `instanceof
  RetryableMessageError` (confirmed by reading the runtime directly, not assumed) — every other
  thrown error nacks without requeue on the very first failure, straight to the DLQ.
  `EmailNotificationConsumer.handleSend` awaited `NotificationService.sendEmail(payload)` with no
  try/catch, so any error it threw propagated as a plain `Error`, never retried. Not a live bug
  today — `NoopEmailSender`/`LoggingEmailSender` never throw — but the moment a real SMTP/SendGrid/
  SES adapter is wired (ARCH.md's own stated next step), every transient send failure (network
  blip, provider rate-limit) would dead-letter after exactly one attempt instead of the three the
  topology already declares. Confirmed the payload itself is already separately guarded — a
  structurally malformed message throws `NonRetryableMessageError` from `rmq-payload-validator.ts`
  before the handler ever runs — so by the time `handleSend` runs, a thrown error can only be a
  genuine delivery failure, making "retryable" the correct default classification for anything
  it can throw.

## Changes Made

- `EmailNotificationConsumer.handleSend`: wraps the `sendEmail` call in try/catch, rethrowing any
  caught error as `RetryableMessageError` (from `@/queue`) with the original message preserved.
  Fixed at the consumer, not inside `NotificationService`/`libs/notification` itself —
  `libs/notification`'s ARCH.md Context Map explicitly scopes the library to "no publish/consume
  calls of its own," and pulling in `@/queue`'s `RetryableMessageError` there would be exactly the
  queue-specific coupling that boundary was drawn to avoid. `apps/worker` already owns the
  `@RMQConsumer` handler, so the classification decision belongs there.
- New test: a `sendEmail` rejection surfaces from `handleSend` as `RetryableMessageError` with the
  original error's message preserved.

## Why

Per `ci.loop` §17 (never trade correctness for elegance): a declared reliability guarantee
(`retry: retry({ strategy: [1, 5, 15] })`) that can structurally never trigger is worse than not
declaring it at all — it reads as "failures retry" to anyone configuring or debugging this queue,
when they in fact don't. Fixing now rather than deferring to "whenever a real adapter is built" per
Open Questions: this isn't building the speculative adapter itself, it's closing the gap between
what the topology already claims and what the code actually does — the same class of fix as
Loop 012's `libs/ratelimit` fail-open gap (a documented guarantee silently unreachable via one
specific path).

## Tests

`libs/notification` suite: unchanged (5 tests, no notification-lib code touched — the fix lives in
`apps/worker`). `apps/worker` suite: 7 of 7 suites passing, gains 1 test. Full monorepo
`make check`: 159 of 164 suites passing (5 skipped by design), 1238 tests passing (up from 1237).

## Build

PASS (`npm run typecheck`)

## Lint

PASS (`npm run lint`)

## Remaining TODO

- Unchanged from Loop 001: no real SMTP/SendGrid/SES adapter yet; SMS/push/in-app channels and the
  other four `libs/auth` events remain out of scope until a concrete trigger appears. When a real
  adapter is eventually built, its own errors should distinguish permanent failures (e.g. a
  provider's hard-bounce/invalid-recipient rejection) from transient ones if that distinction
  becomes concretely necessary — today's blanket "always retryable" is the correct default with
  only synthetic (never-throwing) adapters in play, not a permanent design decision.

## Next Loop

- No Critical/High findings remain open. `libs/notification` returns to a natural stopping point
  per Section 16 until a real email provider adapter (or another concrete requirement) appears.
