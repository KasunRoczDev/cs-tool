# Next.js dashboard (standalone output)
FROM node:22-slim AS build
WORKDIR /app
# Next bakes external rewrite destinations at BUILD time, so BACKEND_URL must be
# available here (not just at runtime).
ARG BACKEND_URL=http://backend:4000
ENV BACKEND_URL=$BACKEND_URL
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=5173
# Standalone bundle includes a minimal server + only required node_modules
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 5173
CMD ["node", "server.js"]
