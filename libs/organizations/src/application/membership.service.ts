import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@/database';
import { AuditService } from '@/audit';
import { MembershipRepository } from '../domain/membership.repository';
import { MembershipEntity } from '../domain/membership.entity';
import { MembershipRole } from '../domain/membership-role.enum';
import { OrganizationService } from './organization.service';
import { MembershipNotFoundError } from '../errors/membership-not-found.error';
import { AlreadyAMemberError } from '../errors/already-a-member.error';
import { CannotRemoveLastOwnerError } from '../errors/cannot-remove-last-owner.error';
import { ForbiddenOrganizationAccessError } from '../errors/forbidden-organization-access.error';
import { isDuplicateKeyError } from '../domain/is-duplicate-key-error';

@Injectable()
export class MembershipService {
  constructor(
    @InjectRepository(MembershipRepository)
    private readonly memberships: MembershipRepository,
    private readonly organizations: OrganizationService,
    private readonly audit: AuditService,
  ) {}

  /** Requires the caller to be any member of the organization (or the platform override). */
  async listMembers(
    organizationId: string,
    actingUserId: string,
  ): Promise<MembershipEntity[]> {
    await this.organizations.assertOrgRole(
      actingUserId,
      organizationId,
      MembershipRole.MEMBER,
    );

    return this.memberships.findByOrganization(organizationId);
  }

