import { BigNumberish, ethers } from "ethers";
import { subIn256, Q128 } from "./utils";

export interface TokenInfo {
  address: string;
  symbol: string;
  decimals: number;
}

export interface TokenAmount extends TokenInfo {
  amount: BigNumberish;
}

export interface PositionInfo {
  id: string;
  token0: TokenInfo;
  token1: TokenInfo;
  fee: number;
  tickSpacing: number;
  tickLower: number;
  tickUpper: number;
  currentTick: number;
  liquidity: string;
  feeGrowthInside0LastX128: BigNumberish;
  feeGrowthInside1LastX128: BigNumberish;
  tokensOwed0: string;
  tokensOwed1: string;
  inRange: boolean;
}

export interface PoolData {
  address: string;
  token0: TokenInfo;
  token1: TokenInfo;
  fee: number;
  tickSpacing: number;
  sqrtPriceX96: BigNumberish;
  tick: number;
  liquidity: string;
  feeGrowthGlobal0X128: BigNumberish;
  feeGrowthGlobal1X128: BigNumberish;
}

export interface AddLiquidityOptions {
  token0: string;
  token1: string;
  fee: number;
  tickLower: number;
  tickUpper: number;
  amount0Desired: BigNumberish;
  amount1Desired: BigNumberish;
  amount0Min: BigNumberish;
  amount1Min: BigNumberish;
  recipient: string;
  deadline: number;
}

export interface RemoveLiquidityOptions {
  tokenId: string;
  liquidity: BigNumberish;
  amount0Min: BigNumberish;
  amount1Min: BigNumberish;
  deadline: number;
}

export interface CollectFeesOptions {
  tokenId: string;
  recipient: string;
  amount0Max: BigNumberish;
  amount1Max: BigNumberish;
}

export interface FeeAmount {
  token0: bigint;
  token1: bigint;
}

export interface PriceRange {
  minPrice: number;
  maxPrice: number;
  currentPrice: number;
}

export interface TickRange {
  tickLower: number;
  tickUpper: number;
}

export const erc20ABI = [
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)",
  "function name() external view returns (string)",
  "function balanceOf(address owner) external view returns (uint256)",
];

export abstract class CLMM {
  provider: ethers.JsonRpcProvider;
  positionManager!: ethers.Contract;
  signer?: ethers.Signer;
  factoryAddress!: string;
  factoryContract!: ethers.Contract;
  poolABI!: string[];

  constructor(rpcUrl: string, signer?: ethers.Signer) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.signer = signer;
  }

  async getTokenInfo(tokenAddress: string): Promise<TokenInfo> {
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

  async getTicks(
    poolAddress: string,
    tick: number,
  ): Promise<{
    feeGrowthOutside0X128: BigNumberish;
    feeGrowthOutside1X128: BigNumberish;
  }> {
    const poolContract = new ethers.Contract(
      poolAddress,
      this.poolABI,
      this.provider,
    );

    const res = await poolContract.ticks(tick);

    return res;
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
    if (position.liquidity === "0") {
      return {
        token0Fees: position.tokensOwed0 ? BigInt(position.tokensOwed0) : 0n,
        token1Fees: position.tokensOwed1 ? BigInt(position.tokensOwed1) : 0n,
      };
    }

    const liquidity = BigInt(position.liquidity);
    const feeGrowthGlobal0X128 = BigInt(pool.feeGrowthGlobal0X128);
    const feeGrowthGlobal1X128 = BigInt(pool.feeGrowthGlobal1X128);
    const feeGrowthInside0LastX128 = BigInt(position.feeGrowthInside0LastX128);
    const feeGrowthInside1LastX128 = BigInt(position.feeGrowthInside1LastX128);

    const tickLower = position.tickLower;
    const tickUpper = position.tickUpper;
    const tickCurrent = pool.tick;

    const tickLowerFees = await this.getTicks(pool.address, tickLower);
    const tickUpperFees = await this.getTicks(pool.address, tickUpper);

    const feeGrowthOutsideLower0X128 = BigInt(
      tickLowerFees.feeGrowthOutside0X128,
    );
    const feeGrowthOutsideLower1X128 = BigInt(
      tickLowerFees.feeGrowthOutside1X128,
    );
    const feeGrowthOutsideUpper0X128 = BigInt(
      tickUpperFees.feeGrowthOutside0X128,
    );
    const feeGrowthOutsideUpper1X128 = BigInt(
      tickUpperFees.feeGrowthOutside1X128,
    );

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

    const feeGrowthInside0X128 = subIn256(
      subIn256(feeGrowthGlobal0X128, feeGrowthBelow0X128),
      feeGrowthAbove0X128,
    );
    const feeGrowthInside1X128 = subIn256(
      subIn256(feeGrowthGlobal1X128, feeGrowthBelow1X128),
      feeGrowthAbove1X128,
    );

    const feesToken0 =
      (subIn256(feeGrowthInside0X128, feeGrowthInside0LastX128) * liquidity) /
      Q128;
    const feesToken1 =
      (subIn256(feeGrowthInside1X128, feeGrowthInside1LastX128) * liquidity) /
      Q128;

    const totalUncollected0 =
      feesToken0 + (position.tokensOwed0 ? BigInt(position.tokensOwed0) : 0n);
    const totalUncollected1 =
      feesToken1 + (position.tokensOwed1 ? BigInt(position.tokensOwed1) : 0n);

    return {
      token0Fees: totalUncollected0,
      token1Fees: totalUncollected1,
    };
  }

  abstract getPosition(positionId: string): Promise<PositionInfo>;
  abstract getPoolData(
    token0: string,
    token1: string,
    fee: number,
  ): Promise<PoolData>;
  abstract addLiquidity(
    options: AddLiquidityOptions,
  ): Promise<ethers.TransactionResponse>;
  abstract removeLiquidity(
    options: RemoveLiquidityOptions,
  ): Promise<ethers.TransactionResponse>;
  abstract collectFees(
    options: CollectFeesOptions,
  ): Promise<ethers.TransactionResponse>;
  // not sure this needs to be abstract
  // abstract calculateUncollectedFees(position: PositionInfo, poolData: PoolData): Promise<FeeAmount>;
  // these are promises bc some (i.e. kittenswap) have possibly mutable fee/tick setups
  abstract getTickSpacingForFee(fee: number): Promise<number>;
  abstract getFeeForTickSpacing(tickSpacing: number): Promise<number>;
}
