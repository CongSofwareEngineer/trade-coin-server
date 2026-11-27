/**
 * ============================================================================
 * TYPES — SWAP V4: tham số / kết quả của helper/swapV4.ts (và bản backtest)
 * ============================================================================
 *
 * Phần server cần quan tâm khi lưu DB:
 *   - `SwapResult.txHash` / `.amount` → đi vào `history.txHash` / `history.amountSwap`.
 *   - `PlaceOrderResult` có `poolId`, `hook`, `tickLower`, `zeroForOne`: PHẢI lưu
 *     lại nếu muốn gọi `withdraw` rút lệnh đã khớp về ví (xem `WithdrawParams`).
 *
 * Mọi amount là đơn vị TOKEN dạng string (vd "1.5"), KHÔNG phải wei.
 * ============================================================================
 */

import type { DecimalString } from "./trade";

/** Chiều lệnh limit: BUY = trả quote (USDC) lấy base, SELL = bán base lấy quote. */
export type OrderSide = "BUY" | "SELL";

/** Kiểu tx của `withdraw`: lệnh đã khớp hết → WITHDRAW, chưa khớp hết → CANCEL. */
export type WithdrawMode = "WITHDRAW" | "CANCEL";

/** Trạng thái khớp của lệnh lúc đọc trên chain. */
export type OrderFillStatus = "FILLED" | "MATCHED_PENDING" | "PARTIAL" | "OPEN";

/* ============================================================================
 * swapBuy / swapSell
 * ========================================================================== */

/** Tham số `swapBuy` / `swapSell` — đúng những gì tradeV4.ts truyền xuống. */
export interface SwapParams {
    /** id bot → tìm private key ví ký (env BOT_PRIVATE_KEY_<ID_BOT>). */
    idBot: string | number;
    chainId: string | number;
    /** Khoá chống gửi trùng tx: gọi lại cùng swapId → trả kết quả cũ. */
    swapId?: string;
    /** Address token đem đi (swapBuy: USDC). */
    tokenIn: string;
    /** Giá USD của tokenIn tại mốc swap. */
    priceTokenIn: string | number;
    /** Address token muốn nhận (swapSell: USDC). */
    tokenOut: string;
    /** Giá USD của tokenOut tại mốc swap. */
    priceTokenOut: string | number;
    /** Số tokenIn, đơn vị token. */
    amount: string | number;
    /** Ví ký, mặc định lấy từ env theo idBot. */
    privateKey?: string;
}

/** Tối thiểu tradeV4.ts đọc từ hàm swap. */
export interface SwapResult {
    txHash: string;
    /** Số tokenOut nhận được của lệnh vừa gửi, đơn vị token. Thành vốn của mốc sau. */
    amount: DecimalString;
}

/** Chữ ký hàm swap tradeV4.ts nhận (thật: swapBuy của swapV4.ts, giả: của backtest). */
export type SwapFn = (params: SwapParams) => Promise<SwapResult>;

/** Kết quả đầy đủ của `swapBuy` / `swapSell` bản thật. */
export interface PlaceOrderResult extends SwapResult {
    approveTxHash: string | null;
    /** Ví ký đặt lệnh. */
    owner: string;
    poolId: string;
    /** Address hook limit order (spender của approve, contract của withdraw). */
    hook: string;
    side: OrderSide;
    /** Giá limit quote per base. */
    price: DecimalString;
    amountIn: DecimalString;
    amountOut: DecimalString;
    /** Số tokenIn hook thực kéo (round UP, có thể hơn amountIn 1 wei). */
    settleIn: DecimalString;
    tickLower: number;
    tickUpper: number;
    currentTick: number;
    /** uint128 dạng chuỗi. */
    liquidity: string;
    /** true = bán token0 của pool. */
    zeroForOne: boolean;
}

/* ============================================================================
 * approve
 * ========================================================================== */

export interface ApproveParams {
    idBot: string | number;
    chainId: string | number;
    swapId?: string;
    /** Address token cần approve. */
    tokenIn: string;
    /** Address token còn lại của pool (để tìm hook). */
    tokenOut: string;
    /** Số token approve, rỗng = max uint256. */
    amount?: string | number;
    /** Ghi đè spender, mặc định là hook của pool. */
    spender?: string;
    privateKey?: string;
}

export interface ApproveResult {
    txHash: string;
    /** Đơn vị token, hoặc "max". */
    amount: string;
    spender: string;
    owner?: string;
    token: string | null;
    backtest?: boolean;
}

/* ============================================================================
 * withdraw
 * ========================================================================== */

export interface WithdrawParams {
    idBot: string | number;
    chainId: string | number;
    swapId?: string;
    /** Address token ĐÃ BÁN của lệnh (lúc place). */
    tokenIn: string;
    /** Address token MUA của lệnh (lúc place). */
    tokenOut: string;
    /** orderId đã lưu lúc place; không có thì đọc getOrderId(poolKey, tickLower, zeroForOne). */
    orderId?: string | number | bigint;
    /** Tick dưới của lệnh. BẮT BUỘC khi không có orderId, và khi phải cancel. */
    tickLower?: number;
    /** Chiều lệnh; mặc định suy từ tokenIn/tokenOut. */
    zeroForOne?: boolean;
    /** Ví nhận token, mặc định là ví của bot. */
    to?: string;
    /** Lệnh chưa khớp hết thì cho phép cancelOrder (mặc định true). */
    allowCancel?: boolean;
    privateKey?: string;
    /** Chỉ bản backtest: số đồng mua muốn nhận lại. */
    amount?: string | number;
}

export interface WithdrawResult {
    txHash: string;
    /** Số ĐỒNG MUA về ví, đơn vị token. */
    amount: DecimalString;
    mode: WithdrawMode;
    status: OrderFillStatus;
    filled: boolean;
    filledPercent: number;
    orderId: string | null;
    amountOut: DecimalString;
    /** Phần chưa đổi được, chỉ khác "0" khi mode = CANCEL. */
    amountSellBack: DecimalString;
    owner?: string;
    to?: string;
    poolId?: string;
    hook?: string;
    sellToken?: string;
    buyToken?: string;
    liquidity?: string;
    liquidityTotal?: string;
    tickLower?: number | null;
    tickUpper?: number | null;
    zeroForOne?: boolean;
    backtest?: boolean;
}

/* ============================================================================
 * BACKTEST (helper/swapV4_backtest.ts)
 * ========================================================================== */

export interface BacktestOptions {
    /** Biên giá limit (mặc định "0.001" = 0.1%). */
    priceSlippage: string;
    /** Phí trừ trên số nhận về (mặc định "0"). */
    feeRate: string;
    /** Số chữ số làm tròn giá limit (mặc định 4). */
    priceDecimals: number;
    /** Số chữ số làm tròn amount (mặc định 18). */
    amountDecimals: number;
    /** In từng lệnh swap ra console. */
    log: boolean;
}

/** Một lệnh giả lập của backtest. */
export interface BacktestOrder extends SwapResult {
    approveTxHash: null;
    side: OrderSide;
    price: DecimalString;
    amountIn: DecimalString;
    amountOut: DecimalString;
    fee: DecimalString;
    tokenIn: string;
    tokenOut: string;
    priceTokenIn: DecimalString;
    priceTokenOut: DecimalString;
    idBot: string | number;
    chainId: string | number;
    swapId: string | null;
    backtest: true;
}
