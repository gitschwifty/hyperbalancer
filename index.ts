import * as dotenv from "dotenv";
import { HyperSwapManager } from "./hyperswap";
import { calculateOptimalRange, prettyPrintPosition } from "./utils";

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

  console.log("initialized");

  try {
    const positions = await reader.getPositionsForWallet(walletAddress);

    while (true) {
      for (const p of positions) {
        const pos = await reader.getPosition(p.id);
        const pool = await reader.getPoolData(
          pos.token0.address,
          pos.token1.address,
          pos.fee,
        );
        const fees = await reader.calculateUncollectedFees(pos, pool);
        console.log(
          prettyPrintPosition(pos, fees.token0Fees, fees.token1Fees),
        );

        const tickSpacing = await reader.getTickSpacingForFee(pos.fee);
        console.log("Tick Spacing for pool:", tickSpacing);

        const { tickLower, tickUpper } = calculateOptimalRange(
          pool.tick,
          tickSpacing,
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
