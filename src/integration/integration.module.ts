import { Module } from '@nestjs/common';
import { IntegrationController } from './integration.controller';
import { IntegrationService } from './integration.service';

/// No importa AuthModule: estos endpoints no usan JWT sino
/// IntegrationApiKeyGuard con INTEGRATION_API_KEY (ver integration.controller).
@Module({
  controllers: [IntegrationController],
  providers: [IntegrationService],
})
export class IntegrationModule {}
