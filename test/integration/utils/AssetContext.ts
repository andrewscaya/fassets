import { constants, time } from "@openzeppelin/test-helpers";
import { AddressUpdaterInstance, AssetManagerControllerInstance, AssetManagerInstance, AttestationClientMockInstance, FAssetInstance, FtsoMockInstance, FtsoRegistryMockInstance, WNatInstance } from "../../../typechain-truffle";
import { ContractWithEvents } from "../../utils/events";
import { AssetManagerSettings } from "../../utils/fasset/AssetManagerTypes";
import { AttestationHelper } from "../../utils/fasset/AttestationHelper";
import { IBlockChain, IBlockChainEvents } from "../../utils/fasset/ChainInterfaces";
import { newAssetManager } from "../../utils/fasset/DeployAssetManager";
import { IStateConnectorClient } from "../../utils/fasset/IStateConnectorClient";
import { MockChain } from "../../utils/fasset/MockChain";
import { MockStateConnectorClient } from "../../utils/fasset/MockStateConnectorClient";
import { BNish, DAYS, HOURS, toBN, toBNExp, toNumber, toWei, WEEKS } from "../../utils/helpers";
import { setDefaultVPContract } from "../../utils/token-test-helpers";
import { web3DeepNormalize } from "../../utils/web3assertions";
import { ChainInfo, NatInfo } from "./ChainInfo";

const AttestationClient = artifacts.require('AttestationClientMock');
const AssetManagerController = artifacts.require('AssetManagerController');
const AddressUpdater = artifacts.require('AddressUpdater');
const WNat = artifacts.require('WNat');
const FtsoMock = artifacts.require('FtsoMock');
const FtsoRegistryMock = artifacts.require('FtsoRegistryMock');

const AMG_NATWEI_PRICE_SCALE = toBN(1e9);
const NAT_WEI = toBN(1e18);

export type AddressUpdaterEvents = import('../../../typechain-truffle/AddressUpdater').AllEvents;
export type AssetManagerControllerEvents = import('../../../typechain-truffle/AssetManagerController').AllEvents;
export type WNatEvents = import('../../../typechain-truffle/WNat').AllEvents;
export type AttestationClientMockEvents = import('../../../typechain-truffle/AttestationClientMock').AllEvents;
export type FtsoRegistryMockEvents = import('../../../typechain-truffle/FtsoRegistryMock').AllEvents;
export type FtsoMockEvents = import('../../../typechain-truffle/FtsoMock').AllEvents;
export type AssetManagerEvents = import('../../../typechain-truffle/AssetManager').AllEvents;
export type FAssetEvents = import('../../../typechain-truffle/FAsset').AllEvents;

// common context shared between several asset managers
export class CommonContext {
    constructor(
        public governance: string,
        public addressUpdater: ContractWithEvents<AddressUpdaterInstance, AddressUpdaterEvents>,
        public assetManagerController: ContractWithEvents<AssetManagerControllerInstance, AssetManagerControllerEvents>,
        public attestationClient: ContractWithEvents<AttestationClientMockInstance, AttestationClientMockEvents>,
        public ftsoRegistry: ContractWithEvents<FtsoRegistryMockInstance, FtsoRegistryMockEvents>,
        public wnat: ContractWithEvents<WNatInstance, WNatEvents>,
        public natFtso: ContractWithEvents<FtsoMockInstance, FtsoMockEvents>,
    ) {}

    static async createTest(governance: string, natInfo: NatInfo): Promise<CommonContext> {
        // create attestation client
        const attestationClient = await AttestationClient.new();
        // create asset manager controller
        const addressUpdater = await AddressUpdater.new(governance);
        const assetManagerController = await AssetManagerController.new(governance, addressUpdater.address);
        // create WNat token
        const wnat = await WNat.new(governance, natInfo.name, natInfo.symbol);
        await setDefaultVPContract(wnat, governance);
        // create NAT ftso
        const natFtso = await FtsoMock.new(natInfo.symbol);
        await natFtso.setCurrentPrice(toBNExp(natInfo.startPrice, 5), 0);
        // create ftso registry
        const ftsoRegistry = await FtsoRegistryMock.new();
        await ftsoRegistry.addFtso(natFtso.address);
        return new CommonContext(governance, addressUpdater, assetManagerController, attestationClient, ftsoRegistry, wnat, natFtso);
    }
}

