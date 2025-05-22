import * as dotenv from "dotenv";
import { HyperSwapManager } from "./hyperswap";
import { calculateOptimalRange, prettyPrintPosition } from "./utils";
import { KittenswapManager } from "./kittenSwap";

dotenv.config();

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const rpcUrl = process.env.RPC_URL;
  const positionManagerAddress = process.env.POSITION_MANAGER_ADDRESS;
  const walletAddress = process.env.WALLET_ADDRESS;

  if (!rpcUrl || !positionManagerAddress || !walletAddress) {
    console.error("env variables not set");
    process.exit(1);
  }

  console.log("Initializing concentrated liquidity reader...");

  const reader = new HyperSwapManager(rpcUrl);
  const kReader = new KittenswapManager(rpcUrl);

  console.log("Initialized");

  try {
    // cache positions by reader/wallet address somehow (data file? seems not DB rly)
    // also store the last index from balanceOf
    // only read from new positions in getPosForWallet (i.e. pass in the index to start from)
    // remove positions from list/file when liq = 0
    console.time('Get hyperswap positions')
    const positions = await reader.getPositionsForWallet(walletAddress);
    console.timeEnd('Get hyperswap positions')
    console.time('Get kittenswap positions')
    const kPositions = await kReader.getPositionsForWallet(walletAddress);
    console.timeEnd('Get kittenswap positions')

    while (true) {
      for (const p of positions) {
        const pos = await reader.getPosition(p);
        const pool = await reader.getPoolData(
          pos.token0.address,
          pos.token1.address,
          pos.fee,
        );
        const fees = await reader.calculateUncollectedFees(pos, pool);
        console.log(prettyPrintPosition(pos, fees.token0Fees, fees.token1Fees));

        const tickSpacing = await reader.getTickSpacingForFee(pos.fee);

        const { tickLower, tickUpper } = calculateOptimalRange(
          pool.tick,
          tickSpacing,
          10,
        );
        console.log("Optimal Range:", { tickLower, tickUpper });
      }

      for (const p of kPositions) {
        const pos = await kReader.getPosition(p);
        const pool = await kReader.getPoolData(
          pos.token0.address,
          pos.token1.address,
          pos.tickSpacing,
        );
        const fees = await kReader.calculateUncollectedFees(pos, pool);
        console.log(prettyPrintPosition(pos, fees.token0Fees, fees.token1Fees));

        // update this to take current range & recalc based off that?
        // only trigger this for out of range/close to edge
        const { tickLower, tickUpper } = calculateOptimalRange(
          pool.tick,
          pool.tickSpacing,
          10,
        );
        console.log("Optimal Range:", { tickLower, tickUpper });
      }

      await sleep(60000);
    }
  } catch (error) {
    console.error("Error:", error);
  }
}

main().catch(console.error);
