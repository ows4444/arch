export interface DatabaseHealthOptions {
  readonly intervalMs?: number;

  readonly query?: string;

  readonly timeoutMs?: number;
}
