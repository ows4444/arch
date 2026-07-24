import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@/database';
import { AuthorizationService } from '@/auth';
import { AuditService } from '@/audit';
import { OrganizationRepository } from '../domain/organization.repository';
import { MembershipRepository } from '../domain/membership.repository';
import { MembershipRole } from '../domain/membership-role.enum';
import { OrganizationEntity } from '../domain/organization.entity';
import { OrganizationNotFoundError } from '../errors/organization-not-found.error';
import { ForbiddenOrganizationAccessError } from '../errors/forbidden-organization-access.error';
import {
  DEFAULT_MANAGE_ORGANIZATIONS_PERMISSION,
  ORGANIZATIONS_MODULE_OPTIONS,
} from '../organizations.constants';
import type { OrganizationsModuleOptions } from '../organizations.types';

const ROLE_RANK: Record<MembershipRole, number> = {
  [MembershipRole.MEMBER]: 1,
  [MembershipRole.ADMIN]: 2,
  [MembershipRole.OWNER]: 3,
};

/**
 * `assertOrgRole` is the org-scoped authorization primitive
 * `libs/organizations/ARCH.md` Design 001 introduces — the second,
 * structurally different ownership shape `libs/users/ARCH.md`'s Open
 * Questions flagged as worth watching (a role hierarchy plus platform
 * override, not a flat self-vs-permission check). Still short of that
 * document's own stated bar (a *third* differently-shaped consumer) for
 * building a shared generalization — see this library's ARCH.md, Rejected
 * Alternatives.
 */
@Injectable()
export class OrganizationService {
  private readonly manageOrganizationsPermission: string;

  constructor(
    @InjectRepository(OrganizationRepository)
    private readonly organizations: OrganizationRepository,
    @InjectRepository(MembershipRepository)
    private readonly memberships: MembershipRepository,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditService,
    @Inject(ORGANIZATIONS_MODULE_OPTIONS)
    options: OrganizationsModuleOptions,
  ) {
    this.manageOrganizationsPermission =
      options.manageOrganizationsPermission ??
      DEFAULT_MANAGE_ORGANIZATIONS_PERMISSION;
  }

  /**
   * Creates the organization and its first (`owner`) membership together —
   * an organization with zero owners is never a state this method can
   * produce. Not wrapped in a database transaction — see
   * `libs/organizations/ARCH.md` Design 001, Key Decisions MEDIUM #1: this
   * is flagged as the first concrete candidate in this monorepo to revisit
   * that decision, since every prior library found no real multi-write
   * atomicity need.
   */
  async create(name: string, ownerUserId: string): Promise<OrganizationEntity> {
    const organization = await this.organizations.save({ name });

    await this.memberships.save({
      organizationId: organization.id,
      userId: ownerUserId,
      role: MembershipRole.OWNER,
    });

    await this.audit.record({
      actorId: ownerUserId,
      action: 'organization.created',
      targetType: 'organization',
      targetId: organization.id,
      metadata: { name },
    });

    return organization;
  }

  /** Requires the caller to be any member of the organization (or the platform override). */
  async get(
    organizationId: string,
    actingUserId: string,
  ): Promise<OrganizationEntity> {
    await this.assertOrgRole(
      actingUserId,
      organizationId,
      MembershipRole.MEMBER,
    );

    return this.findByIdOrFail(organizationId);
  }

  /**
   * `memberships` cascade-deletes via the `organizationId` FK
   * (`onDelete: 'CASCADE'`, see `MembershipEntity`) — mirrors `libs/auth`'s
   * existing `role_permissions`/`user_roles` cascade precedent.
   */
  async delete(organizationId: string, actingUserId: string): Promise<void> {
    await this.assertOrgRole(
      actingUserId,
      organizationId,
      MembershipRole.OWNER,
    );

    const organization = await this.findByIdOrFail(organizationId);

    await this.organizations.delete({ id: organization.id });

    await this.audit.record({
      actorId: actingUserId,
      action: 'organization.deleted',
      targetType: 'organization',
      targetId: organizationId,
    });
  }

  /**
   * Looks up the caller's membership role in `organizationId`; allows if it
   * satisfies `minRole` (owner > admin > member), otherwise falls back to
   * the platform-level override permission, otherwise throws. No existence
   * leak: a stranger to a nonexistent organization gets the same 403 as a
   * stranger to a real one, since a membership lookup against either
   * returns nothing.
   */
  async assertOrgRole(
    actingUserId: string,
    organizationId: string,
    minRole: MembershipRole,
  ): Promise<void> {
    const membership = await this.memberships.findByOrganizationAndUser(
      organizationId,
      actingUserId,
    );

    if (membership && ROLE_RANK[membership.role] >= ROLE_RANK[minRole]) {
      return;
    }

    if (await this.hasManageOverride(actingUserId)) {
      return;
    }

    throw new ForbiddenOrganizationAccessError();
  }

  /**
   * Exposed separately from `assertOrgRole` so `MembershipService`'s
   * owner-only carve-outs (an `admin` may never touch an `owner` row) can
   * still be bypassed by the platform override, without duplicating the
   * `hasPermission` call.
   */
  hasManageOverride(actingUserId: string): Promise<boolean> {
    return this.authorization.hasPermission(
      actingUserId,
      this.manageOrganizationsPermission,
    );
  }

  private async findByIdOrFail(
    organizationId: string,
  ): Promise<OrganizationEntity> {
    const organization = await this.organizations.findOneBy({
      id: organizationId,
    });

    if (!organization) {
      throw new OrganizationNotFoundError(organizationId);
    }

    return organization;
  }
}
