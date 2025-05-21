import { ethers, BigNumberish } from "ethers";
import {
  CLMM,
  PositionInfo,
  PoolData,
  AddLiquidityOptions,
  RemoveLiquidityOptions,
  CollectFeesOptions,
  TokenInfo,
  erc20ABI,
  TokenAmount,
} from "./abstractClmm";
import { Q128, subIn256 } from "./utils";

const positionManagerABI = [
  "function positions(uint256 tokenId) external view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
  "function balanceOf(address owner) external view returns (uint256 balance)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) external view returns (uint256 tokenId)",
  "function factory() external view returns (address)",
  "function mint(tuple(address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline)) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
  "function increaseLiquidity(tuple(uint256 tokenId, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, uint256 deadline)) external payable returns (uint128 liquidity, uint256 amount0, uint256 amount1)",
  "function decreaseLiquidity(tuple(uint256 tokenId, uint128 liquidity, uint256 amount0Min, uint256 amount1Min, uint256 deadline)) external returns (uint256 amount0, uint256 amount1)",
  "function collect(tuple(uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max)) external returns (uint256 amount0, uint256 amount1)",
];

const factoryABI = [
  "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)",
  "function feeAmountTickSpacing(uint24) external view returns (int24)",
];

const poolABI = [
  "function token0() external view returns (address)",
  "function token1() external view returns (address)",
  "function fee() external view returns (uint24)",
  "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function liquidity() external view returns (uint128)",
  "function ticks(int24 tick) external view returns (uint128 liquidityGross, int128 liquidityNet, uint256 feeGrowthOutside0X128, uint256 feeGrowthOutside1X128, int56 tickCumulativeOutside, uint160 secondsPerLiquidityOutsideX128, uint32 secondsOutside, bool initialized)",
  "function feeGrowthGlobal0X128() view returns (uint256)",
  "function feeGrowthGlobal1X128() view returns (uint256)",
];

enum FeeTier {
  LOWEST = 100,
  LOW = 500,
  MEDIUM = 3000,
  HIGH = 10000,
}

const TICK_SPACINGS: { [key in FeeTier]: number } = {
  [FeeTier.LOWEST]: 1,
  [FeeTier.LOW]: 10,
  [FeeTier.MEDIUM]: 60,
  [FeeTier.HIGH]: 200,
};

const hyperswapPositionManagerAddress =
  "0x6eDA206207c09e5428F281761DdC0D300851fBC8";

export class HyperSwapManager extends CLMM {
  positionManager: ethers.Contract;
  factoryAddress: string;
  factoryContract!: ethers.Contract;

