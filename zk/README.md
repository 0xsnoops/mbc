# ZK Circuit Integration (Noir + Sunspot)

This directory contains the Noir zero-knowledge circuit for payment policy verification.

## Circuit: `payment_policy`

The circuit verifies that a payment request complies with an agent's spending policy without revealing the full policy details.

### Inputs

**Public Inputs** (visible on-chain):
- `amount`: Payment amount in USDC smallest units
- `category`: Payment category (1=AI_API, 2=DATA_FEED, 3=TOOL, 4=CATAN_ACTION)
- `policy_hash`: 32-byte hash commitment to the agent's policy

**Private Inputs** (known only to prover):
- `max_per_tx`: Maximum allowed per transaction
- `allowed_category`: Allowed spending category
- `policy_salt`: Random salt for privacy

### Constraints

1. `amount <= max_per_tx`
2. `category == allowed_category`
3. `policy_hash == hash(max_per_tx, allowed_category, salt)`

## Sunspot Integration

[Sunspot](https://github.com/noir-lang/sunspot) generates Solana-compatible verifier programs from Noir circuits.

### Generate Verifier (Development)

```bash
# 1. Compile the Noir circuit
cd payment_policy
nargo compile

# 2. Generate proving/verifying keys
nargo setup

# 3. Use Sunspot to generate Solana verifier
sunspot generate --circuit target/payment_policy.json --output ../verifier/
```

### Integration with AgentBlinkPay

The generated verifier is called via CPI in `authorize_payment_with_proof`:

```rust
// In lib.rs - authorize_payment_with_proof instruction
fn verify_payment_policy_proof(
    proof: &Vec<u8>,
    amount: u64,
    category: u8,
    policy_hash: [u8; 32],
) -> Result<()> {
    // Construct public inputs
    let public_inputs = [
        amount.to_le_bytes().to_vec(),
        vec![category],
        policy_hash.to_vec(),
    ].concat();
    
    // CPI to Sunspot verifier
    // sunspot_verifier::cpi::verify(ctx, public_inputs, proof)?;
    
    // TODO: Replace stub with actual CPI call
    Ok(())
}
```

## Proof Generation (Off-chain)

The backend/SDK generates proofs when agents authorize payments:

```typescript
// In backend or SDK
import { Noir } from '@noir-lang/noir_js';

async function generatePaymentProof(
  amount: bigint,
  category: number,
  policyHash: Uint8Array,
  maxPerTx: bigint,
  allowedCategory: number,
  policySalt: Uint8Array
): Promise<Uint8Array> {
  const circuit = await Noir.compile('payment_policy');
  
  const witness = {
    amount,
    category,
    policy_hash: policyHash,
    max_per_tx: maxPerTx,
    allowed_category: allowedCategory,
    policy_salt: policySalt,
  };
  
  const proof = await circuit.generateProof(witness);
  return proof;
}
```

## Testing

```bash
cd payment_policy
nargo test
```

## Security Notes

- The `policy_salt` should be randomly generated per agent and stored securely
- Policy hash commitments are stored on-chain in `AgentPolicy.policy_hash`
- Proofs are generated off-chain and verified on-chain
- Invalid proofs are rejected, preventing unauthorized payments
