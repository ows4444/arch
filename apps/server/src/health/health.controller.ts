import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { DatabaseHealthService } from '@/database';
import type { DatabaseHealthReport } from '@/database';
import { JwtAuthGuard, Public } from '@/auth';

export interface HealthSummary {
  readonly status: 'ok' | 'degraded';
}

/**
 * `GET /health` is the plain liveness/readiness probe (no auth — an
 * orchestrator/load-balancer needs to reach it without a token) and
 * deliberately returns only a coarse `ok`/`degraded` status, not
 * `DatabaseHealthReport`'s full detail: that report's `metrics` includes
 * `lastError` (an `Error`, whose `.message` can contain connection details
 * like an internal host/IP) and the MySQL server's own reported `hostname`
 * — both fine for an authenticated operator to see, not for an anonymous
 * caller. `GET /health/details` exposes the full report, gated behind
 * `JwtAuthGuard` (any authenticated user, not a specific permission —
 * this is diagnostic read access, not an administrative action the way
 * `roles:manage`-gated RBAC routes are).
 *
 * Currently reflects database health only — `libs/cache`'s Redis
 * connections and `libs/queue`'s RabbitMQ connection have no equivalent
 * health-check surface exposed to `apps/server` today (both are
 * constructed inline inside their own module's `forRoot`/`forRootAsync`
 * options, never as their own injectable provider), so this is a partial
 * readiness signal, not a complete one — noted here so it isn't mistaken
 * for full-stack health.
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly databaseHealth: DatabaseHealthService) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: 'Liveness/readiness probe (database only — see class doc comment)',
  })
  @ApiResponse({ status: 200, description: '{ status: "ok" | "degraded" }' })
  check(): HealthSummary {
    const { healthy } = this.databaseHealth.report();

    return { status: healthy ? 'ok' : 'degraded' };
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('details')
  @ApiOperation({
    summary: 'Per-datasource health detail (authenticated; database only)',
  })
  @ApiResponse({ status: 200, description: 'DatabaseHealthReport' })
  details(): DatabaseHealthReport {
    return this.databaseHealth.report();
  }
}
