-- Migration 0022 — Add CCPA to violation_regulation enum
-- Phase 62: CCPA/CPRA compliance rules implementation
--
-- ALTER TYPE ... ADD VALUE IF NOT EXISTS is a non-blocking operation on PostgreSQL.
-- It requires no table-level lock and is safe to run on a live database.
-- The IF NOT EXISTS guard makes this migration idempotent.
--
-- SOC2 CC6.1 — Regulatory coverage expansion (CCPA/CPRA, California)
-- ISO 27001 A.5.36 — Compliance with laws and regulations

ALTER TYPE violation_regulation ADD VALUE IF NOT EXISTS 'CCPA';
