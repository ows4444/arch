import { WorkflowScheduleRegistrationService } from './schedule-registration.service';
import { WorkflowConfigurationError } from '../../errors/workflow.errors';

function setup() {
  const store = {
    insert: jest.fn(),
    load: jest.fn(),
    findAll: jest.fn(),
    setEnabled: jest.fn(),
    delete: jest.fn(),
  };
  const registry = { resolve: jest.fn() };

  const service = new WorkflowScheduleRegistrationService(
    store as never,
    registry as never,
  );

  return { service, store, registry };
}

describe('WorkflowScheduleRegistrationService', () => {
  describe('computeNextFireAt', () => {
    it('returns a future date for a valid cron expression', () => {
      const { service } = setup();

      const next = service.computeNextFireAt('*/5 * * * *');

      expect(next.getTime()).toBeGreaterThan(Date.now());
    });

    it('throws WorkflowConfigurationError for an invalid cron expression', () => {
      const { service } = setup();

      expect(() => service.computeNextFireAt('not-a-cron')).toThrow(
        WorkflowConfigurationError,
      );
    });
  });

  describe('create', () => {
    it('throws when the target workflow is not registered', async () => {
      const { service, registry, store } = setup();
      registry.resolve.mockImplementation(() => {
        throw new WorkflowConfigurationError("Workflow 'missing' not found");
      });

      await expect(
        service.create({
          workflowName: 'missing',
          cronExpression: '*/5 * * * *',
        }),
      ).rejects.toThrow(WorkflowConfigurationError);

      expect(store.insert).not.toHaveBeenCalled();
    });

    it('inserts a schedule with computed nextFireAt and defaults', async () => {
      const { service, registry, store } = setup();
      registry.resolve.mockReturnValue({ metadata: { name: 'wf' } });

      const schedule = await service.create({
        workflowName: 'wf',
        cronExpression: '*/5 * * * *',
      });

      expect(schedule.enabled).toBe(true);
      expect(schedule.misfirePolicy).toBe('skip');
      expect(schedule.inputTemplate).toEqual({});
      expect(schedule.nextFireAt.getTime()).toBeGreaterThan(Date.now());
      expect(store.insert).toHaveBeenCalledWith(schedule);
    });

    it('honors an explicit scheduleId, input, enabled, and misfirePolicy', async () => {
      const { service, registry } = setup();
      registry.resolve.mockReturnValue({ metadata: { name: 'wf' } });

      const schedule = await service.create({
        scheduleId: 'daily-report',
        workflowName: 'wf',
        cronExpression: '0 9 * * *',
        input: { report: 'daily' },
        enabled: false,
        misfirePolicy: 'fire-once',
      });

      expect(schedule.scheduleId).toBe('daily-report');
      expect(schedule.inputTemplate).toEqual({ report: 'daily' });
      expect(schedule.enabled).toBe(false);
      expect(schedule.misfirePolicy).toBe('fire-once');
    });
  });

  describe('remove / setEnabled / get / list', () => {
    it('delegates to the store', async () => {
      const { service, store } = setup();

      await service.remove('s-1');
      await service.setEnabled('s-1', false);
      await service.get('s-1');
      await service.list();

      expect(store.delete).toHaveBeenCalledWith('s-1');
      expect(store.setEnabled).toHaveBeenCalledWith('s-1', false);
      expect(store.load).toHaveBeenCalledWith('s-1');
      expect(store.findAll).toHaveBeenCalled();
    });
  });
});
