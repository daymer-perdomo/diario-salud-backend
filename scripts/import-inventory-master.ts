/// Import manual (no automatico, no forma parte del seed ni del
/// preDeployCommand de render.yaml) desde el Excel maestro de inventario
/// hacia Branch/Product/ProductStock -- mismo patron que
/// import-blog-master.ts. Idempotente: corre siempre por upsert (sku /
/// branch code / (productId,branchId)), asi que se puede re-correr sin
/// duplicar filas -- por ejemplo para refrescar precios/cantidades cada
/// cierto tiempo con un Excel actualizado.
///
/// La lectura real del .xlsx la hace extract_inventory_master.py (Python
/// + openpyxl, columnas detectadas por nombre de encabezado -- ver ese
/// archivo para el layout esperado). Requiere python3 + openpyxl
/// instalados en la maquina.
///
/// Uso: npx ts-node scripts/import-inventory-master.ts <ruta.xlsx> [--limit N]
/// --limit controla cuantas filas (producto x sucursal) del Excel se
/// importan (default 50) -- igual que Blog, revisar calidad antes de
/// escalar al archivo completo.
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface ExtractedItem {
  sku: string;
  name: string;
  activeIngredient: string | null;
  category: string | null;
  description: string | null;
  requiresPrescription: boolean;
  branchCode: string | null;
  branchName: string | null;
  quantity: number;
  price: number;
}

function runExtractor(xlsxPath: string, limit: number): ExtractedItem[] {
  const outPath = path.join(os.tmpdir(), `inventory-master-extract-${Date.now()}.json`);
  const scriptPath = path.join(__dirname, 'extract_inventory_master.py');
  console.log(`Extrayendo con Python (openpyxl): ${scriptPath}`);
  execFileSync('python3', [scriptPath, xlsxPath, String(limit), outPath], { stdio: 'inherit' });
  const raw = fs.readFileSync(outPath, 'utf-8');
  fs.unlinkSync(outPath);
  return (JSON.parse(raw) as { items: ExtractedItem[] }).items;
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Uso: import-inventory-master.ts <ruta.xlsx> [--limit N]');
    process.exit(1);
  }
  const limitIdx = process.argv.indexOf('--limit');
  const limit = limitIdx !== -1 ? parseInt(process.argv[limitIdx + 1], 10) : 50;

  const items = runExtractor(filePath, limit);

  const branchIdByCode = new Map<string, string>();
  let branchCount = 0;
  let productCount = 0;
  let stockCount = 0;
  let skippedNoBranch = 0;

  for (const item of items) {
    if (!item.branchCode) {
      skippedNoBranch++;
      continue;
    }

    let branchId = branchIdByCode.get(item.branchCode);
    if (!branchId) {
      const branch = await prisma.branch.upsert({
        where: { code: item.branchCode },
        update: { name: item.branchName ?? item.branchCode },
        create: { code: item.branchCode, name: item.branchName ?? item.branchCode },
      });
      branchId = branch.id;
      branchIdByCode.set(item.branchCode, branchId);
      branchCount++;
    }

    const product = await prisma.product.upsert({
      where: { sku: item.sku },
      update: {
        name: item.name,
        activeIngredient: item.activeIngredient,
        category: item.category,
        description: item.description,
        requiresPrescription: item.requiresPrescription,
      },
      create: {
        sku: item.sku,
        name: item.name,
        activeIngredient: item.activeIngredient,
        category: item.category,
        description: item.description,
        requiresPrescription: item.requiresPrescription,
      },
    });
    productCount++;

    await prisma.productStock.upsert({
      where: { productId_branchId: { productId: product.id, branchId } },
      update: { quantity: item.quantity, price: item.price },
      create: { productId: product.id, branchId, quantity: item.quantity, price: item.price },
    });
    stockCount++;
  }

  console.log(`Branch: ${branchCount} sucursales nuevas.`);
  console.log(`Product: ${productCount} productos importados/actualizados.`);
  console.log(`ProductStock: ${stockCount} filas de stock importadas/actualizadas.`);
  if (skippedNoBranch > 0) {
    console.log(`Omitidas ${skippedNoBranch} filas sin codigo de sucursal.`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
