// ============================================================================
// AgentBlinkPay - Payment Policy Circuit (Noir)
// ============================================================================
// 
// This circuit enforces spending policy compliance for agent payments.
// It proves that a payment request satisfies the agent's policy constraints
// without revealing the full policy details.
//
// Public inputs:
//   - amount: The payment amount being authorized
//   - category: The payment category (e.g., AI_API = 1, CATAN_ACTION = 4)
//   - policy_hash: Hash commitment to the agent's full policy
//
// Private inputs:
//   - max_per_tx: Maximum allowed per transaction (hidden)
//   - allowed_category: Allowed spending category (hidden)
//   - policy_salt: Salt used in policy hash computation
//
// Constraints verified:
//   1. amount <= max_per_tx
//   2. category == allowed_category
//   3. policy_hash == hash(max_per_tx, allowed_category, policy_salt)
//
// Usage:
//   1. Agent/backend knows the full policy
//   2. Constructs witness with private inputs
//   3. Generates proof using Noir prover
//   4. Submits proof to Solana program for on-chain verification
// ============================================================================

// Import standard library
use dep::std;

// ============================================================================
// MAIN CIRCUIT
// ============================================================================

fn main(
    // Public inputs (visible on-chain)
    amount: pub Field,
    category: pub Field,
    policy_hash: pub [u8; 32],
    
    // Private inputs (hidden, only known to prover)
    max_per_tx: Field,
    allowed_category: Field,
    policy_salt: [u8; 32]
) {
    // ========================================================================
    // Constraint 1: Amount must not exceed maximum per transaction
    // ========================================================================
    // 
    // This ensures the agent cannot authorize payments larger than their
    // configured spending limit. The max_per_tx value is kept private.
    //
    // We use field comparison - in practice you'd want range proofs
    // for proper u64 comparison, but this demonstrates the concept.
    assert(amount as u64 <= max_per_tx as u64);
    
    // ========================================================================
    // Constraint 2: Category must match allowed category
    // ========================================================================
    //
    // This ensures the agent can only spend on approved categories.
    // For example, an agent with allowed_category = AI_API (1) cannot
    // pay for CATAN_ACTION (4) endpoints.
    assert(category == allowed_category);
    
    // ========================================================================
    // Constraint 3: Policy hash commitment verification
    // ========================================================================
    //
    // This binds the private policy values to the public policy_hash
    // stored on-chain. Without this, a malicious prover could use
    // arbitrary private values.
    //
    // We compute: expected_hash = poseidon(max_per_tx, allowed_category, salt)
    // And verify: expected_hash == policy_hash
    //
    // Note: Using pedersen hash for simplicity. In production, consider
    // poseidon for better circuit efficiency.
    let computed_hash = compute_policy_hash(max_per_tx, allowed_category, policy_salt);
    assert(computed_hash == policy_hash);
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/// Computes the policy hash commitment.
/// 
/// The hash binds the private policy values to a public commitment
/// that is stored on-chain in the AgentPolicy account.
///
/// # Arguments
/// * `max_per_tx` - Maximum allowed per transaction
/// * `allowed_category` - Allowed spending category
/// * `salt` - Random salt for hiding policy details
///
/// # Returns
/// * 32-byte hash of the policy
fn compute_policy_hash(
    max_per_tx: Field,
    allowed_category: Field,
    salt: [u8; 32]
) -> [u8; 32] {
    // Serialize inputs for hashing
    // In practice, use a proper serialization scheme
    let mut preimage: [u8; 40] = [0; 40];
    
    // First 8 bytes: max_per_tx (as little-endian u64)
    let max_bytes = (max_per_tx as u64).to_le_bytes();
    for i in 0..8 {
        preimage[i] = max_bytes[i];
    }
    
    // Byte 8: allowed_category
    preimage[8] = allowed_category as u8;
    
    // Bytes 9-40: salt (use first 31 bytes)
    for i in 0..31 {
        preimage[9 + i] = salt[i];
    }
    
    // Compute hash using std library
    // Note: Using sha256 for compatibility. Poseidon would be more efficient.
    std::hash::sha256(preimage)
}

// ============================================================================
// TEST MODULE
// ============================================================================

#[test]
fn test_valid_payment() {
    // Arrange: Agent with max 1 USDC, category AI_API
    let max_per_tx: Field = 1000000; // 1 USDC in smallest units
    let allowed_category: Field = 1; // AI_API
    let salt: [u8; 32] = [1; 32]; // Dummy salt
    
    let policy_hash = compute_policy_hash(max_per_tx, allowed_category, salt);
    
    // Act: Payment of 0.5 USDC for AI_API
    let amount: Field = 500000; // 0.5 USDC
    let category: Field = 1; // AI_API
    
    // Assert: Should pass all constraints
    main(amount, category, policy_hash, max_per_tx, allowed_category, salt);
}

#[test(should_fail)]
fn test_amount_exceeds_max() {
    // Arrange
    let max_per_tx: Field = 500000; // 0.5 USDC
    let allowed_category: Field = 1;
    let salt: [u8; 32] = [1; 32];
    let policy_hash = compute_policy_hash(max_per_tx, allowed_category, salt);
    
    // Act: Payment of 1 USDC (exceeds max)
    let amount: Field = 1000000;
    
    // Assert: Should fail
    main(amount, 1, policy_hash, max_per_tx, allowed_category, salt);
}

#[test(should_fail)]
fn test_category_mismatch() {
    // Arrange
    let max_per_tx: Field = 1000000;
    let allowed_category: Field = 1; // AI_API
    let salt: [u8; 32] = [1; 32];
    let policy_hash = compute_policy_hash(max_per_tx, allowed_category, salt);
    
    // Act: Payment for CATAN_ACTION (category 4)
    let category: Field = 4;
    
    // Assert: Should fail
    main(500000, category, policy_hash, max_per_tx, allowed_category, salt);
}
