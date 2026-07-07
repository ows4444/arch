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
  console.error(
    '[Cache] Plugin execution failed.',
    error,
    plugin.constructor.name,
  );
};
