// Concentrated Liquidity Position Reader
// This code helps read positions and pool data from concentrated liquidity protocols

const { ethers } = require("ethers");

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
];

// ABI for ERC20 tokens
const erc20ABI = [
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)",
  "function name() external view returns (string)",
];

class ConcentratedLiquidityReader {
  constructor(rpcUrl, positionManagerAddress) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl); // Updated for ethers v6
    this.positionManager = new ethers.Contract(
      positionManagerAddress,
      positionManagerABI,
      this.provider,
    );
  }

  /**
   * Get all positions for a specific wallet address
   */
  async getPositionsForWallet(walletAddress) {
    const balance = await this.positionManager.balanceOf(walletAddress);
    const positions = [];

    for (let i = 0; i < balance; i++) {
      const tokenId = await this.positionManager.tokenOfOwnerByIndex(
        walletAddress,
        i,
      );
      const position = await this.getPosition(tokenId);
      if (position.liquidity !== "0") {
        positions.push({
          tokenId: tokenId.toString(),
          ...position,
        });
      }
    }

    return positions;
  }

  /**
   * Get details for a specific position by tokenId
   */
  async getPosition(tokenId) {
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
    const currentTick = slot0.tick;

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
      currentTick >= positionData.tickLower &&
      currentTick <= positionData.tickUpper;

    return {
      token0: {
        address: positionData.token0,
        symbol: symbol0,
        decimals: decimals0,
      },
      token1: {
        address: positionData.token1,
        symbol: symbol1,
        decimals: decimals1,
      },
      fee: positionData.fee,
      tickLower: positionData.tickLower,
      tickUpper: positionData.tickUpper,
      liquidity: positionData.liquidity.toString(),
      inRange,
      currentTick,
    };
  }

  /**
   * Get pool data for a pair
   */
  async getPoolData(token0Address, token1Address, fee) {
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

    return {
      address: poolAddress,
      sqrtPriceX96: slot0.sqrtPriceX96.toString(),
      tick: slot0.tick,
      liquidity: liquidity.toString(),
    };
  }

  /**
   * Calculate the optimal tick range for a position based on current price and desired width
   */
  calculateOptimalRange(currentTick, tickSpacing, rangeWidth) {
    // Convert inputs to BigInt or Number to avoid type mixing
    const currentTickNum = Number(currentTick);
    const tickSpacingNum = Number(tickSpacing);
    const rangeWidthNum = Number(rangeWidth);

    // Round the current tick to the nearest valid tick based on tickSpacing
    const nearestValidTick =
      Math.round(currentTickNum / tickSpacingNum) * tickSpacingNum;

    // Calculate the tick range
    const halfRange = Math.floor(rangeWidthNum / 2);
    const tickLower = nearestValidTick - halfRange * tickSpacingNum;
    const tickUpper = nearestValidTick + halfRange * tickSpacingNum;

    return { tickLower, tickUpper };
  }
}

// Example usage
async function main() {
  const rpcUrl = "https://rpc.hyperliquid.xyz/evm";
  const positionManagerAddress = "0x6eDA206207c09e5428F281761DdC0D300851fBC8"; // hyperswap pos mgr addy for now
  const walletAddress = "0x51546d4Fe66E33778EEfb45505a8d59f0eCaD4E7";

  console.log("Initializing concentrated liquidity reader...");

  const reader = new ConcentratedLiquidityReader(
    rpcUrl,
    positionManagerAddress,
  );

  console.log("Initialized");

  try {
    // Get all positions for a wallet
    const positions = await reader.getPositionsForWallet(walletAddress);
    console.log("Positions:", positions);

    const poolData = await reader.getPoolData(
      "0x5555555555555555555555555555555555555555", // HYPE
      "0x7DCfFCb06B40344eecED2d1Cbf096B299fE4b405", // RUB
      10000, // 0.3% fee tier
    );
    console.log("Pool Data:", poolData);

    /*
    0.01% fee tier: 1 tick spacing 100
    0.05% fee tier: 10 tick spacing 500
    0.3% fee tier: 60 tick spacing 3000
    1% fee tier: 200 tick spacing, 10000
    */

    // Calculate optimal range for a new position
    const { tickLower, tickUpper } = reader.calculateOptimalRange(
      poolData.tick,
      200, // tick spacing for 0.3% pools
      10, // width in tick spacings (adjust as needed)
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
