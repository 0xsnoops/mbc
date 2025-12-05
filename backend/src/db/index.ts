/**
 * Database Setup and Models
 * 
 * Uses better-sqlite3 for SQLite database operations.
 * In production, could be replaced with PostgreSQL via pg/knex.
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

// =============================================================================
// DATABASE INITIALIZATION
// =============================================================================

const DB_PATH = process.env.DATABASE_PATH || './data/agentblinkpay.db';

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

export const db = new Database(DB_PATH) as any;

// Enable foreign keys
db.pragma('foreign_keys = ON');

/**
 * Initialize database with schema
 */
export function initializeDatabase(): void {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  db.exec(schema);
  runMigrations();
  console.log('Database initialized successfully');
}

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

export interface Agent {
  id: string;
  agent_pubkey: string;
  agent_secret_key: string | null;
  circle_wallet_id: string;
  api_key: string;
  name: string | null;
  frozen: boolean;
  created_at: string;
  updated_at: string;
}

// =============================================================================
// DATABASE MIGRATIONS
// =============================================================================

function runMigrations() {
  try {
    const tableInfo = db.prepare("PRAGMA table_info(agents)").all();
    const hasSecretKey = tableInfo.some((col: any) => col.name === 'agent_secret_key');

    if (!hasSecretKey) {
      console.log('Migrating database: Adding agent_secret_key to agents table...');
      db.prepare("ALTER TABLE agents ADD COLUMN agent_secret_key TEXT").run();
    }
  } catch (error) {
    console.error('Migration failed:', error);
  }
}

export interface Meter {
  id: string;
  meter_pubkey: string;
  merchant_wallet_id: string;
  upstream_url: string;
  http_method: string;
  category: number;
  price_per_call: number;
  requires_zk: boolean;
  name: string | null;
  created_at: string;
  updated_at: string;
}

export interface Payment {
  id: string;
  event_id: string;
  agent_id: string;
  meter_id: string;
  amount: number;
  nonce: number | bigint;
  category: number;
  slot: number;
  from_wallet_id: string;
  to_wallet_id: string;
  status: 'pending' | 'processing' | 'succeeded' | 'failed';
  error_message: string | null;
  circle_transfer_id: string | null;
  created_at: string;
  updated_at: string;
  processed_at: string | null;
}

export interface Credit {
  id: string;
  agent_id: string;
  meter_id: string;
  payment_id: string;
  used: boolean;
  created_at: string;
  used_at: string | null;
}

// =============================================================================
// AGENT OPERATIONS
// =============================================================================

export const agents = {
  create: db.prepare(`
    INSERT INTO agents (id, agent_pubkey, agent_secret_key, circle_wallet_id, api_key, name)
    VALUES (?, ?, ?, ?, ?, ?)
  `) as any,

  findById: db.prepare(`
    SELECT * FROM agents WHERE id = ?
  `) as any,

  findByPubkey: db.prepare(`
    SELECT * FROM agents WHERE agent_pubkey = ?
  `) as any,

  findByApiKey: db.prepare(`
    SELECT * FROM agents WHERE api_key = ?
  `) as any,

  updateFrozen: db.prepare(`
    UPDATE agents SET frozen = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `) as any,

  list: db.prepare(`
    SELECT * FROM agents ORDER BY created_at DESC
  `) as any,
};

// =============================================================================
// METER OPERATIONS
// =============================================================================

export const meters = {
  create: db.prepare(`
    INSERT INTO meters (id, meter_pubkey, merchant_wallet_id, upstream_url, http_method, category, price_per_call, requires_zk, name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `) as any,

  findById: db.prepare(`
    SELECT * FROM meters WHERE id = ?
  `) as any,

  findByPubkey: db.prepare(`
    SELECT * FROM meters WHERE meter_pubkey = ?
  `) as any,

  list: db.prepare(`
    SELECT * FROM meters ORDER BY created_at DESC
  `) as any,
};

// =============================================================================
// PAYMENT OPERATIONS
// =============================================================================

export const payments = {
  create: db.prepare(`
    INSERT INTO payments (id, event_id, agent_id, meter_id, amount, nonce, category, slot, from_wallet_id, to_wallet_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `) as any,

  findByEventId: db.prepare(`
    SELECT * FROM payments WHERE event_id = ?
  `) as any,

  updateStatus: db.prepare(`
    UPDATE payments 
    SET status = ?, error_message = ?, circle_transfer_id = ?, updated_at = CURRENT_TIMESTAMP, processed_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `) as any,

  findPending: db.prepare(`
    SELECT * FROM payments WHERE status IN ('pending', 'failed') ORDER BY created_at ASC
  `) as any,

  findByAgent: db.prepare(`
    SELECT * FROM payments WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?
  `) as any,

  listAll: db.prepare(`
    SELECT * FROM payments ORDER BY created_at ASC
  `) as any,
};

// =============================================================================
// CREDIT OPERATIONS
// =============================================================================

export const credits = {
  create: db.prepare(`
    INSERT INTO credits (id, agent_id, meter_id, payment_id)
    VALUES (?, ?, ?, ?)
  `) as any,

  findAvailable: db.prepare(`
    SELECT * FROM credits WHERE agent_id = ? AND meter_id = ? AND used = FALSE LIMIT 1
  `) as any,

  markUsed: db.prepare(`
    UPDATE credits SET used = TRUE, used_at = CURRENT_TIMESTAMP WHERE id = ?
  `) as any,
};

// =============================================================================
// LISTENER STATE OPERATIONS
// =============================================================================

export const listenerState = {
  get: db.prepare(`
    SELECT last_processed_slot FROM listener_state WHERE id = 1
  `) as any,

  update: db.prepare(`
    UPDATE listener_state SET last_processed_slot = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1
  `) as any,
};
