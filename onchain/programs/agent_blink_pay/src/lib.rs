//! AgentBlinkPay - Solana Program
//! 
//! A Solana-based spending brain for AI agents that uses Circle wallets and
//! ZK-enforced policies to control how agents pay USDC for APIs and services
//! via x402, with human oversight via Blinks.
//!
//! ## Account Types
//! - `AgentPolicy`: Per-agent spending rules (max_per_tx, allowed_category, frozen)
//! - `Meter`: Per-API-endpoint pricing and metadata
//! - `Authorization`: ZK-approved payment ticket (one-time use)
//!
//! ## Instructions
//! - `set_policy`: Create/update an agent's spending policy
//! - `create_meter`: Register a new paywalled API endpoint
//! - `authorize_payment_with_proof`: Verify ZK proof and create payment authorization
//! - `record_meter_payment`: Consume authorization and emit payment event

use anchor_lang::prelude::*;

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

// =============================================================================
// PROGRAM ENTRYPOINT
// =============================================================================

#[program]
pub mod agent_blink_pay {
    use super::*;

    /// Creates or updates an AgentPolicy account.
    /// 
    /// Called by the backend or via a Blink Action to set spending rules.
    /// 
    /// # Arguments
    /// * `policy_hash` - Commitment to the full policy (used as ZK public input)
    /// * `allowed_category` - Category of spending allowed (e.g., AI_API = 1)
    /// * `max_per_tx` - Maximum spend per transaction in smallest USDC units
    /// * `frozen` - If true, agent cannot authorize any payments
    pub fn set_policy(
        ctx: Context<SetPolicy>,
        policy_hash: [u8; 32],
        allowed_category: u8,
        max_per_tx: u64,
        frozen: bool,
    ) -> Result<()> {
        let policy = &mut ctx.accounts.agent_policy;
        
        policy.agent_pubkey = ctx.accounts.agent.key();
        policy.policy_hash = policy_hash;
        policy.allowed_category = allowed_category;
        policy.max_per_tx = max_per_tx;
        policy.frozen = frozen;
        policy.bump = ctx.bumps.agent_policy;
        
        msg!("Policy set for agent: {:?}", policy.agent_pubkey);
        msg!("  allowed_category: {}, max_per_tx: {}, frozen: {}", 
             allowed_category, max_per_tx, frozen);
        
        Ok(())
    }

    /// Creates a Meter account for a new paywalled API endpoint.
    /// 
    /// Called by the backend when a provider uses the "Register API" flow.
    /// 
    /// # Arguments
    /// * `price_per_call` - Price in USDC smallest units (e.g., 50000 = $0.05)
    /// * `category` - Category enum for this meter (must match agent's allowed_category)
    /// * `merchant_wallet_id` - Identifier for the merchant's Circle wallet
    /// * `requires_zk` - Whether this meter requires ZK-checked policies
    pub fn create_meter(
        ctx: Context<CreateMeter>,
        price_per_call: u64,
        category: u8,
        merchant_wallet_id: String,
        requires_zk: bool,
    ) -> Result<()> {
        require!(merchant_wallet_id.len() <= 64, AgentBlinkPayError::MerchantWalletIdTooLong);
        
        let meter = &mut ctx.accounts.meter;
        
        meter.authority = ctx.accounts.authority.key();
        meter.price_per_call = price_per_call;
        meter.category = category;
        meter.requires_zk = requires_zk;
        meter.bump = ctx.bumps.meter;
        
        // Store merchant_wallet_id as fixed-size array
        let mut wallet_id_bytes = [0u8; 64];
        let id_bytes = merchant_wallet_id.as_bytes();
        wallet_id_bytes[..id_bytes.len()].copy_from_slice(id_bytes);
        meter.merchant_wallet_id = wallet_id_bytes;
        meter.merchant_wallet_id_len = id_bytes.len() as u8;
        
        msg!("Meter created: {:?}", ctx.accounts.meter.key());
        msg!("  price_per_call: {}, category: {}, requires_zk: {}", 
             price_per_call, category, requires_zk);
        
        Ok(())
    }

