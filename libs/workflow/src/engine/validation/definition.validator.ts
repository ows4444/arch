import { Injectable } from '@nestjs/common';
import { WorkflowConfigurationError } from '../../errors/workflow.errors';
import { RegisteredWorkflow } from '../../models/registered-workflow';
import { WorkflowStepId } from '../../models/workflow-step-id';

const MAX_DURATION_MS = 365 * 24 * 60 * 60 * 1000;

const MAX_ATTEMPTS = 1_000;

@Injectable()
export class WorkflowDefinitionValidator {
  private traverse(
    workflow: RegisteredWorkflow,
    visitor: (step: WorkflowStepId) => void,
  ): Set<WorkflowStepId> {
    const visited = new Set<WorkflowStepId>();

    const stack: WorkflowStepId[] = [workflow.metadata.definition.start];

    while (stack.length > 0) {
      const current = stack.pop();

      if (!current || visited.has(current)) {
        continue;
      }

      visited.add(current);
      visitor(current);

      stack.push(...(workflow.metadata.definition.transitions[current] ?? []));
    }

    return visited;
  }

  private validatePositiveDuration(
    workflow: RegisteredWorkflow,
    property: string,
    value?: number,
  ): void {
    if (value === undefined) {
      return;
    }

    if (!Number.isFinite(value) || value <= 0) {
      throw new WorkflowConfigurationError(
        `Workflow '${workflow.metadata.name}' ${property} must be a positive finite number.`,
      );
    }

    if (value > MAX_DURATION_MS) {
      throw new WorkflowConfigurationError(
        `Workflow '${workflow.metadata.name}' ${property} must be <= ${MAX_DURATION_MS}ms (365 days), got ${value}.`,
      );
    }
  }

  private validatePositiveInteger(
    workflow: RegisteredWorkflow,
    property: string,
    value: number | undefined,
    max?: number,
  ): void {
    if (value === undefined) {
      return;
    }

    if (!Number.isInteger(value) || value < 1) {
      throw new WorkflowConfigurationError(
        `Workflow '${workflow.metadata.name}' ${property} must be a positive integer >= 1, got ${value}.`,
      );
    }

    if (max !== undefined && value > max) {
      throw new WorkflowConfigurationError(
        `Workflow '${workflow.metadata.name}' ${property} must be <= ${max}, got ${value}.`,
      );
    }
  }

  validate(workflow: RegisteredWorkflow): void {
    this.validateStartStep(workflow);
    this.validateTransitions(workflow);
    this.validateReachability(workflow);
    this.validateCycles(workflow);
    this.validateTerminalSteps(workflow);
    this.validateRetryPolicy(workflow);
    this.validateTimeouts(workflow);
    this.validateSignals(workflow);
    this.validateDeprecatedSteps(workflow);
    this.validateChildWorkflows(workflow);
    this.validateCompensation(workflow);
    this.validateAutoResume(workflow);
    this.validateRetention(workflow);
    this.validatePersistence(workflow);
    this.validateCompatibility(workflow);
  }

  private validateCompatibility(workflow: RegisteredWorkflow): void {
    const { metadata } = workflow;

    if (
      metadata.retention &&
      metadata.autoResume &&
      metadata.retention.ttlMs < (metadata.autoResume.stuckThresholdMs ?? 0)
    ) {
      throw new WorkflowConfigurationError(
        `Workflow '${metadata.name}' retention.ttlMs must be greater than or equal to autoResume.stuckThresholdMs.`,
      );
    }

    if (
      metadata.compensation?.enabled &&
      metadata.persistence?.snapshotEvery === undefined
    ) {
      throw new WorkflowConfigurationError(
        `Workflow '${metadata.name}' enables compensation but persistence.snapshotEvery is not configured.`,
      );
    }
  }

  private validateRetention(workflow: RegisteredWorkflow): void {
    const retention = workflow.metadata.retention;

    if (!retention) {
      return;
    }

    this.validatePositiveDuration(workflow, 'retention.ttlMs', retention.ttlMs);

    this.validatePositiveInteger(
      workflow,
      'retention.batchSize',
      retention.batchSize,
    );
  }

