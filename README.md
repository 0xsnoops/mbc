# AgentBlinkPay

A Solana-based spending brain for AI agents that uses Circle wallets and ZK-enforced policies to control how agents pay USDC for APIs and services via x402, with human oversight via Blinks.

## Project Structure

```
mbc/
├── onchain/              # Anchor Solana program
│   ├── programs/agent_blink_pay/src/lib.rs
│   └── Anchor.toml
├── zk/                   # Noir ZK circuit + Sunspot integration
│   ├── payment_policy/src/main.nr
│   └── README.md
├── backend/              # Node.js/TypeScript backend
│   ├── src/
│   │   ├── index.ts              # Express server
│   │   ├── db/schema.sql         # Database schema
│   │   ├── services/circle.ts    # Circle API (stubbed)
│   │   ├── services/solanaListener.ts
│   │   └── routes/               # x402, agents, providers, actions
│   └── package.json
├── sdk/                  # TypeScript Agent SDK
│   └── src/index.ts
├── frontend/             # Next.js dashboard
│   └── app/
│       ├── page.tsx              # Home
│       ├── agents/page.tsx       # Agents table
│       └── providers/page.tsx    # Register API form
└── examples/
    └── catan-demo.ts     # Catan game integration example
```

## How to Run Locally

### Prerequisites

- Node.js 18+
- Rust + Anchor CLI (for on-chain program)
- Solana CLI (optional, for local validator)

### 1. On-Chain Program (Anchor)

```bash
cd onchain

# Install Anchor dependencies
anchor build

# Run tests (requires Solana localnet)
anchor test

# Deploy to localnet
solana-test-validator &  # Start local validator
anchor deploy
```

### 2. Backend

```bash
cd backend

# Install dependencies
npm install

# Create .env file
cat > .env << EOF
PORT=3000
HOST=localhost
SOLANA_RPC_URL=http://localhost:8899
SOLANA_WS_URL=ws://localhost:8900
PROGRAM_ID=Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS
DATABASE_PATH=./data/agentblinkpay.db
CIRCLE_API_KEY=your_circle_api_key_here
GATEWAY_BASE_URL=http://localhost:3000
EOF

# Start development server
npm run dev
```

The backend will start at `http://localhost:3000` with endpoints:

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Health check |
| `POST /agents` | Create agent |
| `GET /agents/:id` | Get agent status |
| `POST /agents/:id/pay` | Trigger payment |
| `POST /providers/meters` | Register API |
| `ALL /m/:meterId/*` | x402 Gateway |
| `GET /api/actions/agent` | Solana Actions |

### 3. Agent SDK

```bash
cd sdk

# Install dependencies
npm install

# Build
npm run build
```

### 4. Frontend

```bash
cd frontend

# Install dependencies
npm install

# Start development server
npm run dev
```

The dashboard will start at `http://localhost:3001`.

### 5. ZK Circuit (Noir)

```bash
cd zk/payment_policy

# Install Noir (if not already)
curl -L https://raw.githubusercontent.com/noir-lang/noirup/main/install | bash
noirup

# Compile circuit
nargo compile

# Run tests
nargo test
```

## Environment Variables

### Backend (.env)

```env
PORT=3000
HOST=localhost
SOLANA_RPC_URL=http://localhost:8899
SOLANA_WS_URL=ws://localhost:8900
PROGRAM_ID=Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS
DATABASE_PATH=./data/agentblinkpay.db

# Circle API (stubbed for development)
CIRCLE_API_KEY=your_api_key
CIRCLE_API_URL=https://api.circle.com/v1
CIRCLE_ENTITY_SECRET=your_entity_secret

# Gateway
GATEWAY_BASE_URL=http://localhost:3000
SOLANA_NETWORK=devnet

# Solana Actions
ACTIONS_ICON_URL=https://your-domain.com/icon.png
```

### Frontend (.env.local)

```env
NEXT_PUBLIC_API_URL=http://localhost:3000
```

## Quick Start Demo

### 1. Create an Agent

```bash
curl -X POST http://localhost:3000/agents \
  -H "Content-Type: application/json" \
  -d '{"name": "My AI Agent", "allowedCategory": 1, "maxPerTx": 1000000}'
```