    /// Authorizes a payment by verifying a ZK proof of policy compliance.
    /// 
    /// This is where the ZK magic happens - the proof demonstrates that the
    /// payment amount and category comply with the agent's private policy
    /// without revealing the full policy details.
    /// 
    /// # Arguments
    /// * `amount` - Amount to authorize in USDC smallest units
    /// * `category` - Category of this payment
    /// * `nonce` - Unique identifier to prevent replay attacks
    /// * `expires_at_slot` - Slot after which this authorization expires
    /// * `proof` - ZK proof bytes (Noir/Sunspot format)
    pub fn authorize_payment_with_proof(
        ctx: Context<AuthorizePayment>,
        amount: u64,
        category: u8,
        nonce: u64,
        expires_at_slot: u64,
        proof: Vec<u8>,
    ) -> Result<()> {
        let policy = &ctx.accounts.agent_policy;
        let meter = &ctx.accounts.meter;
        
        // Check policy is not frozen
        require!(!policy.frozen, AgentBlinkPayError::PolicyFrozen);
        
        // Check category matches
        require!(meter.category == category, AgentBlinkPayError::CategoryMismatch);
        
        // =====================================================================
        // ZK PROOF VERIFICATION
        // =====================================================================
        // TODO: Implement via Sunspot-generated verifier
        // 
        // The Noir circuit "payment_policy" checks:
        //   - amount <= max_per_tx
        //   - category == allowed_category
        // 
        // Public inputs: amount, category, policy_hash
        // Private inputs: max_per_tx, allowed_category (hidden in policy_hash)
        //
        // In production, this would call into a Sunspot-generated verifier
        // program via CPI, or use an embedded verifier.
        verify_payment_policy_proof(
            &proof,
            amount,
            category,
            policy.policy_hash,
        )?;
        // =====================================================================
        
        // Create the authorization PDA
        let auth = &mut ctx.accounts.authorization;
        
        auth.agent = ctx.accounts.agent.key();
        auth.meter = meter.key();
        auth.amount = amount;
        auth.category = category;
        auth.nonce = nonce;
        auth.expires_at_slot = expires_at_slot;
        auth.used = false;
        auth.bump = ctx.bumps.authorization;
        
        msg!("Payment authorized: agent={:?}, meter={:?}, amount={}, nonce={}",
             auth.agent, auth.meter, amount, nonce);
        
        Ok(())
    }

    /// Records a meter payment by consuming an authorization.
    /// 
    /// This marks the authorization as used and emits a MeterPaid event.
    /// The off-chain Circle service listens for this event to execute
    /// the actual USDC transfer.
    /// 
    /// # Arguments
    /// * `nonce` - The nonce of the authorization to consume
    pub fn record_meter_payment(
        ctx: Context<RecordPayment>,
        nonce: u64,
    ) -> Result<()> {
        let auth = &mut ctx.accounts.authorization;
        
        // Validate authorization is not already used
        require!(!auth.used, AgentBlinkPayError::AuthorizationUsed);
        
        // Validate authorization has not expired
        let current_slot = Clock::get()?.slot;
        require!(
            current_slot <= auth.expires_at_slot,
            AgentBlinkPayError::AuthorizationExpired
        );
        
        // Mark as used
        auth.used = true;
        
        // Emit the payment event
        // Off-chain services (Circle integration) listen for this event
        // to trigger the actual USDC transfer
        emit!(MeterPaid {
            agent: auth.agent,
            meter: auth.meter,
            amount: auth.amount,
            category: auth.category,
            nonce: nonce,
            slot: current_slot,
        });
        
        msg!("Payment recorded: agent={:?}, meter={:?}, amount={}, nonce={}",
             auth.agent, auth.meter, auth.amount, nonce);
        
        Ok(())
    }
}

// =============================================================================
// ZK VERIFICATION HELPER
// =============================================================================

