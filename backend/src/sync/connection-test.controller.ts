import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  type AuthUser,
  CurrentUser,
  RequirePermissions,
} from '../auth/decorators.js';
import {
  type ChannelAdapter,
  CHANNEL_DEFINITIONS,
} from '../channels/channel-adapter.js';
import { ChannelsService, MANAGE } from '../channels/channels.service.js';
import { RateLimiterService } from '../rate-limit/rate-limiter.service.js';
import { ChannelRateLimiter } from './channel-rate-limiter.js';
import { SyncService } from './sync.service.js';

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.NOT_FOUND });

const TEST_LIMIT = { limit: 5, windowMs: 60_000 };

export const CHANNEL_ADAPTERS = Symbol('CHANNEL_ADAPTERS');

const MESSAGES: Record<string, string> = {
  OK: 'Bağlantı başarılı. Pazaryeri kimlik bilgilerini kabul etti.',
  INVALID_CREDENTIALS:
    'Pazaryeri kimlik bilgilerini reddetti. Satıcı ID, API Key ve API Secret değerlerini kontrol edin.',
  FORBIDDEN:
    'Pazaryeri erişime izin vermedi (IP izni veya hesap yetkisi gerekebilir).',
  UNAVAILABLE: 'Pazaryerine şu an ulaşılamadı. Biraz sonra tekrar deneyin.',
  UNKNOWN: 'Pazaryeri beklenmeyen bir yanıt verdi.',
  SYNC_LIVE_CALLS_DISABLED:
    'Canlı pazaryeri çağrıları kapalı (SYNC_LIVE_CALLS). Bağlantı testi yapılmadı.',
  CHANNEL_RATE_LIMITED:
    'Çok sık test edildi. Birkaç saniye sonra tekrar deneyin.',
  NOT_SUPPORTED: 'Bu kanal için bağlantı testi henüz yok.',
  ACCOUNT_INACTIVE: 'Kanal hesabı pasif. Test için önce aktifleştirin.',
};

const result = (code: string) => ({
  data: {
    ok: code === 'OK',
    code,
    message: MESSAGES[code] ?? MESSAGES.UNKNOWN,
  },
});

/** INT-03: channel definitions for the UI and a read-only connection test. */
@Controller()
export class ConnectionTestController {
  constructor(
    private readonly channels: ChannelsService,
    private readonly sync: SyncService,
    private readonly limiter: ChannelRateLimiter,
    private readonly tests: RateLimiterService,
    @Inject(CHANNEL_ADAPTERS)
    private readonly adapters: Record<string, ChannelAdapter>,
  ) {}

  /** Credential fields per channel (no validation patterns, no secrets). */
  @Get('channel-definitions')
  @RequirePermissions(MANAGE)
  definitions() {
    return {
      data: CHANNEL_DEFINITIONS.map((d) => ({
        code: d.code,
        name: d.name,
        credentialFields: d.credentialFields.map((f) => ({
          key: f.key,
          label: f.label,
          secret: f.secret,
          maxLength: f.maxLength,
        })),
        connectionTest: Boolean(this.adapters[d.code]),
      })),
    };
  }

  /**
   * One read-only marketplace request with the stored credentials. Refused
   * while SYNC_LIVE_CALLS is off; takes from the account's shared rate bucket.
   */
  @Post('companies/:companyId/channel-accounts/:id/test-connection')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(MANAGE)
  async test(
    @CurrentUser() user: AuthUser,
    @Param('companyId', uuid) companyId: string,
    @Param('id', uuid) id: string,
  ) {
    const account = await this.channels.get(user, companyId, id);
    const adapter = this.adapters[account.data.channel];
    if (!adapter) return result('NOT_SUPPORTED');
    if (!account.data.isActive) return result('ACCOUNT_INACTIVE');
    if (!this.sync.liveCallsAllowed) return result('SYNC_LIVE_CALLS_DISABLED');
    // Manual tests: at most 5 per account per minute (429 with Retry-After).
    await this.tests.hit(`conn-test:${id}`, TEST_LIMIT);
    const budget = await this.limiter
      .take(account.data.channel, id)
      .catch(() => ({ ok: false as const, retryAfterMs: 0 }));
    if (!budget.ok) return result('CHANNEL_RATE_LIMITED');
    const credentials = await this.channels.credentialsFor(companyId, id);
    const outcome = await adapter.testConnection(credentials);
    return result(outcome.ok ? 'OK' : outcome.code);
  }
}
