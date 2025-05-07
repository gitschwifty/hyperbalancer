// Concentrated Liquidity Position Reader (TypeScript)
// This code helps read positions and pool data from concentrated liquidity protocols

import { BigNumberish, ethers } from "ethers";
import * as dotenv from "dotenv";
import { PositionInfo, PoolData, TickRange } from "./abstractClmm";
import { HyperSwapManager } from "./hyperswap";
import { calculateOptimalRange, prettyPrintPosition } from "./utils";

// Load environment variables from .env file
dotenv.config();

// ABI for the NonFungiblePositionManager (Uniswap V3 style)
const kittenswapPositionManagerABI = [
  // Position related functions
  "function positions(uint256 tokenId) external view returns (uint96 nonce, address operator, address token0, address token1, uint24 tickSpacing, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
  "function balanceOf(address owner) external view returns (uint256 balance)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) external view returns (uint256 tokenId)",
  // Pool related functions
  "function factory() external view returns (address)",
];

/* class ConcentratedLiquidityReader {
  private provider: ethers.JsonRpcProvider;
  private positionManager: ethers.Contract;

  constructor(rpcUrl: string, positionManagerAddress: string) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.positionManager = new ethers.Contract(
      positionManagerAddress,
      positionManagerABI,
      this.provider,
    );
  }

  async getPositionsForWallet(walletAddress: string): Promise<[PositionInfo, PoolData][]> {
    const balance = await this.positionManager.balanceOf(walletAddress);
    const positions: [PositionInfo, PoolData][] = [];

    for (let i = 0; i < Number(balance); i++) {
      const tokenId = await this.positionManager.tokenOfOwnerByIndex(
        walletAddress,
        i,
      );
      const position = await this.getPosition(tokenId);
      if (position && position[0].liquidity !== "0") {
        positions.push([{
          ...position[0],
          id: tokenId.toString(),
        }, position[1]]);
      }
    }

    return positions;
  }

  async getPosition(tokenId: string | bigint, zeroLiq: boolean = false): Promise<[PositionInfo, PoolData] | null> {
    console.log(tokenId)
    const positionData = await this.positionManager.positions(tokenId);

    if (positionData.liquidity.toString() === "0" && !zeroLiq) {
      return null;
    }

    console.log(positionData)

    // Get pool info
    const factoryAddress = await this.positionManager.factory();
    const factory = new ethers.Contract(
      factoryAddress,
      factoryABI,
      this.provider,
    );

    console.log(factoryAddress)

    // const fee = await factory.tickSpacingToFee(positionData.tickSpacing);
    // console.log(fee)

    const poolData = await this.getPoolData(positionData.token0, positionData.token1, positionData.fee);
    console.log(poolData)
    const poolAddress = await factory.getPool(
      positionData.token0,
      positionData.token1,
      positionData.fee,
    );

    const currentTick = poolData.tick;

    // Get token info
    const token0 = new ethers.Contract(
      positionData.token0,
      erc20ABI,
      this.provider,
    );
    const token1 = new ethers.Contract(
      positionData.token1,
      erc20ABI,
      this.provider,
    );

    const [symbol0, symbol1, decimals0, decimals1] = await Promise.all([
      token0.symbol(),
      token1.symbol(),
      token0.decimals(),
      token1.decimals(),
    ]);

    // Calculate position status
    const inRange =
      currentTick >= Number(positionData.tickLower) &&
      currentTick <= Number(positionData.tickUpper);

    return [{
      id: typeof tokenId === "string" ? tokenId : tokenId.toString(),
      token0: {
        address: positionData.token0,
        symbol: symbol0,
        decimals: Number(decimals0),
      },
      token1: {
        address: positionData.token1,
        symbol: symbol1,
        decimals: Number(decimals1),
      },
      fee: Number(positionData.fee),
      tickLower: Number(positionData.tickLower),
      tickUpper: Number(positionData.tickUpper),
      liquidity: positionData.liquidity.toString(),
      inRange,
      currentTick,
      tokensOwed0: positionData.tokensOwed0.toString(),
      tokensOwed1: positionData.tokensOwed1.toString(),
      feeGrowthInside0x128: positionData.feeGrowthInside0LastX128,
      feeGrowthInside1x128: positionData.feeGrowthInside1LastX128,
    }, poolData];
  }

  async getPoolData(
    token0Address: string,
    token1Address: string,
    fee: number,
  ): Promise<PoolData> {
    const factoryAddress = await this.positionManager.factory();
    const factory = new ethers.Contract(
      factoryAddress,
      factoryABI,
      this.provider,
    );
    const poolAddress = await factory.getPool(
      token0Address,
      token1Address,
      fee,
    );

    console.log(poolAddress)

    if (poolAddress === ethers.ZeroAddress) {
      throw new Error("Pool does not exist");
    }

    const pool = new ethers.Contract(poolAddress, poolABI, this.provider);
    const slot0 = await pool.slot0();
    const liquidity = await pool.liquidity();
    const feeGrowthGlobal0x128 = await pool.feeGrowthGlobal0X128();
    const feeGrowthGlobal1x128 = await pool.feeGrowthGlobal1X128();

    // Also get the token0 and token1 from the pool to confirm order
    const actualToken0 = await pool.token0();
    const actualToken1 = await pool.token1();
    const actualFee = await pool.fee();

    return {
      address: poolAddress,
      sqrtPriceX96: slot0.sqrtPriceX96.toString(),
      tick: Number(slot0.tick),
      liquidity: liquidity.toString(),
      token0: actualToken0,
      token1: actualToken1,
      fee: Number(actualFee),
        feeGrowthGlobal0x128,
        feeGrowthGlobal1x128,
    };
  }


  calculateOptimalRange(
    currentTick: number | bigint,
    tickSpacing: number | bigint,
    rangeWidth: number,
  ): TickRange {
    // Convert to numbers for calculations
    const currentTickNum = Number(currentTick);
    const tickSpacingNum = Number(tickSpacing);

    // Round the current tick to the nearest valid tick based on tickSpacing
    const nearestValidTick =
      Math.round(currentTickNum / tickSpacingNum) * tickSpacingNum;

    // Calculate the tick range
    const halfRange = Math.floor(rangeWidth / 2);
    const tickLower = nearestValidTick - halfRange * tickSpacingNum;
    const tickUpper = nearestValidTick + halfRange * tickSpacingNum;

    return { tickLower, tickUpper };
  }

  tickToPrice(
    tick: number,
    token0Decimals: number,
    token1Decimals: number,
  ): number {
    // Price = 1.0001^tick
    const price = Math.pow(1.0001, tick);

    // Adjust for decimal differences
    const decimalAdjustment = Math.pow(10, token0Decimals - token1Decimals);
    return price * decimalAdjustment;
  }

  getPositionPriceRange(position: PositionInfo): {
    minPrice: number;
    maxPrice: number;
  } {
    const lowerPrice = this.tickToPrice(
      position.tickLower,
      position.token0.decimals,
      position.token1.decimals,
    );

    const upperPrice = this.tickToPrice(
      position.tickUpper,
      position.token0.decimals,
      position.token1.decimals,
    );

    return {
      minPrice: lowerPrice,
      maxPrice: upperPrice,
    };
  }


  calculateUncollectedFees(
    position: {
      liquidity: string;
      feeGrowthInside0x128: BigNumberish;
      feeGrowthInside1x128: BigNumberish;
      tokensOwed0?: string;
      tokensOwed1?: string;
    },
    poolData: {
        feeGrowthGlobal0x128: BigNumberish;
        feeGrowthGlobal1x128: BigNumberish;
    },
  ) {
    // Convert string liquidity to BigInt
    const liquidityBI = BigInt(position.liquidity);

    // Convert fee growth values to BigInt
    const feeGrowthGlobal0 = BigInt(
      poolData.feeGrowthGlobal0x128.toString(),
    );
    const feeGrowthGlobal1 = BigInt(
      poolData.feeGrowthGlobal1x128.toString(),
    );
    const feeGrowthInside0 = BigInt(position.feeGrowthInside0x128.toString());
    const feeGrowthInside1 = BigInt(position.feeGrowthInside1x128.toString());

    // Calculate fee growth delta
    const feeGrowthDelta0 = feeGrowthGlobal0 - feeGrowthInside0;
    const feeGrowthDelta1 = feeGrowthGlobal1 - feeGrowthInside1;

    // Q128 constant for division
    const Q128 = 2n ** 128n;
    console.log(liquidityBI)
    console.log(feeGrowthDelta0)
    console.log(feeGrowthDelta1)

    // Calculate uncollected fees
    const uncollectedFees0 = (liquidityBI * feeGrowthDelta0) / Q128;
    const uncollectedFees1 = (liquidityBI * feeGrowthDelta1) / Q128;

    console.log(uncollectedFees0)
    console.log(uncollectedFees1)

    // Add existing owed fees if they exist
    const totalUncollected0 =
      uncollectedFees0 +
      (position.tokensOwed0 ? BigInt(position.tokensOwed0) : 0n);
    const totalUncollected1 =
      uncollectedFees1 +
      (position.tokensOwed1 ? BigInt(position.tokensOwed1) : 0n);

    return {
      token0Fees: totalUncollected0,
      token1Fees: totalUncollected1,
    };
  }


  formatTokenFees(amount: bigint, decimals: number): string {
    const divisor = BigInt(10) ** BigInt(decimals);
    const integerPart = amount / divisor;
    const fractionalPart = amount % divisor;

    // Format with the proper number of decimal places
    const fractionalStr = fractionalPart.toString().padStart(decimals, "0");

    // Trim trailing zeros
    const trimmedFractional = fractionalStr.replace(/0+$/, "");

    if (trimmedFractional.length === 0) {
      return integerPart.toString();
    }

    return `${integerPart}.${trimmedFractional}`;
  }


  prettyPrintPosition(position: PositionInfo, poolData: PoolData): string {
    const currentPrice = this.tickToPrice(
      position.currentTick,
      position.token0.decimals,
      position.token1.decimals,
    );

    const { minPrice, maxPrice } = this.getPositionPriceRange(position);

    let rangePercentage = 0;
    if (position.inRange) {
      rangePercentage =
        ((currentPrice - minPrice) / (maxPrice - minPrice)) * 100;
    } else if (position.currentTick < position.tickLower) {
      rangePercentage = 0;
    } else {
      rangePercentage = 100;
    }

    const formattedRangePercentage = rangePercentage.toFixed(2);

    const feeTier = position.fee / 10000;

    const rangeVisual = this.generateRangeVisual(rangePercentage);

    const { token0Fees, token1Fees } = this.calculateUncollectedFees(position, poolData);

    const formattedFees0 = this.formatTokenAmount(token0Fees, position.token0.decimals);
    const formattedFees1 = this.formatTokenAmount(token1Fees, position.token1.decimals);

    // Format all the information
    return `
    ╭───────────────────────────────────────────────╮
    │  Position ID: ${position.id.padEnd(34 - position.id.length)}  │
    ├───────────────────────────────────────────────┤
    │  ${position.token0.symbol}/${position.token1.symbol} (${feeTier}% fee tier)${" ".repeat(32 - position.token0.symbol.length - position.token1.symbol.length - feeTier.toString().length - 1)}│
    │  Liquidity: ${this.shortenNumber(position.liquidity)}${" ".repeat(35 - this.shortenNumber(position.liquidity).length - 1)}│
    ├───────────────────────────────────────────────┤
    │  Price Range:${" ".repeat(33)}│
    │    Min (${position.tickLower}): ${minPrice.toFixed(9)}${" ".repeat(29 - minPrice.toFixed(9).length)}│
    │    Max (${position.tickUpper}): ${maxPrice.toFixed(9)}${" ".repeat(29 - maxPrice.toFixed(9).length)}│
    │    Current (${position.currentTick}): ${currentPrice.toFixed(9)}${" ".repeat(25 - currentPrice.toFixed(9).length)}│
    │${" ".repeat(47)}│
    │  Range Position: ${position.inRange ? "🟢 In Range" : "🔴 Out of Range"}${" ".repeat(23 - (position.inRange ? 5 : 8))}│
    │  ${rangeVisual}${" ".repeat(45 - rangeVisual.length)}│
    │  Position: ${formattedRangePercentage}% through range${" ".repeat(20 - formattedRangePercentage.length)}│
    ├───────────────────────────────────────────────┤
    │  Fees Collectible:${" ".repeat(28)}│
    │    ${position.token0.symbol}: ${formattedFees0}${" ".repeat(41 - position.token0.symbol.length - formattedFees0.length)}│
    │    ${position.token1.symbol}: ${formattedFees1}${" ".repeat(41 - position.token1.symbol.length - formattedFees1.length)}│
    ╰───────────────────────────────────────────────╯
    `;
  }

  private generateRangeVisual(percentage: number): string {
    const width = 30; // Width of the visual bar
    const pos = Math.floor((percentage / 100) * width);

    let bar = "  [";
    for (let i = 0; i < width; i++) {
      if (i === pos) {
        bar += "●";
      } else {
        bar += "─";
      }
    }
    bar += "]";

    return bar;
  }

  private shortenNumber(num: string | bigint): string {
    const numStr = typeof num === "bigint" ? num.toString() : num;
    const value = parseFloat(numStr);

    if (value >= 1e9) {
      return (value / 1e9).toFixed(2) + "B";
    } else if (value >= 1e6) {
      return (value / 1e6).toFixed(2) + "M";
    } else if (value >= 1e3) {
      return (value / 1e3).toFixed(2) + "K";
    } else {
      return value.toString();
    }
  }

  formatTokenAmount(
    amount: bigint | string,
    decimals: number,
    precision: number = 6,
  ): string {
    const amountBigInt = typeof amount === "string" ? BigInt(amount) : amount;
    const divisor = BigInt(10) ** BigInt(decimals);
    const integerPart = amountBigInt / divisor;

    // Calculate the fractional part with proper precision
    const fractionalDivisor = BigInt(10) ** BigInt(precision);
    const fractionalMultiplier = BigInt(10) ** BigInt(decimals - precision);
    let fractionalPart = (amountBigInt % divisor) / fractionalMultiplier;

    // Format with proper precision
    const fractionalStr = fractionalPart.toString().padStart(precision, "0");

    return `${integerPart}.${fractionalStr}`;
  }

  getTickSpacingForFee(fee: number): number {
    // Convert basis points to percentage representation used in the enum
    const feeAmount = fee as FeeAmount;
    if (feeAmount in TICK_SPACINGS) {
      return TICK_SPACINGS[feeAmount];
    }
    throw new Error(`Unknown fee amount: ${fee}`);
  }
} */

