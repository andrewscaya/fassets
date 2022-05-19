import { constants } from "@openzeppelin/test-helpers";
import { AttestationClientMockInstance, FtsoRegistryMockInstance, WNatInstance } from "../../../typechain-truffle";
import { AssetManagerSettings } from "../../utils/fasset/AssetManagerTypes";
import { DAYS, HOURS, toStringExp, WEEKS } from "../../utils/helpers";

export function createTestSettings(attestationClient: AttestationClientMockInstance, wNat: WNatInstance, ftsoRegistry: FtsoRegistryMockInstance, requireEOAAddressProof: boolean = true): AssetManagerSettings {
    return {
        assetManagerController: constants.ZERO_ADDRESS,     // replaced in newAssetManager(...)
        attestationClient: attestationClient.address,
        wNat: wNat.address,
        whitelist: constants.ZERO_ADDRESS,
        ftsoRegistry: ftsoRegistry.address,
        natFtsoIndex: 0,                                    // set automatically in contract
        assetFtsoIndex: 0,                                  // set automatically in contract
        natFtsoSymbol: "NAT",
        assetFtsoSymbol: "ETH",
        burnAddress: constants.ZERO_ADDRESS,
        chainId: 1,
        collateralReservationFeeBIPS: 100,                  // 1%
        assetUnitUBA: toStringExp(1, 18),                   // 1e18 wei per eth
        assetMintingGranularityUBA: toStringExp(1, 9),      // 1e9 = 1 gwei
        lotSizeAMG: toStringExp(1_000, 9),                  // 1000 eth
        requireEOAAddressProof: requireEOAAddressProof,
        minCollateralRatioBIPS: 2_1000,                     // 2.1
        ccbMinCollateralRatioBIPS: 1_9000,                  // 1.9
        safetyMinCollateralRatioBIPS: 2_5000,               // 2.5
        underlyingBlocksForPayment: 10,
        underlyingSecondsForPayment: 120,                       // 12s per block assumed
        redemptionFeeBIPS: 200,                                 // 2%
        redemptionDefaultFactorBIPS: 1_2000,                    // 1.2
        confirmationByOthersAfterSeconds: 6 * HOURS,            // 6 hours
        confirmationByOthersRewardNATWei: toStringExp(100, 18),    // 100 NAT
        maxRedeemedTickets: 20,                                 // TODO: find number that fits comfortably in gas limits
        paymentChallengeRewardBIPS: 0,
        paymentChallengeRewardNATWei: toStringExp(300, 18),     // 300 NAT
        withdrawalWaitMinSeconds: 300,
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
