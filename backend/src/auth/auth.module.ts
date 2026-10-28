import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import type { StringValue } from 'ms';
import { RateLimitModule } from '../rate-limit/rate-limit.module.js';
import { TenantsModule } from '../tenants/tenants.module.js';
import { AuthRateLimitService } from './auth-rate-limit.service.js';
import { AuthController } from './auth.controller.js';
import { AuthRepository } from './auth.repository.js';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard, PermissionsGuard } from './guards.js';
import { TokenService } from './token.service.js';

@Module({
  imports: [
    TenantsModule,
    RateLimitModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>('JWT_ACCESS_SECRET') ?? '';
        if (secret.length < 32) {
          throw new Error('JWT_ACCESS_SECRET en az 32 karakter olmalı');
        }
        return {
          secret,
          signOptions: {
            expiresIn: (config.get<string>('JWT_ACCESS_EXPIRES_IN') ??
              '15m') as StringValue,
            algorithm: 'HS256',
          },
          verifyOptions: { algorithms: ['HS256'] },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthRateLimitService,
    AuthRepository,
    AuthService,
    TokenService,
    // Order matters: authenticate (and bind tenant) before checking permissions.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AuthModule {}
