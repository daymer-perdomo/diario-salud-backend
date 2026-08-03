import { join } from 'path';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
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
import { PromptsModule } from './prompts/prompts.module';
import { PipelineStatusModule } from './pipeline-status/pipeline-status.module';
import { BlogModule } from './blog/blog.module';
import { InventoryModule } from './inventory/inventory.module';
import { ChatbotModule } from './chatbot/chatbot.module';
import { OrdersModule } from './orders/orders.module';
import { UsersModule } from './users/users.module';
import { WordpressModule } from './wordpress/wordpress.module';

@Module({
  imports: [
    ConfigModule,

    // Sirve el panel (public/) en la raiz -- misma estrategia que CentraVigia.
    // outDir compila a dist/src/**, por eso hay que subir dos niveles (a
    // diferencia de un outDir plano tipo dist/**) para llegar a public/.
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', '..', 'public'),
      renderPath: '*path',
      exclude: [
        '/auth/(.*)',
        '/validation/(.*)',
        '/sources/(.*)',
        '/publish/(.*)',
        '/articles/(.*)',
        '/articles',
        '/health',
        '/prompts/(.*)',
        '/prompts',
        '/pipeline/(.*)',
        '/blog/(.*)',
        '/blog',
        '/inventory/(.*)',
        '/inventory',
        '/chatbot/(.*)',
        '/chatbot',
        '/orders/(.*)',
        '/orders',
        '/users/(.*)',
        '/users',
        '/wordpress/(.*)',
        '/wordpress',
      ],
      serveStaticOptions: { index: 'index.html', fallthrough: true },
    }),

    // Freno generico contra abuso en endpoints de entrada -- primer uso es
    // el chatbot publico (unico endpoint sin JwtAuthGuard/ApiKeyGuard de
    // todo el backend). Default global generoso (no afecta al panel admin
    // autenticado en uso normal); el controller del chatbot aplica su
    // propio limite mas estricto con @Throttle().
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
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
    PromptsModule,
    PipelineStatusModule,
    BlogModule,
    InventoryModule,
    ChatbotModule,
    OrdersModule,
    UsersModule,
    WordpressModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
