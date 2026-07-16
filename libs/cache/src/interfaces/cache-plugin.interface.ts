import { Logger } from '@nestjs/common';

export interface CachePlugin<K, V> {
  beforeGet?(key: K): Promise<void> | void;

  afterGet?(key: K, value: V | undefined): Promise<void> | void;

  beforeSet?(key: K, value: V): Promise<void> | void;

  afterSet?(key: K, value: V): Promise<void> | void;

  beforeDelete?(key: K): Promise<void> | void;

  afterDelete?(key: K): Promise<void> | void;

  beforeClear?(): Promise<void> | void;

  afterClear?(): Promise<void> | void;
}

export interface CachePluginErrorHandler {
  (error: unknown, plugin: CachePlugin<any, any>): void;
}
export const defaultPluginErrorHandler: CachePluginErrorHandler = (
  error,
  plugin,
) => {
  const message = error instanceof Error ? error.message : String(error);

  Logger.error(
    `Plugin '${plugin.constructor.name}' execution failed: ${message}`,
    error instanceof Error ? error.stack : undefined,
    'Cache',
  );
};
