import { ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import { OffsetPaginationResult } from './pagination.types';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export async function paginateOffset<TEntity extends ObjectLiteral>(
  queryBuilder: SelectQueryBuilder<TEntity>,
  page = DEFAULT_PAGE,
  limit = DEFAULT_LIMIT,
): Promise<OffsetPaginationResult<TEntity>> {
  const normalizedPage = Math.max(DEFAULT_PAGE, page);
  const normalizedLimit = Math.min(MAX_LIMIT, Math.max(1, limit));

  const [items, total] = await queryBuilder
    .skip((normalizedPage - 1) * normalizedLimit)
    .take(normalizedLimit)
    .getManyAndCount();

  const totalPages = total === 0 ? 0 : Math.ceil(total / normalizedLimit);

  return {
    items,
    total,

    page: normalizedPage,
    limit: normalizedLimit,

    totalPages,

    hasNext: normalizedPage < totalPages,

    hasPrevious: normalizedPage > 1,
  };
}
