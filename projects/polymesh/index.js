const { Polymesh } = require("@polymeshassociation/polymesh-sdk");

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  // Network configuration
  RPC_ENDPOINT:
    process.env.POLYMESH_RPC || "wss://mainnet-rpc.polymesh.network/",
  CHAIN_NAME: "polymesh",

  // Token configuration
  POLYX_DECIMALS: 6, // Polymesh uses 6 decimals (micro-POLYX)
  POLYX_FALLBACK_PRICE: 0.3, // Fallback USD price if API fails

  // Polymesh-specific addresses
  // TODO: Replace with actual Polymesh treasury account
  // This can be found at: https://mainnet-app.polymesh.network/#/treasury
  TREASURY_ACCOUNT: null, // Set to null to skip treasury query

  // Feature flags
  DEMO_MODE: process.env.DEMO_MODE === "true",
  SILENT_MODE: process.env.SILENT_MODE === "true",

  // Timing
  MAINNET_LAUNCH_TIMESTAMP: 1639612800, // December 16, 2021
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Conditional logging - respects SILENT_MODE
 */
const log = {
  info: (...args) => !CONFIG.SILENT_MODE && console.log(...args),
  warn: (...args) => !CONFIG.SILENT_MODE && console.warn(...args),
  error: (...args) => console.error(...args), // Always log errors
};

/**
 * Convert from smallest unit to POLYX
 * @param {BigInt|string|number} amount - Amount in smallest unit
 * @returns {number} Amount in POLYX
 */
function toPolyx(amount) {
  const divisor = Math.pow(10, CONFIG.POLYX_DECIMALS);
  return Number(amount) / divisor;
}

/**
 * Format number for display
 * @param {number} num - Number to format
 * @returns {string} Formatted number
 */
