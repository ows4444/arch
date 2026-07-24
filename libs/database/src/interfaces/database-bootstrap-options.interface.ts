import { EntitySchema, MixedList } from 'typeorm';

export interface DatabaseBootstrapOptions {
  readonly entities:
    | MixedList<string | (new (...args: any[]) => unknown) | EntitySchema<any>>
    | undefined;

  readonly migrations?:
    MixedList<(new (...args: any[]) => unknown) | string> | undefined;
}
