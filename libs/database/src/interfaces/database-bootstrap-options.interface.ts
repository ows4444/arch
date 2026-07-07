import { EntitySchema, MixedList } from 'typeorm';

export interface DatabaseBootstrapOptions {
  readonly entities:
    | MixedList<string | ((...args: any[]) => any) | EntitySchema<any>>
    | undefined;
}
