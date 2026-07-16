import { Injectable, OnModuleInit, Type } from '@nestjs/common';
import { DiscoveryService, Reflector } from '@nestjs/core';

import {
  WORKFLOW_HOOK_METADATA,
  WORKFLOW_METADATA,
  WORKFLOW_SIGNAL_METADATA,
} from '../../constants/workflow.constants';
import { WORKFLOW_STEP_METADATA } from '../../constants/workflow.constants';
import { WorkflowHookMetadata } from '../hooks/hook.metadata';
import { WorkflowSignalMetadata } from '../signals/signal.metadata';
import { WorkflowDefinitionValidator } from '../validation/definition.validator';
import { WorkflowRegistry } from './registry';
import { WorkflowMetadata } from '../../definition/workflow-metadata';
import { WorkflowStepMetadata } from '../../definition/workflow-step-metadata';
import { WorkflowConfigurationError } from '../../errors/workflow.errors';
import { WorkflowStepHandler } from '../../handlers/workflow-step-handler';
import { RegisteredWorkflowStep } from '../../models/registered-workflow';
import { WorkflowStepId } from '../../models/workflow-step-id';
import { deepFreeze } from '../../shared/utils/deep-freeze';

interface MutableRegisteredWorkflow {
  readonly metadata: WorkflowMetadata;
  readonly workflowType: Type<unknown>;
  readonly steps: Map<WorkflowStepId, RegisteredWorkflowStep>;

  readonly transitions: Map<WorkflowStepId, ReadonlySet<WorkflowStepId>>;
}

@Injectable()
export class WorkflowDiscovery implements OnModuleInit {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly reflector: Reflector,
    private readonly registry: WorkflowRegistry,
    private readonly validator: WorkflowDefinitionValidator,
  ) {}

  private registerStep(
    workflow: MutableRegisteredWorkflow,
    metadata: WorkflowStepMetadata,
    type: Type<WorkflowStepHandler>,
  ): void {
    if (workflow.steps.has(metadata.step)) {
      throw new WorkflowConfigurationError(
        `Duplicate step '${metadata.step}' in workflow '${workflow.metadata.name}'`,
      );
    }

    workflow.steps.set(metadata.step, {
      metadata,
      type,
    });
  }

  private findWorkflow(
    workflows: Map<string, MutableRegisteredWorkflow>,
    name: string,
    version: number,
  ): MutableRegisteredWorkflow | undefined {
    return workflows.get(WorkflowRegistry.buildKey(name, version));
  }

  private validateChildWorkflowCycles(
    workflows: Map<string, MutableRegisteredWorkflow>,
  ): void {
    const byType = new Map(
      [...workflows.values()].map((workflow) => [
        workflow.workflowType,
        workflow,
      ]),
    );

    const visited = new Set<Type<unknown>>();
    const recursionStack = new Set<Type<unknown>>();

    const visit = (workflow: MutableRegisteredWorkflow): void => {
      const type = workflow.workflowType;

      if (recursionStack.has(type)) {
        throw new WorkflowConfigurationError(
          `Workflow '${workflow.metadata.name}' is part of a circular child workflow relationship.`,
        );
      }

      if (visited.has(type)) {
        return;
      }

      visited.add(type);
      recursionStack.add(type);

      for (const child of workflow.metadata.childWorkflows ?? []) {
        const childWorkflow = byType.get(child.workflow);

        if (childWorkflow) {
          visit(childWorkflow);
        }
      }

      recursionStack.delete(type);
    };

    for (const workflow of workflows.values()) {
      visit(workflow);
    }
  }

  onModuleInit(): void {
    const providers = this.discovery.getProviders();

    const workflows = new Map<string, MutableRegisteredWorkflow>();

    for (const wrapper of providers) {
      const type = wrapper.metatype;

      if (!type) {
        continue;
      }

      const workflowMetadata = this.reflector.get<WorkflowMetadata>(
        WORKFLOW_METADATA,
        type,
      );

      if (!workflowMetadata) {
        continue;
      }

      const hookMetadata = this.reflector.get<WorkflowHookMetadata>(
        WORKFLOW_HOOK_METADATA,
        type,
      );

      const signalMetadata = this.reflector.get<WorkflowSignalMetadata>(
        WORKFLOW_SIGNAL_METADATA,
        type,
      );

      const metadata: WorkflowMetadata = deepFreeze({
        ...workflowMetadata,
        hooks: hookMetadata ?? workflowMetadata.hooks,
        signals: signalMetadata ?? workflowMetadata.signals,
      });

      const key = WorkflowRegistry.buildKey(metadata.name, metadata.version);
      if (workflows.has(key)) {
        throw new WorkflowConfigurationError(
          `Workflow '${metadata.name}' version '${metadata.version}' already exists`,
        );
      }

      workflows.set(key, {
        metadata,
        workflowType: type as Type<unknown>,
        steps: new Map(),
        transitions: new Map(),
      });
    }

    for (const wrapper of providers) {
      const type = wrapper.metatype as Type<WorkflowStepHandler> | undefined;

      if (!type) {
        continue;
      }

      const metadata = this.reflector.get<WorkflowStepMetadata>(
        WORKFLOW_STEP_METADATA,
        type,
      );

      if (!metadata) {
        continue;
      }

      const matchingVersions = [...workflows.values()]
        .filter((w) => w.metadata.name === metadata.workflow)
        .map((w) => w.metadata.version);

      if (
        metadata.workflowVersion === undefined &&
        matchingVersions.length === 0
      ) {
        throw new WorkflowConfigurationError(
          `Step '${metadata.step}' references unknown workflow '${metadata.workflow}' — no version registered`,
        );
      }

      const resolvedVersion =
        metadata.workflowVersion ?? Math.max(...matchingVersions);

      const workflow = this.findWorkflow(
        workflows,
        metadata.workflow,
        resolvedVersion,
      );

      if (!workflow) {
        const knownVersions = [...workflows.keys()]
          .filter((k) => k.startsWith(`${metadata.workflow}:`))
          .map((k) => k.split(':')[1]);
        const hint =
          knownVersions.length > 0
            ? ` (workflow '${metadata.workflow}' exists at version(s) ${knownVersions.join(', ')} — did you forget to set workflowVersion on the @Step decorator?)`
            : '';
        throw new WorkflowConfigurationError(
          `Step '${metadata.step}' references unknown workflow '${metadata.workflow}' v${resolvedVersion}${hint}`,
        );
      }

      if (workflow.steps.has(metadata.step)) {
        throw new WorkflowConfigurationError(
          `Duplicate step '${metadata.step}' in workflow '${metadata.workflow}'`,
        );
      }

      this.registerStep(workflow, metadata, type);
    }

    this.validateChildWorkflowCycles(workflows);

    for (const workflow of workflows.values()) {
      this.validator.validate(workflow);

      for (const child of workflow.metadata.childWorkflows ?? []) {
        const registered = [...workflows.values()].some(
          (candidate) => candidate.workflowType === child.workflow,
        );

        if (!registered) {
          throw new WorkflowConfigurationError(
            `Workflow '${workflow.metadata.name}' references unregistered child workflow '${child.workflow.name}'.`,
          );
        }
      }

      const transitions = new Map<
        WorkflowStepId,
        ReadonlySet<WorkflowStepId>
      >();

      for (const [step, targets] of Object.entries(
        workflow.metadata.definition.transitions,
      ) as [WorkflowStepId, readonly WorkflowStepId[]][]) {
        transitions.set(step, new Set(targets));
      }

      this.registry.register({
        ...workflow,
        transitions,
      });
    }
  }
}
