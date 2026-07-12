# Base Node LTS -- Playwright se instala explicitamente con --with-deps
# en vez de partir de la imagen oficial de Playwright, para no depender
# de que el tag de esa imagen coincida exactamente con la version de
# @playwright/test instalada en package.json.
FROM node:22-slim

WORKDIR /app

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
CMD ["node", "dist/src/main.js"]