/// Verifies a ZK proof that the payment complies with the agent's policy.
/// 
/// # Arguments
/// * `proof` - The ZK proof bytes generated by the Noir prover
/// * `amount` - The payment amount (public input)
/// * `category` - The payment category (public input)
/// * `policy_hash` - Hash commitment to the policy (public input)
/// 
/// # Returns
/// * `Ok(())` if proof is valid
/// * `Err(InvalidProof)` if proof verification fails
/// 
/// # TODO
/// This is a stub function. In production, implement via:
/// 1. Sunspot-generated verifier program (CPI call)
/// 2. Embedded verifier from Sunspot (inline verification)
/// 
/// Example Sunspot integration pattern:
/// ```ignore
/// // CPI to Sunspot verifier program
/// let cpi_accounts = sunspot_verifier::cpi::accounts::Verify {
///     // ... accounts
/// };
/// let cpi_ctx = CpiContext::new(verifier_program.to_account_info(), cpi_accounts);
/// sunspot_verifier::cpi::verify(cpi_ctx, public_inputs, proof)?;
/// ```
fn verify_payment_policy_proof(
    proof: &Vec<u8>,
    amount: u64,
    category: u8,
    policy_hash: [u8; 32],
) -> Result<()> {
    // =========================================================================
    // STUB: ZK Proof Verification
    // =========================================================================
    // In production, this would:
    // 1. Deserialize the proof bytes into the verifier's expected format
    // 2. Construct public inputs array: [amount, category, policy_hash]
    // 3. Call the Sunspot-generated verifier
    // 4. Return error if verification fails
    //
    // For hackathon purposes, we perform basic sanity checks and accept
    // any non-empty proof as valid.
    // =========================================================================
    
    msg!("Verifying ZK proof...");
    msg!("  amount: {}", amount);
    msg!("  category: {}", category);
    msg!("  policy_hash: {:?}", &policy_hash[..8]); // First 8 bytes for brevity
    msg!("  proof length: {} bytes", proof.len());
    
    // Basic sanity check - proof should not be empty
    require!(!proof.is_empty(), AgentBlinkPayError::InvalidProof);
    
    // TODO: Replace with actual Sunspot verifier call
    // verify_with_sunspot(public_inputs, proof)?;
    
    msg!("ZK proof verification passed (stub)");
    
    Ok(())
}

// =============================================================================
// ACCOUNT STRUCTURES
// =============================================================================

/// Agent's spending policy account.
/// 
/// PDA seeds: ["policy", agent_pubkey]
/// 
/// This defines what an agent is allowed to spend on and how much.
/// The policy_hash is a commitment used as a public input to ZK proofs,
/// allowing verification without revealing the full policy details.
#[account]
#[derive(Default)]
pub struct AgentPolicy {
    /// The agent's public key (payment identity)
    pub agent_pubkey: Pubkey,
    
    /// Hash commitment to the full policy (ZK public input)
    /// Computed as: hash(max_per_tx || allowed_category || other_fields)
    pub policy_hash: [u8; 32],
    
    /// Category of spending allowed (e.g., 1 = AI_API, 2 = CATAN_ACTION)
    pub allowed_category: u8,
    
    /// Maximum allowed spend per transaction (USDC smallest units)
    /// e.g., 500000 = 0.5 USDC
    pub max_per_tx: u64,
    
    /// If true, agent cannot authorize any payments
    pub frozen: bool,
    
    /// PDA bump seed
    pub bump: u8,
}

impl AgentPolicy {
    pub const LEN: usize = 8 +  // discriminator
        32 +                    // agent_pubkey
        32 +                    // policy_hash
        1 +                     // allowed_category
        8 +                     // max_per_tx
        1 +                     // frozen
        1;                      // bump
}

