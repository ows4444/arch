import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@/database';
import { AuthorizationService } from '@/auth';
import { AuditService } from '@/audit';
import { UserProfileRepository } from '../domain/user-profile.repository';
import { UserProfileEntity } from '../domain/user-profile.entity';
import { isDuplicateKeyError } from '../domain/is-duplicate-key-error';
import { UserProfileNotFoundError } from '../errors/user-profile-not-found.error';
import { ForbiddenProfileAccessError } from '../errors/forbidden-profile-access.error';
import {
  DEFAULT_MANAGE_OTHERS_PERMISSION,
  USERS_MODULE_OPTIONS,
} from '../users.constants';
import type { UsersModuleOptions } from '../users.types';

export interface UpdateProfilePatch {
  displayName?: string;
  avatarUrl?: string | null;
  bio?: string | null;
  locale?: string | null;
  timezone?: string | null;
}

/**
 * `assertOwnerOrPermission` is the concrete answer to the resource-level/
 * ownership authorization item `REQUIREMENTS.md` Tier 1 flagged and
 * `libs/auth/ARCH.md` explicitly deferred until a real consumer existed —
 * see `libs/users/ARCH.md` Design 001, Key Decisions HIGH #3. It's a
 * two-branch comparison, not a policy engine, by design.
 */
@Injectable()
export class UserProfileService {
  private readonly manageOthersPermission: string;

  constructor(
    @InjectRepository(UserProfileRepository)
    private readonly profiles: UserProfileRepository,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditService,
    @Inject(USERS_MODULE_OPTIONS)
    options: UsersModuleOptions,
  ) {
    this.manageOthersPermission =
      options.manageOthersPermission ?? DEFAULT_MANAGE_OTHERS_PERMISSION;
  }

  /**
   * Self-service only: creates a default-shaped row on first access rather
   * than requiring registration-time orchestration with `libs/auth` — see
   * ARCH.md Key Decisions HIGH #1. Every authenticated caller already has a
   * `userId` a valid JWT vouched for, so there is no ownership check here.
   */
  async getOrCreateMine(userId: string): Promise<UserProfileEntity> {
    const existing = await this.profiles.findByUserId(userId);

    if (existing) {
      return existing;
    }

    try {
      return await this.profiles.save({ userId, displayName: '' });
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        throw error;
      }

      // Lost a create race against a concurrent first request for the same
      // user — the row now exists, so read it instead of failing.
      const created = await this.profiles.findByUserId(userId);

      if (!created) {
        throw error;
      }

      return created;
    }
  }

  async updateMine(
    userId: string,
    patch: UpdateProfilePatch,
  ): Promise<UserProfileEntity> {
    const profile = await this.getOrCreateMine(userId);

    // Filter to keys whose value was actually provided *before* merging —
    // `patch` may be a real `UpdateProfileDto` instance, which (per this
    // project's TS class-field semantics) has every declared field present
    // as an own key set to `undefined` even when the caller omitted it.
    // Left unfiltered, `{ ...profile, ...patch }` still spreads those
    // `undefined` values over `profile`'s real ones: TypeORM's `save()`
    // correctly skips `undefined` columns in the actual UPDATE (the DB row
    // itself is never corrupted — confirmed empirically), but the *object
    // this method returns* would show those fields as null instead of their
    // real, unchanged value, since it's built from the same merged object.
    // Confirmed live against real MySQL for the audit-metadata half of this
    // (see `libs/audit/LOOP.md` Loop 002) — the response-body half wasn't
    // checked there since that pass only verified fields actually sent.
    const providedFields = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    ) as Partial<UpdateProfilePatch>;

    const updated = await this.profiles.save({
      ...profile,
      ...providedFields,
    });

    await this.audit.record({
      actorId: userId,
      action: 'profile.updated',
      targetType: 'user_profile',
      targetId: userId,
      metadata: { fields: Object.keys(providedFields) },
    });

    return updated;
  }

  /**
   * Checks the permission override *before* looking the profile up, so a
   * caller with neither ownership nor `manageOthersPermission` gets the same
   * 403 whether or not a profile exists for `targetUserId` — never leaking
   * profile existence to someone unauthorized to see it.
   */
  async getForUser(
    targetUserId: string,
    actingUserId: string,
  ): Promise<UserProfileEntity> {
    await this.assertOwnerOrPermission(targetUserId, actingUserId);

    const profile = await this.profiles.findByUserId(targetUserId);

    if (!profile) {
      throw new UserProfileNotFoundError(targetUserId);
    }

    return profile;
  }

  private async assertOwnerOrPermission(
    targetUserId: string,
    actingUserId: string,
  ): Promise<void> {
    if (targetUserId === actingUserId) {
      return;
    }

    const allowed = await this.authorization.hasPermission(
      actingUserId,
      this.manageOthersPermission,
    );

    if (!allowed) {
      throw new ForbiddenProfileAccessError();
    }
  }
}
