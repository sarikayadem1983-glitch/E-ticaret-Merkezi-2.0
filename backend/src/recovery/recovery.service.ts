import { createHash, randomBytes } from 'node:crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import { AuditService } from '../audit/audit.service.js';
import {
  InjectPrisma,
  type TenantPrismaClient,
} from '../database/prisma.service.js';
import {
  INVITATIONS_CONFIG,
  type InvitationsConfig,
} from '../invitations/invitations.config.js';
import { MailService } from '../mail/mail.service.js';
import { MembershipsRepository } from '../memberships/memberships.repository.js';
import { TenantContext } from '../tenancy/tenant-context.js';
import { emailVerifyMail, passwordResetMail } from '../auth/recovery-mail.js';

export type TokenPurpose = 'password_reset' | 'email_verify';

const MINUTE = 60 * 1000;
export const TOKEN_TTL_MS: Record<TokenPurpose, number> = {
  password_reset: 30 * MINUTE,
  email_verify: 24 * 60 * MINUTE,
};

export const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');

const invalidToken = () =>
  new BadRequestException({
    code: 'INVALID_TOKEN',
    message: 'Bağlantı geçersiz, süresi dolmuş veya daha önce kullanılmış',
  });

/**
 * USR-19: password reset and e-mail verification with single-use, expiring,
 * hashed tokens. Users and tokens are global; every query runs in system
 * context and filters by user id or token hash itself.
 *
 * Account existence never leaks: "forgot password" answers the same for any
 * address, and the lookup and e-mail run after the response.
 */
@Injectable()
export class RecoveryService {
  private readonly logger = new Logger(RecoveryService.name);

  constructor(
    @InjectPrisma() private readonly prisma: TenantPrismaClient,
    private readonly mail: MailService,
    private readonly memberships: MembershipsRepository,
    private readonly audit: AuditService,
    @Inject(INVITATIONS_CONFIG) private readonly config: InvitationsConfig,
  ) {}

  private sys<T>(fn: () => Promise<T>): Promise<T> {
    return TenantContext.runAsSystem(fn);
  }

  /**
   * Issues a new token. The user row is locked so concurrent requests are
   * serialized. Earlier unused tokens of the same purpose are closed only by
   * `closeOthers`, after the new link was mailed: a failed mail never kills
   * the link the user already has.
   */
  private async issue(userId: string, purpose: TokenPurpose) {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS[purpose]);
    const id = await this.sys(() =>
      this.prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: userId },
          data: { updatedAt: new Date() },
          select: { id: true },
        });
        const row = await tx.userToken.create({
          data: { userId, purpose, tokenHash: hashToken(token), expiresAt },
          select: { id: true },
        });
        return row.id;
      }),
    );
    return { token, expiresAt, id };
  }

  private closeOthers(userId: string, purpose: TokenPurpose, keepId: string) {
    return this.sys(() =>
      this.prisma.userToken.updateMany({
        where: { userId, purpose, usedAt: null, id: { not: keepId } },
        data: { usedAt: new Date() },
      }),
    );
  }

  /** Fire-and-forget: same response and timing whether the account exists or not. */
  requestPasswordReset(email: string): void {
    void this.sendPasswordReset(email).catch((error: unknown) => {
      this.logger.error(
        // Error name only: messages may carry the recipient address.
        `Şifre sıfırlama e-postası gönderilemedi: ${(error as Error).name}`,
      );
    });
  }

  private async sendPasswordReset(email: string) {
    const user = await this.sys(() =>
      this.prisma.user.findFirst({
        where: { email, isActive: true, deletedAt: null },
        select: { id: true, email: true },
      }),
    );
    if (!user) return;
    const { token, expiresAt, id } = await this.issue(
      user.id,
      'password_reset',
    );
    const msg = passwordResetMail(
      `${this.config.appOrigin}/reset-password/${token}`,
      expiresAt,
    );
    await this.mail.send({ to: user.email, ...msg });
    await this.closeOthers(user.id, 'password_reset', id);
  }

  /** Signed-in user: sends a verification link unless already verified. */
  async requestEmailVerification(userId: string): Promise<void> {
    const user = await this.sys(() =>
      this.prisma.user.findFirst({
        where: { id: userId, isActive: true, deletedAt: null },
        select: { id: true, email: true, emailVerifiedAt: true },
      }),
    );
    if (!user || user.emailVerifiedAt) return;
    const { token, expiresAt, id } = await this.issue(user.id, 'email_verify');
    const msg = emailVerifyMail(
      `${this.config.appOrigin}/verify-email/${token}`,
      expiresAt,
    );
    await this.mail.send({ to: user.email, ...msg });
    await this.closeOthers(user.id, 'email_verify', id);
  }

  /**
   * Marks the token used if it is valid; returns its user. Atomic: of two
   * concurrent uses only one succeeds.
   */
  private async consume(
    tx: Parameters<Parameters<TenantPrismaClient['$transaction']>[0]>[0],
    token: string,
    purpose: TokenPurpose,
  ): Promise<string> {
    const now = new Date();
    const row = await tx.userToken.findUnique({
      where: { tokenHash: hashToken(token) },
      select: { id: true, userId: true, purpose: true },
    });
    if (!row || row.purpose !== purpose) throw invalidToken();
    const { count } = await tx.userToken.updateMany({
      where: { id: row.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (count !== 1) throw invalidToken();
    const user = await tx.user.findFirst({
      where: { id: row.userId, isActive: true, deletedAt: null },
      select: { id: true },
    });
    if (!user) throw invalidToken();
    return user.id;
  }

  /**
   * Sets the new password, verifies the e-mail (the link proved ownership),
   * and ends every session in every tenant, in one transaction.
   */
  async resetPassword(token: string, password: string): Promise<void> {
    const passwordHash = await hash(password);
    const { userId, tenants, revoked } = await this.sys(() =>
      this.prisma.$transaction(async (tx) => {
        const userId = await this.consume(tx, token, 'password_reset');
        const now = new Date();
        await tx.user.update({
          where: { id: userId },
          data: { passwordHash },
        });
        await tx.user.updateMany({
          where: { id: userId, emailVerifiedAt: null },
          data: { emailVerifiedAt: now },
        });
        await tx.userToken.updateMany({
          where: { userId, purpose: 'password_reset', usedAt: null },
          data: { usedAt: now },
        });
        const { count: revoked } = await tx.refreshToken.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: now },
        });
        const tenants = await this.memberships.bumpAuthVersionForUser(
          tx,
          userId,
        );
        return { userId, tenants, revoked };
      }),
    );
    for (const tenantId of tenants) {
      try {
        await TenantContext.run(tenantId, () =>
          this.audit.record({
            action: 'UPDATE',
            module: 'auth',
            entityType: 'UserPassword',
            entityId: userId,
            actorUserId: userId,
            after: { sessionsRevoked: revoked },
          }),
        );
      } catch (error) {
        this.logger.error(
          `PASSWORD_RESET audit kaydı yazılamadı (tenant ${tenantId}): ${(error as Error).message}`,
        );
      }
    }
  }

  async verifyEmail(token: string): Promise<void> {
    await this.sys(() =>
      this.prisma.$transaction(async (tx) => {
        const userId = await this.consume(tx, token, 'email_verify');
        await tx.user.updateMany({
          where: { id: userId, emailVerifiedAt: null },
          data: { emailVerifiedAt: new Date() },
        });
      }),
    );
  }
}
