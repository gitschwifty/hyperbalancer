import { ethers } from "ethers";
import {
  CLMM,
  PositionInfo,
  PoolData,
  AddLiquidityOptions,
  RemoveLiquidityOptions,
  CollectFeesOptions,
} from "./abstractClmm";

const kittenswapPositionManagerAddress =
  "0xB9201e89f94a01FF13AD4CAeCF43a2e232513754";

const positionManagerABI = [
  "function positions(uint256 tokenId) external view returns (uint96 nonce, address operator, address token0, address token1, int24 tickSpacing, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
  "function balanceOf(address owner) external view returns (uint256 balance)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) external view returns (uint256 tokenId)",
  "function factory() external view returns (address)",
];

const factoryABI = [
  "function getPool(address tokenA, address tokenB, int24 tickSpacing) external view returns (address pool)",
  "function tickSpacingToFee(int24) external view returns (uint24)",
];

const poolABI = [
  "function token0() external view returns (address)",
  "function token1() external view returns (address)",
  "function fee() external view returns (uint24)",
  "function tickSpacing() external view returns (int24)",
  // this differs from the ABI on purrsec - not sure if there's a canonical spot to find it but no feeProtocol in here
  "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, bool unlocked)",
  "function liquidity() external view returns (uint128)",
  // another ABI mismatch crazy
  "function ticks(int24 tick) external view returns (uint128 liquidityGross, int128 liquidityNet, int128 stakedLiquidityNet, uint256 feeGrowthOutside0X128, uint256 feeGrowthOutside1X128, uint256 rewardGrowthOutsideX128, int56 tickCumulativeOutside, uint160 secondsPerLiquidityOutsideX128, uint32 secondsOutside, bool initialized)",
  "function feeGrowthGlobal0X128() view returns (uint256)",
  "function feeGrowthGlobal1X128() view returns (uint256)",
];

// main difference is that positions returns tick spacing instead of fee
// and to get pool you send in tickSpacing
// you can get fee through tickSpacingToFee
// oh tricky tickSpacing is an int not a uint lol
// why? can it be negative

// could initialize these through several calls to factory but it's not typed if i do that hmm
enum FeeTier {
  LOW = 200,
  MEDIUM = 2500,
  HIGH = 7500,
}

const TICK_SPACINGS: { [key in FeeTier]: number } = {
  [FeeTier.LOW]: 1,
  [FeeTier.MEDIUM]: 200,
  [FeeTier.HIGH]: 2000,
};

export class KittenswapManager extends CLMM {
  constructor(rpcUrl: string, signer?: ethers.Signer) {
    super(rpcUrl, signer);

    this.positionManager = new ethers.Contract(
      kittenswapPositionManagerAddress,
      positionManagerABI,
      signer || this.provider,
    );

    this.factoryAddress = "";
    this.poolABI = poolABI;
  }

  private async initializeFactory(): Promise<void> {
    if (!this.factoryAddress) {
      this.factoryAddress = await this.positionManager.factory();
      this.factoryContract = new ethers.Contract(
        this.factoryAddress,
        factoryABI,
        this.provider,
      );
    }
  }

  async getPosition(positionId: string): Promise<PositionInfo> {
    await this.initializeFactory();

    const positionData = await this.positionManager.positions(positionId);

    const poolAddress = await this.factoryContract.getPool(
      positionData.token0,
      positionData.token1,
      positionData.tickSpacing,
    );

    // only need this for current tick, maybe shouldn't be in getPosition but then
    // have to drop currentTick from pos type (or opt it)
    const poolContract = new ethers.Contract(
      poolAddress,
      poolABI,
      this.provider,
    );

    const slot0 = await poolContract.slot0();
    const currentTick = Number(slot0.tick);

    const [token0Info, token1Info] = await Promise.all([
      this.getTokenInfo(positionData.token0),
      this.getTokenInfo(positionData.token1),
    ]);

    const inRange =
      currentTick >= Number(positionData.tickLower) &&
      currentTick <= Number(positionData.tickUpper);

    const fee = await this.getFeeForTickSpacing(
      Number(positionData.tickSpacing),
    );

    return {
      id: positionId,
      token0: token0Info,
      token1: token1Info,
      fee,
      tickSpacing: Number(positionData.tickSpacing),
      tickLower: Number(positionData.tickLower),
      tickUpper: Number(positionData.tickUpper),
      currentTick,
      liquidity: positionData.liquidity.toString(),
      feeGrowthInside0LastX128: positionData.feeGrowthInside0LastX128,
      feeGrowthInside1LastX128: positionData.feeGrowthInside1LastX128,
      tokensOwed0: positionData.tokensOwed0.toString(),
      tokensOwed1: positionData.tokensOwed1.toString(),
      inRange,
    };
  }

