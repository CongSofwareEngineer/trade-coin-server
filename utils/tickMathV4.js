/**
 * ============================================================================
 * TICK MATH V4 — toán tick / sqrtPriceX96 / liquidity của Uniswap v4
 * ============================================================================
 *
 * Copy nguyên từ `src/common/manualLimitOrder/limitOrderHookClient.ts` của
 * coinpool-client (bản đó đã được verify với helper ethers của demo repo trên
 * Base mainnet: poolId, getSlot0, 50 case quote, 306 lệnh thật đều khớp).
 *
 * Hàm thuần, không gọi RPC, không đọc env — sửa ở đây là sửa toán.
 * ============================================================================
 */

const { encodeAbiParameters, getAddress, keccak256 } = require("viem");
const { POOL_KEY_PARAM } = require("../constant/abis");
const {
    MIN_TICK,
    MAX_TICK,
    ZERO,
    ONE,
    Q96,
    MAX_UINT256,
    SQRT_RATIO_MULTIPLIERS,
    SQRT_RATIO_ODD_TICK,
} = require("../constant/swapV4");

/** tick → sqrtPriceX96. */
const getSqrtRatioAtTick = (tick) => {
    if (!Number.isInteger(tick) || tick < MIN_TICK || tick > MAX_TICK) {
        throw new Error(`[tickMathV4] tick ${tick} ngoài khoảng cho phép`);
    }
    const absTick = BigInt(Math.abs(tick));

    let ratio = (absTick & ONE) !== ZERO ? SQRT_RATIO_ODD_TICK : ONE << BigInt(128);
    for (const [bit, multiplier] of SQRT_RATIO_MULTIPLIERS) {
        if ((absTick & bit) !== ZERO) ratio = (ratio * multiplier) >> BigInt(128);
    }
    if (tick > 0) ratio = MAX_UINT256 / ratio;

    return (ratio >> BigInt(32)) + (ratio % (ONE << BigInt(32)) === ZERO ? ZERO : ONE);
};

const MIN_SQRT_RATIO = getSqrtRatioAtTick(MIN_TICK);
const MAX_SQRT_RATIO = getSqrtRatioAtTick(MAX_TICK);

/** sqrtPriceX96 → tick (chặt nhị phân, giống bản web). */
const getTickAtSqrtRatio = (sqrtPriceX96) => {
    if (sqrtPriceX96 < MIN_SQRT_RATIO || sqrtPriceX96 >= MAX_SQRT_RATIO) {
        throw new Error("[tickMathV4] sqrt price ngoài khoảng cho phép");
    }
    let lo = MIN_TICK;
    let hi = MAX_TICK;
    while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (getSqrtRatioAtTick(mid) <= sqrtPriceX96) lo = mid;
        else hi = mid - 1;
    }

    return lo;
};

/** Số token0 của một khoảng giá. `roundUp` = kiểu tính tiền mint của v4. */
const getAmount0Delta = (sqrtA, sqrtB, liquidity, roundUp = false) => {
    if (sqrtA > sqrtB) [sqrtA, sqrtB] = [sqrtB, sqrtA];
    const numerator1 = liquidity << BigInt(96);
    const numerator2 = sqrtB - sqrtA;
    if (roundUp) {
        const inner = (numerator1 * numerator2 + sqrtB - ONE) / sqrtB;
        return (inner + sqrtA - ONE) / sqrtA;
    }

    return (numerator1 * numerator2) / sqrtB / sqrtA;
};

/** Số token1 của một khoảng giá. */
const getAmount1Delta = (sqrtA, sqrtB, liquidity, roundUp = false) => {
    if (sqrtA > sqrtB) [sqrtA, sqrtB] = [sqrtB, sqrtA];
    const product = liquidity * (sqrtB - sqrtA);

    return roundUp ? (product + Q96 - ONE) / Q96 : product / Q96;
};

const amount0ForLiquidity = (sqrtA, sqrtB, liquidity) => getAmount0Delta(sqrtA, sqrtB, liquidity, false);
const amount1ForLiquidity = (sqrtA, sqrtB, liquidity) => getAmount1Delta(sqrtA, sqrtB, liquidity, false);

/**
 * Hai số token của một position theo GIÁ HIỆN TẠI của pool.
 *
 * Giá dưới khoảng → còn nguyên token0; trong khoảng → một phần đã đổi sang
 * token1; trên khoảng → đã đổi hết sang token1. Dùng để biết một lệnh limit
 * chưa khớp hết đang nắm bao nhiêu đồng bán / bao nhiêu đồng mua.
 */
