export interface Specification<T> {
  readonly name: string;
  isSatisfiedBy(candidate: T): boolean | Promise<boolean>;
  explain(candidate: T): string[] | Promise<string[]>;
}