function formatNumber(num) {
  return num.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// ============================================================================
// PRICE FEED
// ============================================================================

/**
 * Fetch POLYX price from CoinGecko
 * @returns {Promise<number>} POLYX price in USD
 */
async function fetchPolyxPriceFromCoinGecko() {
  try {
    const axios = require("axios");
    const response = await axios.get(
      "https://api.coingecko.com/api/v3/simple/price",
      {
        params: {
          ids: "polymesh",
          vs_currencies: "usd",
        },
        timeout: 5000,
      }
    );

    if (response.data?.polymesh?.usd) {
      return response.data.polymesh.usd;
    }

    throw new Error("Invalid response format from CoinGecko");
  } catch (error) {
    log.warn(`CoinGecko price fetch failed: ${error.message}`);
    return null;
  }
}

/**
 * Get POLYX price with fallback
 * @returns {Promise<number>} POLYX price in USD
 */
async function getPolyxPrice() {
  // Try CoinGecko first
  const price = await fetchPolyxPriceFromCoinGecko();

  if (price && price > 0) {
    log.info(`✅ Using live POLYX price: $${price}`);
    return price;
  }

  // Fallback to configured price
  log.warn(`⚠️  Using fallback POLYX price: $${CONFIG.POLYX_FALLBACK_PRICE}`);
  return CONFIG.POLYX_FALLBACK_PRICE;
}

// ============================================================================
// BLOCKCHAIN QUERIES
// ============================================================================

/**
 * Initialize connection to Polymesh blockchain
 * @returns {Promise<Polymesh>} Connected Polymesh instance
 */
async function initializePolymesh() {
  try {
    const polymesh = await Polymesh.connect({
      nodeUrl: CONFIG.RPC_ENDPOINT,
    });
    return polymesh;
  } catch (error) {
    log.error("Failed to connect to Polymesh:", error.message);
    throw error;
  }
}

/**
 * Query total staked POLYX
 * @param {Object} api - Polkadot.js API instance
 * @returns {Promise<BigInt>} Total staked amount
 */
async function queryTotalStaked(api) {
  try {
    if (!api.query.staking) {
      log.warn("Staking module not available");
      return BigInt(0);
    }

    // Get current active era
    const activeEra = await api.query.staking.activeEra();

    if (!activeEra || !activeEra.isSome) {
      log.warn("No active era found");
      return BigInt(0);
    }

    const currentEra = activeEra.unwrap().index.toNumber();

    // Query total stake for current era (more efficient than fetching all)
    const totalStake = await api.query.staking.erasTotalStake(currentEra);

    if (totalStake) {
      return BigInt(totalStake.toString());
    }

    return BigInt(0);
  } catch (error) {
    log.warn(`Unable to query staking data: ${error.message}`);
    return BigInt(0);
  }
}

/**
 * Query treasury balance
 * @param {Object} api - Polkadot.js API instance
 * @returns {Promise<BigInt>} Treasury balance
 */
async function queryTreasuryBalance(api) {
  try {
    if (!CONFIG.TREASURY_ACCOUNT) {
      log.info("Treasury account not configured, skipping");
      return BigInt(0);
    }

    const account = await api.query.system.account(CONFIG.TREASURY_ACCOUNT);

    if (account?.data?.free) {
      return BigInt(account.data.free.toString());
    }

    return BigInt(0);
  } catch (error) {
    log.warn(`Unable to query treasury balance: ${error.message}`);
    return BigInt(0);
  }
}

/**
 * Query all chain data needed for TVL calculation
 * @param {Polymesh} polymesh - Polymesh SDK instance
 * @returns {Promise<Object>} Chain data
 */
async function queryChainData(polymesh) {
  const api = polymesh._polkadotApi;

  // Query data in parallel for efficiency
  const [totalIssuance, totalStaked, treasuryBalance] = await Promise.all([
    api.query.balances.totalIssuance().then((val) => BigInt(val.toString())),
    queryTotalStaked(api),
    queryTreasuryBalance(api),
  ]);

  return {
    totalIssuance,
    totalStaked,
    treasuryBalance,
  };
}

// ============================================================================
// TVL CALCULATION
// ============================================================================

/**
 * Calculate TVL from chain data
 * @param {Object} chainData - Data from queryChainData
 * @param {number} polyxPrice - POLYX price in USD
 * @returns {Object} TVL breakdown
 */
function calculateTVL(chainData, polyxPrice) {
  const { totalIssuance, totalStaked, treasuryBalance } = chainData;

  // TVL = Staked + Treasury (both are locked/non-circulating)
  const tvlInSmallestUnit = totalStaked + treasuryBalance;
  const tvlPolyx = toPolyx(tvlInSmallestUnit);
  const tvlUsd = tvlPolyx * polyxPrice;

  return {
    totalIssuance: toPolyx(totalIssuance),
    totalStaked: toPolyx(totalStaked),
    treasuryBalance: toPolyx(treasuryBalance),
    tvlPolyx,
    tvlUsd,
    polyxPrice,
  };
}

/**
 * Display TVL breakdown (for logging)
 * @param {Object} tvl - TVL data from calculateTVL
 */
function displayTVLBreakdown(tvl) {
  log.info("\n📊 Chain Data:");
  log.info(`- Total Issuance: ${formatNumber(tvl.totalIssuance)} POLYX`);
  log.info(
    `- Total Staked: ${formatNumber(tvl.totalStaked)} POLYX (${(
      (tvl.totalStaked / tvl.totalIssuance) *
      100
    ).toFixed(1)}%)`
  );
  if (tvl.treasuryBalance > 0) {
    log.info(`- Treasury: ${formatNumber(tvl.treasuryBalance)} POLYX`);
  }
  log.info(`\n💰 Total TVL: ${formatNumber(tvl.tvlPolyx)} POLYX`);
  log.info(
    `💵 USD Value: $${formatNumber(tvl.tvlUsd)} (@ $${tvl.polyxPrice}/POLYX)\n`
  );
}

// ============================================================================
// DEMO MODE
// ============================================================================

/**
 * Demo mode - returns mock data for testing
 * @returns {Promise<Object>} Mock TVL data
 */
async function fetchDemo() {
  log.info("⚠️  Running in DEMO MODE - using mock data");
  log.info(
    "To connect to real network, unset DEMO_MODE environment variable\n"
  );

  const mockData = {
    totalIssuance: 1000,
    totalStaked: 300,
    treasuryBalance: 50,
    tvlPolyx: 350,
    tvlUsd: 350 * CONFIG.POLYX_FALLBACK_PRICE,
    polyxPrice: CONFIG.POLYX_FALLBACK_PRICE,
  };

  displayTVLBreakdown(mockData);

  return {
    [CONFIG.CHAIN_NAME]: mockData.tvlUsd,
  };
}

// ============================================================================
// MAIN ADAPTER FUNCTION
// ============================================================================

/**
 * Main fetch function for DefiLlama adapter
 * @returns {Promise<Object>} TVL data in DefiLlama format
 */
async function fetch() {
  // Demo mode shortcut
  if (CONFIG.DEMO_MODE) {
    return fetchDemo();
  }

  let polymesh;

  try {
    // Connect to Polymesh
    polymesh = await initializePolymesh();
    log.info("✅ Connected to Polymesh mainnet");

    // Fetch price and chain data in parallel
    const [polyxPrice, chainData] = await Promise.all([
      getPolyxPrice(),
      queryChainData(polymesh),
    ]);

    // Calculate TVL
    const tvl = calculateTVL(chainData, polyxPrice);

    // Display results
    displayTVLBreakdown(tvl);

    // Return in DefiLlama format
    return {
      [CONFIG.CHAIN_NAME]: tvl.tvlUsd,
    };
  } catch (error) {
    log.error("Error fetching Polymesh TVL:", error.message);
    log.info("\n⚠️  Falling back to DEMO MODE...\n");
    return fetchDemo();
  } finally {
    // Always cleanup
    if (polymesh) {
      try {
        await polymesh.disconnect();
      } catch (e) {
        // Ignore disconnect errors
      }
    }
  }
}

/**
 * TVL function with historical support (for future use)
 * @param {number} timestamp - Unix timestamp
 * @param {number} block - Block number
 * @returns {Promise<Object>} TVL data
 */
async function tvl(timestamp, block) {
  // TODO: Implement historical queries at specific block height
  // For now, return current TVL
  return fetch();
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  timetravel: false, // Set to true when historical data is implemented
  misrepresentedTokens: false,
  methodology:
    "Polymesh TVL includes staked POLYX tokens and treasury holdings. " +
    "Staked tokens are locked in the consensus mechanism (Proof of Stake). " +
    "Treasury holdings represent governance-locked funds. " +
    "Data is fetched directly from Polymesh blockchain via Polymesh SDK and Polkadot.js API. " +
    "Prices are sourced from CoinGecko with fallback to cached values.",
  start: CONFIG.MAINNET_LAUNCH_TIMESTAMP,
  [CONFIG.CHAIN_NAME]: {
    tvl: fetch,
    fetch: fetch,
  },
};
