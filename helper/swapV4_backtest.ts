/**
 * ============================================================================
 * SWAP V4 BACKTEST — bản GIẢ LẬP của helper/swapV4.ts
 * ============================================================================
 *
 * Cùng 4 hàm export, cùng tham số vào / field ra như swapV4.ts:
 *   - swapBuy(params)   mua tokenOut bằng tokenIn
 *   - swapSell(params)  bán tokenIn lấy tokenOut
 *   - approve(params)   không làm gì, trả hash giả
 *   - withdraw(params)  không làm gì, coi như lệnh đã khớp hết
 *
 * KHÁC swapV4.ts:
 *   - KHÔNG dùng viem, KHÔNG gọi API pool, KHÔNG đọc/ghi contract nào
 *   - không cần address thật, không cần private key, không check số dư / gas
 *   - lệnh limit coi như KHỚP NGAY tại giá limit (giá USD truyền vào +- biên)
 *   - `txHash` là chuỗi giả `0xbacktest...` tăng dần
 *
 * Số nhận về tính giống `buildAmounts` của swapV4.ts:
 *     swapSell → price = priceTokenIn  / priceTokenOut * (1 + PRICE_SLIPPAGE)
 *                amountOut = amount * price
 *     swapBuy  → price = priceTokenOut / priceTokenIn  * (1 - PRICE_SLIPPAGE)
 *                amountOut = amount / price
 * price làm tròn xuống PRICE_DECIMALS chữ số như bản thật.
 *
 * Có thể chỉnh giả định qua `setBacktestOptions({ ... })`:
 *   priceSlippage   biên giá limit (mặc định 0.001 = 0.1%, giống swapV4.ts)
 *   feeRate         phí trừ trên số nhận về (mặc định 0 — hook limit order không thu phí swap)
 *   priceDecimals   số chữ số làm tròn giá limit (mặc định 4, giống PRICE_DECIMALS)
 *   amountDecimals  số chữ số làm tròn amount (mặc định 18)
 *   log             in từng lệnh swap ra console (mặc định false)
 * ============================================================================
 */

import BigNumber from "bignumber.js";
import type {
    ApproveParams,
    ApproveResult,
    BacktestOptions,
    BacktestOrder,
    SwapParams,
    WithdrawParams,
    WithdrawResult,
} from "../types/swap";

const DEFAULT_OPTIONS: Readonly<BacktestOptions> = Object.freeze({
    priceSlippage: "0.001",
    feeRate: "0",
    priceDecimals: 4,
    amountDecimals: 18,
    log: false,
});

let options: BacktestOptions = { ...DEFAULT_OPTIONS };

/** Đổi giả định backtest. Truyền object rỗng / gọi resetBacktest() để về mặc định. */
export const setBacktestOptions = (next: Partial<BacktestOptions> = {}): BacktestOptions => {
    options = { ...options, ...next };

    return { ...options };
};

/* ============================================================================
 * HELPER NỘI BỘ
 * ========================================================================== */

let txCounter = 0;

/** Hash giả 32 byte, tăng dần để dễ dò trong history. */
const fakeTxHash = (): string => {
    txCounter += 1;

    return `0xbacktest${txCounter.toString(16).padStart(56, "0")}`;
};

/** Toàn bộ lệnh đã "gửi" trong lần chạy backtest, để in báo cáo. */
const orders: BacktestOrder[] = [];

/** Chống gửi trùng như bản thật: cùng `swapId` gọi lại → trả kết quả cũ. */
const inflight = new Map<string, Promise<unknown>>();

const withSwapId = <T>(swapId: string | undefined, action: string, run: () => Promise<T>): Promise<T> => {
    if (!swapId) return run();

    const key = `${action}:${swapId}`;
    if (inflight.has(key)) return inflight.get(key) as Promise<T>;

    const promise = run().catch((error) => {
        inflight.delete(key);
        throw error;
    });
    inflight.set(key, promise);

    return promise;
};

const requireToken = (value: unknown, label: string): string => {
    if (value === undefined || value === null || String(value).trim() === "") {
        throw new Error(`[swapV4_backtest] thiếu ${label}`);
    }

    return String(value).trim();
};

const requirePositive = (value: BigNumber.Value, label: string): BigNumber => {
    let number: BigNumber;
    try {
        number = BigNumber(value);
    } catch (error) {
        number = BigNumber(NaN);
    }
    if (!number.isFinite() || number.lte(0)) throw new Error(`[swapV4_backtest] ${label} phải là số > 0: ${value}`);

    return number;
};