### 2. Register an API

```bash
curl -X POST http://localhost:3000/providers/meters \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My API",
    "upstreamUrl": "https://api.example.com/v1",
    "pricePerCall": 50000,
    "category": 1
  }'
```

### 3. Use the SDK

```typescript
import { AgentClient } from '@agentblinkpay/sdk';

const agent = new AgentClient({
  agentId: 'YOUR_AGENT_ID',
  apiKey: 'YOUR_API_KEY',
  gatewayBaseUrl: 'http://localhost:3000',
  backendBaseUrl: 'http://localhost:3000',
});

// Call a paywalled API - automatic 402 handling + payment
const response = await agent.callPaywalledApi(
  'METER_ID',
  '/v1/endpoint',
  { method: 'POST', body: JSON.stringify({ data: 'here' }) }
);
```

### 4. Use Blinks to Control Agents

Share a Blink URL on social media:

```
https://dial.to/action?action=solana-action:http://localhost:3000/api/actions/agent?agentId=YOUR_AGENT_ID&action=freeze
```

## Architecture Overview

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   AI Agent      │────▶│  x402 Gateway    │────▶│  Upstream API   │
│   (with SDK)    │◀────│  (402/Proxy)     │◀────│                 │
└─────────────────┘     └──────────────────┘     └─────────────────┘
        │                        │
        │ Pay                    │ Credit check
        ▼                        ▼
┌─────────────────┐     ┌──────────────────┐
│  Solana Program │────▶│  Event Listener  │
│  (ZK Verify)    │     │  (Circle USDC)   │
└─────────────────┘     └──────────────────┘
        ▲                        │
        │ Freeze/TopUp           │
┌─────────────────┐              │
│  Human (Blink)  │              │
└─────────────────┘     ┌────────▼─────────┐
                        │  Circle Wallets  │
                        │  (Agent ──▶ Merchant)
                        └──────────────────┘
