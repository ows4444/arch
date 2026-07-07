export type SortDirection = 'ASC' | 'DESC';

export interface OffsetPaginationRequest<TSort extends string = string> {
  readonly page?: number;

  readonly limit?: number;

  readonly sortBy?: TSort;

  readonly sortOrder?: SortDirection;
}

export interface OffsetPaginationResult<T> {
  readonly items: readonly T[];

  readonly total: number;

  readonly page: number;

  readonly limit: number;

  readonly totalPages: number;

  readonly hasNext: boolean;

  readonly hasPrevious: boolean;
}

export interface CursorPaginationRequest {
  readonly cursor?: string;

  readonly limit?: number;
}

export interface CursorPaginationResult<T> {
  readonly items: readonly T[];

  readonly nextCursor?: string;

  readonly hasNext: boolean;
}
