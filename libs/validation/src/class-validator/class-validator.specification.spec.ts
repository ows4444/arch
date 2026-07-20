import { IsInt, IsString, Min } from 'class-validator';
import {
  ClassValidatorSpecification,
  ClassValidatorSpecificationError,
} from './class-validator.specification';

class SampleDto {
  @IsString()
  name!: string;

  @IsInt()
  @Min(0)
  age!: number;
}

describe('ClassValidatorSpecification', () => {
  const spec = new ClassValidatorSpecification(SampleDto);

  it('is satisfied by a valid payload', () => {
    expect(spec.isSatisfiedBy({ name: 'ada', age: 30 })).toBe(true);
  });

  it('is not satisfied by an invalid payload', () => {
    expect(spec.isSatisfiedBy({ name: 'ada', age: -1 })).toBe(false);
  });

  it('rejects unknown fields (whitelist/forbidNonWhitelisted)', () => {
    expect(spec.isSatisfiedBy({ name: 'ada', age: 30, extra: 'x' })).toBe(
      false,
    );
  });

  it('explains failures with human-readable constraint messages', () => {
    const messages = spec.explain({ name: 'ada', age: -1 });
    expect(messages.length).toBeGreaterThan(0);
  });

  it('toInstance returns a typed instance on success', () => {
    const instance = spec.toInstance({ name: 'ada', age: 30 });
    expect(instance).toBeInstanceOf(SampleDto);
    expect(instance.name).toBe('ada');
  });

  it('toInstance throws ClassValidatorSpecificationError on failure', () => {
    expect(() => spec.toInstance({ name: 'ada', age: -1 })).toThrow(
      ClassValidatorSpecificationError,
    );
  });
});
