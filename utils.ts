import { BigNumberish } from "ethers";
import { PoolData, PositionInfo } from "./abstractClmm";

/**
 * Create a pretty display for a position
 * @param position The position to display
 * @returns Formatted string with position details
 */
export function prettyPrintPosition(
  position: PositionInfo,
  poolData: PoolData,
): string {
  const currentPrice = tickToPrice(
    position.currentTick,
    position.token0.decimals,
    position.token1.decimals,
  );

  const { minPrice, maxPrice } = getPositionPriceRange(position);

  let rangePercentage = 0;
  if (position.inRange) {
    rangePercentage = ((currentPrice - minPrice) / (maxPrice - minPrice)) * 100;
  } else if (position.currentTick < position.tickLower) {
    rangePercentage = 0;
  } else {
    rangePercentage = 100;
  }

  const formattedRangePercentage = rangePercentage.toFixed(2);

  const feeTier = position.fee / 10000;

  const rangeVisual = generateRangeVisual(rangePercentage);

  const { token0Fees, token1Fees } = calculateUncollectedFees(
    position,
    poolData,
  );

  const formattedFees0 = formatTokenAmount(
    token0Fees,
    position.token0.decimals,
  );
  const formattedFees1 = formatTokenAmount(
    token1Fees,
    position.token1.decimals,
  );

  // Format all the information
  return `
    ╭───────────────────────────────────────────────╮
    │  Position ID: ${position.id.padEnd(34 - position.id.length)}  │
    ├───────────────────────────────────────────────┤
    │  ${position.token0.symbol}/${position.token1.symbol} (${feeTier}% fee tier)${" ".repeat(32 - position.token0.symbol.length - position.token1.symbol.length - feeTier.toString().length - 1)}│
    │  Liquidity: ${shortenNumber(position.liquidity)}${" ".repeat(35 - shortenNumber(position.liquidity).length - 1)}│
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

/**
 * Generate a visual representation of the position's range
 * @param percentage The percentage through the range (0-100)
 * @returns A string with a visual bar representation
 */
function generateRangeVisual(percentage: number): string {
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

/**
 * Shorten a large number for display purposes
 * @param num The number as a string or BigInt
 * @returns Shortened representation (e.g., 1.23M)
 */
function shortenNumber(num: string | bigint): string {
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

/**
 * Format a token amount for display based on decimals
 * @param amount The token amount as a BigInt or string
 * @param decimals The number of decimals for the token
 * @param precision Optional precision for display (default: 6)
 */
function formatTokenAmount(
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
 * Calculate the price from a tick value
 * @param tick The tick value
 * @param token0Decimals Decimals for token0
 * @param token1Decimals Decimals for token1
 * @returns The price of token1 in terms of token0
 */
function tickToPrice(
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

/**
 * Calculate the current price range for a position
 * @param position The position info object
 * @returns An object with min and max prices
 */
export function getPositionPriceRange(position: PositionInfo): {
  minPrice: number;
  maxPrice: number;
} {
  const lowerPrice = tickToPrice(
    position.tickLower,
    position.token0.decimals,
    position.token1.decimals,
  );

  const upperPrice = tickToPrice(
    position.tickUpper,
    position.token0.decimals,
    position.token1.decimals,
  );

  return {
    minPrice: lowerPrice,
    maxPrice: upperPrice,
  };
}

export function priceToTick(
  price: number,
  token0Decimals: number,
  token1Decimals: number,
): number {
  // Adjust for decimal differences
  const decimalAdjustment = Math.pow(10, token0Decimals - token1Decimals);
  const adjustedPrice = price / decimalAdjustment;

  // Tick = log(price) / log(1.0001)
  return Math.floor(Math.log(adjustedPrice) / Math.log(1.0001));
}

export function calculateOptimalRange(
  currentTick: number,
  tickSpacing: number,
  rangeWidth: number,
): {
  tickLower: number;
  tickUpper: number;
} {
  // Round current tick to nearest valid tick based on spacing
  const nearestValidTick = Math.round(currentTick / tickSpacing) * tickSpacing;

  // Calculate range boundaries
  const halfRange = Math.floor(rangeWidth / 2);
  const tickLower = nearestValidTick - halfRange * tickSpacing;
  const tickUpper = nearestValidTick + halfRange * tickSpacing;

  return { tickLower, tickUpper };
}

// this is possibly incorrect and/or impl specific but put it here for rn
function calculateUncollectedFees(
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
  const feeGrowthGlobal0 = BigInt(poolData.feeGrowthGlobal0x128.toString());
  const feeGrowthGlobal1 = BigInt(poolData.feeGrowthGlobal1x128.toString());
  const feeGrowthInside0 = BigInt(position.feeGrowthInside0x128.toString());
  const feeGrowthInside1 = BigInt(position.feeGrowthInside1x128.toString());

  // Calculate fee growth delta
  const feeGrowthDelta0 = feeGrowthGlobal0 - feeGrowthInside0;
  const feeGrowthDelta1 = feeGrowthGlobal1 - feeGrowthInside1;

  // Q128 constant for division
  const Q128 = 2n ** 128n;
  console.log(liquidityBI);
  console.log(feeGrowthDelta0);
  console.log(feeGrowthDelta1);

  // Calculate uncollected fees
  const uncollectedFees0 = (liquidityBI * feeGrowthDelta0) / Q128;
  const uncollectedFees1 = (liquidityBI * feeGrowthDelta1) / Q128;

  console.log(uncollectedFees0);
  console.log(uncollectedFees1);

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
