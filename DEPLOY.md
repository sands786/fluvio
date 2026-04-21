# Fluvio — Deployment Guide

## Prerequisites

```bash
# Install Initia CLI
curl -sSL https://get.initia.xyz | bash

# Install Move compiler
initiad move compile --help  # verify installed

# Node.js 18+ for frontend
node --version
```

---

## Step 1: Deploy the Appchain

```bash
# Initialize your appchain
initiad init fluvio-1 \
  --chain-id fluvio-1 \
  --moniker "fluvio-node"

# Configure for Initia testnet
# Edit ~/.initia/config/config.toml:
# persistent_peers = "<initia-testnet-peers>"

# Start the node
initiad start
```

---

## Step 2: Create deployer wallet

```bash
# Create wallet
initiad keys add deployer

# Get testnet INIT from faucet
# https://faucet.testnet.initia.xyz

# Verify balance
initiad query bank balance $(initiad keys show deployer -a) uinit
```

---

## Step 3: Deploy Move contracts

```bash
cd contracts

# Compile first
initiad move compile

# Deploy all three contracts
initiad tx move publish . \
  --from deployer \
  --chain-id fluvio-1 \
  --gas auto \
  --gas-adjustment 1.5 \
  --fees 100000uinit \
  -y

# Save the deployed address — update in Move.toml and frontend
```

---

## Step 4: Initialize contracts

```bash
# Initialize stream registry
initiad tx move run \
  --module-address <YOUR_ADDRESS> \
  --module-name stream_registry \
  --function-name init_module \
  --from deployer \
  --chain-id fluvio-1 \
  -y
```

---

## Step 5: Frontend deployment

```bash
cd frontend

# Install dependencies
npm install

# Set environment variables
cat > .env.local << EOF
REACT_APP_CONTRACT_ADDRESS=<YOUR_DEPLOYED_ADDRESS>
REACT_APP_CHAIN_ID=fluvio-1
REACT_APP_RPC_URL=https://rpc.testnet.initia.xyz
EOF

# Test locally
npm start

# Build for production
npm run build

# Deploy to Vercel
npx vercel --prod
```

---

## Step 6: Verify deployment

```bash
# Check contract is live
initiad query move module \
  --address <YOUR_ADDRESS> \
  --module-name stream_core

# Create a test stream
initiad tx move run \
  --module-address <YOUR_ADDRESS> \
  --module-name stream_core \
  --function-name create_stream \
  --args "address:<RECIPIENT>" "u64:1000000" "u64:3600000" "u8:0" "string:Test" "string:deployer.init" "string:alice.init" \
  --from deployer \
  --chain-id fluvio-1 \
  -y

# Verify claimable amount (wait 60 seconds then check)
initiad query move view \
  --address <YOUR_ADDRESS> \
  --module-name stream_core \
  --function-name get_claimable \
  --args "u64:1"
```

---

## Step 7: Update submission.json

```bash
# After deployment, update these fields:
# - chain_id: your actual chain ID
# - contract_address: deployed address
# - frontend_url: your Vercel URL
# - demo_video: YouTube link after recording
```

---

## Common Issues

**Move compile error: module not found**
→ Check Move.toml dependencies point to correct initia_stdlib version

**Transaction gas error**
→ Increase --gas-adjustment to 2.0

**Frontend can't connect to chain**
→ Check CORS settings on your node RPC

**InterwovenKit not loading**
→ Ensure `@initia/interwovenkit-react` is installed and wrap app in `<InterwovenKitProvider>`

---

## Demo Checklist

Before recording demo video:
- [ ] Chain is live and producing blocks
- [ ] Contracts deployed and verified
- [ ] Frontend live on Vercel
- [ ] At least 2 test streams active
- [ ] Live counter updating visibly in UI
- [ ] Session key flow working (sign once → stream auto-runs)
- [ ] .init username resolving correctly
- [ ] submission.json has all correct fields
- [ ] README is complete

**Record:** 90 seconds. Show the counter ticking. That's your winning moment.
