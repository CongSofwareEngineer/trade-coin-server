/**
 * ============================================================================
 * QUOTE V4 — từ (amountIn, amountOut) mong muốn ra tick range + liquidity
 * ============================================================================
 *
 * Copy logic `quote()` / `sizeOrder()` của coinpool-client
 * (`src/common/manualLimitOrder/limitOrderHookClient.ts`).
 *
 * Bảo đảm của hàm này (đã verify 19.200 case quote bên web): lệnh KHÔNG BAO
 * GIỜ tệ hơn giá yêu cầu — bán nhận về ít nhất `amountOut`, mua trả nhiều nhất
 * `amountIn`.
 * ============================================================================
 */

import { formatUnits, parseUnits } from "viem";
import { MIN_TICK, MAX_TICK, ZERO, ONE } from "../constant/swapV4";
import {
    amount0ForLiquidity,
    amount1ForLiquidity,
    encodeSqrtRatioX96,
    getAmount0Delta,
    getAmount1Delta,
    getLiquidityForAmounts,
    getSqrtRatioAtTick,
    getTickAtSqrtRatio,
    roundTickDown,
    roundTickUp,
} from "./tickMathV4";

/** Token tối thiểu quote cần: decimals để đổi đơn vị. */
export interface QuoteToken {
    address: string;
    symbol: string;
    decimals: number;
}

export interface SizedOrder {
    liquidity: bigint;
    settleIn: bigint;
    actualIn: bigint;
    actualOut: bigint;
}

export interface QuoteLimitOrderParams<T extends QuoteToken = QuoteToken> {
    /** số token đem đặt, đơn vị token */
    amountIn: string;
    /** số token muốn nhận, đơn vị token */
    amountOut: string;
    /** true = bán token0 của pool */
    zeroForOne: boolean;
    /** tick hiện tại (getSlot0) */
    currentTick?: number | null;
    tickSpacing: number;
    sellToken: T;
    buyToken: T;
}

export interface QuoteLimitOrderResult<T extends QuoteToken = QuoteToken> {
    zeroForOne: boolean;
    sellToken: T;
    buyToken: T;
    rawTick: number;
    tickLower: number;
    tickUpper: number;
    liquidity: bigint;
    raw: {
        liquidity: bigint;
        requestedIn: bigint;
        requestedOut: bigint;
        actualIn: bigint;
        settleIn: bigint;
        actualOut: bigint;
    };
    amountIn: string;
    amountOut: string;
    executionPrice: number | null;
    meetsRequestedOut: boolean;
}

/**
 * Liquidity lớn nhất trong `[tickLower, tickLower + tickSpacing]` mà `amountIn`
 * trả nổi.
 *
 * v4 tính tiền mint theo kiểu round UP, nên liquidity lấy theo round DOWN có
 * thể đắt hơn amountIn 1 wei → phải co liquidity lại tới khi giá mint vừa với
 * amountIn, không thì approve / balance thiếu 1 wei và tx revert.
 */
export const sizeOrder = ({
    tickLower,
    tickSpacing,
    zeroForOne,
    amountInUnits,
}: {
    tickLower: number;
    tickSpacing: number;
    zeroForOne: boolean;
    amountInUnits: bigint;
}): SizedOrder => {
    if (tickLower < MIN_TICK || tickLower + tickSpacing > MAX_TICK) {
        throw new Error(`[quoteV4] tick ${tickLower} ngoài khoảng: giá limit không đặt được`);
    }

    const sqrtLower = getSqrtRatioAtTick(tickLower);
    const sqrtUpper = getSqrtRatioAtTick(tickLower + tickSpacing);

    let liquidity = getLiquidityForAmounts(
        zeroForOne ? sqrtLower : sqrtUpper,
        sqrtLower,
        sqrtUpper,
        zeroForOne ? amountInUnits : ZERO,
        zeroForOne ? ZERO : amountInUnits
    );

    const costOf = (l: bigint): bigint =>
        zeroForOne ? getAmount0Delta(sqrtLower, sqrtUpper, l, true) : getAmount1Delta(sqrtLower, sqrtUpper, l, true);

    let settleIn = liquidity > ZERO ? costOf(liquidity) : ZERO;
    while (liquidity > ZERO && settleIn > amountInUnits) {
        const scaled = (liquidity * amountInUnits) / settleIn;
        liquidity = scaled < liquidity ? scaled : liquidity - ONE;
        settleIn = costOf(liquidity);
    }

    if (liquidity === ZERO) throw new Error("[quoteV4] liquidity làm tròn về 0: amount quá nhỏ");
    if (settleIn > amountInUnits) throw new Error("[quoteV4] sai bất biến: settleIn > amountIn");

    const actualIn = zeroForOne
        ? amount0ForLiquidity(sqrtLower, sqrtUpper, liquidity)
        : amount1ForLiquidity(sqrtLower, sqrtUpper, liquidity);
    const actualOut = zeroForOne
        ? amount1ForLiquidity(sqrtLower, sqrtUpper, liquidity)
        : amount0ForLiquidity(sqrtLower, sqrtUpper, liquidity);

    return { liquidity, settleIn, actualIn, actualOut };
};

