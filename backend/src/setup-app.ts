import type { NestExpressApplication } from '@nestjs/platform-express';
import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import helmet from 'helmet';
import {
  bodyParserErrorHandler,
  HttpExceptionFilter,
} from './common/http-exception.filter.js';
import { validationPipe } from './common/validation.pipe.js';
import {
  loadSecurityConfig,
  type SecurityConfig,
} from './config/security.config.js';

const API_PREFIX = 'api/v1';
/** Load balancer probes often use plain HTTP inside the private network. */
const HTTPS_EXEMPT = new Set([`/${API_PREFIX}/health`]);

/**
 * Shared by main.ts and e2e tests so both run the same pipeline.
 * The app must be created with `bodyParser: false`; parsers and limits are set here.
 */
export function setupApp(
  app: NestExpressApplication,
  security: SecurityConfig = loadSecurityConfig(process.env),
): void {
  // Decides req.ip, req.protocol and req.secure; never trusts X-Forwarded-* from unknown peers.
  app.set('trust proxy', security.trustProxy);

  app.use(
    helmet({
      // JSON API: nothing should ever be rendered or framed.
      contentSecurityPolicy: {
        useDefaults: false,
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      },
      strictTransportSecurity: security.production
        ? { maxAge: 31_536_000, includeSubDomains: true }
        : false,
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );

  if (security.enforceHttps) {
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.secure || HTTPS_EXEMPT.has(req.path)) return next();
      // 426 Upgrade Required
      res.status(426).json({
        error: {
          code: 'HTTPS_REQUIRED',
          message: 'Bu API yalnızca HTTPS üzerinden kullanılabilir',
          details: [],
        },
      });
    });
  }

  // Registered directly (not via useBodyParser) so parser errors are answered
  // here in the standard format, before Nest turns them into raw messages.
  app.use(express.json({ limit: security.bodyLimit }));
  app.use(express.urlencoded({ limit: security.bodyLimit, extended: false }));
  app.use(bodyParserErrorHandler);

  app.enableCors({
    origin: security.corsOrigins.length > 0 ? security.corsOrigins : false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    credentials: false,
    maxAge: 600,
  });

  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalPipes(validationPipe);
  app.useGlobalFilters(new HttpExceptionFilter(security.production));
}
