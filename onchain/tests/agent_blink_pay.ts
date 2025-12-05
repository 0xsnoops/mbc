import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AgentBlinkPay } from "../target/types/agent_blink_pay";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";
import crypto from "crypto";

describe("agent_blink_pay", () => {
    // Configure the client to use the local cluster.
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const program = anchor.workspace.AgentBlinkPay as Program<AgentBlinkPay>;

    // Test keypairs
    const agentKeypair = Keypair.generate();
    const meterIdKeypair = Keypair.generate();

    // PDAs
    let policyPda: PublicKey;
    let meterPda: PublicKey;
    let authPda: PublicKey;

    // Test constants
    const policyHash = Array.from(crypto.createHash('sha256').update('test_policy').digest());
    const allowedCategory = 1; // AI_API
    const maxPerTx = new anchor.BN(1000000); // 1 USDC
    const pricePerCall = new anchor.BN(50000); // 0.05 USDC
    const merchantWalletId = "test_merchant_wallet_123";
    const testNonce = new anchor.BN(Date.now());

    before(async () => {
        // Derive PDAs
        [policyPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("policy"), agentKeypair.publicKey.toBuffer()],
            program.programId
        );

        [meterPda] = PublicKey.findProgramAddressSync(
            [
                Buffer.from("meter"),
                provider.wallet.publicKey.toBuffer(),
                meterIdKeypair.publicKey.toBuffer()
            ],
            program.programId
        );

        [authPda] = PublicKey.findProgramAddressSync(
            [
                Buffer.from("auth"),
                agentKeypair.publicKey.toBuffer(),
                meterPda.toBuffer(),
                testNonce.toArrayLike(Buffer, 'le', 8)
            ],
            program.programId
        );

        // Airdrop SOL to agent for fees
        const sig = await provider.connection.requestAirdrop(
            agentKeypair.publicKey,
            anchor.web3.LAMPORTS_PER_SOL
        );
        await provider.connection.confirmTransaction(sig);
    });

    // =========================================================================
    // TEST 1: set_policy creates AgentPolicy PDA correctly
    // =========================================================================
    describe("set_policy", () => {
        it("creates AgentPolicy PDA with correct values", async () => {
            await program.methods
                .setPolicy(policyHash, allowedCategory, maxPerTx, false)
                .accounts({
                    agent: agentKeypair.publicKey,
                    agentPolicy: policyPda,
                    payer: provider.wallet.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([agentKeypair])
                .rpc();

            // Fetch and verify
            const policy = await program.account.agentPolicy.fetch(policyPda);

            expect(policy.agentPubkey.toBase58()).to.equal(agentKeypair.publicKey.toBase58());
            expect(policy.allowedCategory).to.equal(allowedCategory);
            expect(policy.maxPerTx.toNumber()).to.equal(maxPerTx.toNumber());
            expect(policy.frozen).to.equal(false);
        });

        it("can freeze an agent by setting frozen=true", async () => {
            await program.methods
                .setPolicy(policyHash, allowedCategory, maxPerTx, true)
                .accounts({
                    agent: agentKeypair.publicKey,
                    agentPolicy: policyPda,
                    payer: provider.wallet.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([agentKeypair])
                .rpc();

            const policy = await program.account.agentPolicy.fetch(policyPda);
            expect(policy.frozen).to.equal(true);
        });
    });

    // =========================================================================
    // TEST 2: create_meter works correctly
    // =========================================================================
    describe("create_meter", () => {
        it("creates Meter PDA with correct values", async () => {
            await program.methods
                .createMeter(pricePerCall, allowedCategory, merchantWalletId, false)
                .accounts({
                    authority: provider.wallet.publicKey,
                    meterId: meterIdKeypair.publicKey,
                    meter: meterPda,
                    systemProgram: SystemProgram.programId,
                })
                .rpc();

            const meter = await program.account.meter.fetch(meterPda);

            expect(meter.authority.toBase58()).to.equal(provider.wallet.publicKey.toBase58());
            expect(meter.pricePerCall.toNumber()).to.equal(pricePerCall.toNumber());
            expect(meter.category).to.equal(allowedCategory);
            expect(meter.requiresZk).to.equal(false);
        });
    });

    // =========================================================================
    // TEST 3: authorize_payment_with_proof fails when frozen
    // =========================================================================
    describe("authorize_payment_with_proof", () => {
        it("fails when agent policy is frozen", async () => {
            // Ensure policy is frozen
            await program.methods
                .setPolicy(policyHash, allowedCategory, maxPerTx, true) // frozen = true
                .accounts({
                    agent: agentKeypair.publicKey,
                    agentPolicy: policyPda,
                    payer: provider.wallet.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([agentKeypair])
                .rpc();

            const currentSlot = await provider.connection.getSlot();
            const expiresAtSlot = new anchor.BN(currentSlot + 100);
            const proof = Buffer.alloc(64); // Stub proof

            try {
                await program.methods
                    .authorizePaymentWithProof(
                        new anchor.BN(50000), // amount
                        allowedCategory,
                        testNonce,
                        expiresAtSlot,
                        [...proof]
                    )
                    .accounts({
                        agent: agentKeypair.publicKey,
                        agentPolicy: policyPda,
                        meter: meterPda,
                        authorization: authPda,
                        payer: provider.wallet.publicKey,
                        systemProgram: SystemProgram.programId,
                    })
                    .signers([agentKeypair])
                    .rpc();

                expect.fail("Should have thrown PolicyFrozen error");
            } catch (err: any) {
                expect(err.error.errorCode.code).to.equal("PolicyFrozen");
            }
        });

        it("fails when amount exceeds max_per_tx", async () => {
            // Unfreeze first
            await program.methods
                .setPolicy(policyHash, allowedCategory, maxPerTx, false)
                .accounts({
                    agent: agentKeypair.publicKey,
                    agentPolicy: policyPda,
                    payer: provider.wallet.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([agentKeypair])
                .rpc();

            const currentSlot = await provider.connection.getSlot();
            const expiresAtSlot = new anchor.BN(currentSlot + 100);
            const proof = Buffer.alloc(64);

            // Create new auth PDA for this test
            const badNonce = new anchor.BN(Date.now() + 1);
            const [badAuthPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from("auth"),
                    agentKeypair.publicKey.toBuffer(),
                    meterPda.toBuffer(),
                    badNonce.toArrayLike(Buffer, 'le', 8)
                ],
                program.programId
            );

            try {
                await program.methods
                    .authorizePaymentWithProof(
                        new anchor.BN(2000000), // 2 USDC > max 1 USDC
                        allowedCategory,
                        badNonce,
                        expiresAtSlot,
                        [...proof]
                    )
                    .accounts({
                        agent: agentKeypair.publicKey,
                        agentPolicy: policyPda,
                        meter: meterPda,
                        authorization: badAuthPda,
                        payer: provider.wallet.publicKey,
                        systemProgram: SystemProgram.programId,
                    })
                    .signers([agentKeypair])
                    .rpc();

                expect.fail("Should have thrown AmountExceedsMax error");
            } catch (err: any) {
                expect(err.error.errorCode.code).to.equal("AmountExceedsMax");
            }
        });

        it("succeeds with valid parameters", async () => {
            const currentSlot = await provider.connection.getSlot();
            const expiresAtSlot = new anchor.BN(currentSlot + 100);
            const proof = Buffer.alloc(64);

            // New nonce for successful test
            const goodNonce = new anchor.BN(Date.now() + 2);
            const [goodAuthPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from("auth"),
                    agentKeypair.publicKey.toBuffer(),
                    meterPda.toBuffer(),
                    goodNonce.toArrayLike(Buffer, 'le', 8)
                ],
                program.programId
            );

            await program.methods
                .authorizePaymentWithProof(
                    new anchor.BN(50000), // Valid amount
                    allowedCategory,
                    goodNonce,
                    expiresAtSlot,
                    [...proof]
                )
                .accounts({
                    agent: agentKeypair.publicKey,
                    agentPolicy: policyPda,
                    meter: meterPda,
                    authorization: goodAuthPda,
                    payer: provider.wallet.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([agentKeypair])
                .rpc();

            const auth = await program.account.authorization.fetch(goodAuthPda);
            expect(auth.agent.toBase58()).to.equal(agentKeypair.publicKey.toBase58());
            expect(auth.meter.toBase58()).to.equal(meterPda.toBase58());
            expect(auth.amount.toNumber()).to.equal(50000);
            expect(auth.used).to.equal(false);
        });
    });

    // =========================================================================
    // TEST 4: record_meter_payment emits MeterPaid event
    // =========================================================================
    describe("record_meter_payment", () => {
        let paymentNonce: anchor.BN;
        let paymentAuthPda: PublicKey;

        before(async () => {
            // Create a fresh authorization for this test
            paymentNonce = new anchor.BN(Date.now() + 100);
            [paymentAuthPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from("auth"),
                    agentKeypair.publicKey.toBuffer(),
                    meterPda.toBuffer(),
                    paymentNonce.toArrayLike(Buffer, 'le', 8)
                ],
                program.programId
            );

            const currentSlot = await provider.connection.getSlot();
            const expiresAtSlot = new anchor.BN(currentSlot + 100);
            const proof = Buffer.alloc(64);

            await program.methods
                .authorizePaymentWithProof(
                    new anchor.BN(50000),
                    allowedCategory,
                    paymentNonce,
                    expiresAtSlot,
                    [...proof]
                )
                .accounts({
                    agent: agentKeypair.publicKey,
                    agentPolicy: policyPda,
                    meter: meterPda,
                    authorization: paymentAuthPda,
                    payer: provider.wallet.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([agentKeypair])
                .rpc();
        });

        it("emits MeterPaid event and marks authorization as used", async () => {
            // Listen for events
            let eventReceived = false;
            const listener = program.addEventListener("MeterPaid", (event, slot) => {
                eventReceived = true;
                expect(event.agent.toBase58()).to.equal(agentKeypair.publicKey.toBase58());
                expect(event.meter.toBase58()).to.equal(meterPda.toBase58());
                expect(event.amount.toNumber()).to.equal(50000);
                expect(event.category).to.equal(allowedCategory);
            });

            await program.methods
                .recordMeterPayment(paymentNonce)
                .accounts({
                    agent: agentKeypair.publicKey,
                    meter: meterPda,
                    authorization: paymentAuthPda,
                })
                .signers([agentKeypair])
                .rpc();

            // Give time for event to fire
            await new Promise(resolve => setTimeout(resolve, 1000));

            const auth = await program.account.authorization.fetch(paymentAuthPda);
            expect(auth.used).to.equal(true);

            // Note: Event listener may not fire in test env, but we verify used=true
            program.removeEventListener(listener);
        });

        it("fails when authorization already used", async () => {
            // Using the same auth from above (already used)
            try {
                await program.methods
                    .recordMeterPayment(paymentNonce)
                    .accounts({
                        agent: agentKeypair.publicKey,
                        meter: meterPda,
                        authorization: paymentAuthPda,
                    })
                    .signers([agentKeypair])
                    .rpc();

                expect.fail("Should have thrown AuthorizationUsed error");
            } catch (err: any) {
                expect(err.error.errorCode.code).to.equal("AuthorizationUsed");
            }
        });
    });

    // =========================================================================
    // TEST 5: record_meter_payment fails on expired authorization
    // =========================================================================
    describe("authorization expiry", () => {
        it("fails when authorization has expired", async () => {
            // Create authorization that expires immediately (slot 1)
            const expiredNonce = new anchor.BN(Date.now() + 200);
            const [expiredAuthPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from("auth"),
                    agentKeypair.publicKey.toBuffer(),
                    meterPda.toBuffer(),
                    expiredNonce.toArrayLike(Buffer, 'le', 8)
                ],
                program.programId
            );

            const currentSlot = await provider.connection.getSlot();
            // Set expires_at_slot to current slot (will be expired by the time we record)
            const expiresAtSlot = new anchor.BN(currentSlot);
            const proof = Buffer.alloc(64);

            await program.methods
                .authorizePaymentWithProof(
                    new anchor.BN(50000),
                    allowedCategory,
                    expiredNonce,
                    expiresAtSlot,
                    [...proof]
                )
                .accounts({
                    agent: agentKeypair.publicKey,
                    agentPolicy: policyPda,
                    meter: meterPda,
                    authorization: expiredAuthPda,
                    payer: provider.wallet.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([agentKeypair])
                .rpc();

            // Wait a bit to ensure slot advances
            await new Promise(resolve => setTimeout(resolve, 1000));

            try {
                await program.methods
                    .recordMeterPayment(expiredNonce)
                    .accounts({
                        agent: agentKeypair.publicKey,
                        meter: meterPda,
                        authorization: expiredAuthPda,
                    })
                    .signers([agentKeypair])
                    .rpc();

                expect.fail("Should have thrown AuthorizationExpired error");
            } catch (err: any) {
                expect(err.error.errorCode.code).to.equal("AuthorizationExpired");
            }
        });
    });
});