  async addMember(
    organizationId: string,
    targetUserId: string,
    role: MembershipRole,
    actingUserId: string,
  ): Promise<MembershipEntity> {
    await this.organizations.assertOrgRole(
      actingUserId,
      organizationId,
      MembershipRole.ADMIN,
    );
    await this.assertActorCanTouchRole(organizationId, actingUserId, role);

    try {
      const created = await this.memberships.save({
        organizationId,
        userId: targetUserId,
        role,
      });

      await this.audit.record({
        actorId: actingUserId,
        action: 'membership.added',
        targetType: 'organization',
        targetId: organizationId,
        metadata: { userId: targetUserId, role },
      });

      return created;
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new AlreadyAMemberError(organizationId, targetUserId);
      }

      throw error;
    }
  }

  /**
   * Only an `owner` (or the platform override) may promote someone to
   * `owner` or change an existing `owner`'s role — an `admin` cannot touch
   * an `owner` row at all. This isn't a simple `>=` rank comparison against
   * `assertOrgRole`'s hierarchy, so it's enforced here as an explicit extra
   * rule (`assertActorCanTouchMembership`/`assertActorCanTouchRole`), per
   * `libs/organizations/ARCH.md` Design 001, Application Layer.
   */
  async changeRole(
    organizationId: string,
    targetUserId: string,
    newRole: MembershipRole,
    actingUserId: string,
  ): Promise<MembershipEntity> {
    await this.organizations.assertOrgRole(
      actingUserId,
      organizationId,
      MembershipRole.ADMIN,
    );

    const target = await this.findMembershipOrFail(
      organizationId,
      targetUserId,
    );

    await this.assertActorCanTouchMembership(
      organizationId,
      actingUserId,
      target,
    );
    await this.assertActorCanTouchRole(organizationId, actingUserId, newRole);

    if (
      target.role === MembershipRole.OWNER &&
      newRole !== MembershipRole.OWNER
    ) {
      await this.assertNotLastOwner(organizationId);
    }

    const updated = await this.memberships.save({ ...target, role: newRole });

    await this.audit.record({
      actorId: actingUserId,
      action: 'membership.role_changed',
      targetType: 'organization',
      targetId: organizationId,
      metadata: { userId: targetUserId, role: newRole },
    });

    return updated;
  }

  /**
   * A member may always remove themselves ("leave") without needing the
   * `admin` gate — checked before it, the same "self vs. permission" shape
   * `libs/users`' `assertOwnerOrPermission` already established. Removing
   * someone else requires `admin`, checked *before* the target membership is
   * looked up: an unauthorized caller must get the same 403 whether or not
   * `targetUserId` is actually a member — an earlier draft of this method
   * looked the target up first, letting an unauthorized caller distinguish
   * "member, but forbidden" (403) from "not a member" (404) by response
   * code, the exact existence-leak class `libs/users`' `getForUser` was
   * built to avoid. Caught in this library's Loop 003 review, before it
   * shipped to a real consumer.
   */
  async removeMember(
    organizationId: string,
    targetUserId: string,
    actingUserId: string,
  ): Promise<void> {
    if (targetUserId !== actingUserId) {
      await this.organizations.assertOrgRole(
        actingUserId,
        organizationId,
        MembershipRole.ADMIN,
      );
    }

    const target = await this.findMembershipOrFail(
      organizationId,
      targetUserId,
    );

    if (targetUserId !== actingUserId) {
      await this.assertActorCanTouchMembership(
        organizationId,
        actingUserId,
        target,
      );
    }

    if (target.role === MembershipRole.OWNER) {
      await this.assertNotLastOwner(organizationId);
    }

    await this.memberships.delete({ id: target.id });

    await this.audit.record({
      actorId: actingUserId,
      action: 'membership.removed',
      targetType: 'organization',
      targetId: organizationId,
      metadata: { userId: targetUserId },
    });
  }

  private async findMembershipOrFail(
    organizationId: string,
    userId: string,
  ): Promise<MembershipEntity> {
    const membership = await this.memberships.findByOrganizationAndUser(
      organizationId,
      userId,
    );

    if (!membership) {
      throw new MembershipNotFoundError(organizationId, userId);
    }

    return membership;
  }

  private async assertActorCanTouchMembership(
    organizationId: string,
    actingUserId: string,
    target: MembershipEntity,
  ): Promise<void> {
    if (target.role !== MembershipRole.OWNER) {
      return;
    }

    if (await this.actingUserIsOwner(organizationId, actingUserId)) {
      return;
    }

    if (await this.organizations.hasManageOverride(actingUserId)) {
      return;
    }

    throw new ForbiddenOrganizationAccessError();
  }

  private async assertActorCanTouchRole(
    organizationId: string,
    actingUserId: string,
    role: MembershipRole,
  ): Promise<void> {
    if (role !== MembershipRole.OWNER) {
      return;
    }

    if (await this.actingUserIsOwner(organizationId, actingUserId)) {
      return;
    }

    if (await this.organizations.hasManageOverride(actingUserId)) {
      return;
    }

    throw new ForbiddenOrganizationAccessError();
  }

  private async actingUserIsOwner(
    organizationId: string,
    actingUserId: string,
  ): Promise<boolean> {
    const actingMembership = await this.memberships.findByOrganizationAndUser(
      organizationId,
      actingUserId,
    );

    return actingMembership?.role === MembershipRole.OWNER;
  }

  /**
   * The aggregate invariant `libs/organizations/ARCH.md` Design 001 (Key
   * Decisions HIGH #2) establishes: an organization must always retain at
   * least one `owner`. Enforced here, in application code, since TypeORM/
   * MySQL can't express "at least one row with role = 'owner' per
   * organizationId" as a schema constraint.
   *
   * `excludingUserId` is always the caller's already-confirmed-`owner`
   * target (both call sites only reach this after checking
   * `target.role === MembershipRole.OWNER`), so "would this action leave
   * zero owners" reduces to "is the current owner count 1" — no need to
   * load the full roster just to filter it in JS, which the original
   * version of this method did (caught in this library's Loop 003 review;
   * `MembershipRepository.countByOrganizationAndRole` already existed for
   * this and was simply unused).
   */
  private async assertNotLastOwner(organizationId: string): Promise<void> {
    const ownerCount = await this.memberships.countByOrganizationAndRole(
      organizationId,
      MembershipRole.OWNER,
    );

    if (ownerCount <= 1) {
      throw new CannotRemoveLastOwnerError();
    }
  }
}
