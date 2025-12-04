-- =============================================================================
-- AgentBlinkPay Database Schema
-- =============================================================================
-- 
-- This schema defines the off-chain data store for AgentBlinkPay.
-- Solana is the source of truth for policies, meters, and authorizations.
-- This DB stores operational data, Circle wallet mappings, and payment status.
-- =============================================================================

-- =============================================================================
-- AGENTS TABLE
-- =============================================================================
-- 
-- Stores agent accounts with their Circle wallet mappings and API keys.
-- Each agent has an on-chain AgentPolicy account (linked via agent_pubkey).

CREATE TABLE IF NOT EXISTS agents (
    -- Primary key
    id TEXT PRIMARY KEY,
    
    -- Solana public key for the agent (links to on-chain AgentPolicy PDA)
    agent_pubkey TEXT NOT NULL UNIQUE,
    
    -- Circle Programmable Wallet ID assigned to this agent
    -- Used for USDC transfers when MeterPaid events are received
    circle_wallet_id TEXT NOT NULL,
    
    -- API key for authenticating agent requests
    -- Used in x-agent-api-key header
    api_key TEXT NOT NULL UNIQUE,
    
    -- Human-readable name for the agent
    name TEXT,
    
    -- Current frozen status (cached from on-chain)
    -- Updated when set_policy is called
    frozen BOOLEAN NOT NULL DEFAULT FALSE,
    
    -- Metadata
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Index for API key lookups (auth)
CREATE INDEX IF NOT EXISTS idx_agents_api_key ON agents(api_key);

-- Index for pubkey lookups (event processing)
CREATE INDEX IF NOT EXISTS idx_agents_pubkey ON agents(agent_pubkey);

-- =============================================================================
-- METERS TABLE
-- =============================================================================
-- 
-- Stores registered API endpoints (meters) with their pricing and routing info.
-- Each meter has an on-chain Meter account (linked via meter_pubkey).

CREATE TABLE IF NOT EXISTS meters (
    -- Primary key
    id TEXT PRIMARY KEY,
    
    -- Solana public key for the meter (links to on-chain Meter PDA)
    meter_pubkey TEXT NOT NULL UNIQUE,
    
    -- Circle wallet ID for the merchant receiving payments
    merchant_wallet_id TEXT NOT NULL,
    
    -- Upstream API URL to proxy requests to
    -- e.g., "https://api.openai.com/v1/chat/completions"
    upstream_url TEXT NOT NULL,
    
    -- HTTP method for the upstream API
    http_method TEXT NOT NULL DEFAULT 'POST',
    
    -- Spending category (1=AI_API, 2=DATA_FEED, 3=TOOL, 4=CATAN_ACTION)
    category INTEGER NOT NULL,
    
    -- Price per call in USDC smallest units (e.g., 50000 = $0.05)
    price_per_call INTEGER NOT NULL,
    
    -- Whether this meter requires ZK policy verification
    requires_zk BOOLEAN NOT NULL DEFAULT TRUE,
    
    -- Human-readable name
    name TEXT,
    
    -- Metadata
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Index for pubkey lookups (event processing)
CREATE INDEX IF NOT EXISTS idx_meters_pubkey ON meters(meter_pubkey);

-- =============================================================================
-- PAYMENTS TABLE
-- =============================================================================
-- 
-- Tracks payment flow from Solana events to Circle transfers.
-- 
-- Flow:
-- 1. MeterPaid event received → create record with status='pending'
-- 2. Circle transfer initiated → status='processing'
-- 3. Circle transfer confirmed → status='succeeded'
-- 4. Circle transfer failed → status='failed'
-- 
-- The event_id (hash of agent+meter+nonce) is used as Circle idempotency key.

CREATE TABLE IF NOT EXISTS payments (
    -- Primary key
    id TEXT PRIMARY KEY,
    
    -- Unique event identifier (used as Circle idempotency key)
    -- Computed as: hash(agent_pubkey + meter_pubkey + nonce)
    event_id TEXT NOT NULL UNIQUE,
    
    -- References
    agent_id TEXT NOT NULL REFERENCES agents(id),
    meter_id TEXT NOT NULL REFERENCES meters(id),
    
    -- Payment details (from MeterPaid event)
    amount INTEGER NOT NULL,
    nonce INTEGER NOT NULL,
    category INTEGER NOT NULL,
    
    -- Solana slot when payment was recorded
    slot INTEGER NOT NULL,
    
    -- Circle wallet IDs for the transfer
    from_wallet_id TEXT NOT NULL,
    to_wallet_id TEXT NOT NULL,
    
    -- Payment status
    -- 'pending' → 'processing' → 'succeeded' | 'failed'
    status TEXT NOT NULL DEFAULT 'pending',
    
    -- Error information if status='failed'
    error_message TEXT,
    
    -- Circle transfer ID (if available)
    circle_transfer_id TEXT,
    
    -- Timestamps
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    processed_at DATETIME
);

-- Index for status queries (finding pending/failed payments to retry)
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);

-- Index for agent queries
CREATE INDEX IF NOT EXISTS idx_payments_agent ON payments(agent_id);

-- Index for meter queries
CREATE INDEX IF NOT EXISTS idx_payments_meter ON payments(meter_id);

-- Composite index for credit checks (does agent have recent payment for meter?)
CREATE INDEX IF NOT EXISTS idx_payments_credit ON payments(agent_id, meter_id, status);

-- =============================================================================
-- CREDITS TABLE
-- =============================================================================
-- 
-- Tracks "credits" that allow agents to access paywalled APIs.
-- A credit is created when a payment succeeds and consumed when a request is made.
-- This provides a simple "pay once, use once" model.

CREATE TABLE IF NOT EXISTS credits (
    -- Primary key
    id TEXT PRIMARY KEY,
    
    -- References
    agent_id TEXT NOT NULL REFERENCES agents(id),
    meter_id TEXT NOT NULL REFERENCES meters(id),
    payment_id TEXT NOT NULL REFERENCES payments(id),
    
    -- Whether this credit has been consumed
    used BOOLEAN NOT NULL DEFAULT FALSE,
    
    -- Timestamps
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    used_at DATETIME
);

-- Index for credit checks
CREATE INDEX IF NOT EXISTS idx_credits_lookup ON credits(agent_id, meter_id, used);

-- =============================================================================
-- LISTENER_STATE TABLE
-- =============================================================================
-- 
-- Tracks the Solana event listener's processing state.
-- Used for recovery after restart - we can resume from last_processed_slot.

CREATE TABLE IF NOT EXISTS listener_state (
    -- Single row table
    id INTEGER PRIMARY KEY CHECK (id = 1),
    
    -- Last successfully processed Solana slot
    last_processed_slot INTEGER NOT NULL DEFAULT 0,
    
    -- Last update timestamp
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Initialize listener state
INSERT OR IGNORE INTO listener_state (id, last_processed_slot) VALUES (1, 0);
