import { HealthController } from './health.controller';
import type { DatabaseHealthReport } from '@/database';

describe('HealthController', () => {
  function setup(report: DatabaseHealthReport) {
    const databaseHealth = { report: jest.fn().mockReturnValue(report) };
    const controller = new HealthController(databaseHealth as never);

    return { controller, databaseHealth };
  }

  const healthyReport: DatabaseHealthReport = {
    healthy: true,
    datasources: [
      {
        name: 'writer',
        writer: true,
        status: 'READY' as never,
        healthy: true,
        metrics: {} as never,
      },
    ],
  };

  const degradedReport: DatabaseHealthReport = {
    ...healthyReport,
    healthy: false,
  };

  describe('check (GET /health)', () => {
    it('reports ok when every datasource is healthy', () => {
      const { controller } = setup(healthyReport);

      expect(controller.check()).toEqual({ status: 'ok' });
    });

    it('reports degraded when at least one datasource is unhealthy', () => {
      const { controller } = setup(degradedReport);

      expect(controller.check()).toEqual({ status: 'degraded' });
    });

    it('does not leak per-datasource detail in the summary response', () => {
      const { controller } = setup(healthyReport);

      const result = controller.check();

      expect(result).not.toHaveProperty('datasources');
      expect(Object.keys(result)).toEqual(['status']);
    });
  });

  describe('details (GET /health/details)', () => {
    it('returns the full DatabaseHealthReport unmodified', () => {
      const { controller, databaseHealth } = setup(healthyReport);

      expect(controller.details()).toBe(healthyReport);
      expect(databaseHealth.report).toHaveBeenCalledTimes(1);
    });
  });
});
