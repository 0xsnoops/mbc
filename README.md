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

## Key Features

- **ZK-Enforced Policies**: Agents prove payment compliance without revealing full policy details
- **Circle USDC**: Programmable wallets with gasless transactions
- **x402 Gateway**: Turn any HTTP API into a pay-per-call endpoint
- **Blinks Control**: Freeze/unfreeze/top-up agents from social media
- **Event-Driven Payments**: Solana events trigger Circle USDC transfers

## License

MIT
