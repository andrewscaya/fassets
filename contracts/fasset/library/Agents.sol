// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "../interface/IAgentVault.sol";
import "../../utils/lib/SafeBips.sol";
import "./UnderlyingAddressOwnership.sol";
import "./AssetManagerState.sol";
import "./Conversion.sol";


library Agents {
    using SafeMath for uint256;
    using SafeBips for uint256;
    using UnderlyingAddressOwnership for UnderlyingAddressOwnership.State;
    
    enum AgentType {
        NONE,
        AGENT_100,
        AGENT_0,
        SELF_MINTING
    }
    
    enum AgentStatus {
        NORMAL,
        LIQUIDATION
    }
    
    struct LiquidationState {

        uint64 liquidationStartedAt;
    }

    struct AddressLiquidationState {

        uint64 liquidationStartedAt;

        bool fullLiquidation;
    }

    struct Agent {
        // Current address for underlying agent's collateral.
        // Agent can change this address anytime and it affects future mintings.
        bytes32 underlyingAddress;
        
        // For agents to withdraw NAT collateral, they must first announce it and then wait 
        // withdrawalAnnouncementSeconds. 
        // The announced amount cannt be used as collateral for minting during that time.
        // This makes sure that agents cannot just remove all collateral if they are challenged.
        uint128 withdrawalAnnouncedNATWei;
        
        // The time when withdrawal was announced.
        uint64 withdrawalAnnouncedAt;
        
        // Amount of collateral locked by collateral reservation.
        uint64 reservedAMG;
        
        // Amount of collateral backing minted fassets.
        uint64 mintedAMG;
        
        // The amount of fassets being redeemed. In this case, the fassets were already burned,
        // but the collateral must still be locked to allow payment in case of redemption failure.
        // The distinction between 'minted' and 'redeemed' assets is important in case of challenge.
        uint64 redeemingAMG;
        
        // When lot size changes, there may be some leftover after redemtpion that doesn't fit
        // a whole lot size. It is added to dustAMG and can be recovered via self-close.
        uint64 dustAMG;
        
        // Minimum native collateral ratio required for this agent. Changes during the liquidation.
        uint32 minCollateralRatioBIPS;
        
        // Position of this agent in the list of agents available for minting.
        // Value is actually `list index + 1`, so that 0 means 'not in list'.
        uint64 availableAgentsPos;
        
        // Minting fee in BIPS (collected in underlying currency).
        uint16 feeBIPS;
        
        // Minimum collateral ratio at which minting can occur.
        // Agent may set own value for minting collateral ratio when entering the available agent list,
        // but it must always be greater than minimum collateral ratio.
        uint32 mintingCollateralRatioBIPS;
        
        // When an agent exits and re-enters availability list, mintingCollateralRatio changes
        // so we have to acocunt for that when calculating total reserved collateral.
        // We simplify by only allowing one change before the old CRs are executed or cleared.
        // Therefore we store relevant old values here and match old/new by 0/1 flag 
        // named `availabilityEnterCountMod2` here and in CR.
        uint64 oldReservedAMG;
        uint32 oldMintingCollateralRatioBIPS;
        uint8 availabilityEnterCountMod2;
        
        // Current status of the agent (changes for liquidation).
        AgentType agentType;
        AgentStatus status;
        LiquidationState liquidationState;

        // 1) When no topup is performed, partial liquidation for underlyingAddress is started
        // 2) When illegal payment challenge is confirmed, agent's underlyingAddress should be fully liquidated
        //    All redemption tickets for that underlyingAddress should be liquidated
        // Type: mapping underlyingAddress => Agents.AddressLiquidationState
        mapping(bytes32 => AddressLiquidationState) addressInLiquidation;

        // The amount of underlying funds that may be withdrawn by the agent
        // (fees, self-close and, amount released by liquidation).
        // May become negative (due to high underlying gas costs), in which case topup is required.
        int128 freeUnderlyingBalanceUBA;
        
        // When freeUnderlyingBalanceUBA becomes negative, agent has until this block to perform topup,
        // otherwise liquidation can be triggered by a challenger.
        uint64 lastUnderlyingBlockForTopup;
    }
    
    event DustChanged(
        address indexed agentVault,
        uint256 dustUBA);
        
    function createAgent(
        AssetManagerState.State storage _state, 
        AgentType _agentType,
        address _agentVault,
        bytes32 _underlyingAddress
    ) 
        internal 
    {
        // TODO: create vault here instead of passing _agentVault?
        require(_agentVault != address(0), "zero vault address");
        require(_underlyingAddress != 0, "zero underlying address");
        Agent storage agent = _state.agents[_agentVault];
        require(agent.agentType == AgentType.NONE, "agent already exists");
        agent.agentType = _agentType;
        agent.status = AgentStatus.NORMAL;
        agent.minCollateralRatioBIPS = _state.settings.initialMinCollateralRatioBIPS;
        agent.underlyingAddress = _underlyingAddress;
    }
    
    function allocateMintedAssets(
        AssetManagerState.State storage _state, 
        address _agentVault,
        uint64 _valueAMG
    )
        internal
    {
        Agent storage agent = _state.agents[_agentVault];
        agent.mintedAMG = SafeMath64.add64(agent.mintedAMG, _valueAMG);
    }

    function releaseMintedAssets(
        AssetManagerState.State storage _state, 
        address _agentVault,
        uint64 _valueAMG
    )
        internal
    {
        Agent storage agent = _state.agents[_agentVault];
        agent.mintedAMG = SafeMath64.sub64(agent.mintedAMG, _valueAMG, "ERROR: not enough minted");
    }

    function startRedeemingAssets(
        AssetManagerState.State storage _state, 
        address _agentVault,
        uint64 _valueAMG
    )
        internal
    {
        Agent storage agent = _state.agents[_agentVault];
        agent.redeemingAMG = SafeMath64.add64(agent.redeemingAMG, _valueAMG);
        agent.mintedAMG = SafeMath64.sub64(agent.mintedAMG, _valueAMG, "ERROR: not enough minted");
    }

    function endRedeemingAssets(
        AssetManagerState.State storage _state, 
        address _agentVault,
        uint64 _valueAMG
    )
        internal
    {
        Agent storage agent = _state.agents[_agentVault];
        agent.redeemingAMG = SafeMath64.sub64(agent.redeemingAMG, _valueAMG, "ERROR: not enough redeeming");
    }
    
    function announceWithdrawal(
        AssetManagerState.State storage _state, 
        address _agentVault,
        uint256 _valueNATWei,
        uint256 _fullCollateral, 
        uint256 _amgToNATWeiPrice
    )
        internal
    {
        Agent storage agent = _state.agents[_agentVault];
        if (_valueNATWei > agent.withdrawalAnnouncedNATWei) {
            // announcement increased - must check there is enough free collateral and then lock it
            // in this case the wait to withdrawal restarts from this moment
            uint256 increase = _valueNATWei - agent.withdrawalAnnouncedNATWei;
            require(increase <= freeCollateralWei(agent, _fullCollateral, _amgToNATWeiPrice),
                "withdrawal: value too high");
            agent.withdrawalAnnouncedAt = SafeCast.toUint64(block.timestamp);
        } else {
            // announcement decreased or canceled - might be needed to get agent out of CCB
            // if value is 0, we cancel announcement completely (i.e. set announcement time to 0)
            // otherwise, for decreasing announcement, we can safely leave announcement time unchanged
            if (_valueNATWei == 0) {
                agent.withdrawalAnnouncedAt = 0;
            }
        }
        agent.withdrawalAnnouncedNATWei = SafeCast.toUint128(_valueNATWei);
    }

    function increaseDust(
        AssetManagerState.State storage _state,
        address _agentVault,
        uint64 _dustIncreaseAMG
    )
        internal
    {
        Agent storage agent = _state.agents[_agentVault];
        agent.dustAMG = SafeMath64.add64(agent.dustAMG, _dustIncreaseAMG);
        uint256 dustUBA = uint256(agent.dustAMG).mul(_state.settings.assetMintingGranularityUBA);
        emit DustChanged(_agentVault, dustUBA);
    }
    
    function withdrawalExecuted(
        AssetManagerState.State storage _state, 
        address _agentVault,
        uint256 _valueNATWei
    )
        internal
    {
        Agent storage agent = _state.agents[_agentVault];
        require(agent.withdrawalAnnouncedAt != 0 &&
            block.timestamp <= agent.withdrawalAnnouncedAt + _state.settings.withdrawalWaitMinSeconds,
            "withdrawal: not announced");
        require(_valueNATWei <= agent.withdrawalAnnouncedNATWei,
            "withdrawal: more than announced");
        agent.withdrawalAnnouncedAt = 0;
        agent.withdrawalAnnouncedNATWei = 0;
    }
    
    function getAgent(
        AssetManagerState.State storage _state, 
        address _agentVault
    ) 
        internal view 
        returns (Agent storage _agent) 
    {
        _agent = _state.agents[_agentVault];
        require(_agent.agentType != AgentType.NONE, "agent does not exist");
    }
    
    function isAgentInLiquidation(
        AssetManagerState.State storage _state, 
        address _agentVault
    )
        internal view
        returns (bool)
    {
        Agents.Agent storage agent = _state.agents[_agentVault];
        return agent.liquidationState.liquidationStartedAt > 0;
        // || agent.addressInLiquidation[_underlyingAddress].liquidationStartedAt > 0;
        // TODO: handle address liquidation
    }

    function freeCollateralLots(
        Agents.Agent storage _agent, 
        AssetManagerSettings.Settings storage _settings,
        uint256 _fullCollateral, 
        uint256 _amgToNATWeiPrice
    )
        internal view 
        returns (uint256) 
    {
        uint256 freeCollateral = freeCollateralWei(_agent, _fullCollateral, _amgToNATWeiPrice);
        uint256 lotCollateral = mintingLotCollateralWei(_agent, _settings, _amgToNATWeiPrice);
        return freeCollateral.div(lotCollateral);
    }

    function freeCollateralWei(
        Agents.Agent storage _agent, 
        uint256 _fullCollateral, 
        uint256 _amgToNATWeiPrice
    )
        internal view 
        returns (uint256) 
    {
        uint256 lockedCollateral = lockedCollateralWei(_agent, _amgToNATWeiPrice);
        (, uint256 freeCollateral) = _fullCollateral.trySub(lockedCollateral);
        return freeCollateral;
    }
    
    function lockedCollateralWei(
        Agents.Agent storage _agent, 
        uint256 _amgToNATWeiPrice
    )
        internal view 
        returns (uint256) 
    {
        // reservedCollateral = _agent.reservedAMG * 
        // reserved collateral is calculated at minting ratio
        uint256 reservedCollateral = Conversion.convertAmgToNATWei(_agent.reservedAMG, _amgToNATWeiPrice)
            .mulBips(_agent.mintingCollateralRatioBIPS);
        // old reserved collateral (from before agent exited and re-entered minting queue), at old minting ratio
        uint256 oldReservedCollateral = Conversion.convertAmgToNATWei(_agent.oldReservedAMG, _amgToNATWeiPrice)
            .mulBips(_agent.oldMintingCollateralRatioBIPS);
        // minted collateral is calculated at minimal ratio
        uint256 mintedCollateral = Conversion.convertAmgToNATWei(_agent.mintedAMG, _amgToNATWeiPrice)
            .mulBips(_agent.minCollateralRatioBIPS);
        return reservedCollateral
            .add(oldReservedCollateral)
            .add(mintedCollateral)
            .add(_agent.withdrawalAnnouncedNATWei);
    }
    
    function mintingLotCollateralWei(
        Agents.Agent storage _agent, 
        AssetManagerSettings.Settings storage _settings,
        uint256 _amgToNATWeiPrice
    ) 
        internal view 
        returns (uint256) 
    {
        return Conversion.convertAmgToNATWei(_settings.lotSizeAMG, _amgToNATWeiPrice)
            .mulBips(_agent.mintingCollateralRatioBIPS);
    }
    
    function requireOwnerAgent(address _agentVault) internal view {
        require(msg.sender == IAgentVault(_agentVault).owner(), "only agent");
    }
}
