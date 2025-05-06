// Concentrated Liquidity Position Reader (TypeScript)
// This code helps read positions and pool data from concentrated liquidity protocols

import { BigNumberish, ethers } from "ethers";
import * as dotenv from "dotenv";

// Load environment variables from .env file
dotenv.config();

// ABI for the NonFungiblePositionManager (Uniswap V3 style)
const positionManagerABI = [
  // Position related functions
  "function positions(uint256 tokenId) external view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
  "function balanceOf(address owner) external view returns (uint256 balance)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) external view returns (uint256 tokenId)",
  // Pool related functions
  "function factory() external view returns (address)",
];

// ABI for the Factory
const factoryABI = [
  "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)",
];

// ABI for the Pool
const poolABI = [
  "function token0() external view returns (address)",
  "function token1() external view returns (address)",
  "function fee() external view returns (uint24)",
  "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function liquidity() external view returns (uint128)",
  "function ticks(int24 tick) external view returns (uint128 liquidityGross, int128 liquidityNet, uint256 feeGrowthOutside0X128, uint256 feeGrowthOutside1X128, int56 tickCumulativeOutside, uint160 secondsPerLiquidityOutsideX128, uint32 secondsOutside, bool initialized)",
  "function feeGrowthGlobal0X128() view returns (uint256)",
  "function feeGrowthGlobal1X128() view returns (uint256)"
];

// ABI for ERC20 tokens
const erc20ABI = [
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)",
  "function name() external view returns (string)",
  "function balanceOf(address owner) external view returns (uint256)",
];

// Enum for tick spacing by fee tier
enum FeeAmount {
  LOWEST = 100, // 0.01%
  LOW = 500, // 0.05%
  MEDIUM = 3000, // 0.3%
  HIGH = 10000, // 1%
}

// Map of fee tiers to their tick spacing
const TICK_SPACINGS: { [key in FeeAmount]: number } = {
  [FeeAmount.LOWEST]: 1,
  [FeeAmount.LOW]: 10,
  [FeeAmount.MEDIUM]: 60,
  [FeeAmount.HIGH]: 200,
};

// Type definitions for position data
interface TokenInfo {
  address: string;
  symbol: string;
  decimals: number;
}

interface PositionInfo {
  tokenId: string;
  token0: TokenInfo;
  token1: TokenInfo;
  fee: number;
  tickLower: number;
  tickUpper: number;
  liquidity: string;
  inRange: boolean;
  currentTick: number;
  tokensOwed0?: string;
  tokensOwed1?: string;
  amount0?: string;
  amount1?: string;
  feeGrowthInside0x128: BigNumberish;
  feeGrowthInside1x128: BigNumberish;
}

interface PoolData {
  address: string;
  sqrtPriceX96: string;
  tick: number;
  liquidity: string;
  token0?: string;
  token1?: string;
  fee?: number;
  feeGrowthGlobal: {
    feeGrowthGlobal0x128: BigNumberish;
    feeGrowthGlobal1x128: BigNumberish;
  }
}

interface TickRange {
  tickLower: number;
  tickUpper: number;
}

class ConcentratedLiquidityReader {
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

  /**
   * Get all positions for a specific wallet address
   */
  async getPositionsForWallet(walletAddress: string): Promise<PositionInfo[]> {
    const balance = await this.positionManager.balanceOf(walletAddress);
    const positions: PositionInfo[] = [];

    for (let i = 0; i < Number(balance); i++) {
      const tokenId = await this.positionManager.tokenOfOwnerByIndex(
        walletAddress,
        i,
      );
      const position = await this.getPosition(tokenId);
      if (position.liquidity !== '0') {
        positions.push({
            ...position,
            tokenId: tokenId.toString(),
        });
      }
    }

    return positions;
  }

  /**
   * Get details for a specific position by tokenId
   */
  async getPosition(tokenId: string | bigint): Promise<PositionInfo> {
    const positionData = await this.positionManager.positions(tokenId);

    // Get pool info
    const factoryAddress = await this.positionManager.factory();
    const factory = new ethers.Contract(
      factoryAddress,
      factoryABI,
      this.provider,
    );
    const poolAddress = await factory.getPool(
      positionData.token0,
      positionData.token1,
      positionData.fee,
    );
    const pool = new ethers.Contract(poolAddress, poolABI, this.provider);

    // Get current price and tick
    const slot0 = await pool.slot0();
    const currentTick = Number(slot0.tick);

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

    return {
      tokenId: typeof tokenId === "string" ? tokenId : tokenId.toString(),
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
    };
  }

