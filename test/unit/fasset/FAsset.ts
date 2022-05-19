import { constants, expectEvent, expectRevert, time } from "@openzeppelin/test-helpers";
import { FAssetInstance, WhitelistInstance } from "../../../typechain-truffle";
import { getTestFile } from "../../utils/helpers";
import { assertWeb3Equal } from "../../utils/web3assertions";

const FAsset = artifacts.require('FAsset');

contract(`FAsset.sol; ${getTestFile(__filename)}; FAsset basic tests`, async accounts => {
    let fAsset: FAssetInstance;
    const governance = accounts[10];
    const assetManager = accounts[11];

    beforeEach(async () => {
        fAsset = await FAsset.new(governance, "Ethereum", "ETH", 18);
    });

    describe("basic tests", () => {

        it('should not set asset manager if not governance', async function () {
            const promise = fAsset.setAssetManager(assetManager);
            await expectRevert(promise, "only governance")
        });

        it('should not set asset manager to zero address', async function () {
            const promise = fAsset.setAssetManager(constants.ZERO_ADDRESS, { from: governance });
            await expectRevert(promise, "zero asset manager")
        });
        
        it('should not replace asset manager', async function () {
            await fAsset.setAssetManager(assetManager, { from: governance });
            const promise = fAsset.setAssetManager(assetManager, { from: governance });
            await expectRevert(promise, "cannot replace asset manager")
        });

        it('should only be terminated by asset manager', async function () {
            await fAsset.setAssetManager(assetManager, { from: governance });
            const promise = fAsset.terminate({ from: governance });
            await expectRevert(promise, "only asset manager");
            assert.isFalse(await fAsset.terminated());
            await fAsset.terminate({ from: assetManager });
            assert.isTrue(await fAsset.terminated());
            const terminatedAt = await fAsset.terminatedAt();
            await time.increase(100);
            await fAsset.terminate({ from: assetManager });
            const terminatedAt2 = await fAsset.terminatedAt();
            assertWeb3Equal(terminatedAt, terminatedAt2);
        });
    });
});