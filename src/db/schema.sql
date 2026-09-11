-- ============================================================================
-- ENTERPRISE DISTRIBUTED SYSTEMS ARCHITECTURE: POSTGRESQL SCHEMAS & INDEXES
-- Systems: Primary Master (Source of Truth) & Secondary (Consumer / Scraping)
-- ============================================================================

-- Enable UUID extension for cryptographically strong entity identifiers
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. TRANSACTIONAL OUTBOX PATTERN TABLE
-- Stores domain events atomically inside local transactions before webhook dispatch
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id VARCHAR(128) NOT NULL UNIQUE,
    idempotency_key VARCHAR(128) NOT NULL UNIQUE,
    aggregate_type VARCHAR(64) NOT NULL,    -- e.g. 'student', 'account', 'attendance', 'payment'
    aggregate_id VARCHAR(128) NOT NULL,     -- e.g. student barcode or user id
    event_type VARCHAR(64) NOT NULL,        -- 'CREATED', 'UPDATED', 'DELETED', 'SOFT_DELETED'
    version BIGINT NOT NULL,                -- Monotonic incrementing version
    payload JSONB NOT NULL,                 -- Full entity state / delta
    checksum VARCHAR(64) NOT NULL,          -- SHA-256 checksum of payload
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'PROCESSING', 'PROCESSED', 'FAILED', 'DEAD_LETTER'
    retry_count INT NOT NULL DEFAULT 0,
    max_retries INT NOT NULL DEFAULT 10,
    next_retry_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMPTZ,
    last_attempt_at TIMESTAMPTZ
);

-- Compound index for ultra-fast polling by outbox dispatcher worker
CREATE INDEX IF NOT EXISTS idx_sync_outbox_polling 
ON sync_outbox (status, next_retry_at ASC) 
WHERE status IN ('PENDING', 'FAILED');

CREATE INDEX IF NOT EXISTS idx_sync_outbox_aggregate 
ON sync_outbox (aggregate_type, aggregate_id, version DESC);

-- Automated retention cleanup index for processed and dead-letter events purge
CREATE INDEX IF NOT EXISTS idx_sync_outbox_purge 
ON sync_outbox (status, created_at ASC) 
WHERE status IN ('PROCESSED', 'DEAD_LETTER');

-- ----------------------------------------------------------------------------
-- 2. MONOTONIC VERSION & ENTITY SYNC TRACKER TABLE
-- Secondary System guard against out-of-order execution, replay attacks, and drift
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS entity_sync_tracker (
    entity_type VARCHAR(64) NOT NULL,
    entity_id VARCHAR(128) NOT NULL,
    version BIGINT NOT NULL,
    checksum VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'IN_SYNC', -- 'IN_SYNC', 'DIRTY', 'CORRUPTED'
    last_synced_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    source_system VARCHAR(64) NOT NULL DEFAULT 'PRIMARY_MASTER',
    metadata JSONB DEFAULT '{}'::jsonb,
    PRIMARY KEY (entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_entity_sync_tracker_version 
ON entity_sync_tracker (entity_type, version DESC);

CREATE INDEX IF NOT EXISTS idx_entity_sync_tracker_synced_at 
ON entity_sync_tracker (last_synced_at DESC);

-- ----------------------------------------------------------------------------
-- 3. USER ACCOUNTS TABLE (CORE IDENTITY & RBAC)
-- Synchronized between Primary Master and Secondary Consumer with Cascading Rules
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    barcode VARCHAR(64) NOT NULL UNIQUE,
    parent_phone VARCHAR(32) NOT NULL,
    student_name VARCHAR(256) NOT NULL,
    grade VARCHAR(64) NOT NULL,
    role VARCHAR(32) NOT NULL DEFAULT 'parent', -- 'parent', 'supervisor', 'admin'
    password_hash VARCHAR(256) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'active', -- 'active', 'suspended', 'deleted'
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    linked_barcodes TEXT[] DEFAULT ARRAY[]::TEXT[],
    preferences JSONB DEFAULT '{"notifications_enabled": true, "sound_alerts": true}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    suspended_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_user_accounts_phone ON user_accounts (parent_phone);
CREATE INDEX IF NOT EXISTS idx_user_accounts_status ON user_accounts (status, is_deleted);
CREATE INDEX IF NOT EXISTS idx_user_accounts_role ON user_accounts (role);

-- ----------------------------------------------------------------------------
-- 4. CHAT CONVERSATIONS TABLE
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_barcode VARCHAR(64) NOT NULL UNIQUE REFERENCES user_accounts (barcode) ON DELETE CASCADE,
    title VARCHAR(256) NOT NULL,
    last_message_text TEXT,
    last_message_at TIMESTAMPTZ,
    unread_parent_count INT NOT NULL DEFAULT 0,
    unread_admin_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_chat_conversations_last_msg 
ON chat_conversations (last_message_at DESC NULLS LAST);

-- ----------------------------------------------------------------------------
-- 5. CHAT MESSAGES TABLE
-- Includes Compound Index (conversation_id, created_at DESC) for Cursor Pagination
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES chat_conversations (id) ON DELETE CASCADE,
    sender_id VARCHAR(64) NOT NULL,
    sender_role VARCHAR(32) NOT NULL, -- 'parent', 'supervisor', 'admin'
    text TEXT NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'SENT', -- 'SENT', 'DELIVERED', 'READ'
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    read_at TIMESTAMPTZ
);

-- CRITICAL PERFORMANCE INDEX FOR CURSOR-BASED PAGINATION
CREATE INDEX IF NOT EXISTS idx_chat_messages_cursor 
ON chat_messages (conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_messages_status 
ON chat_messages (conversation_id, status) 
WHERE status != 'READ';

-- ----------------------------------------------------------------------------
-- 6. PUSH NOTIFICATION TOKENS TABLE (FCM v1 & Web Push)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS push_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(64) NOT NULL,
    token TEXT NOT NULL UNIQUE,
    platform VARCHAR(32) NOT NULL DEFAULT 'web', -- 'android', 'ios', 'web'
    native_channel_id VARCHAR(64) DEFAULT 'high_importance_channel',
    device_info JSONB DEFAULT '{}'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_push_tokens_user 
ON push_tokens (user_id, is_active);

-- ----------------------------------------------------------------------------
-- 7. AUDIT LOGS TABLE
-- Immutable event log for Supervisor and Admin actions
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action VARCHAR(64) NOT NULL,        -- 'ACCOUNT_SUSPENDED', 'ACCOUNT_ACTIVATED', 'ACCOUNT_HARD_DELETED'
    actor_id VARCHAR(64) NOT NULL,      -- Supervisor / Admin identifier
    actor_role VARCHAR(32) NOT NULL,
    target_entity VARCHAR(64) NOT NULL, -- 'user_account', 'chat_conversation'
    target_id VARCHAR(128) NOT NULL,    -- student barcode / entity ID
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip_address VARCHAR(45),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_target 
ON audit_logs (target_entity, target_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at 
ON audit_logs (created_at DESC);

-- ----------------------------------------------------------------------------
-- 8. AUTOMATED TIMESTAMP UPDATE TRIGGER
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_timestamp_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE OR REPLACE TRIGGER trg_user_accounts_updated_at
BEFORE UPDATE ON user_accounts
FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();

CREATE OR REPLACE TRIGGER trg_chat_conversations_updated_at
BEFORE UPDATE ON chat_conversations
FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();

CREATE OR REPLACE TRIGGER trg_push_tokens_updated_at
BEFORE UPDATE ON push_tokens
FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();