/** Quote một lệnh limit — xem `QuoteLimitOrderParams`, ghi chú `currentTick` ở dưới. */
export const quoteLimitOrder = <T extends QuoteToken>({
    amountIn,
    amountOut,
    zeroForOne,
    currentTick,
    tickSpacing,
    sellToken,
    buyToken,
}: QuoteLimitOrderParams<T>): QuoteLimitOrderResult<T> => {
    const amountInUnits = parseUnits(String(amountIn), sellToken.decimals);
    const amountOutUnits = parseUnits(String(amountOut), buyToken.decimals);
    if (amountInUnits <= ZERO || amountOutUnits <= ZERO) throw new Error("[quoteV4] amountIn / amountOut phải > 0");

    const [amt1, amt0] = zeroForOne ? [amountOutUnits, amountInUnits] : [amountInUnits, amountOutUnits];

    const rawTick = getTickAtSqrtRatio(encodeSqrtRatioX96(amt1, amt0));
    let tickLower = zeroForOne ? roundTickUp(rawTick, tickSpacing) : roundTickDown(rawTick, tickSpacing);
    let order = sizeOrder({ tickLower, tickSpacing, zeroForOne, amountInUnits });

    // Bán token0 round UP nên luôn >= giá yêu cầu. Bán token1 round DOWN có thể
    // để range nằm vắt qua giá yêu cầu → đẩy thêm một tickSpacing ra xa thị trường.
    if (!zeroForOne && order.actualOut < amountOutUnits) {
        tickLower -= tickSpacing;
        order = sizeOrder({ tickLower, tickSpacing, zeroForOne, amountInUnits });
    }

    // Hook chỉ nhận range nằm hoàn toàn ở phía bên kia tick hiện tại (trên nó khi
    // bán token0, dưới nó khi bán token1). Giá đúng chiều vẫn có thể làm tròn vào
    // đúng range đang được trade → đẩy về range hợp lệ gần nhất, chỉ tốt hơn cho mình.
    if (currentTick !== undefined && currentTick !== null) {
        const currentLower = roundTickDown(currentTick, tickSpacing);
        const nearestLower = zeroForOne ? currentLower + tickSpacing : currentLower - tickSpacing;
        if (zeroForOne ? tickLower < nearestLower : tickLower > nearestLower) {
            tickLower = nearestLower;
            order = sizeOrder({ tickLower, tickSpacing, zeroForOne, amountInUnits });
        }
    }

    const { liquidity, settleIn, actualIn, actualOut } = order;
    const inHuman = Number(formatUnits(actualIn, sellToken.decimals));
    const outHuman = Number(formatUnits(actualOut, buyToken.decimals));

    return {
        zeroForOne,
        sellToken,
        buyToken,
        rawTick,
        tickLower,
        tickUpper: tickLower + tickSpacing,
        liquidity,
        raw: { liquidity, requestedIn: amountInUnits, requestedOut: amountOutUnits, actualIn, settleIn, actualOut },
        amountIn: formatUnits(actualIn, sellToken.decimals),
        amountOut: formatUnits(actualOut, buyToken.decimals),
        executionPrice: inHuman === 0 ? null : outHuman / inHuman,
        meetsRequestedOut: actualOut >= amountOutUnits,
    };
};
