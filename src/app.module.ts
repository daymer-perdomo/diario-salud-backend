import { join } from 'path';
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ConfigModule } from './config/config.module';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { AuditModule } from './audit/audit.module';
import { QueueModule } from './queue/queue.module';
import { AuthModule } from './auth/auth.module';
import { SourcesModule } from './sources/sources.module';
import { ArticlesModule } from './articles/articles.module';
import { IngestionModule } from './ingestion/ingestion.module';
import { FilteringModule } from './filtering/filtering.module';
import { ScoringModule } from './scoring/scoring.module';
import { RewriteModule } from './rewrite/rewrite.module';
import { GroundingModule } from './grounding/grounding.module';
import { ComplianceModule } from './compliance/compliance.module';
import { ValidationModule } from './validation/validation.module';
import { PublishModule } from './publish/publish.module';

@Module({
  imports: [
    ConfigModule,

    // Sirve el panel (public/) en la raiz -- misma estrategia que CentraVigia.
    // outDir compila a dist/src/**, por eso hay que subir dos niveles (a
    // diferencia de un outDir plano tipo dist/**) para llegar a public/.
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', '..', 'public'),
      renderPath: '*path',
      exclude: ['/auth/(.*)', '/validation/(.*)', '/sources/(.*)', '/publish/(.*)', '/articles/(.*)', '/articles', '/health'],
      serveStaticOptions: { index: 'index.html', fallthrough: true },
    }),

    ScheduleModule.forRoot(),
    PrismaModule,
    AuditModule,
    QueueModule,
    AuthModule,
    SourcesModule,
    ArticlesModule,
    IngestionModule,
    FilteringModule,
    ScoringModule,
    RewriteModule,
    GroundingModule,
    ComplianceModule,
    ValidationModule,
    PublishModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
