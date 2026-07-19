/// Prueba de solo lectura: llama fetchCandidates() de cada fuente activa
/// directo, sin pasar por BullMQ ni crear Article -- no gasta IA, no
/// escribe en la base. Sirve para verificar el filtro de maxAgeDays
/// (bajado a 3 dias el 2026-07-17) fuente por fuente antes de correr el
/// pipeline completo. Uso: npx ts-node -r tsconfig-paths/register scripts/test-fetch-per-source.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { SourceRegistryService } from '../src/sources/source-registry.service';
import { AdapterFactory } from '../src/sources/adapters/adapter.factory';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const registry = app.get(SourceRegistryService);
  const adapterFactory = app.get(AdapterFactory);

  const sources = await registry.findActive();
  const results: Array<{ code: string; ok: boolean; count: number; detail: string }> = [];

  for (const source of sources) {
    const startedAt = Date.now();
    console.log(`>> ${source.institutionCode}: iniciando fetch...`);
    try {
      const adapter = adapterFactory.get(source.type);
      const result = await Promise.race([
        adapter.fetchCandidates(source, null),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Timeout de seguridad del script (45s) -- posible red bloqueada/colgada')), 45_000),
        ),
      ]);
      const elapsedMs = Date.now() - startedAt;
      const items = result.items
        .slice(0, 3)
        .map((i) => `    - [${i.publishedAt.toISOString().slice(0, 10)}] ${i.title.slice(0, 80)}`)
        .join('\n');
      console.log(`<< ${source.institutionCode}: OK, ${result.items.length} items (${elapsedMs}ms)`);
      results.push({
        code: source.institutionCode,
        ok: true,
        count: result.items.length,
        detail: items,
      });
    } catch (err) {
      const elapsedMs = Date.now() - startedAt;
      console.log(`<< ${source.institutionCode}: FAIL tras ${elapsedMs}ms -- ${(err as Error).message}`);
      results.push({ code: source.institutionCode, ok: false, count: 0, detail: (err as Error).message });
    }
  }

  console.log('\n=== Resultado por fuente (solo fetch, sin persistir ni gastar IA) ===\n');
  for (const r of results.sort((a, b) => b.count - a.count)) {
    console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${r.code.padEnd(16)} ${r.count} items`);
    if (r.detail) console.log(r.detail);
  }
  console.log(`\nTotal items dentro de la ventana de 3 dias: ${results.reduce((s, r) => s + r.count, 0)}`);

  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
