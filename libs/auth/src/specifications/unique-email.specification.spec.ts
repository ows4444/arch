import { UniqueEmailSpecification } from './unique-email.specification';
import type { UserRepository } from '../domain/user.repository';

describe('UniqueEmailSpecification', () => {
  function fakeUsers(existing: { email: string } | null): UserRepository {
    return { findByEmail: jest.fn(() => Promise.resolve(existing)) } as never;
  }

  it('is satisfied when no user with that email exists', async () => {
    const spec = new UniqueEmailSpecification(fakeUsers(null));

    expect(await spec.isSatisfiedBy('new@example.com')).toBe(true);
    expect(await spec.explain('new@example.com')).toEqual([]);
  });

  it('is not satisfied when a user with that email already exists', async () => {
    const spec = new UniqueEmailSpecification(
      fakeUsers({ email: 'taken@example.com' }),
    );

    expect(await spec.isSatisfiedBy('taken@example.com')).toBe(false);
    expect(await spec.explain('taken@example.com')).toEqual([
      "Email 'taken@example.com' is already registered.",
    ]);
  });
});
