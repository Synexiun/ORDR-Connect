-- ============================================================
-- Migration 0021: Internal Messaging — chat_channels + chat_messages
--
-- Adds persistent storage for the internal enterprise messaging system.
-- Replaces InMemoryChannelStore and InMemoryMessageStore with Drizzle-backed
-- stores that survive pod restarts.
--
-- SOC2 CC6.3  — Tenant isolation via tenant_id FK + future RLS.
-- ISO 27001 A.8.3.1 — Message retention controlled at DB level.
-- HIPAA §164.312(a)(1) — Access controls via RLS (see 0003_rls_policies.sql).
-- ============================================================

-- ── Enums ────────────────────────────────────────────────────────
CREATE TYPE channel_type AS ENUM (
  'public',
  'private',
  'direct',
  'announcement',
  'thread'
);

CREATE TYPE message_content_type AS ENUM (
  'text',
  'markdown',
  'file',
  'image',
  'system',
  'code'
);

-- ── chat_channels ────────────────────────────────────────────────
CREATE TABLE chat_channels (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          VARCHAR(255) NOT NULL,
  type          channel_type NOT NULL DEFAULT 'public',
  description   TEXT,
  topic         TEXT,
  member_ids    JSONB       NOT NULL DEFAULT '[]',
  admin_ids     JSONB       NOT NULL DEFAULT '[]',
  created_by    UUID        NOT NULL,
  is_archived   BOOLEAN     NOT NULL DEFAULT false,
  is_pinned     BOOLEAN     NOT NULL DEFAULT false,
  metadata      JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX chat_channels_tenant_archived_idx ON chat_channels (tenant_id, is_archived);
CREATE INDEX chat_channels_tenant_type_idx     ON chat_channels (tenant_id, type);

-- ── chat_messages ────────────────────────────────────────────────
CREATE TABLE chat_messages (
  id                  UUID                  PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id          UUID                  NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
  tenant_id           UUID                  NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sender_id           UUID                  NOT NULL,
  sender_name         VARCHAR(255)          NOT NULL,
  content             TEXT                  NOT NULL,
  content_type        message_content_type  NOT NULL DEFAULT 'text',
  attachments         JSONB                 NOT NULL DEFAULT '[]',
  reply_to_id         UUID,
  thread_id           UUID,
  thread_reply_count  INTEGER               NOT NULL DEFAULT 0,
  mentions            JSONB                 NOT NULL DEFAULT '[]',
  reactions           JSONB                 NOT NULL DEFAULT '{}',
  read_by             JSONB                 NOT NULL DEFAULT '{}',
  is_system_message   BOOLEAN               NOT NULL DEFAULT false,
  metadata            JSONB,
  edited_at           TIMESTAMPTZ,
  deleted_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ           NOT NULL DEFAULT NOW()
);

-- Primary lookup: messages in a channel ordered by time (cursor pagination)
CREATE INDEX chat_messages_channel_created_idx ON chat_messages (channel_id, tenant_id, created_at DESC);
-- Unread count queries + sender history
CREATE INDEX chat_messages_tenant_sender_idx   ON chat_messages (tenant_id, sender_id);
-- Thread queries
CREATE INDEX chat_messages_thread_idx          ON chat_messages (thread_id) WHERE thread_id IS NOT NULL;
-- Full-text search (GIN index on content)
CREATE INDEX chat_messages_fts_idx             ON chat_messages USING gin (to_tsvector('english', content));
