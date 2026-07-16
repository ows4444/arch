import type { SelectQueryBuilder } from 'typeorm';
import { paginateOffset } from './pagination.util';

interface FakeEntity {
  id: number;
}

function fakeQueryBuilder(
  items: FakeEntity[],
  total: number,
): SelectQueryBuilder<FakeEntity> {
  return {
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn().mockResolvedValue([items, total]),
  } as unknown as SelectQueryBuilder<FakeEntity>;
}

describe('paginateOffset', () => {
  it('uses default page=1, limit=20 when not provided', async () => {
    const qb = fakeQueryBuilder([], 0);

    const result = await paginateOffset(qb);

    expect(qb.skip).toHaveBeenCalledWith(0);
    expect(qb.take).toHaveBeenCalledWith(20);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
  });

  it.each([0, -1, -100])('clamps page=%d to page 1', async (page) => {
    const qb = fakeQueryBuilder([], 0);

    const result = await paginateOffset(qb, page, 10);

    expect(result.page).toBe(1);
    expect(qb.skip).toHaveBeenCalledWith(0);
  });

  it('caps limit at 100 when requesting a larger limit', async () => {
    const qb = fakeQueryBuilder([], 0);

    const result = await paginateOffset(qb, 1, 500);

    expect(result.limit).toBe(100);
    expect(qb.take).toHaveBeenCalledWith(100);
  });

  it.each([0, -1, -50])('floors limit=%d to 1', async (limit) => {
    const qb = fakeQueryBuilder([], 0);

    const result = await paginateOffset(qb, 1, limit);

    expect(result.limit).toBe(1);
    expect(qb.take).toHaveBeenCalledWith(1);
  });

  it('passes the correct skip/take for a given page/limit', async () => {
    const qb = fakeQueryBuilder([], 0);

    await paginateOffset(qb, 3, 10);

    expect(qb.skip).toHaveBeenCalledWith(20);
    expect(qb.take).toHaveBeenCalledWith(10);
  });

  it('computes totalPages correctly', async () => {
    const qb = fakeQueryBuilder([], 95);

    const result = await paginateOffset(qb, 1, 20);

    expect(result.totalPages).toBe(5);
  });

  it('computes totalPages as 0 when total is 0', async () => {
    const qb = fakeQueryBuilder([], 0);

    const result = await paginateOffset(qb, 1, 20);

    expect(result.totalPages).toBe(0);
  });

  it('hasNext/hasPrevious are correct on the first page', async () => {
    const qb = fakeQueryBuilder([], 100);

    const result = await paginateOffset(qb, 1, 20);

    expect(result.hasPrevious).toBe(false);
    expect(result.hasNext).toBe(true);
  });

  it('hasNext/hasPrevious are correct on a middle page', async () => {
    const qb = fakeQueryBuilder([], 100);

    const result = await paginateOffset(qb, 3, 20);

    expect(result.hasPrevious).toBe(true);
    expect(result.hasNext).toBe(true);
  });

  it('hasNext/hasPrevious are correct on the last page', async () => {
    const qb = fakeQueryBuilder([], 100);

    const result = await paginateOffset(qb, 5, 20);

    expect(result.hasPrevious).toBe(true);
    expect(result.hasNext).toBe(false);
  });

  it('returns the items and total from the query builder', async () => {
    const items = [{ id: 1 }, { id: 2 }];
    const qb = fakeQueryBuilder(items, 2);

    const result = await paginateOffset(qb, 1, 20);

    expect(result.items).toBe(items);
    expect(result.total).toBe(2);
  });
});