```

## Mapping Model (Circle ↔ Solana)

AgentBlinkPay bridges On-Chain Solana identity with Off-Chain Circle Programmable Wallets.

**Why are mappings needed?**
- **Agent Identity**: On-Chain, an agent is identified by a `Pubkey` (AgentPolicy PDA). Off-Chain, the agent holds funds in a Circle Wallet (`wallet_id`).
- **Merchant Identity**: Meters are on-chain accounts, but settlements occur to a Merchant's Circle Wallet (`merchant_wallet_id`).

**Data Flow**:
1.  **Agent Creation**: We create a Circle Wallet and store the `circle_wallet_id` in the `agents` table, linked to the `agent_pubkey`.
2.  **Top-Up**: When a user tops up an agent (via Blink), they send USDC on-chain to the Agent's Circle Wallet Address. Circle detects this incoming transfer and credits the wallet balance.
3.  **Payment**: When a `MeterPaid` event occurs on-chain, the backend looks up the `circle_wallet_id` for the agent and the `merchant_wallet_id` for the meter, then executes a Circle Transfer.

**Reconciliation**:
- **Source of Truth**: Circle is the source of truth for balances. Solana is the source of truth for payment authorization and policy enforcement.
- **Top-Up**: We use "Option A" - Direct on-chain transfer to the Agent's Circle Wallet Address. This simplifies the flow as Circle automatically indexes the balance.

## Failure Handling & Retries

To ensure robust settlements, we implement a multi-layered safety strategy:

1.  **Finality Buffer**: We wait for **32 slots** (approx 12s) after a `MeterPaid` event before initiating a transfer. This prevents acting on forked/dropped blocks.
2.  **Idempotency**: Every payment event is hashed (`hash(agent_pubkey + meter_pubkey + nonce)`) to generate a unique `event_id`. This ID is used as the Circle Transfer idempotency key, ensuring that even if we process the same event twice, only one USDC transfer occurs.
3.  **At-Least-Once Processing**: The listener runs a background job to catch any "pending" or "stuck" payments (e.g., if the server restarts mid-process).
4.  **Recovery**: On startup, the system scans for `pending_finality` and `processing` records to resume their settlement flow.


## ZK Verification Design

We use a **CPI-based Verification Architecture** to keep the main program lightweight and modular.

-   **Verifier Placement**: The ZK verifier is deployed as a separate, Sunspot-generated Solana program.
-   **Integration**: `AgentBlinkPay` makes a Cross-Program Invocation (CPI) to the verifier, passing the proof and public inputs (`amount`, `category`, `policy_hash`).
-   **Compute Budget**: ZK verification allows roughly ~200k CU. By keeping public inputs minimal (hash commitments), we stay well within the standard transaction limits.

> ⚠️ **Hackathon Note**: ZK proof verification is **stubbed for latency**. The Noir circuits exist in `zk/payment_policy/`, but on-chain verification is not cryptographically validated. Instead, we:
> 1. Require proof bytes be at least 32 bytes (preventing empty proofs)
> 2. Enforce policy constraints (`amount <= max_per_tx`, `category == allowed_category`) directly on-chain
> 
> This provides the **security guarantees** without the **privacy benefits** of full ZK. In production, deploy the Sunspot-generated verifier program and enable CPI calls.

-   **Zero-Knowledge Architecture**: AgentBlinkPay uses a **Hybrid Policy Engine**. The Noir circuits (`zk/`) define the privacy constraints. For the Hackathon MVP, we enforce these constraints (`max_per_tx`) using native Anchor program logic to ensure maximum speed and stability during live demos, while maintaining the ZK-ready data structures (Policy Hashes) on-chain.

## Key Features

- **ZK-Enforced Policies**: Agents prove payment compliance without revealing full policy details
- **Circle USDC**: Programmable wallets with gasless transactions
- **x402 Gateway**: Turn any HTTP API into a pay-per-call endpoint
- **Blinks Control**: Freeze/unfreeze/top-up agents from social media
- **Event-Driven Payments**: Solana events trigger Circle USDC transfers


## Token Units & Decimals

AgentBlinkPay strictly uses **USDC (6 decimals)** for all pricing and settlements.

-   **Base Units**: All on-chain values (`price_per_call`, `max_per_tx`) are stored in base units (integer).
    -   Example: `$0.05` is stored as `50000`.
-   **SDK Helpers**: The SDK provides `UsdcUnits.toBaseUnits(amount)` and `.fromBaseUnits(amount)` to avoid precision errors.
-   **API Inputs**: The `POST /providers/meters` endpoint expects `pricePerCall` in **base units**.


## Replay Protection

AgentBlinkPay prevents replay attacks (re-submitting a used payment authorization) via a 3-pronged approach:

1.  **Unique Nonces**: Every payment authorization includes a 64-bit cryptographically secure random nonce.
2.  **On-Chain State**: The `Authorization` account PDA `["auth", agent, meter, nonce]` is marked as `used=true` upon consumption. The program logic `require!(!auth.used)` prevents reuse.
3.  **Expiry (TTL)**: Authorizations include an `expires_at_slot` (default 150 slots / ~60s). The program rejects checks if `current_slot > expires_at_slot`.


## Agent Authentication Model

To prevent unauthorized wallet usage, the backend enforces strict API Key authentication:

1.  **Creation**: When an agent is created (`POST /agents`), an `api_key` (`ak_...`) is returned. This key effectively controls the agent's wallet.
2.  **Storage**: The SDK stores this key and sends it in the `x-agent-api-key` header for all requests.
3.  **Enforcement**: The `/agents/:id/pay` endpoint validates that the provided header matches the stored key for the requested agent ID. Mismatches result in `401 Unauthorized`.


## Gas Sponsorship

We use **Circle Gas Station** to provide a seamless, gasless experience for AI Agents.

-   **Scope**: Transaction fees are sponsored for key protocol instructions (`authorize_payment`, `record_payment`).
-   **Policy**:
    -   **Rate Limits**: Capped at 100 transactions per agent/hour to prevent drain.
    -   **Global Cap**: Hard cap of 10 SOL/day for the entire platform.
-   **Implementation**: Agents build transactions with `feePayer = ServiceRelayer`, ensuring they never need to hold SOL, only USDC.

## License

MIT
