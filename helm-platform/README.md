# Helm — Release & DevOps Management Platform (MVP scaffold)

Phase-0 scaffold for the platform specified in `../Release-DevOps-Platform-Blueprint.md`.
NestJS modular monolith + Prisma (PostgreSQL) + Redis (Streams/BullMQ). Four deployables
share this codebase: `helm-api` (main.ts), `helm-worker` (worker.ts), webhook ingress
(WebhookModule, deployable separately), and `helm-web` (separate React repo).

## Layout
```
prisma/schema.prisma        Full MVP data model (Parts C & G of the blueprint)
src/common/                 prisma, rbac (guard/decorator/permissions), events (bus/outbox), errors, health
src/modules/
  git-provider/             Provider port + GitHub adapter + registry (Part I)
  repository/               Repo register + bulk import
  release/                  Keystone: preflight + promote + rollback + governance + compatibility (Part C.9)
  workitem/                 Hotfix auto create + merge-back (Part C.9.1)
  webhook/                  Signature-verified provider ingress -> event bus
  audit/  notification/     Event consumers (append-only audit; channel routing)
src/main.ts                 helm-api entrypoint (REST + Swagger at /api/docs)
src/worker.ts               helm-worker entrypoint (outbox relay + consumer loop)
openapi.yaml                Machine-readable API contract (Part H)
docs/                       ER + sequence diagrams (Mermaid), Phase-0 backlog
```

## Run locally
```bash
cp .env.example .env
docker compose up -d postgres redis
npm install
npm run prisma:generate && npm run prisma:migrate
npm run start:dev          # helm-api on :3000  (Swagger: /api/docs)
npm run start:worker       # helm-worker
```

## What's real vs. stubbed
- Real: data model, RBAC guard, event envelope + transactional outbox + Redis Streams bus,
  release preflight/promote/rollback logic, governance (freeze + approvals), hotfix merge-back
  target computation, webhook signature verification + normalization, audit/notification wiring.
- Stubbed (clearly marked): GitHub API calls (Octokit wiring), OIDC auth middleware that
  populates `req.user`, BullMQ delivery workers. These are the first implementation tickets
  (see docs/phase-0-backlog.md).
