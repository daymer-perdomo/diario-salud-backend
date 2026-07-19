/// Reencola a FILTER una lista de articleId ya existentes (uso ad-hoc para
/// reintentar articulos que quedaron en ERROR tras un fallo transitorio de
/// la API de IA) -- no crea ni modifica el Article, solo agrega el job.
/// Uso: npx ts-node -r tsconfig-paths/register scripts/requeue-articles.ts <id1> <id2> ...
import { NestFactory } from '@nestjs/core';
import { getQueueToken } from '@nestjs/bullmq';
import { AppModule } from '../src/app.module';
import { QUEUE_NAMES, JOB_NAMES } from '../src/queue/queue.constants';

async function main() {
  const ids = process.argv.slice(2);
  if (ids.length === 0) {
    console.error('Uso: requeue-articles.ts <articleId> [articleId...]');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const queue = app.get(getQueueToken(QUEUE_NAMES.FILTER));
  for (const articleId of ids) {
    await queue.add(
      JOB_NAMES.FILTER_ARTICLE,
      { articleId },
      { attempts: 3, backoff: { type: 'exponential', delay: 10_000 }, removeOnComplete: true },
    );
    console.log('encolado:', articleId);
  }
  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
