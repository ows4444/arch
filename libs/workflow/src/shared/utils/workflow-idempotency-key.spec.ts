import { buildSignalIdempotencyKey } from './workflow-idempotency-key';

describe('buildSignalIdempotencyKey', () => {
  it('scopes the key by both workflowId and signalId', () => {
    expect(buildSignalIdempotencyKey('wf-1', 'approve')).toBe(
      'signal:wf-1:approve',
    );
  });

  it('produces distinct keys for the same signalId across different workflows', () => {
    const a = buildSignalIdempotencyKey('wf-1', 'approve');
    const b = buildSignalIdempotencyKey('wf-2', 'approve');

    expect(a).not.toBe(b);
  });
});
