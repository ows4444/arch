export const USERS_MODULE_OPTIONS = Symbol('USERS_MODULE_OPTIONS');

/**
 * The admin-override permission `assertOwnerOrPermission` checks when the
 * acting user isn't the profile's owner — seeded via migration, same
 * bootstrap pattern as `libs/auth`'s `roles:manage`. See
 * `libs/users/ARCH.md` Design 001, Security Architecture.
 */
export const DEFAULT_MANAGE_OTHERS_PERMISSION = 'users:manage';