  async getPoolData(
    token0: string,
    token1: string,
    tickSpacing: number,
  ): Promise<PoolData> {
    await this.initializeFactory();

    const poolAddress = await this.factoryContract.getPool(
      token0,
      token1,
      tickSpacing,
    );

    if (poolAddress === ethers.ZeroAddress) {
      throw new Error("Pool does not exist");
    }

    const poolContract = new ethers.Contract(
      poolAddress,
      poolABI,
      this.provider,
    );

    const [
      slot0,
      liquidity,
      feeGrowthGlobal0X128,
      feeGrowthGlobal1X128,
      actualToken0,
      actualToken1,
      fee,
      actualTickSpacing,
    ] = await Promise.all([
      poolContract.slot0(),
      poolContract.liquidity(),
      poolContract.feeGrowthGlobal0X128(),
      poolContract.feeGrowthGlobal1X128(),
      poolContract.token0(),
      poolContract.token1(),
      poolContract.fee(),
      poolContract.tickSpacing(),
    ]);

    const [token0Info, token1Info] = await Promise.all([
      this.getTokenInfo(actualToken0),
      this.getTokenInfo(actualToken1),
    ]);

    return {
      address: poolAddress,
      token0: token0Info,
      token1: token1Info,
      fee: Number(fee),
      tickSpacing: Number(actualTickSpacing),
      sqrtPriceX96: slot0.sqrtPriceX96,
      tick: Number(slot0.tick),
      liquidity: liquidity.toString(),
      feeGrowthGlobal0X128,
      feeGrowthGlobal1X128,
    };
  }

  async addLiquidity(
    options: AddLiquidityOptions,
  ): Promise<ethers.TransactionResponse> {
    if (!this.signer) {
      throw new Error("Signer required for transactions");
    }

    const params = {
      token0: options.token0,
      token1: options.token1,
      fee: options.fee,
      tickLower: options.tickLower,
      tickUpper: options.tickUpper,
      amount0Desired: options.amount0Desired,
      amount1Desired: options.amount1Desired,
      amount0Min: options.amount0Min,
      amount1Min: options.amount1Min,
      recipient: options.recipient,
      deadline: options.deadline,
    };

    return await this.positionManager.mint(params);
  }

  async removeLiquidity(
    options: RemoveLiquidityOptions,
  ): Promise<ethers.TransactionResponse> {
    if (!this.signer) {
      throw new Error("Signer required for transactions");
    }

    const params = {
      tokenId: options.tokenId,
      liquidity: options.liquidity,
      amount0Min: options.amount0Min,
      amount1Min: options.amount1Min,
      deadline: options.deadline,
    };

    return await this.positionManager.decreaseLiquidity(params);
  }

  async collectFees(
    options: CollectFeesOptions,
  ): Promise<ethers.TransactionResponse> {
    if (!this.signer) {
      throw new Error("Signer required for transactions");
    }

    const params = {
      tokenId: options.tokenId,
      recipient: options.recipient,
      amount0Max: options.amount0Max,
      amount1Max: options.amount1Max,
    };

    return await this.positionManager.collect(params);
  }

  async getTickSpacingForFee(fee: number): Promise<number> {
    const feeAmount = fee as FeeTier;
    if (feeAmount in TICK_SPACINGS) {
      return TICK_SPACINGS[feeAmount];
    }
    throw new Error(`Unknown fee amount: ${fee}`);
  }

  async getFeeForTickSpacing(tickSpacing: number): Promise<number> {
    await this.initializeFactory();
    const fee = await this.factoryContract.tickSpacingToFee(tickSpacing);
    return Number(fee);
  }
}
