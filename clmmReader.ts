import * as dotenv from "dotenv";
import { HyperSwapManager } from "./hyperswap";
import { calculateOptimalRange, prettyPrintPosition } from "./utils";

dotenv.config();

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
    await positions.forEach(async (pos) => {
      const pool = await reader.getPoolData(
        pos.token0.address,
        pos.token1.address,
        pos.fee,
      );
      console.log(prettyPrintPosition(pos, pool));
    });

    const pos = await reader.getPosition("2089");
    const poolData = await reader.getPoolData(
      pos.token0.address,
      pos.token1.address,
      pos.fee,
    );
    console.log(prettyPrintPosition(pos, poolData));

    console.log("Position:", pos);
    console.log("Pool Data:", poolData);

    const tickSpacing = await reader.getTickSpacingForFee(pos.fee);
    console.log("Tick Spacing for pool:", tickSpacing);

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

main().catch(console.error);
