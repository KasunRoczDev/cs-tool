/* eslint-disable */
// Applies database/schema.sql and seeds a working admin user.
// Usage: DATABASE_URL=... ADMIN_EMAIL=... ADMIN_PASSWORD=... node scripts/migrate.js
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const bcrypt = require('bcryptjs');

(async () => {
  // SCHEMA_PATH lets Docker point at a mounted copy; fall back to repo layout for local dev.
  const schemaPath =
    process.env.SCHEMA_PATH || path.resolve(__dirname, '../../database/schema.sql');
  if (!fs.existsSync(schemaPath)) {
    throw new Error(
      `schema.sql not found at ${schemaPath}. Set SCHEMA_PATH or mount database/schema.sql.`,
    );
  }
  const sql = fs.readFileSync(schemaPath, 'utf8');
  const client = new Client({
    connectionString:
      process.env.DATABASE_URL ||
      'postgres://monitor:monitor@localhost:5432/monitoring',
  });
  await client.connect();
  console.log('Applying schema...');
  await client.query(sql);

  // Apply products migration (idempotent — uses IF NOT EXISTS / ON CONFLICT DO NOTHING).
  // Must run after schema.sql since it ALTERs the servers table.
  const productsPath =
    process.env.PRODUCTS_MIGRATION_PATH ||
    path.resolve(__dirname, '../../database/products_migration.sql');
  if (fs.existsSync(productsPath)) {
    console.log('Applying products migration...');
    await client.query(fs.readFileSync(productsPath, 'utf8'));
  }

  // Apply settings migration (idempotent — uses IF NOT EXISTS / ON CONFLICT DO NOTHING).
  const settingsPath =
    process.env.SETTINGS_MIGRATION_PATH ||
    path.resolve(__dirname, '../../database/settings_migration.sql');
  if (fs.existsSync(settingsPath)) {
    console.log('Applying settings migration...');
    await client.query(fs.readFileSync(settingsPath, 'utf8'));
  }

  // Apply notifications migration (idempotent — uses IF NOT EXISTS).
  const notifPath =
    process.env.NOTIF_MIGRATION_PATH ||
    path.resolve(__dirname, '../../database/notifications_migration.sql');
  if (fs.existsSync(notifPath)) {
    console.log('Applying notifications migration...');
    await client.query(fs.readFileSync(notifPath, 'utf8'));
  }

  // Apply topology migration (idempotent — IF NOT EXISTS). Must run after the
  // products table exists, since topologies references products(id).
  const topologyPath =
    process.env.TOPOLOGY_MIGRATION_PATH ||
    path.resolve(__dirname, '../../database/topology_migration.sql');
  if (fs.existsSync(topologyPath)) {
    console.log('Applying topology migration...');
    await client.query(fs.readFileSync(topologyPath, 'utf8'));
  }

  // Apply MFA migration (idempotent — ADD COLUMN IF NOT EXISTS).
  const mfaPath =
    process.env.MFA_MIGRATION_PATH ||
    path.resolve(__dirname, '../../database/mfa_migration.sql');
  if (fs.existsSync(mfaPath)) {
    console.log('Applying mfa migration...');
    await client.query(fs.readFileSync(mfaPath, 'utf8'));
  }

  // Apply release-management migration (idempotent — IF NOT EXISTS / guarded
  // enums). Must run after products + users exist, since repositories and
  // releases reference them.
  const releasePath =
    process.env.RELEASE_MIGRATION_PATH ||
    path.resolve(__dirname, '../../database/release_migration.sql');
  if (fs.existsSync(releasePath)) {
    console.log('Applying release-management migration...');
    await client.query(fs.readFileSync(releasePath, 'utf8'));
  }

  // Apply repo GitHub-token migration (idempotent — ADD COLUMN IF NOT EXISTS).
  // Must run after release_migration.sql since it ALTERs the repositories table.
  const repoTokenPath =
    process.env.REPO_TOKEN_MIGRATION_PATH ||
    path.resolve(__dirname, '../../database/repo_github_token_migration.sql');
  if (fs.existsSync(repoTokenPath)) {
    console.log('Applying repo github-token migration...');
    await client.query(fs.readFileSync(repoTokenPath, 'utf8'));
  }

  // Apply deploy-jobs migration (idempotent — IF NOT EXISTS). Must run after
  // release_migration.sql (deployments) and schema.sql (servers).
  const deployJobsPath =
    process.env.DEPLOY_JOBS_MIGRATION_PATH ||
    path.resolve(__dirname, '../../database/deploy_jobs_migration.sql');
  if (fs.existsSync(deployJobsPath)) {
    console.log('Applying deploy-jobs migration...');
    await client.query(fs.readFileSync(deployJobsPath, 'utf8'));
  }

  // Apply deploy-cancel migration (idempotent — ADD VALUE IF NOT EXISTS / IF NOT
  // EXISTS index). Must run after deploy_jobs_migration.sql (deployments, channels).
  const deployCancelPath =
    process.env.DEPLOY_CANCEL_MIGRATION_PATH ||
    path.resolve(__dirname, '../../database/deploy_cancel_migration.sql');
  if (fs.existsSync(deployCancelPath)) {
    console.log('Applying deploy-cancel migration...');
    await client.query(fs.readFileSync(deployCancelPath, 'utf8'));
  }

  // Apply release-approvals migration (idempotent). After releases + products + users.
  const approvalsPath =
    process.env.APPROVALS_MIGRATION_PATH ||
    path.resolve(__dirname, '../../database/release_approvals_migration.sql');
  if (fs.existsSync(approvalsPath)) {
    console.log('Applying release-approvals migration...');
    await client.query(fs.readFileSync(approvalsPath, 'utf8'));
  }

  // Apply RBAC + release-status migration (idempotent). Must run LAST — after
  // users, products, releases, approvals exist (it backfills from them).
  const rbacPath =
    process.env.RBAC_MIGRATION_PATH ||
    path.resolve(__dirname, '../../database/rbac_migration.sql');
  if (fs.existsSync(rbacPath)) {
    console.log('Applying RBAC + release-status migration...');
    await client.query(fs.readFileSync(rbacPath, 'utf8'));
  }

  // Apply release-workflow-config migration (idempotent — widens releases.status
  // to TEXT so custom per-product workflow status keys don't hit the old
  // release_channel enum). Must run after rbac_migration.sql.
  const workflowConfigPath =
    process.env.RELEASE_WORKFLOW_CONFIG_MIGRATION_PATH ||
    path.resolve(__dirname, '../../database/release_workflow_config_migration.sql');
  if (fs.existsSync(workflowConfigPath)) {
    console.log('Applying release-workflow-config migration...');
    await client.query(fs.readFileSync(workflowConfigPath, 'utf8'));
  }

  // Apply release-calendar migration (idempotent — planned_date, scheduled
  // deployments, freeze windows). Must run after deploy_jobs_migration.sql and
  // deploy_cancel_migration.sql (deployments, channels, deploy_status enum,
  // uq_deployments_active_channel — all widened/reused here).
  const calendarPath =
    process.env.RELEASE_CALENDAR_MIGRATION_PATH ||
    path.resolve(__dirname, '../../database/release_calendar_migration.sql');
  if (fs.existsSync(calendarPath)) {
    // The file itself later uses 'scheduled' in a CREATE INDEX WHERE clause, and
    // Postgres rejects using a freshly-added enum value in the same multi-statement
    // batch it was added in ("unsafe use of new value" — a bare COMMIT inside the
    // batch string does NOT split it for this check, verified against a real run).
    // Adding it here, as its own standalone query, is a separate round-trip that
    // Postgres auto-commits immediately, so it's already durable by the time the
    // file below re-issues the same (now no-op) ADD VALUE IF NOT EXISTS.
    await client.query(`ALTER TYPE deploy_status ADD VALUE IF NOT EXISTS 'scheduled'`);
    console.log('Applying release-calendar migration...');
    await client.query(fs.readFileSync(calendarPath, 'utf8'));
  }

  // Apply deployment-strategy migration (idempotent — rolling/canary batch
  // waves on top of deploy_jobs). Must run after deploy_jobs_migration.sql
  // and deploy_cancel_migration.sql.
  const strategyPath =
    process.env.DEPLOYMENT_STRATEGY_MIGRATION_PATH ||
    path.resolve(__dirname, '../../database/deployment_strategy_migration.sql');
  if (fs.existsSync(strategyPath)) {
    // Same "unsafe use of new value" pitfall as release_calendar_migration.sql above —
    // this file's own CREATE INDEX later uses 'awaiting_promotion' in the same batch.
    await client.query(`ALTER TYPE deploy_status ADD VALUE IF NOT EXISTS 'awaiting_promotion'`);
    console.log('Applying deployment-strategy migration...');
    await client.query(fs.readFileSync(strategyPath, 'utf8'));
  }

  // Apply environment-secrets migration (idempotent — channel env vars/secrets,
  // channel locking, deploy_jobs.env_vars). Must run after deploy_jobs_migration.sql.
  const envSecretsPath =
    process.env.ENVIRONMENT_SECRETS_MIGRATION_PATH ||
    path.resolve(__dirname, '../../database/environment_secrets_migration.sql');
  if (fs.existsSync(envSecretsPath)) {
    console.log('Applying environment-secrets migration...');
    await client.query(fs.readFileSync(envSecretsPath, 'utf8'));
  }

  // Apply approval-workflows migration (idempotent — delegation, expiration,
  // reminders, decision history). Must run after release_approvals_migration.sql.
  const approvalWorkflowsPath =
    process.env.APPROVAL_WORKFLOWS_MIGRATION_PATH ||
    path.resolve(__dirname, '../../database/approval_workflows_migration.sql');
  if (fs.existsSync(approvalWorkflowsPath)) {
    console.log('Applying approval-workflows migration...');
    await client.query(fs.readFileSync(approvalWorkflowsPath, 'utf8'));
  }

  // Apply recurring-deployment migration (idempotent — redeploy a fixed
  // release to a channel on a schedule). Must run after
  // deployment_strategy_migration.sql.
  const recurringPath =
    process.env.RECURRING_DEPLOYMENT_MIGRATION_PATH ||
    path.resolve(__dirname, '../../database/recurring_deployment_migration.sql');
  if (fs.existsSync(recurringPath)) {
    console.log('Applying recurring-deployment migration...');
    await client.query(fs.readFileSync(recurringPath, 'utf8'));
  }

  // Apply trusted-devices migration (idempotent — IF NOT EXISTS).
  const trustedDevicesPath =
    process.env.TRUSTED_DEVICES_MIGRATION_PATH ||
    path.resolve(__dirname, '../../database/trusted_devices_migration.sql');
  if (fs.existsSync(trustedDevicesPath)) {
    console.log('Applying trusted-devices migration...');
    await client.query(fs.readFileSync(trustedDevicesPath, 'utf8'));
  }

  // Apply WebAuthn (passkeys) migration (idempotent — IF NOT EXISTS).
  const webauthnPath =
    process.env.WEBAUTHN_MIGRATION_PATH ||
    path.resolve(__dirname, '../../database/webauthn_migration.sql');
  if (fs.existsSync(webauthnPath)) {
    console.log('Applying webauthn migration...');
    await client.query(fs.readFileSync(webauthnPath, 'utf8'));
  }

  // Apply agent-releases migration (idempotent — IF NOT EXISTS). Must run
  // after schema.sql (users) and settings_migration.sql (platform_settings).
  const agentReleasesPath =
    process.env.AGENT_RELEASES_MIGRATION_PATH ||
    path.resolve(__dirname, '../../database/agent_releases_migration.sql');
  if (fs.existsSync(agentReleasesPath)) {
    console.log('Applying agent-releases migration...');
    await client.query(fs.readFileSync(agentReleasesPath, 'utf8'));
  }

  // Apply agent-update-status migration (idempotent — ADD COLUMN IF NOT
  // EXISTS). Must run after schema.sql (servers).
  const agentUpdateStatusPath =
    process.env.AGENT_UPDATE_STATUS_MIGRATION_PATH ||
    path.resolve(__dirname, '../../database/agent_update_status_migration.sql');
  if (fs.existsSync(agentUpdateStatusPath)) {
    console.log('Applying agent-update-status migration...');
    await client.query(fs.readFileSync(agentUpdateStatusPath, 'utf8'));
  }

  // Apply billing-management migration (idempotent — IF NOT EXISTS / guarded
  // enums). Must run after products_migration.sql (products) and
  // settings_migration.sql (platform_settings).
  const billingPath =
    process.env.BILLING_MIGRATION_PATH ||
    path.resolve(__dirname, '../../database/billing_migration.sql');
  if (fs.existsSync(billingPath)) {
    console.log('Applying billing-management migration...');
    await client.query(fs.readFileSync(billingPath, 'utf8'));
  }

  // Apply RDS engine service types migration (idempotent — ON CONFLICT DO
  // NOTHING). Must run after billing_migration.sql (service_types exists).
  const rdsEnginesPath =
    process.env.RDS_ENGINE_SERVICE_TYPES_MIGRATION_PATH ||
    path.resolve(__dirname, '../../database/rds_engine_service_types_migration.sql');
  if (fs.existsSync(rdsEnginesPath)) {
    console.log('Applying RDS engine service types migration...');
    await client.query(fs.readFileSync(rdsEnginesPath, 'utf8'));
  }

  // Apply service-type spec-fields migration (idempotent — ADD COLUMN IF NOT
  // EXISTS). Must run after billing_migration.sql (service_types exists).
  const specFieldsPath =
    process.env.SERVICE_TYPE_SPEC_FIELDS_MIGRATION_PATH ||
    path.resolve(__dirname, '../../database/service_type_spec_fields_migration.sql');
  if (fs.existsSync(specFieldsPath)) {
    console.log('Applying service-type spec-fields migration...');
    await client.query(fs.readFileSync(specFieldsPath, 'utf8'));
  }

  const email = process.env.ADMIN_EMAIL || 'admin@example.com';
  const password = process.env.ADMIN_PASSWORD || 'admin123';
  const hash = await bcrypt.hash(password, 10);
  await client.query(
    `INSERT INTO users (email, password_hash, role) VALUES ($1,$2,'admin')
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
    [email, hash],
  );
  console.log(`Admin ready: ${email} / ${password}`);
  await client.end();
  console.log('Done.');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