/// Meter account for a paywalled API endpoint.
/// 
/// PDA seeds: ["meter", authority, meter_id]
/// 
/// Created when an API provider registers their endpoint through the
/// "Register API" flow in the dashboard.
#[account]
#[derive(Default)]
pub struct Meter {
    /// Authority that can update this meter
    pub authority: Pubkey,
    
    /// Price per call in USDC smallest units (e.g., 50000 = $0.05)
    pub price_per_call: u64,
    
    /// Category enum (must match agent's allowed_category)
    pub category: u8,
    
    /// Merchant's Circle wallet ID (for off-chain USDC transfers)
    pub merchant_wallet_id: [u8; 64],
    
    /// Actual length of merchant_wallet_id
    pub merchant_wallet_id_len: u8,
    
    /// Whether this meter requires ZK-checked policies
    pub requires_zk: bool,
    
    /// PDA bump seed
    pub bump: u8,
}

impl Meter {
    pub const LEN: usize = 8 +  // discriminator
        32 +                    // authority
        8 +                     // price_per_call
        1 +                     // category
        64 +                    // merchant_wallet_id
        1 +                     // merchant_wallet_id_len
        1 +                     // requires_zk
        1;                      // bump
}

/// Authorization (payment ticket) account.
/// 
/// PDA seeds: ["auth", agent_pubkey, meter_pubkey, nonce]
/// 
/// Created by authorize_payment_with_proof after ZK verification.
/// Consumed by record_meter_payment to emit the payment event.
/// One-time use, expires after expires_at_slot.
#[account]
#[derive(Default)]
pub struct Authorization {
    /// The agent making the payment
    pub agent: Pubkey,
    
    /// The meter being paid
    pub meter: Pubkey,
    
    /// Amount approved (USDC smallest units)
    pub amount: u64,
    
    /// Category of this payment
    pub category: u8,
    
    /// Unique nonce to prevent replay attacks
    pub nonce: u64,
    
    /// Slot after which this authorization is invalid
    pub expires_at_slot: u64,
    
    /// Whether this authorization has been consumed
    pub used: bool,
    
    /// PDA bump seed
    pub bump: u8,
}

impl Authorization {
    pub const LEN: usize = 8 +  // discriminator
        32 +                    // agent
        32 +                    // meter
        8 +                     // amount
        1 +                     // category
        8 +                     // nonce
        8 +                     // expires_at_slot
        1 +                     // used
        1;                      // bump
}

// =============================================================================
// INSTRUCTION CONTEXTS
// =============================================================================

/// Context for set_policy instruction.
#[derive(Accounts)]
pub struct SetPolicy<'info> {
    /// The agent whose policy is being set
    pub agent: Signer<'info>,
    
    /// The policy account (PDA: ["policy", agent])
    #[account(
        init_if_needed,
        payer = payer,
        space = AgentPolicy::LEN,
        seeds = [b"policy", agent.key().as_ref()],
        bump
    )]
    pub agent_policy: Account<'info, AgentPolicy>,
    
    /// Account paying for the transaction
    #[account(mut)]
    pub payer: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

/// Context for create_meter instruction.
#[derive(Accounts)]
#[instruction(price_per_call: u64, category: u8, merchant_wallet_id: String)]
pub struct CreateMeter<'info> {
    /// Authority creating and controlling this meter
    #[account(mut)]
    pub authority: Signer<'info>,
    
    /// Unique identifier for this meter (e.g., API endpoint hash)
    /// CHECK: This is just used for PDA derivation
    pub meter_id: AccountInfo<'info>,
    
    /// The meter account (PDA: ["meter", authority, meter_id])
    #[account(
        init,
        payer = authority,
        space = Meter::LEN,
        seeds = [b"meter", authority.key().as_ref(), meter_id.key().as_ref()],
        bump
    )]
    pub meter: Account<'info, Meter>,
    
    pub system_program: Program<'info, System>,
}

