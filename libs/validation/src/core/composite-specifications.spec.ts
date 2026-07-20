import type { Specification } from './specification.interface';
import { and, not, or } from './composite-specifications';

function spec(name: string, satisfied: boolean): Specification<unknown> {
  return {
    name,
    isSatisfiedBy: () => satisfied,
    explain: () => (satisfied ? [] : [`${name} failed`]),
  };
}

describe('composite specifications', () => {
  it('and() is satisfied only when both sides are', async () => {
    expect(await and(spec('a', true), spec('b', true)).isSatisfiedBy({})).toBe(
      true,
    );
    expect(await and(spec('a', true), spec('b', false)).isSatisfiedBy({})).toBe(
      false,
    );
  });

  it('and() collects explanations from both sides on failure', async () => {
    const failures = await and(spec('a', false), spec('b', false)).explain({});
    expect(failures).toEqual(['a failed', 'b failed']);
  });

  it('or() is satisfied when either side is', async () => {
    expect(await or(spec('a', false), spec('b', true)).isSatisfiedBy({})).toBe(
      true,
    );
    expect(await or(spec('a', false), spec('b', false)).isSatisfiedBy({})).toBe(
      false,
    );
  });

  it('or() explains only when both sides fail', async () => {
    expect(await or(spec('a', true), spec('b', false)).explain({})).toEqual([]);
    expect(await or(spec('a', false), spec('b', false)).explain({})).toEqual([
      'a failed',
      'b failed',
    ]);
  });

  it('not() inverts satisfaction', async () => {
    expect(await not(spec('a', true)).isSatisfiedBy({})).toBe(false);
    expect(await not(spec('a', false)).isSatisfiedBy({})).toBe(true);
  });

  it('names compose readably', () => {
    expect(and(spec('a', true), spec('b', true)).name).toBe('(a AND b)');
    expect(or(spec('a', true), spec('b', true)).name).toBe('(a OR b)');
    expect(not(spec('a', true)).name).toBe('NOT a');
  });
});