/** Giống `buildAmounts` của swapV4.ts, bỏ phần decimals theo token của pool. */
const buildAmounts = ({
    isSell,
    amount,
    usdIn,
    usdOut,
}: {
    isSell: boolean;
    amount: BigNumber.Value;
    usdIn: BigNumber;
    usdOut: BigNumber;
}): { price: BigNumber; amountIn: BigNumber; amountOut: BigNumber; fee: BigNumber } => {
    const priceSlippage = BigNumber(options.priceSlippage);
    const slippage = isSell ? BigNumber(1).plus(priceSlippage) : BigNumber(1).minus(priceSlippage);

    const price = (isSell ? usdIn.dividedBy(usdOut) : usdOut.dividedBy(usdIn))
        .times(slippage)
        .decimalPlaces(options.priceDecimals, BigNumber.ROUND_DOWN);
    if (price.lte(0)) throw new Error("[swapV4_backtest] giá limit làm tròn về 0, giá USD truyền vào quá lệch");

    const amountIn = BigNumber(amount).decimalPlaces(options.amountDecimals, BigNumber.ROUND_DOWN);
    const gross = isSell ? amountIn.times(price) : amountIn.dividedBy(price);
    const fee = gross.times(options.feeRate);
    const amountOut = gross.minus(fee).decimalPlaces(options.amountDecimals, BigNumber.ROUND_DOWN);

    if (amountIn.lte(0) || amountOut.lte(0)) throw new Error("[swapV4_backtest] amount quá nhỏ, lệnh làm tròn về 0");

    return { price, amountIn, amountOut, fee };
};

/* ============================================================================
 * LÕI: "đặt lệnh" giả lập, khớp ngay
 * ========================================================================== */

const placeLimitOrder = async ({
    isSell,
    idBot,
    chainId,
    swapId,
    tokenIn,
    priceTokenIn,
    tokenOut,
    priceTokenOut,
    amount,
}: SwapParams & { isSell: boolean }): Promise<BacktestOrder> => {
    const nameIn = requireToken(tokenIn, "tokenIn");
    const nameOut = requireToken(tokenOut, "tokenOut");
    if (nameIn.toLowerCase() === nameOut.toLowerCase()) throw new Error("[swapV4_backtest] tokenIn và tokenOut giống nhau");

    const usdIn = requirePositive(priceTokenIn, "priceTokenIn");
    const usdOut = requirePositive(priceTokenOut, "priceTokenOut");
    requirePositive(amount, "amount");

    const { price, amountIn, amountOut, fee } = buildAmounts({ isSell, amount, usdIn, usdOut });

    const txHash = fakeTxHash();
    const result: BacktestOrder = {
        txHash,
        // số tokenOut nhận được — field `amount` tradeV4.ts đang đọc
        amount: amountOut.toFixed(),
        approveTxHash: null,
        side: isSell ? "SELL" : "BUY",
        price: price.toFixed(),
        amountIn: amountIn.toFixed(),
        amountOut: amountOut.toFixed(),
        fee: fee.toFixed(),
        tokenIn: nameIn,
        tokenOut: nameOut,
        priceTokenIn: usdIn.toFixed(),
        priceTokenOut: usdOut.toFixed(),
        idBot,
        chainId,
        swapId: swapId || null,
        backtest: true,
    };

    orders.push(result);

    if (options.log) {
        console.log(
            `[swapV4_backtest] ${result.side} ${amountIn.toFixed(8)} ${nameIn} -> ${amountOut.toFixed(8)} ${nameOut} ` +
            `@ ${price.toFixed()} (${txHash})`
        );
    }

    return result;
};

/* ============================================================================
 * 4 HÀM EXPORT — cùng chữ ký với swapV4.ts
 * ========================================================================== */

export const swapBuy = async (params: SwapParams): Promise<BacktestOrder> =>
    withSwapId(params.swapId, "buy", () => placeLimitOrder({ ...params, isSell: false }));

export const swapSell = async (params: SwapParams): Promise<BacktestOrder> =>
    withSwapId(params.swapId, "sell", () => placeLimitOrder({ ...params, isSell: true }));

/** Backtest không có allowance — trả hash giả cho đúng dạng kết quả. */
export const approve = async (params: ApproveParams): Promise<ApproveResult> =>
    withSwapId(params.swapId, "approve", async (): Promise<ApproveResult> => ({
        txHash: fakeTxHash(),
        amount: params.amount ? BigNumber(params.amount).toFixed() : "max",
        spender: params.spender || "backtest-hook",
        token: params.tokenIn || null,
        backtest: true,
    }));

/**
 * Backtest coi mọi lệnh đã khớp hết ngay lúc đặt, nên withdraw luôn là
 * `mode = "WITHDRAW"` và token đã nằm sẵn trong số `amount` của swapBuy/swapSell.
 * Truyền `amount` (số đồng mua của lệnh) nếu muốn nhận lại đúng số đó.
 */
export const withdraw = async (params: WithdrawParams): Promise<WithdrawResult> =>
    withSwapId(params.swapId, "withdraw", async (): Promise<WithdrawResult> => {
        const amount = params.amount ? BigNumber(params.amount).toFixed() : "0";

        return {
            txHash: fakeTxHash(),
            amount,
            mode: "WITHDRAW",
            status: "FILLED",
            filled: true,
            filledPercent: 100,
            orderId: params.orderId !== undefined && params.orderId !== null ? String(params.orderId) : null,
            amountOut: amount,
            amountSellBack: "0",
            backtest: true,
        };
    });

/** Danh sách lệnh đã giả lập (bản copy). */
export const getBacktestOrders = (): BacktestOrder[] => orders.map((order) => ({ ...order }));

/** Xoá lệnh / hash / cache swapId / options — gọi trước mỗi lần backtest mới. */
export const resetBacktest = (): void => {
    orders.length = 0;
    inflight.clear();
    txCounter = 0;
    options = { ...DEFAULT_OPTIONS };
};