// context, specific for each asset manager (includes common context vars)
export class AssetContext {
    constructor(
        // common context
        public governance: string,
        public addressUpdater: ContractWithEvents<AddressUpdaterInstance, AddressUpdaterEvents>,
        public assetManagerController: ContractWithEvents<AssetManagerControllerInstance, AssetManagerControllerEvents>,
        public attestationClient: ContractWithEvents<AttestationClientMockInstance, AttestationClientMockEvents>,
        public ftsoRegistry: ContractWithEvents<FtsoRegistryMockInstance, FtsoRegistryMockEvents>,
        public wnat: ContractWithEvents<WNatInstance, WNatEvents>,
        public natFtso: ContractWithEvents<FtsoMockInstance, FtsoMockEvents>,
        // asset context
        public chainInfo: ChainInfo,
        public chain: IBlockChain,
        public chainEvents: IBlockChainEvents,
        public stateConnectorClient: IStateConnectorClient,
        public attestationProvider: AttestationHelper,
        public settings: AssetManagerSettings,
        public assetManager: ContractWithEvents<AssetManagerInstance, AssetManagerEvents>,
        public fAsset: ContractWithEvents<FAssetInstance, FAssetEvents>,
        public assetFtso: ContractWithEvents<FtsoMockInstance, FtsoMockEvents>,
    ) {
    }

    get chainId() {
        return this.chainInfo.chainId;
    }
    
    /**
     * Convert underlying amount to base units (e.g. eth to wei)
     */
    underlyingAmount(value: number) {
        return toBNExp(value, this.chainInfo.decimals);
    }
    
    async refreshSettings() {
        this.settings = await this.assetManager.getSettings();
    }
    
    async lotsSize() {
        const settings = await this.assetManager.getSettings();
        return toBN(settings.lotSizeAMG).mul(toBN(settings.assetMintingGranularityUBA));
    }
    
    async updateUnderlyingBlock() {
        const proof = await this.attestationProvider.proveConfirmedBlockHeightExists();
        await this.assetManager.updateCurrentBlock(proof);
        return toNumber(proof.blockNumber) + toNumber(proof.numberOfConfirmations);
    }

    async currentAmgToNATWeiPrice() {
        // Force cast here to circument architecure in original contracts 
        const {0: natPrice, } = await this.natFtso.getCurrentPrice();
        const {0: assetPrice, } = await this.assetFtso.getCurrentPrice();
        return this.amgToNATWeiPrice(natPrice, assetPrice);
    }

    async currentAmgToNATWeiPriceWithTrusted() {
        const {0: natPrice, 1: natTimestamp } = await this.natFtso.getCurrentPrice();
        const {0: assetPrice, 1: assetTimestamp } = await this.assetFtso.getCurrentPrice();
        const {0: natPriceTrusted, 1: natTimestampTrusted } = await this.natFtso.getCurrentPriceFromTrustedProviders();
        const {0: assetPriceTrusted, 1: assetTimestampTrusted } = await this.assetFtso.getCurrentPriceFromTrustedProviders();
        const ftsoPrice = this.amgToNATWeiPrice(natPrice, assetPrice);
        const trustedPrice = natTimestampTrusted.add(toBN(this.settings.maxTrustedPriceAgeSeconds)).gte(natTimestamp) && 
            assetTimestampTrusted.add(toBN(this.settings.maxTrustedPriceAgeSeconds)).gte(assetTimestamp) ?
            this.amgToNATWeiPrice(natPriceTrusted, assetPriceTrusted) : ftsoPrice;
        return [ftsoPrice, trustedPrice];
    }

    amgToNATWeiPrice(natPriceUSDDec5: BNish, assetPriceUSDDec5: BNish) {
        // _natPriceUSDDec5 < 2^128 (in ftso) and assetUnitUBA, are both 64 bit, so there can be no overflow
        return toBN(assetPriceUSDDec5)
            .mul(toBN(this.settings.assetMintingGranularityUBA).mul(NAT_WEI).mul(AMG_NATWEI_PRICE_SCALE))
            .div(toBN(natPriceUSDDec5).mul(toBN(this.settings.assetUnitUBA)));
    }
    
    convertAmgToUBA(valueAMG: BNish) {
        return toBN(valueAMG).mul(toBN(this.settings.assetMintingGranularityUBA));
    }

    convertUBAToAmg(valueUBA: BNish) {
        return toBN(valueUBA).div(toBN(this.settings.assetMintingGranularityUBA));
    }

    async convertUBAToLots(valueUBA: BNish) {
        return toBN(valueUBA).div(await this.lotsSize());
    }
    
    async convertLotsToUBA(lots: BNish) {
        return toBN(lots).mul(await this.lotsSize());
    }

    async convertLotsToAMG(lots: BNish) {
        const settings = await this.assetManager.getSettings();
        return toBN(lots).mul(toBN(settings.lotSizeAMG));
    }
    
    convertAmgToNATWei(valueAMG: BNish, amgToNATWeiPrice: BNish) {
        return toBN(valueAMG).mul(toBN(amgToNATWeiPrice)).div(AMG_NATWEI_PRICE_SCALE);
    }

