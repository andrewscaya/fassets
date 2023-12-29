import hre from "hardhat";
import { runAsyncMain } from "../../../lib/utils/helpers";
import { ChainContracts, loadContracts, newContract, saveContracts } from "../../lib/contracts";
import { loadDeployAccounts, requiredEnvironmentVariable } from "../../lib/deploy-utils";

const FakeERC20 = artifacts.require('FakeERC20');

// only use when deploying on full flare deploy on hardhat local network (i.e. `deploy_local_hardhat_commands` was run in flare-smart-contracts project)
runAsyncMain(async () => {
    const network = requiredEnvironmentVariable('NETWORK_CONFIG');
    const contractsFile = `deployment/deploys/${network}.json`;
    const contracts = loadContracts(contractsFile);
    await deployStablecoin(contracts, "Test USDCoin", "testUSDC", 6);
    await deployStablecoin(contracts, "Test Tether", "testUSDT", 6);
    saveContracts(contractsFile, contracts);
});

async function deployStablecoin(contracts: ChainContracts, name: string, symbol: string, decimals: number) {
    // create token
    const { deployer } = loadDeployAccounts(hre);
    const token = await FakeERC20.new(deployer, name, symbol, decimals);
    contracts[symbol] = newContract(symbol, 'FakeERC20.sol', token.address);
}
