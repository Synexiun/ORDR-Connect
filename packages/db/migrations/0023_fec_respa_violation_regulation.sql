-- Migration 0023 — Add FEC and RESPA to violation_regulation enum
-- Phase 63: FEC and RESPA compliance rules implementation
--
-- ALTER TYPE ... ADD VALUE IF NOT EXISTS is a non-blocking operation.
-- Both statements are idempotent via IF NOT EXISTS.
--
-- SOC2 CC6.1 — Regulatory coverage expansion (political/proptech verticals)
-- ISO 27001 A.5.36 — Compliance with applicable laws and regulations

ALTER TYPE violation_regulation ADD VALUE IF NOT EXISTS 'FEC';
ALTER TYPE violation_regulation ADD VALUE IF NOT EXISTS 'RESPA';