  private validatePersistence(workflow: RegisteredWorkflow): void {
    const persistence = workflow.metadata.persistence;

    if (!persistence) {
      return;
    }

    this.validatePositiveInteger(
      workflow,
      'persistence.snapshotEvery',
      persistence.snapshotEvery,
    );
  }

  private validateCompensation(workflow: RegisteredWorkflow): void {
    const compensation = workflow.metadata.compensation;

    if (!compensation) {
      return;
    }

    if (
      compensation.strategy === 'custom' &&
      (!compensation.order || compensation.order.length === 0)
    ) {
      throw new WorkflowConfigurationError(
        `Workflow '${workflow.metadata.name}' uses custom compensation without defining an order.`,
      );
    }

    for (const step of compensation.order ?? []) {
      if (!workflow.steps.has(step)) {
        throw new WorkflowConfigurationError(
          `Workflow '${workflow.metadata.name}' references unknown compensation step '${step}'.`,
        );
      }
    }
  }

  private validateSignals(workflow: RegisteredWorkflow): void {
    const signals = workflow.metadata.signals;

    if (!signals) {
      return;
    }

    this.validatePositiveDuration(
      workflow,
      'signals.defaultTimeoutMs',
      signals.defaultTimeoutMs,
    );

    if (
      signals.defaultTimeoutMs !== undefined &&
      signals.defaultTimeoutMs > MAX_DURATION_MS
    ) {
      throw new WorkflowConfigurationError(
        `Workflow '${workflow.metadata.name}' has signal defaultTimeoutMs ` +
          `${signals.defaultTimeoutMs}ms which exceeds the maximum of ` +
          `${MAX_DURATION_MS}ms (365 days). Signal expiry would be effectively ` +
          `disabled. Remove the field to use the library default.`,
      );
    }

    const supported = signals.supportedSignals;

    if (!supported) {
      return;
    }

    const unique = new Set<string>();

    for (const signal of supported) {
      if (!signal.trim()) {
        throw new WorkflowConfigurationError(
          `Workflow '${workflow.metadata.name}' declares an empty signal name.`,
        );
      }

      if (unique.has(signal)) {
        throw new WorkflowConfigurationError(
          `Workflow '${workflow.metadata.name}' declares duplicate signal '${signal}'.`,
        );
      }

      unique.add(signal);
    }
  }

  private validateAutoResume(workflow: RegisteredWorkflow): void {
    const autoResume = workflow.metadata.autoResume;

    if (!autoResume) {
      return;
    }

    this.validatePositiveDuration(
      workflow,
      'autoResume.intervalMs',
      autoResume.intervalMs,
    );

    this.validatePositiveDuration(
      workflow,
      'autoResume.stuckThresholdMs',
      autoResume.stuckThresholdMs,
    );

    this.validatePositiveInteger(
      workflow,
      'autoResume.maxAttempts',
      autoResume.maxAttempts,
      MAX_ATTEMPTS,
    );

    this.validatePositiveInteger(
      workflow,
      'autoResume.batchSize',
      autoResume.batchSize,
    );
  }

  private validateTimeouts(workflow: RegisteredWorkflow): void {
    const validateTimeout = (name: string, value?: number) => {
      if (value === undefined) {
        return;
      }

      if (!Number.isFinite(value) || value <= 0) {
        throw new WorkflowConfigurationError(
          `${name} must be a positive finite number.`,
        );
      }

      if (value > MAX_DURATION_MS) {
        throw new WorkflowConfigurationError(
          `${name} must be <= ${MAX_DURATION_MS}ms (365 days), got ${value}ms. ` +
            `Step execution cannot exceed 365 days.`,
        );
      }
    };

    validateTimeout(
      `Workflow '${workflow.metadata.name}' defaultStepTimeoutMs`,
      workflow.metadata.defaultStepTimeoutMs,
    );

    for (const step of workflow.steps.values()) {
      validateTimeout(
        `Step '${step.metadata.step}' timeoutMs`,
        step.metadata.timeoutMs,
      );
    }
  }