/// Context for authorize_payment_with_proof instruction.
#[derive(Accounts)]
#[instruction(amount: u64, category: u8, nonce: u64)]
pub struct AuthorizePayment<'info> {
    /// The agent authorizing the payment
    pub agent: Signer<'info>,
    
    /// The agent's policy account
    #[account(
        seeds = [b"policy", agent.key().as_ref()],
        bump = agent_policy.bump,
    )]
    pub agent_policy: Account<'info, AgentPolicy>,
    
    /// The meter being paid
    pub meter: Account<'info, Meter>,
    
    /// The authorization account (PDA: ["auth", agent, meter, nonce])
    #[account(
        init,
        payer = payer,
        space = Authorization::LEN,
        seeds = [
            b"auth",
            agent.key().as_ref(),
            meter.key().as_ref(),
            &nonce.to_le_bytes()
        ],
        bump
    )]
    pub authorization: Account<'info, Authorization>,
    
    /// Account paying for the transaction
    #[account(mut)]
    pub payer: Signer<'info>,
    
    pub system_program: Program<'info, System>,
}

/// Context for record_meter_payment instruction.
#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct RecordPayment<'info> {
    /// The agent making the payment
    pub agent: Signer<'info>,
    
    /// The meter being paid
    pub meter: Account<'info, Meter>,
    
    /// The authorization to consume
    #[account(
        mut,
        seeds = [
            b"auth",
            agent.key().as_ref(),
            meter.key().as_ref(),
            &nonce.to_le_bytes()
        ],
        bump = authorization.bump,
        constraint = authorization.agent == agent.key(),
        constraint = authorization.meter == meter.key(),
    )]
    pub authorization: Account<'info, Authorization>,
}

// =============================================================================
// EVENTS
// =============================================================================

/// Emitted when a meter payment is recorded.
/// 
/// Off-chain services (specifically the Circle integration service)
/// listen for this event to trigger USDC transfers from the agent's
/// Circle wallet to the merchant's Circle wallet.
#[event]
pub struct MeterPaid {
    /// The agent who made the payment
    pub agent: Pubkey,
    
    /// The meter that was paid
    pub meter: Pubkey,
    
    /// Amount paid (USDC smallest units)
    pub amount: u64,
    
    /// Category of the payment
    pub category: u8,
    
    /// Unique nonce for this payment
    pub nonce: u64,
    
    /// Slot when payment was recorded
    pub slot: u64,
}

// =============================================================================
// ERRORS
// =============================================================================

/// Custom errors for AgentBlinkPay program.
#[error_code]
pub enum AgentBlinkPayError {
    /// Agent's policy is frozen - no payments allowed
    #[msg("Agent policy is frozen")]
    PolicyFrozen,
    
    /// Payment amount exceeds the policy's max_per_tx limit
    #[msg("Amount exceeds maximum allowed per transaction")]
    AmountExceedsMax,
    
    /// Authorization has already been used (replay attempt)
    #[msg("Authorization has already been used")]
    AuthorizationUsed,
    
    /// Authorization has expired (current_slot > expires_at_slot)
    #[msg("Authorization has expired")]
    AuthorizationExpired,
    
    /// Payment category doesn't match meter category
    #[msg("Category mismatch between payment and meter")]
    CategoryMismatch,
    
    /// ZK proof verification failed
    #[msg("Invalid ZK proof")]
    InvalidProof,
    
    /// Merchant wallet ID is too long (max 64 bytes)
    #[msg("Merchant wallet ID too long (max 64 bytes)")]
    MerchantWalletIdTooLong,
}

// =============================================================================
// CATEGORY CONSTANTS (for reference)
// =============================================================================

/// Category constants for spending classification.
/// These are stored as u8 in accounts for space efficiency.
pub mod categories {
    /// AI/ML inference APIs (e.g., OpenAI, Anthropic)
    pub const AI_API: u8 = 1;
    
    /// Data feeds and market data
    pub const DATA_FEED: u8 = 2;
    
    /// General tools and utilities
    pub const TOOL: u8 = 3;
    
    /// Game actions (e.g., Catan demo)
    pub const CATAN_ACTION: u8 = 4;
}
