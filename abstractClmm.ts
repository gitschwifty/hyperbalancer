import { BigNumberish, ethers } from "ethers";

export interface TokenInfo {
  address: string;
  symbol: string;
  decimals: number;
}

export interface PositionInfo {
  id: string;
  token0: TokenInfo;
  token1: TokenInfo;
  fee: number;
  tickLower: number;
  tickUpper: number;
  currentTick: number;
  liquidity: string;
  feeGrowthInside0x128: BigNumberish;
  feeGrowthInside1x128: BigNumberish;
  tokensOwed0: string;
  tokensOwed1: string;
  inRange: boolean;
}

export interface PoolData {
  address: string;
  token0: TokenInfo;
  token1: TokenInfo;
  fee: number;
  sqrtPriceX96: BigNumberish;
  tick: number;
  liquidity: string;
  feeGrowthGlobal0x128: BigNumberish;
  feeGrowthGlobal1x128: BigNumberish;
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
  signer?: ethers.Signer;

  constructor(rpcUrl: string, signer?: ethers.Signer) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.signer = signer;
  }

  // in implmentations maybe initialize factory/pool/etc contracts in constructor

  abstract getPositionsForWallet(
    walletAddress: string,
  ): Promise<PositionInfo[]>;
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
