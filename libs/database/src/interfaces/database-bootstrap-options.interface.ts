import { EntitySchema, MixedList } from 'typeorm';

export interface DatabaseBootstrapOptions {
  readonly entities:
    MixedList<string | Function | EntitySchema<any>> | undefined;
}
