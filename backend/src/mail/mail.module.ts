import { Module } from '@nestjs/common';
import { LogTransport } from './log.transport.js';
import { loadMailConfig, type MailConfig } from './mail.config.js';
import { MailService } from './mail.service.js';
import { MAIL_OPTIONS, MAIL_TRANSPORT } from './mail.transport.js';
import { SmtpTransport } from './smtp.transport.js';

const MAIL_CONFIG = Symbol('MAIL_CONFIG');

@Module({
  providers: [
    // process.env already holds .env (ConfigModule loads it first).
    { provide: MAIL_CONFIG, useFactory: () => loadMailConfig(process.env) },
    {
      provide: MAIL_TRANSPORT,
      inject: [MAIL_CONFIG],
      useFactory: (config: MailConfig) =>
        config.smtp ? new SmtpTransport(config.smtp) : new LogTransport(),
    },
    {
      provide: MAIL_OPTIONS,
      inject: [MAIL_CONFIG],
      useFactory: (config: MailConfig) => ({ from: config.from }),
    },
    MailService,
  ],
  exports: [MailService],
})
export class MailModule {}
