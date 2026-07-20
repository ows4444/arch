/**
 * Structural contract for `@Step({ inputSpec })` — deliberately self-contained (no import from
 * `@/validation`). `libs/workflow` (`@ows4444/nest-workflow`) is built and published as a
 * standalone package; `@/validation` is a workspace-only path alias, not a real dependency this
 * package can declare. Shaped identically to `@/validation`'s `Specification<T>` so any
 * `Specification` instance built there satisfies this interface by structural typing alone, with
 * zero import coupling in either direction. See ARCH.md, Design 002.
 */
export interface WorkflowStepInputSpecification<T = unknown> {
  readonly name: string;
  isSatisfiedBy(candidate: T): boolean | Promise<boolean>;
  explain(candidate: T): string[] | Promise<string[]>;
}