const getAmountsForLiquidity = (sqrtPriceX96, sqrtA, sqrtB, liquidity) => {
    if (sqrtA > sqrtB) [sqrtA, sqrtB] = [sqrtB, sqrtA];
    if (sqrtPriceX96 <= sqrtA) {
        return { amount0: amount0ForLiquidity(sqrtA, sqrtB, liquidity), amount1: ZERO };
    }
    if (sqrtPriceX96 < sqrtB) {
        return {
            amount0: amount0ForLiquidity(sqrtPriceX96, sqrtB, liquidity),
            amount1: amount1ForLiquidity(sqrtA, sqrtPriceX96, liquidity),
        };
    }

    return { amount0: ZERO, amount1: amount1ForLiquidity(sqrtA, sqrtB, liquidity) };
};

const liquidityForAmount0 = (sqrtA, sqrtB, amount0) => {
    if (sqrtA > sqrtB) [sqrtA, sqrtB] = [sqrtB, sqrtA];
    const intermediate = (sqrtA * sqrtB) / Q96;

    return (amount0 * intermediate) / (sqrtB - sqrtA);
};

const liquidityForAmount1 = (sqrtA, sqrtB, amount1) => {
    if (sqrtA > sqrtB) [sqrtA, sqrtB] = [sqrtB, sqrtA];

    return (amount1 * Q96) / (sqrtB - sqrtA);
};

/** Liquidity lớn nhất mà (amount0, amount1) mua được trong khoảng [sqrtA, sqrtB]. */
const getLiquidityForAmounts = (sqrtPriceX96, sqrtA, sqrtB, amount0, amount1) => {
    if (sqrtA > sqrtB) [sqrtA, sqrtB] = [sqrtB, sqrtA];
    if (sqrtPriceX96 <= sqrtA) return liquidityForAmount0(sqrtA, sqrtB, amount0);
    if (sqrtPriceX96 < sqrtB) {
        const l0 = liquidityForAmount0(sqrtPriceX96, sqrtB, amount0);
        const l1 = liquidityForAmount1(sqrtA, sqrtPriceX96, amount1);

        return l0 < l1 ? l0 : l1;
    }

    return liquidityForAmount1(sqrtA, sqrtB, amount1);
};

const sqrtBigInt = (n) => {
    if (n < ZERO) throw new Error("[tickMathV4] sqrt của số âm");
    if (n < BigInt(2)) return n;
    let x = n;
    let y = (x + ONE) >> ONE;
    while (y < x) {
        x = y;
        y = (x + n / x) >> ONE;
    }

    return x;
};

/** (amount1 / amount0) → sqrtPriceX96, dùng để đổi giá limit thành tick. */
const encodeSqrtRatioX96 = (amount1, amount0) => {
    if (amount0 <= ZERO) throw new Error("[tickMathV4] amount0 phải > 0");

    return sqrtBigInt((amount1 << BigInt(192)) / amount0);
};

const truncDiv = (tick, tickSpacing) => Math.trunc(tick / tickSpacing) * tickSpacing;

/** Làm tròn tick LÊN theo tickSpacing. */
const roundTickUp = (tick, tickSpacing) => {
    const rounded = truncDiv(tick, tickSpacing);

    return tick > 0 && tick % tickSpacing !== 0 ? rounded + tickSpacing : rounded;
};

/** Làm tròn tick XUỐNG theo tickSpacing. */
const roundTickDown = (tick, tickSpacing) => {
    const rounded = truncDiv(tick, tickSpacing);

    return tick < 0 && tick % tickSpacing !== 0 ? rounded - tickSpacing : rounded;
};

/** PoolKey theo đúng thứ tự Uniswap sort (token0 < token1 theo address). */
const buildPoolKey = ({ tokenA, tokenB, fee, tickSpacing, hooks }) => {
    const a = getAddress(tokenA);
    const b = getAddress(tokenB);
    const [currency0, currency1] = BigInt(a) < BigInt(b) ? [a, b] : [b, a];

    return { currency0, currency1, fee, tickSpacing, hooks: getAddress(hooks) };
};

/** poolId = keccak256(abi.encode(poolKey)). */
const getPoolId = (poolKey) => keccak256(encodeAbiParameters([POOL_KEY_PARAM], [poolKey]));

module.exports = {
    MIN_SQRT_RATIO,
    MAX_SQRT_RATIO,
    getSqrtRatioAtTick,
    getTickAtSqrtRatio,
    getAmount0Delta,
    getAmount1Delta,
    amount0ForLiquidity,
    amount1ForLiquidity,
    getAmountsForLiquidity,
    getLiquidityForAmounts,
    encodeSqrtRatioX96,
    roundTickUp,
    roundTickDown,
    buildPoolKey,
    getPoolId,
};
