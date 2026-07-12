import { PrismaClient, Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { SOURCE_SEED_DATA } from '../src/sources/seed-data/sources.seed-data';

const prisma = new PrismaClient();

async function main() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@ecofarma.co';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'change-me-now-12345';

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      name: 'Administrador EcoFarma',
      passwordHash: await bcrypt.hash(adminPassword, 12),
      role: 'ADMIN',
    },
  });
  console.log(`Usuario ADMIN listo: ${admin.email} (cambiar password tras el primer login)`);

  for (const item of SOURCE_SEED_DATA) {
    const source = await prisma.source.upsert({
      where: { institutionCode: item.institutionCode },
      // El horario (scheduledTime/nextRunAt) NO se toca en `update`: si el
      // seed se vuelve a correr sobre una DB existente, no debe pisar un
      // horario que un ADMIN ya haya configurado desde el panel.
      update: {
        name: item.name,
        type: item.type,
        baseUrl: item.baseUrl,
        country: item.country,
        fetchMethod: item.fetchMethod,
        isActive: item.isActive,
        config: item.config as Prisma.InputJsonValue,
        updatedByUserId: admin.id,
      },
      create: {
        institutionCode: item.institutionCode,
        name: item.name,
        type: item.type,
        baseUrl: item.baseUrl,
        country: item.country,
        fetchMethod: item.fetchMethod,
        isActive: item.isActive,
        scheduledTime: item.scheduledTime ?? null,
        nextRunAt: null,
        config: item.config as Prisma.InputJsonValue,
        createdByUserId: admin.id,
        updatedByUserId: admin.id,
      },
    });
    console.log(`Source ${source.institutionCode}: activa=${source.isActive}`);
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
