import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { CompaniesModule } from '../companies/companies.module.js';
import { ChannelsController } from './channels.controller.js';
import { ChannelsRepository } from './channels.repository.js';
import { ChannelsService, CREDENTIAL_CIPHER } from './channels.service.js';
import { CredentialCipher, parseCipherConfig } from './credential-cipher.js';

@Module({
  imports: [AccessModule, CompaniesModule],
  controllers: [ChannelsController],
  providers: [
    ChannelsRepository,
    ChannelsService,
    {
      // Parsed once at startup: an invalid key configuration stops the app.
      // Empty CHANNEL_KEKS → accounts cannot be written (503), production refuses to start.
      provide: CREDENTIAL_CIPHER,
      useFactory: () => {
        const config = parseCipherConfig(process.env);
        if (!config && process.env.NODE_ENV === 'production') {
          throw new Error('CHANNEL_KEKS production ortamında zorunlu');
        }
        return config ? new CredentialCipher(config) : null;
      },
    },
  ],
  exports: [ChannelsService],
})
export class ChannelsModule {}