// Example usage
async function main() {
  // Get configuration from environment variables
  const rpcUrl = process.env.RPC_URL;
  const positionManagerAddress = process.env.POSITION_MANAGER_ADDRESS;
  const walletAddress = process.env.WALLET_ADDRESS;

  if (!rpcUrl || !positionManagerAddress || !walletAddress) {
    console.error("env variables not set");
    process.exit(1);
  }

  console.log("Initializing concentrated liquidity reader...");

  const reader = new HyperSwapManager(rpcUrl);

  console.log("initialized");

  try {
    // Get all positions for a wallet
    // const positions = (await reader.getPositionsForWallet(walletAddress));
    // positions.forEach(pos => console.log(reader.prettyPrintPosition(pos[0], pos[1])));

    const pos = await reader.getPosition("2089");
    const poolData = await reader.getPoolData(
      pos.token0.address,
      pos.token1.address,
      pos.fee,
    );
    console.log(prettyPrintPosition(pos, poolData));

    console.log("Position:", pos);
    console.log("Pool Data:", poolData);

    // Get tick spacing for the fee
    const tickSpacing = await reader.getTickSpacingForFee(pos.fee);
    console.log("Tick Spacing for pool:", tickSpacing);

    // Calculate optimal range for a new position
    const { tickLower, tickUpper } = calculateOptimalRange(
      poolData.tick,
      tickSpacing,
      10,
    );
    console.log("Optimal Range:", { tickLower, tickUpper });
  } catch (error) {
    console.error("Error:", error);
  }
}

// To use this code, replace the placeholder values and run the main function
main().catch(console.error);

// For the auto-rebalancer, you'll need to implement additional functions to:
// 1. Monitor price movements
// 2. Determine when a position should be rebalanced
// 3. Execute the rebalancing transactions