  constructor(rpcUrl: string, signer?: ethers.Signer) {
    super(rpcUrl, signer);

    this.positionManager = new ethers.Contract(
      hyperswapPositionManagerAddress,
      positionManagerABI,
      signer || this.provider,
    );

    this.factoryAddress = "";
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

  private async getTokenInfo(tokenAddress: string): Promise<TokenInfo> {
    const token = new ethers.Contract(tokenAddress, erc20ABI, this.provider);

    const [symbol, decimals] = await Promise.all([
      token.symbol(),
      token.decimals(),
    ]);

    return {
      address: tokenAddress,
      symbol,
      decimals: Number(decimals),
    };
  }

  async getPositionsForWallet(walletAddress: string): Promise<PositionInfo[]> {
    const balance = await this.positionManager.balanceOf(walletAddress);
    const positions: PositionInfo[] = [];

    for (let i = 0; i < Number(balance); i++) {
      const tokenId = await this.positionManager.tokenOfOwnerByIndex(
        walletAddress,
        i,
      );

      try {
        const position = await this.getPosition(tokenId.toString());
        if (position.liquidity !== "0") {
          positions.push(position);
        }
      } catch (error) {
        console.warn(`Error fetching position ${tokenId}: ${error}`);
      }
    }

    return positions;
  }

  async getPosition(positionId: string): Promise<PositionInfo> {
    await this.initializeFactory();

    const positionData = await this.positionManager.positions(positionId);

    const poolAddress = await this.factoryContract.getPool(
      positionData.token0,
      positionData.token1,
      positionData.fee,
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

    return {
      id: positionId,
      token0: token0Info,
      token1: token1Info,
      fee: Number(positionData.fee),
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

  async getTicks(
    poolAddress: string,
    tick: number,
  ): Promise<{
    feeGrowthOutside0X128: BigNumberish;
    feeGrowthOutside1X128: BigNumberish;
  }> {
    const poolContract = new ethers.Contract(
      poolAddress,
      poolABI,
      this.provider,
    );

    const res = await poolContract.ticks(tick);

    return res;
  }

  async getPoolData(
    token0: string,
    token1: string,
    fee: number,
  ): Promise<PoolData> {
    await this.initializeFactory();

    const poolAddress = await this.factoryContract.getPool(token0, token1, fee);

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
      actualFee,
    ] = await Promise.all([
      poolContract.slot0(),
      poolContract.liquidity(),
      poolContract.feeGrowthGlobal0X128(),
      poolContract.feeGrowthGlobal1X128(),
      poolContract.token0(),
      poolContract.token1(),
      poolContract.fee(),
    ]);

    const [token0Info, token1Info] = await Promise.all([
      this.getTokenInfo(actualToken0),
      this.getTokenInfo(actualToken1),
    ]);

    return {
      address: poolAddress,
      token0: token0Info,
      token1: token1Info,
      fee: Number(actualFee),
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
    for (const fee in TICK_SPACINGS) {
      if (TICK_SPACINGS[Number(fee) as FeeTier] === tickSpacing) {
        return Number(fee);
      }
    }

    throw new Error(`Unknown tick spacing: ${tickSpacing}`);
  }

  getCounterfactualFees(
    feeGrowthGlobal: bigint,
    feeGrowthOutsideLower: bigint,
    feeGrowthOutsideUpper: bigint,
    feeGrowthInsideLast: bigint,
    pool: PoolData,
    liquidity: bigint,
    tickLower: number,
    tickUpper: number,
  ) {
    let feeGrowthBelow: bigint;
    if (pool.tick >= tickLower) {
      feeGrowthBelow = feeGrowthOutsideLower;
    } else {
      feeGrowthBelow = subIn256(feeGrowthGlobal, feeGrowthOutsideLower);
    }

    let feeGrowthAbove: bigint;
    if (pool.tick < tickUpper) {
      feeGrowthAbove = feeGrowthOutsideUpper;
    } else {
      feeGrowthAbove = subIn256(feeGrowthGlobal, feeGrowthOutsideUpper);
    }

    const feeGrowthInside = subIn256(
      subIn256(feeGrowthGlobal, feeGrowthBelow),
      feeGrowthAbove,
    );

    return (
      (subIn256(feeGrowthInside, feeGrowthInsideLast) * liquidity) / 2n ** 128n
    );
    // .mul(liquidity).div(BigNumber.from(2).pow(128))
  }

  // compute current + counterfactual fees for a v3 position
  async useV3PositionFees(
    pool: PoolData,
    positionDetails: PositionInfo,
  ): Promise<[TokenAmount, TokenAmount]> {
    /* const { chainId } = usePrivyWallet()

  const poolAddress = useMemo(() => {
    try {
      return chainId &&
        V3_CORE_FACTORY_ADDRESSES[chainId as keyof typeof V3_CORE_FACTORY_ADDRESSES] &&
        pool &&
        positionDetails
        ? computePoolAddress({
            factoryAddress: V3_CORE_FACTORY_ADDRESSES[chainId as keyof typeof V3_CORE_FACTORY_ADDRESSES] as string,
            tokenA: pool.token0,
            tokenB: pool.token1,
            fee: positionDetails.fee,
          })
        : undefined
    } catch {
      return undefined
    }
  }, [chainId, pool, positionDetails])
  const poolContract = useV3Pool(poolAddress) */

    // data fetching
    const feeGrowthGlobal0: bigint | undefined = BigInt(
      pool.feeGrowthGlobal0X128,
    ); // useSingleCallResult(poolContract, 'feeGrowthGlobal0X128')?.result?.[0]
    const feeGrowthGlobal1: bigint | undefined = BigInt(
      pool.feeGrowthGlobal1X128,
    ); // useSingleCallResult(poolContract, 'feeGrowthGlobal1X128')?.result?.[0]
    const {
      feeGrowthOutside0X128: feeGrowthOutsideLower0,
      feeGrowthOutside1X128: feeGrowthOutsideLower1,
    } = await this.getTicks(pool.address, positionDetails.tickLower);
    // (useSingleCallResult(poolContract, 'ticks', [
    //  positionDetails?.tickLower,
    //])?.result ?? {}) as { feeGrowthOutside1X128?: BigNumber }
    const {
      feeGrowthOutside0X128: feeGrowthOutsideUpper0,
      feeGrowthOutside1X128: feeGrowthOutsideUpper1,
    } = await this.getTicks(pool.address, positionDetails.tickUpper);

    // calculate fees
    const counterfactualFees0 = this.getCounterfactualFees(
      feeGrowthGlobal0,
      BigInt(feeGrowthOutsideLower0),
      BigInt(feeGrowthOutsideUpper0),
      BigInt(positionDetails.feeGrowthInside0LastX128),
      pool,
      BigInt(positionDetails.liquidity),
      positionDetails.tickLower,
      positionDetails.tickUpper,
    );
    const counterfactualFees1 = this.getCounterfactualFees(
      feeGrowthGlobal1,
      BigInt(feeGrowthOutsideLower1),
      BigInt(feeGrowthOutsideUpper1),
      BigInt(positionDetails.feeGrowthInside1LastX128),
      pool,
      BigInt(positionDetails.liquidity),
      positionDetails.tickLower,
      positionDetails.tickUpper,
    );

    const tOne = (
      BigInt(positionDetails.tokensOwed0) + counterfactualFees0
    ).toString();
    const tTwo = (
      BigInt(positionDetails.tokensOwed1) + counterfactualFees1
    ).toString();
    return [
      { ...positionDetails.token0, amount: tOne },
      {
        ...positionDetails.token1,
        amount: tTwo,
      },
    ];
  }

  async calculateUncollectedFees(
    position: {
      liquidity: string;
      tickLower: number;
      tickUpper: number;
      feeGrowthInside0LastX128: BigNumberish;
      feeGrowthInside1LastX128: BigNumberish;
      tokensOwed0?: string;
      tokensOwed1?: string;
    },
    pool: {
      address: string;
      tick: number;
      feeGrowthGlobal0X128: BigNumberish;
      feeGrowthGlobal1X128: BigNumberish;
    },
  ) {
    // Early return for positions with zero liquidity
    if (position.liquidity === "0") {
      return {
        token0Fees: position.tokensOwed0 ? BigInt(position.tokensOwed0) : 0n,
        token1Fees: position.tokensOwed1 ? BigInt(position.tokensOwed1) : 0n,
      };
    }

    // Convert to BigInt
    const liquidity = BigInt(position.liquidity);
    const feeGrowthGlobal0X128 = BigInt(pool.feeGrowthGlobal0X128);
    const feeGrowthGlobal1X128 = BigInt(pool.feeGrowthGlobal1X128);
    const feeGrowthInside0LastX128 = BigInt(position.feeGrowthInside0LastX128);
    const feeGrowthInside1LastX128 = BigInt(position.feeGrowthInside1LastX128);

    // Get tick data
    const tickLower = position.tickLower;
    const tickUpper = position.tickUpper;
    const tickCurrent = pool.tick;

    const tickLowerFees = await this.getTicks(pool.address, tickLower);
    const tickHigherFees = await this.getTicks(pool.address, tickUpper);
    // Get fee growth outside values for the position's tick bounds
    const feeGrowthOutsideLower0X128 = BigInt(
      tickLowerFees.feeGrowthOutside0X128,
    );
    const feeGrowthOutsideLower1X128 = BigInt(
      tickLowerFees.feeGrowthOutside1X128,
    );
    const feeGrowthOutsideUpper0X128 = BigInt(
      tickHigherFees.feeGrowthOutside0X128,
    );
    const feeGrowthOutsideUpper1X128 = BigInt(
      tickHigherFees.feeGrowthOutside1X128,
    );

    // Constants

    // Calculate fee growth below the position's range
    let feeGrowthBelow0X128: bigint;
    let feeGrowthBelow1X128: bigint;

    if (tickCurrent >= tickLower) {
      feeGrowthBelow0X128 = feeGrowthOutsideLower0X128;
      feeGrowthBelow1X128 = feeGrowthOutsideLower1X128;
    } else {
      feeGrowthBelow0X128 = subIn256(
        feeGrowthGlobal0X128,
        feeGrowthOutsideLower0X128,
      );
      feeGrowthBelow1X128 = subIn256(
        feeGrowthGlobal1X128,
        feeGrowthOutsideLower1X128,
      );
    }

    // Calculate fee growth above the position's range
    let feeGrowthAbove0X128: bigint;
    let feeGrowthAbove1X128: bigint;

    if (tickCurrent < tickUpper) {
      feeGrowthAbove0X128 = feeGrowthOutsideUpper0X128;
      feeGrowthAbove1X128 = feeGrowthOutsideUpper1X128;
    } else {
      feeGrowthAbove0X128 = subIn256(
        feeGrowthGlobal0X128,
        feeGrowthOutsideUpper0X128,
      );
      feeGrowthAbove1X128 = subIn256(
        feeGrowthGlobal1X128,
        feeGrowthOutsideUpper1X128,
      );
    }

    // Calculate the current fee growth inside the position's range
    const feeGrowthInside0X128 = subIn256(
      subIn256(feeGrowthGlobal0X128, feeGrowthBelow0X128),
      feeGrowthAbove0X128,
    );
    const feeGrowthInside1X128 = subIn256(
      subIn256(feeGrowthGlobal1X128, feeGrowthBelow1X128),
      feeGrowthAbove1X128,
    );

    // Calculate fees accrued since last collection
    const feesToken0 =
      (subIn256(feeGrowthInside0X128, feeGrowthInside0LastX128) * liquidity) /
      Q128;
    const feesToken1 =
      (subIn256(feeGrowthInside1X128, feeGrowthInside1LastX128) * liquidity) /
      Q128;

    // Add existing owed fees if they exist
    const totalUncollected0 =
      feesToken0 + (position.tokensOwed0 ? BigInt(position.tokensOwed0) : 0n);
    const totalUncollected1 =
      feesToken1 + (position.tokensOwed1 ? BigInt(position.tokensOwed1) : 0n);

    return {
      token0Fees: totalUncollected0,
      token1Fees: totalUncollected1,
    };
  }
}