  private validateChildWorkflows(workflow: RegisteredWorkflow): void {
    const children = workflow.metadata.childWorkflows;

    if (!children) {
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    const seen = new Set<Function>();

    for (const child of children) {
      if (seen.has(child.workflow)) {
        throw new WorkflowConfigurationError(
          `Workflow '${workflow.metadata.name}' declares child workflow '${child.workflow.name}' more than once.`,
        );
      }

      if (child.workflow === workflow.workflowType) {
        throw new WorkflowConfigurationError(
          `Workflow '${workflow.metadata.name}' cannot declare itself as a child workflow.`,
        );
      }

      switch (child.failurePolicy) {
        case 'fail-parent':
        case 'ignore':
        case 'retry-child':
        case 'compensate-parent':
          break;

        default:
          child.failurePolicy satisfies never;
      }

      switch (child.cancellationPolicy) {
        case 'propagate':
        case 'detach':
          break;

        default:
          child.cancellationPolicy satisfies never;
      }

      if (
        child.failurePolicy === 'compensate-parent' &&
        !workflow.metadata.compensation?.enabled
      ) {
        throw new WorkflowConfigurationError(
          `Workflow '${workflow.metadata.name}' declares child workflow ` +
            `'${child.workflow.name}' with failurePolicy 'compensate-parent' ` +
            `but does not have compensation enabled. ` +
            `Set compensation: { enabled: true, strategy: '...' } on ` +
            `'${workflow.metadata.name}' or change the child failurePolicy.`,
        );
      }

      if (
        child.maxRetries !== undefined &&
        (!Number.isInteger(child.maxRetries) || child.maxRetries < 1)
      ) {
        throw new WorkflowConfigurationError(
          `Workflow '${workflow.metadata.name}' declares child workflow ` +
            `'${child.workflow.name}' with maxRetries=${child.maxRetries}. ` +
            `maxRetries must be a positive integer >= 1.`,
        );
      }

      if (
        child.maxRetries !== undefined &&
        child.failurePolicy !== 'retry-child'
      ) {
        throw new WorkflowConfigurationError(
          `Workflow '${workflow.metadata.name}' declares child workflow ` +
            `'${child.workflow.name}' with maxRetries=${child.maxRetries} ` +
            `but failurePolicy is '${child.failurePolicy}'. ` +
            `maxRetries is only applicable when failurePolicy is 'retry-child'.`,
        );
      }

      seen.add(child.workflow);
    }
  }

  private validateDeprecatedSteps(workflow: RegisteredWorkflow): void {
    for (const step of workflow.steps.values()) {
      const metadata = step.metadata;

      if (
        metadata.deprecated &&
        workflow.metadata.definition.start === metadata.step
      ) {
        throw new WorkflowConfigurationError(
          `Workflow '${workflow.metadata.name}' cannot start on deprecated step '${metadata.step}'.`,
        );
      }

      if (!metadata.replacedBy) {
        continue;
      }

      if (!workflow.steps.has(metadata.replacedBy)) {
        throw new WorkflowConfigurationError(
          `Step '${metadata.step}' replaces unknown step '${metadata.replacedBy}'`,
        );
      }

      if (metadata.replacedBy === metadata.step) {
        throw new WorkflowConfigurationError(
          `Step '${metadata.step}' cannot replace itself.`,
        );
      }
    }
  }

  private validateTerminalSteps(workflow: RegisteredWorkflow): void {
    const hasTerminalStep = [...workflow.steps.keys()].some(
      (step) =>
        (workflow.metadata.definition.transitions[step] ?? []).length === 0,
    );

    if (!workflow.metadata.definition.allowCycles && !hasTerminalStep) {
      throw new WorkflowConfigurationError(
        `Workflow '${workflow.metadata.name}' has no terminal step`,
      );
    }
  }

  private validateRetryPolicy(workflow: RegisteredWorkflow): void {
    const retry = workflow.metadata.retries;

    if (!retry) {
      return;
    }

    if (retry.maxAttempts < 1) {
      throw new WorkflowConfigurationError(
        `Workflow '${workflow.metadata.name}' maxAttempts must be >= 1`,
      );
    }

    if (retry.maxAttempts > MAX_ATTEMPTS) {
      throw new WorkflowConfigurationError(
        `Workflow '${workflow.metadata.name}' retries.maxAttempts ` +
          `must be <= ${MAX_ATTEMPTS}, got ${retry.maxAttempts}.`,
      );
    }

    if (
      retry.delayMs !== undefined &&
      (!Number.isFinite(retry.delayMs) ||
        retry.delayMs < 0 ||
        retry.delayMs > MAX_DURATION_MS)
    ) {
      throw new WorkflowConfigurationError(
        `Workflow '${workflow.metadata.name}' retries.delayMs ` +
          `must be a non-negative finite number <= ${MAX_DURATION_MS}ms (365 days), ` +
          `got ${retry.delayMs}.`,
      );
    }

    if (
      retry.maxDelayMs !== undefined &&
      (!Number.isFinite(retry.maxDelayMs) ||
        retry.maxDelayMs < 0 ||
        retry.maxDelayMs > MAX_DURATION_MS)
    ) {
      throw new WorkflowConfigurationError(
        `Workflow '${workflow.metadata.name}' retries.maxDelayMs ` +
          `must be a non-negative finite number <= ${MAX_DURATION_MS}ms (365 days), ` +
          `got ${retry.maxDelayMs}.`,
      );
    }

    if (
      retry.delayMs !== undefined &&
      retry.maxDelayMs !== undefined &&
      retry.maxDelayMs < retry.delayMs
    ) {
      throw new WorkflowConfigurationError(
        `Workflow '${workflow.metadata.name}' retries.maxDelayMs ` +
          `(${retry.maxDelayMs}ms) must be >= retries.delayMs (${retry.delayMs}ms).`,
      );
    }

    if (retry.strategy === 'fixed' && retry.maxDelayMs !== undefined) {
      throw new WorkflowConfigurationError(
        `Workflow '${workflow.metadata.name}' retries.maxDelayMs is not ` +
          `applicable when strategy is 'fixed'. Remove maxDelayMs or ` +
          `change the strategy to 'exponential'.`,
      );
    }
  }

  private validateReachability(workflow: RegisteredWorkflow): void {
    const visited = this.traverse(workflow, () => {});

    for (const step of workflow.steps.keys()) {
      if (!visited.has(step)) {
        throw new WorkflowConfigurationError(
          `Workflow '${workflow.metadata.name}' contains unreachable step '${step}'`,
        );
      }
    }
  }

  private validateCycles(workflow: RegisteredWorkflow): void {
    if (workflow.metadata.definition.allowCycles) {
      return;
    }

    const visited = new Set<string>();
    const recursion = new Set<string>();

    const transitions = workflow.metadata.definition.transitions;

    const dfs = (step: string): boolean => {
      if (recursion.has(step)) {
        return true;
      }

      if (visited.has(step)) {
        return false;
      }

      visited.add(step);
      recursion.add(step);

      for (const next of transitions[step as WorkflowStepId] ?? []) {
        if (dfs(next)) {
          return true;
        }
      }

      recursion.delete(step);

      return false;
    };

    if (dfs(workflow.metadata.definition.start)) {
      throw new WorkflowConfigurationError(
        `Workflow '${workflow.metadata.name}' contains a cycle`,
      );
    }
  }

  private validateStartStep(workflow: RegisteredWorkflow): void {
    const start = workflow.metadata.definition.start;

    if (!workflow.steps.has(start)) {
      throw new WorkflowConfigurationError(
        `Workflow '${workflow.metadata.name}' start step '${start}' does not exist`,
      );
    }
  }

  private validateTransitions(workflow: RegisteredWorkflow): void {
    const transitions = workflow.metadata.definition.transitions;

    for (const [source, targets] of Object.entries(transitions) as [
      WorkflowStepId,
      readonly WorkflowStepId[],
    ][]) {
      if (!workflow.steps.has(source)) {
        throw new WorkflowConfigurationError(
          `Workflow '${workflow.metadata.name}' transition source '${source}' does not exist`,
        );
      }

      for (const target of targets ?? []) {
        if (!workflow.steps.has(target)) {
          throw new WorkflowConfigurationError(
            `Workflow '${workflow.metadata.name}' transition target '${target}' does not exist`,
          );
        }
      }
    }
  }
}
