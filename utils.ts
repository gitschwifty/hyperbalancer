import { PoolData, PositionInfo } from "./abstractClmm";

export const Q128 = 2n ** 128n;
export const MAX_UINT256 = 2n ** 256n - 1n;

export function prettyPrintPosition(
  position: PositionInfo,
  feeZero: bigint,
  feeOne: bigint,
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

  const formattedFees0 = formatTokenAmount(feeZero, position.token0.decimals);

  const formattedFees1 = formatTokenAmount(feeOne, position.token1.decimals);

  return `
    ╭───────────────────────────────────────────────╮
    │  Position ID: ${position.id}${" ".repeat(32 - position.id.length)}│
    ├───────────────────────────────────────────────┤
    │  ${position.token0.symbol}/${position.token1.symbol} (${feeTier}% fee tier)${" ".repeat(32 - position.token0.symbol.length - position.token1.symbol.length - feeTier.toString().length - 1)}│
    │  Liquidity: ${shortenNumber(position.liquidity)}${" ".repeat(35 - shortenNumber(position.liquidity).length - 1)}│
    ├───────────────────────────────────────────────┤
    │  Price Range:${" ".repeat(33)}│
    │    Min (${position.tickLower}): ${minPrice.toFixed(9)}${" ".repeat(35 - minPrice.toFixed(9).length - position.tickLower.toString().length)}│
    │    Max (${position.tickUpper}): ${maxPrice.toFixed(9)}${" ".repeat(35 - maxPrice.toFixed(9).length - position.tickUpper.toString().length)}│
    │    Current (${position.currentTick}): ${currentPrice.toFixed(9)}${" ".repeat(31 - currentPrice.toFixed(9).length - position.currentTick.toString().length)}│
    │${" ".repeat(47)}│
    │  Range Position: ${position.inRange ? "🟢 In Range" : "🔴 Out of Range"}${" ".repeat(23 - (position.inRange ? 5 : 9))}│
    │  ${rangeVisual}${" ".repeat(45 - rangeVisual.length)}│
    │  Position: ${formattedRangePercentage}% through range${" ".repeat(20 - formattedRangePercentage.length)}│
    ├───────────────────────────────────────────────┤
    │  Fees Collectible:${" ".repeat(28)}│
    │    ${position.token0.symbol}: ${formattedFees0}${" ".repeat(41 - position.token0.symbol.length - (formattedFees0.length > 20 ? 20 : formattedFees0.length))}│
    │    ${position.token1.symbol}: ${formattedFees1}${" ".repeat(41 - position.token1.symbol.length - (formattedFees1.length > 20 ? 20 : formattedFees1.length))}│
    ╰───────────────────────────────────────────────╯
    `;
}

function generateRangeVisual(percentage: number): string {
  const width = 30;
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

function formatTokenAmount(
  amount: bigint | string,
  decimals: number,
  precision: number = 9,
): string {
  const amountBigInt = typeof amount === "string" ? BigInt(amount) : amount;

  const divisor = BigInt(10) ** BigInt(decimals);

  const integerPart = amountBigInt / divisor;

  const fractionalPart = amountBigInt % divisor;

  let fractionalStr = fractionalPart.toString();

  fractionalStr = fractionalStr.padStart(decimals, "0");

  fractionalStr = fractionalStr.substring(0, precision);

  if (precision > 0) {
    return `${integerPart}.${fractionalStr}`;
  } else {
    return integerPart.toString();
  }
}

function tickToPrice(
  tick: number,
  token0Decimals: number,
  token1Decimals: number,
): number {
  const price = Math.pow(1.0001, tick);

  const decimalAdjustment = Math.pow(10, token0Decimals - token1Decimals);
  return price * decimalAdjustment;
}

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
  const decimalAdjustment = Math.pow(10, token0Decimals - token1Decimals);
  const adjustedPrice = price / decimalAdjustment;

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
  const nearestValidTick = Math.round(currentTick / tickSpacing) * tickSpacing;

  const halfRange = Math.floor(rangeWidth / 2);
  const tickLower = nearestValidTick - halfRange * tickSpacing;
  const tickUpper = nearestValidTick + halfRange * tickSpacing;

  return { tickLower, tickUpper };
}

export function subIn256(x: bigint, y: bigint): bigint {
  return x >= y ? x - y : MAX_UINT256 - y + x + 1n;
}
