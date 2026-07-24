-- =====================================================================
-- Per-repository GitHub access token (encrypted at rest).
--
-- Stores an AES-256-GCM ciphertext (iv:tag:data, base64) produced by the
-- backend crypto util — never the raw PAT. Decryption needs TOKEN_ENC_KEY.
-- The column is read by GitService to make authenticated Octokit calls
-- (list branches, fetch the commit graph) on a per-repo basis.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS. Apply after release_migration.sql:
--   psql -U monitor -d monitoring -f database/repo_github_token_migration.sql
-- =====================================================================

ALTER TABLE repositories
  ADD COLUMN IF NOT EXISTS github_token_enc TEXT;

COMMENT ON COLUMN repositories.github_token_enc IS
  'AES-256-GCM encrypted GitHub PAT (iv:tag:ciphertext, base64). Decrypt with TOKEN_ENC_KEY.';