  /**
   * Get pool data for a pair
   */
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
      feeGrowthGlobal: {
        feeGrowthGlobal0x128,
        feeGrowthGlobal1x128
      }
    };
  }

  /**
   * Calculate the optimal tick range for a position based on current price and desired width
   * @param currentTick The current tick from the pool
   * @param tickSpacing The tick spacing for the fee tier
   * @param rangeWidth The width of the range in terms of tick spacing units
   */
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

    /**
   * Calculate the price from a tick value
   * @param tick The tick value
   * @param token0Decimals Decimals for token0
   * @param token1Decimals Decimals for token1
   * @returns The price of token1 in terms of token0
   */
    tickToPrice(tick: number, token0Decimals: number, token1Decimals: number): number {
        // Price = 1.0001^tick
        const price = Math.pow(1.0001, tick);
        
        // Adjust for decimal differences
        const decimalAdjustment = Math.pow(10, token0Decimals - token1Decimals);
        return price * decimalAdjustment;
      }
    
      /**
       * Calculate the current price range for a position
       * @param position The position info object
       * @returns An object with min and max prices
       */
      getPositionPriceRange(position: PositionInfo): { minPrice: number; maxPrice: number } {
        const lowerPrice = this.tickToPrice(
          position.tickLower, 
          position.token0.decimals, 
          position.token1.decimals
        );
        
        const upperPrice = this.tickToPrice(
          position.tickUpper, 
          position.token0.decimals, 
          position.token1.decimals
        );
        
        return {
          minPrice: lowerPrice,
          maxPrice: upperPrice
        };
      }
    
      /**
       * Create a pretty display for a position
       * @param position The position to display
       * @returns Formatted string with position details
       */
      prettyPrintPosition(position: PositionInfo, poolData: PoolData): string {
        // Calculate current price
        const currentPrice = this.tickToPrice(
          position.currentTick,
          position.token0.decimals,
          position.token1.decimals
        );
        
        // Calculate price range
        const { minPrice, maxPrice } = this.getPositionPriceRange(position);
    
        // Calculate how far the current price is into the range (as a percentage)
        let rangePercentage = 0;
        if (position.inRange) {
          rangePercentage = ((currentPrice - minPrice) / (maxPrice - minPrice)) * 100;
        } else if (position.currentTick < position.tickLower) {
          rangePercentage = 0; // Below range
        } else {
          rangePercentage = 100; // Above range
        }
        
        // Format the range percentage to 2 decimal places
        const formattedRangePercentage = rangePercentage.toFixed(2);
        
        // Get fee tier as a percentage
        const feeTier = position.fee / 10000; // Convert from basis points to percentage
        
        // Format fees owed
        const tokensOwed0 = position.tokensOwed0 
          ? this.formatTokenAmount(position.tokensOwed0, position.token0.decimals)
          : '0';
        const tokensOwed1 = position.tokensOwed1
          ? this.formatTokenAmount(position.tokensOwed1, position.token1.decimals)
          : '0';
        
        // Generate a visual representation of where in the range the current price is
        const rangeVisual = this.generateRangeVisual(rangePercentage);

        // Calculate fee growth since last collection
        const feeGrowthDelta0 = poolData.feeGrowthGlobal.feeGrowthGlobal0x128.sub(position.feeGrowthInside0x128);
        const feeGrowthDelta1 = poolData.feeGrowthGlobal.feeGrowthGlobal1X128.sub(feeGrowthInside.feeGrowthInside1X128);
    
        // Calculate uncollected fees (from fee growth)
        const Q128 = ethers.BigNumber.from(2).pow(128);
    
        const uncollectedFees0 = position.liquidity.mul(feeGrowthDelta0).div(Q128);
        const uncollectedFees1 = position.liquidity.mul(feeGrowthDelta1).div(Q128);
        
        // Format all the information
        return `
    ╭───────────────────────────────────────────────╮
    │  Position ID: ${position.tokenId.padEnd(35 - position.tokenId.length)}  │
    ├───────────────────────────────────────────────┤
    │  ${position.token0.symbol}/${position.token1.symbol} (${feeTier}% fee tier)${' '.repeat(32 - position.token0.symbol.length - position.token1.symbol.length - feeTier.toString().length - 1)}│
    │  Liquidity: ${this.shortenNumber(position.liquidity)}${' '.repeat(35 - this.shortenNumber(position.liquidity).length - 1)}│
    ├───────────────────────────────────────────────┤
    │  Price Range:${' '.repeat(33)}│
    │    Min (${position.tickLower}): ${minPrice.toFixed(9)}${' '.repeat(28 - minPrice.toFixed(9).length)}│
    │    Max (${position.tickUpper}): ${maxPrice.toFixed(9)}${' '.repeat(28 - maxPrice.toFixed(9).length)}│
    │    Current (${position.currentTick}): ${currentPrice.toFixed(9)}${' '.repeat(24 - currentPrice.toFixed(9).length)}│
    │${' '.repeat(47)}│
    │  Range Position: ${position.inRange ? '🟢 In Range' : '🔴 Out of Range'}${' '.repeat(23 - (position.inRange ? 5 : 8))}│
    │  ${rangeVisual}${' '.repeat(45 - rangeVisual.length)}│
    │  Position: ${formattedRangePercentage}% through range${' '.repeat(20 - formattedRangePercentage.length)}│
    ├───────────────────────────────────────────────┤
    │  Fees Collectible:${' '.repeat(28)}│
    │    ${position.token0.symbol}: ${tokensOwed0}${' '.repeat(41 - position.token0.symbol.length - tokensOwed0.length)}│
    │    ${position.token1.symbol}: ${tokensOwed1}${' '.repeat(41 - position.token1.symbol.length - tokensOwed1.length)}│
    ╰───────────────────────────────────────────────╯
    `;
      }
    
      /**
       * Generate a visual representation of the position's range
       * @param percentage The percentage through the range (0-100)
       * @returns A string with a visual bar representation
       */
      private generateRangeVisual(percentage: number): string {
        const width = 30; // Width of the visual bar
        const pos = Math.floor((percentage / 100) * width);
        
        let bar = '  [';
        for (let i = 0; i < width; i++) {
          if (i === pos) {
            bar += '●';
          } else {
            bar += '─';
          }
        }
        bar += ']';
        
        return bar;
      }
      
      /**
       * Shorten a large number for display purposes
       * @param num The number as a string or BigInt
       * @returns Shortened representation (e.g., 1.23M)
       */
      private shortenNumber(num: string | bigint): string {
        const numStr = typeof num === 'bigint' ? num.toString() : num;
        const value = parseFloat(numStr);
        
        if (value >= 1e9) {
          return (value / 1e9).toFixed(2) + 'B';
        } else if (value >= 1e6) {
          return (value / 1e6).toFixed(2) + 'M';
        } else if (value >= 1e3) {
          return (value / 1e3).toFixed(2) + 'K';
        } else {
          return value.toString();
        }
      }

  /**
   * Format a token amount for display based on decimals
   * @param amount The token amount as a BigInt or string
   * @param decimals The number of decimals for the token
   * @param precision Optional precision for display (default: 6)
   */
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

  /**
   * Get the tick spacing for a given fee amount
   */
  getTickSpacingForFee(fee: number): number {
    // Convert basis points to percentage representation used in the enum
    const feeAmount = fee as FeeAmount;
    if (feeAmount in TICK_SPACINGS) {
      return TICK_SPACINGS[feeAmount];
    }
    throw new Error(`Unknown fee amount: ${fee}`);
  }
}

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

  const reader = new ConcentratedLiquidityReader(
    rpcUrl,
    positionManagerAddress,
  );

  console.log("initialized")

  try {
    // Get all positions for a wallet
    // const positions = await reader.getPositionsForWallet(walletAddress);
    // positions.forEach(pos => console.log(reader.prettyPrintPosition(pos)));

    const rubPos = await reader.getPosition('34258');
    const poolData = await reader.getPoolData(
        "0x5555555555555555555555555555555555555555", // HYPE
        "0x7DCfFCb06B40344eecED2d1Cbf096B299fE4b405", // RUB
        10000, // 0.3% fee tier
    );
    console.log(reader.prettyPrintPosition(rubPos, poolData))


    console.log("Pool Data:", poolData);

    // Get tick spacing for the fee
    const tickSpacing = reader.getTickSpacingForFee(10000);
    console.log("Tick Spacing for 1% pool:", tickSpacing);

    // Calculate optimal range for a new position
    const { tickLower, tickUpper } = reader.calculateOptimalRange(
      poolData.tick,
      tickSpacing,
      10, // width in tick spacings (adjust as needed)
    );
    console.log("Optimal Range:", { tickLower, tickUpper });

    // Example of formatting a token amount
    const exampleAmount = BigInt("1234567890000000000"); // 1.23456789 ETH
    const formatted = reader.formatTokenAmount(exampleAmount, 18, 6);
    console.log("Formatted amount:", formatted);
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
