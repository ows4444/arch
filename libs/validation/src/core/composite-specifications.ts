import type { Specification } from './specification.interface';

class AndSpecification<T> implements Specification<T> {
  constructor(
    private readonly left: Specification<T>,
    private readonly right: Specification<T>,
  ) {}

  get name(): string {
    return `(${this.left.name} AND ${this.right.name})`;
  }

  async isSatisfiedBy(candidate: T): Promise<boolean> {
    return (
      (await this.left.isSatisfiedBy(candidate)) &&
      (await this.right.isSatisfiedBy(candidate))
    );
  }

  async explain(candidate: T): Promise<string[]> {
    return [
      ...(await this.left.explain(candidate)),
      ...(await this.right.explain(candidate)),
    ];
  }
}

class OrSpecification<T> implements Specification<T> {
  constructor(
    private readonly left: Specification<T>,
    private readonly right: Specification<T>,
  ) {}

  get name(): string {
    return `(${this.left.name} OR ${this.right.name})`;
  }

  async isSatisfiedBy(candidate: T): Promise<boolean> {
    return (
      (await this.left.isSatisfiedBy(candidate)) ||
      (await this.right.isSatisfiedBy(candidate))
    );
  }

  async explain(candidate: T): Promise<string[]> {
    if (await this.isSatisfiedBy(candidate)) {
      return [];
    }

    return [
      ...(await this.left.explain(candidate)),
      ...(await this.right.explain(candidate)),
    ];
  }
}

class NotSpecification<T> implements Specification<T> {
  constructor(private readonly inner: Specification<T>) {}

  get name(): string {
    return `NOT ${this.inner.name}`;
  }

  async isSatisfiedBy(candidate: T): Promise<boolean> {
    return !(await this.inner.isSatisfiedBy(candidate));
  }

  async explain(candidate: T): Promise<string[]> {
    if (await this.isSatisfiedBy(candidate)) {
      return [];
    }

    return [`${this.name} was not satisfied`];
  }
}

export function and<T>(
  left: Specification<T>,
  right: Specification<T>,
): Specification<T> {
  return new AndSpecification(left, right);
}

export function or<T>(
  left: Specification<T>,
  right: Specification<T>,
): Specification<T> {
  return new OrSpecification(left, right);
}

export function not<T>(inner: Specification<T>): Specification<T> {
  return new NotSpecification(inner);
}
