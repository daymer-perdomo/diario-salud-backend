# Base Node LTS -- Playwright se instala explicitamente con --with-deps
# en vez de partir de la imagen oficial de Playwright, para no depender
# de que el tag de esa imagen coincida exactamente con la version de
# @playwright/test instalada en package.json.
FROM node:22-slim

WORKDIR /app

# python3 + openpyxl: requeridos en runtime por
# scripts/extract_content_pack.py y extract_blog_master.py (ver
# src/blog/content-pack-import.core.ts), invocados via execFileSync desde
# Node -- sin esto, POST /blog/import y los scripts de import fallan con
# "python3: command not found" (500 generico de Nest, sin detalle). Se usa
# el paquete apt python3-openpyxl (no pip) porque Debian bookworm bloquea
# pip install directo sobre el Python del sistema (PEP 668,
# "externally-managed-environment").
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-openpyxl \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

# Chromium + dependencias de sistema. Unico uso real hoy: el adapter de
# cancer.gov.co (fetchMethod=HEADLESS_BROWSER, Cloudflare) -- isActive=false
# hasta calibrar sus selectores, pero el binario debe estar disponible
# desde el primer deploy.
RUN npx playwright install --with-deps chromium

COPY . .

RUN npx prisma generate
RUN npm run build

EXPOSE 3000

# El build de Nest compila a dist/src/main.js (no dist/main.js): no hay
# "rootDir" en tsconfig.json, y prisma/seed.ts entra en la compilacion,
# asi que TypeScript calcula la raiz comun de src/ y prisma/ y refleja
# ambas carpetas bajo dist/.
#
# migrate deploy + seed corren en cada arranque del contenedor (no solo en
# el primer deploy): en el plan free de Render no hay preDeployCommand ni
# Shell, asi que este es el unico lugar disponible para aplicarlos. Ambos
# son idempotentes -- migrate deploy omite lo ya aplicado, el seed usa
# upsert -- por lo que repetirlos en cada restart es seguro.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/prisma/seed.js && node dist/src/main.js"]