    convertNATWeiToAMG(valueNATWei: BNish, amgToNATWeiPrice: BNish) {
        return toBN(valueNATWei).mul(AMG_NATWEI_PRICE_SCALE).div(toBN(amgToNATWeiPrice));
    }
    
    static async createTest(common: CommonContext, chainInfo: ChainInfo): Promise<AssetContext> {
        // create mock chain attestation provider
        const chain = new MockChain(await time.latest());
        chain.secondsPerBlock = chainInfo.blockTime;
        const chainEvents = chain;
        const stateConnectorClient = new MockStateConnectorClient(common.attestationClient, { [chainInfo.chainId]: chain }, 'on_wait');
        const attestationProvider = new AttestationHelper(stateConnectorClient, chain, chainInfo.chainId, 0);
        // create asset FTSO and set some price
        const assetFtso = await FtsoMock.new(chainInfo.symbol);
        await assetFtso.setCurrentPrice(toBNExp(chainInfo.startPrice, 5), 0);
        await common.ftsoRegistry.addFtso(assetFtso.address);
        // create asset manager
        const settings = await AssetContext.createTestSettings(common, chainInfo);
        // web3DeepNormalize is required when passing structs, otherwise BN is incorrectly serialized
        const [assetManager, fAsset] = await newAssetManager(common.governance, common.assetManagerController,
            chainInfo.name, chainInfo.symbol, chainInfo.decimals, web3DeepNormalize(settings));
        return new AssetContext(common.governance, common.addressUpdater, common.assetManagerController, common.attestationClient, common.ftsoRegistry, common.wnat, common.natFtso,
            chainInfo, chain, chainEvents, stateConnectorClient, attestationProvider, settings, assetManager, fAsset, assetFtso);
    }
    
    static async createTestSettings(ctx: CommonContext, ci: ChainInfo): Promise<AssetManagerSettings> {
        return {
            assetManagerController: constants.ZERO_ADDRESS,     // replaced in newAssetManager(...)
            attestationClient: ctx.attestationClient.address,
            wNat: ctx.wnat.address,
            whitelist: constants.ZERO_ADDRESS,
            ftsoRegistry: ctx.ftsoRegistry.address,
            natFtsoIndex: 0,                                    // set automatically in contract
            assetFtsoIndex: 0,                                  // set automatically in contract
            natFtsoSymbol: await ctx.wnat.symbol(),
            assetFtsoSymbol: ci.symbol,
            chainId: ci.chainId,
            assetUnitUBA: toBNExp(1, ci.decimals),
            assetMintingGranularityUBA: toBNExp(1, ci.amgDecimals),
            lotSizeAMG: toBNExp(ci.lotSize, ci.decimals - ci.amgDecimals),
            requireEOAAddressProof: ci.requireEOAProof,
            underlyingBlocksForPayment: ci.underlyingBlocksForPayment,
            underlyingSecondsForPayment: ci.underlyingBlocksForPayment * ci.blockTime,
            // settings that are more or less chain independent
            burnAddress: constants.ZERO_ADDRESS,            // burn address on local chain - same for all assets
            collateralReservationFeeBIPS: 100,              // 1%
            minCollateralRatioBIPS: 2_1000,          // 2.1
            ccbMinCollateralRatioBIPS: 1_9000,   // 1.9
            safetyMinCollateralRatioBIPS: 2_5000,      // 2.5
            redemptionFeeBIPS: 200,                         // 2%
            redemptionDefaultFactorBIPS: 1_2000,            // 1.2
            confirmationByOthersAfterSeconds: 6 * HOURS,      // 6 hours
            confirmationByOthersRewardNATWei: toWei(100),      // 100 NAT
            maxRedeemedTickets: 20,                         // TODO: find number that fits comfortably in gas limits
            paymentChallengeRewardBIPS: 1,
            paymentChallengeRewardNATWei: toWei(300),       // 300 NAT
            withdrawalWaitMinSeconds: 60,
            liquidationCollateralFactorBIPS: [12000, 16000, 20000],
            ccbTimeSeconds: 180,
            liquidationStepSeconds: 90,
            maxTrustedPriceAgeSeconds: 8 * 60,
            timelockSeconds: 1 * WEEKS, // 1 week
            minUpdateRepeatTimeSeconds: 1 * DAYS,
            attestationWindowSeconds: 1 * DAYS,
            buybackCollateralFactorBIPS: 1_1000,                    // 1.1
        };
    }
}

export class AssetContextClient {
    constructor(
        public context: AssetContext,
    ) {}
    
    protected assetManager = this.context.assetManager;
    protected chain = this.context.chain;
    protected attestationProvider = this.context.attestationProvider;
    protected wnat = this.context.wnat;
    protected fAsset = this.context.fAsset;
}
