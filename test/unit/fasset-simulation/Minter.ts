import { CollateralReserved } from "../../../typechain-truffle/AssetManager";
import { EventArgs, requiredEventArgs } from "../../utils/events";
import { IChainWallet } from "../../utils/fasset/ChainInterfaces";
import { MockChain, MockChainWallet } from "../../utils/fasset/MockChain";
import { AssetContext, AssetContextClient } from "./AssetContext";

export class Minter extends AssetContextClient {
    constructor(
        context: AssetContext,
        public address: string,
        public underlyingAddress: string,
        public wallet: IChainWallet,
    ) {
        super(context);
    }
    
    static async createTest(ctx: AssetContext, address: string, underlyingAddress: string, underlyingBalance: BN) {
        if (!(ctx.chain instanceof MockChain)) assert.fail("only for mock chains");
        ctx.chain.mint(underlyingAddress, underlyingBalance);
        const wallet = new MockChainWallet(ctx.chain);
        return Minter.create(ctx, address, underlyingAddress, wallet);
    }
    
    static async create(ctx: AssetContext, address: string, underlyingAddress: string, wallet: IChainWallet) {
        return new Minter(ctx, address, underlyingAddress, wallet);
    }
    
    async reserveCollateral(agent: string, lots: number) {
        const agentInfo = await this.assetManager.getAgentInfo(agent);
        const crFee = await this.assetManager.collateralReservationFee(lots);
        const res = await this.assetManager.reserveCollateral(agent, lots, agentInfo.feeBIPS, { from: this.address, value: crFee });
        return requiredEventArgs(res, 'CollateralReserved');
    }
    
    async performMintingPayment(crt: EventArgs<CollateralReserved>) {
        const paymentAmount = crt.valueUBA.add(crt.feeUBA);
        return this.wallet.addTransaction(this.underlyingAddress, crt.paymentAddress, paymentAmount, crt.paymentReference);
    }
    
    async executeMinting(crt: EventArgs<CollateralReserved>, transactionHash: string) {
        const proof = await this.attestationProvider.provePayment(transactionHash, this.underlyingAddress, crt.paymentAddress);
        const res = await this.assetManager.executeMinting(proof, crt.collateralReservationId, { from: this.address });
        return requiredEventArgs(res, 'MintingExecuted');
    }
}
