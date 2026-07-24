export const ORGANIZATIONS_MODULE_OPTIONS = Symbol(
  'ORGANIZATIONS_MODULE_OPTIONS',
);

/**
 * The platform-override permission `assertOrgRole` falls back to when the
 * acting user has no (or an insufficient) membership role — seeded via
 * migration, same bootstrap pattern as `libs/auth`'s `roles:manage` and
 * `libs/users`' `users:manage`. See `libs/organizations/ARCH.md` Design 001,
 * Security Architecture.
 */
export const DEFAULT_MANAGE_ORGANIZATIONS_PERMISSION = 'organizations:manage';
