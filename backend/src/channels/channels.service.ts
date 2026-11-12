import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AccessService } from '../access/access.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/decorators.js';
import { CompaniesService } from '../companies/companies.service.js';
import {
  InjectPrisma,
  type TenantPrismaClient,
} from '../database/prisma.service.js';
import type { PrismaTx } from '../database/prisma.types.js';
import { Prisma } from '../generated/prisma/client.js';
import { TenantContext } from '../tenancy/tenant-context.js';
import { channelDefinition } from './channel-adapter.js';
import type {
  CreateChannelAccountDto,
  UpdateChannelAccountDto,
} from './channels.dto.js';
import {
  type AccountRow,
  ChannelsRepository,
  toEncrypted,
} from './channels.repository.js';
import {
  CredentialCipher,
  type EncryptedCredentials,
  maskSecret,
} from './credential-cipher.js';

export const CREDENTIAL_CIPHER = Symbol('CREDENTIAL_CIPHER');
export const MANAGE = 'channels:manage';
const MODULE = 'channels';
const ENTITY = 'ChannelAccount';

const notFound = () =>
  new NotFoundException({
    code: 'NOT_FOUND',
    message: 'Kanal hesabı bulunamadı',
  });

function view(row: AccountRow) {
  return {
    id: row.id,
    companyId: row.companyId,
    channel: row.channel,
    name: row.name,
    isActive: row.isActive,
    credentials: row.credentialsHint as Record<string, string>,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Channel accounts (INT-01). Only members whose tenant role grants
 * `channels:manage` (Owner, Admin) can see or change accounts; credentials are
 * write-only and every response shows them masked. Other modules (adapters,
 * sync jobs) use `credentialsFor` and never read the table.
 */
@Injectable()
export class ChannelsService {
  private readonly logger = new Logger(ChannelsService.name);

  constructor(
    private readonly repository: ChannelsRepository,
    private readonly audit: AuditService,
    private readonly access: AccessService,
    private readonly companies: CompaniesService,
    @InjectPrisma() private readonly prisma: TenantPrismaClient,
    @Inject(CREDENTIAL_CIPHER) private readonly cipher: CredentialCipher | null,
  ) {}

  private requireCipher(): CredentialCipher {
    if (!this.cipher) {
      throw new ServiceUnavailableException({
        code: 'CHANNEL_CRYPTO_UNAVAILABLE',
        message: 'Kanal kimlik bilgisi şifrelemesi yapılandırılmamış',
      });
    }
    return this.cipher;
  }

  /** Read from the database on every request, not from the JWT `perms`. Unknown company → 404. */
  private async assertManager(user: AuthUser, companyId: string) {
    if (!(await this.access.hasTenantPermission(user.sub, MANAGE))) {
      throw new ForbiddenException('Yetki yok');
    }
    const [company] = await this.companies.activeByIds([companyId]);
    if (!company) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Firma bulunamadı',
      });
    }
  }

  /** Validates against the channel definition; returns cleaned values and masked hints. */
  private credentials(channel: string, input: Record<string, unknown>) {
    const def = channelDefinition(channel);
    if (!def) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_ERROR',
        message: 'Desteklenmeyen kanal',
      });
    }
    const allowed = new Set(def.credentialFields.map((f) => f.key));
    const errors: { field: string; message: string }[] = [];
    for (const key of Object.keys(input)) {
      if (!allowed.has(key)) {
        errors.push({
          field: `credentials.${key}`,
          message: 'Bilinmeyen alan',
        });
      }
    }
    const values: Record<string, string> = {};
    const hint: Record<string, string> = {};
    for (const f of def.credentialFields) {
      const raw = input[f.key];
      const value = typeof raw === 'string' ? raw.trim() : '';
      if (typeof raw !== 'string' || value === '') {
        errors.push({
          field: `credentials.${f.key}`,
          message: `${f.label} zorunlu`,
        });
        continue;
      }
      if (value.length > f.maxLength || (f.pattern && !f.pattern.test(value))) {
        errors.push({
          field: `credentials.${f.key}`,
          message: `${f.label} geçersiz`,
        });
        continue;
      }
      values[f.key] = value;
      // Secret fields show no characters at all; others show the last 4.
      hint[f.key] = f.secret ? '••••' : maskSecret(value);
    }
    if (errors.length) {
      throw new UnprocessableEntityException({
        code: 'VALIDATION_ERROR',
        message: 'Geçersiz kimlik bilgisi',
        details: errors,
      });
    }
    return { values, hint };
  }

  private async write<T>(fn: (tx: PrismaTx) => Promise<T>) {
    try {
      return await this.prisma.$transaction(fn);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException({
          code: 'CHANNEL_ACCOUNT_EXISTS',
          message: 'Bu firmada aynı adla bir kanal hesabı zaten var',
        });
      }
      throw error;
    }
  }

  async list(user: AuthUser, companyId: string) {
    await this.assertManager(user, companyId);
    return { data: (await this.repository.list(companyId)).map(view) };
  }

  async get(user: AuthUser, companyId: string, id: string) {
    await this.assertManager(user, companyId);
    const row = await this.repository.find(companyId, id);
    if (!row) throw notFound();
    return { data: view(row) };
  }

  async create(
    user: AuthUser,
    companyId: string,
    dto: CreateChannelAccountDto,
  ) {
    await this.assertManager(user, companyId);
    const cipher = this.requireCipher();
    const { values, hint } = this.credentials(dto.channel, dto.credentials);
    const id = randomUUID();
    const tenantId = TenantContext.requireTenantId();
    const encrypted = cipher.encrypt(
      { tenantId, accountId: id, channel: dto.channel },
      values,
    );
    const row = await this.write(async (tx) => {
      const created = await this.repository.create(tx, {
        id,
        companyId,
        channel: dto.channel,
        name: dto.name,
        encrypted,
        hint,
      });
      await this.audit.record(
        {
          action: 'CREATE',
          module: MODULE,
          entityType: ENTITY,
          entityId: id,
          after: {
            companyId,
            channel: dto.channel,
            name: dto.name,
            credentialsChanged: true,
          },
        },
        tx,
      );
      return created;
    });
    return { data: view(row) };
  }

  async update(
    user: AuthUser,
    companyId: string,
    id: string,
    dto: UpdateChannelAccountDto,
  ) {
    await this.assertManager(user, companyId);
    const current = await this.repository.find(companyId, id);
    if (!current) throw notFound();
    let secret: ReturnType<ChannelsService['credentials']> | undefined;
    let encrypted: EncryptedCredentials | undefined;
    if (dto.credentials !== undefined) {
      const cipher = this.requireCipher();
      secret = this.credentials(current.channel, dto.credentials);
      encrypted = cipher.encrypt(
        {
          tenantId: TenantContext.requireTenantId(),
          accountId: id,
          channel: current.channel,
        },
        secret.values,
      );
    }
    const row = await this.write(async (tx) => {
      if (!(await this.repository.find(companyId, id, tx))) throw notFound();
      const updated = await this.repository.update(tx, companyId, id, {
        name: dto.name,
        isActive: dto.isActive,
        encrypted,
        hint: secret?.hint,
      });
      if (!updated) throw notFound();
      await this.audit.record(
        {
          action: 'UPDATE',
          module: MODULE,
          entityType: ENTITY,
          entityId: id,
          before: { name: current.name, isActive: current.isActive },
          after: {
            name: updated.name,
            isActive: updated.isActive,
            ...(encrypted ? { credentialsChanged: true } : {}),
          },
        },
        tx,
      );
      return updated;
    });
    return { data: view(row) };
  }

  async remove(user: AuthUser, companyId: string, id: string) {
    await this.assertManager(user, companyId);
    await this.write(async (tx) => {
      const current = await this.repository.find(companyId, id, tx);
      if (!current) throw notFound();
      if (!(await this.repository.softDelete(tx, companyId, id)))
        throw notFound();
      await this.audit.record(
        {
          action: 'DELETE',
          module: MODULE,
          entityType: ENTITY,
          entityId: id,
          before: { companyId, channel: current.channel, name: current.name },
        },
        tx,
      );
    });
  }

  /**
   * Decrypted credentials for an active account of the current tenant. Only for
   * adapters and sync jobs; never return the result over HTTP or log it.
   */
  async credentialsFor(
    companyId: string,
    id: string,
  ): Promise<Record<string, string>> {
    const cipher = this.requireCipher();
    const row = await this.repository.findSecret(companyId, id);
    if (!row) throw notFound();
    return cipher.decrypt(
      { tenantId: row.tenantId, accountId: row.id, channel: row.channel },
      toEncrypted(row),
    );
  }

  /**
   * Key rotation for the current tenant: re-wraps every DEK that is not under
   * the active KEK. Credential ciphertext is unchanged. Returns counts only.
   */
  async rewrapAll(batch = 100): Promise<{ rewrapped: number; failed: number }> {
    const cipher = this.requireCipher();
    let rewrapped = 0;
    let failed = 0;
    const skip = new Set<string>();
    for (;;) {
      const rows = (
        await this.repository.findForRewrap(
          cipher.activeKekId,
          batch + skip.size,
        )
      ).filter((r) => !skip.has(r.id));
      if (rows.length === 0) break;
      for (const row of rows) {
        try {
          const wrapped = cipher.rewrap(
            { tenantId: row.tenantId, accountId: row.id, channel: row.channel },
            toEncrypted(row),
          );
          const { count } = await this.repository.saveRewrap(row, wrapped);
          if (count === 1) rewrapped++;
          // Changed meanwhile (update/rotation elsewhere): retry in a later run.
          else skip.add(row.id);
        } catch {
          failed++;
          skip.add(row.id);
          this.logger.error(`Kanal hesabı anahtarı yenilenemedi: ${row.id}`);
        }
      }
    }
    return { rewrapped, failed };
  }
}
