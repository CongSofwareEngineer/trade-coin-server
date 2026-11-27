/**
 * ============================================================================
 * TYPES — TRADE V4: dữ liệu VÀO / RA của thuật toán (helper/tradeV4.ts)
 * ============================================================================
 *
 * File này là "hợp đồng" giữa thuật toán và server. Mọi thứ server phải LƯU DB
 * (config, history) và phải CHUẨN BỊ mỗi mốc (arrToken) đều được khai ở đây.
 * Schema database gợi ý dựa trên các type này nằm ở `types/database.ts`.
 *
 * ⚠ MỌI SỐ ĐỀU LÀ STRING (`DecimalString`), KHÔNG DÙNG Number.
 *   Giá và số token là BigNumber 20+ chữ số thập phân (vd perETH
 *   "41.66666666666666666667"). Number của JS làm tròn mất → mốc sau đọc lại
 *   là tính lệch, càng chạy càng lệch. Trong DB khai kiểu String.
 *
 * Ví dụ data thật của từng type: `helper/tradeV4_Data.ts`.
 * ============================================================================
 */

import type { SwapFn } from "./swap";

/** Số thập phân dạng chuỗi (BigNumber.toFixed()), vd "0.26666666666666666667". Lưu DB: String. */
export type DecimalString = string;

/**
 * Symbol token đã chuẩn hoá UPPERCASE, vd "ETH", "BTC", "AMZNC".
 * Là KEY của các map trong `TradeState` → giữ y nguyên suốt vòng đời bot.
 */
export type TokenSymbol = string;

/** Address token (0x...). Giữ nguyên hoa/thường như server truyền vào. */
export type TokenAddress = string;

/** Map `symbol → số`, vd `{ ETH: "1", BTC: "40", BNB: "0.26" }`. Key thay đổi theo token của bot. */
export type SymbolMap = Record<TokenSymbol, DecimalString>;

/* ============================================================================
 * history.action
 * ========================================================================== */

/**
 * 5 giá trị `history.action`. Dùng làm `enum` cho field `action` của schema.
 *
 *   DEPOSIT        register xong. Không có tx.
 *   NOSWAP         mốc giá bình thường, chưa đủ điều kiện. Không có tx.
 *   SWAP_PENDING   mốc này ĐÃ GỬI tx swap, CHƯA chắc tx thành công onchain.
 *                  Theo dõi `txHash` để set `status` là việc của server.
 *   WITHDRAW       swap hết về đồng gốc, bot dừng (config.isStop = true).
 *   RESET          swap hết về đồng gốc, mở vòng mới luôn.
 */
export const HISTORY_ACTION = {
    DEPOSIT: "DEPOSIT",
    SWAP_PENDING: "SWAP_PENDING",
    NOSWAP: "NOSWAP",
    WITHDRAW: "WITHDRAW",
    RESET: "RESET",
} as const;

export type HistoryAction = (typeof HISTORY_ACTION)[keyof typeof HISTORY_ACTION];

/** Mảng giá trị để khai `enum` trong schema (mongoose `enum: HISTORY_ACTIONS`). */
export const HISTORY_ACTIONS = Object.values(HISTORY_ACTION) as HistoryAction[];

/* ============================================================================
 * INPUT — server chuẩn bị
 * ========================================================================== */

/**
 * Một token trong `arrToken` server truyền vào MỖI MỐC.
 *
 *   symbol   ETH nhận ETH/WETH/CBETH, BTC nhận BTC/WBTC/CBBTC/BTCB. Bắt buộc có
 *            cả ETH và BTC. Thứ tự + danh sách token CỐ ĐỊNH từ lúc register.
 *   address  address token để gọi contract swap. Khoá từ lúc register — mốc
 *            sau truyền address khác là hàm throw (chống swap nhầm token).
 *   price    giá USD (bên server là `tokenPricePerUsd`), string hoặc number.
 */
export interface ArrTokenInput {
    symbol: string;
    address: TokenAddress;
    price: string | number;
}

/** Một mốc giá (data giả / data lịch sử dùng cho backtest). */
export interface PricePoint {
    /** Thời điểm của mốc, vd "09/10/2026 00:00". */
    time: string;
    arrToken: Array<{ symbol: string; price: number | string; address?: TokenAddress }>;
}

/**
 * Cài đặt user truyền MỘT LẦN lúc register (`registerTradeV4({ config })`).
 * Ví dụ: `CONFIG_REGISTER_INPUT` trong tradeV4_Data.ts.
 */
export interface RegisterConfigInput {
    /** Số token user nạp, đơn vị token (vd "1" = 1 ETH). */
    amountStart: string | number;
    /** Symbol đồng user nạp. Lúc rút/reset luôn swap về đồng này. */
    inputStart: string;
    /** Ngưỡng biến động, đơn vị % (vd "0.3" = 0.3%). */
    volatility: string | number;
    /** (tuỳ chọn) ví của user — thuật toán không đọc, chỉ lưu kèm. */
    address?: string;
    /** (tuỳ chọn) chainId — thuật toán không đọc, chỉ lưu kèm. */
    chainId?: number | string;
    /** (tuỳ chọn) list symbol user đăng ký chạy — thuật toán không đọc, chỉ lưu kèm. */
    tradeTokens?: string[];
}

/* ============================================================================
 * CONFIG — state của bot, LƯU NGUYÊN KHỐI vào bot (Setting.config)
 * ========================================================================== */

/**
 * `config.userConfig` — cài đặt user đã chuẩn hoá. Thuật toán CHỈ ĐỌC.
 * Lưu nguyên vẹn suốt vòng đời bot (withdraw/reset cần `inputStart`).
 */
export interface UserConfig {
    amountStart: DecimalString;
    /** UPPERCASE, đã quy ETH/WETH/CBETH → "ETH", BTC/WBTC/... → "BTC" nếu caller convert trước. */
    inputStart: TokenSymbol;
    volatility: DecimalString;
    /** Các field phụ caller truyền lúc register được giữ lại nguyên văn. */
    address?: string;
    chainId?: number | string;
    tradeTokens?: string[];
}

/** `config.state` — biến trạng thái thuật toán. Đúng interface State của indexV4.ts. */
export interface TradeState {
    /** Số token đang nắm giữ (của `outputSwap`). */
    amountInput: DecimalString;
    /** Symbol token đang nắm giữ. */
    outputSwap: TokenSymbol;
    /** Ứng viên swap của lần xét gần nhất (tầng 1 của điều kiện swap). */
    outputSwapTemp: TokenSymbol;
    /** perETH của từng token tại lần xét gần nhất. Map theo symbol. */
    ETHLastSwap: SymbolMap;
    /** perETH gốc để so (dời mốc khi >= 2 token vượt resetPoint). Map theo symbol. */
    perETHOriginal: SymbolMap;
    /** Vốn ban đầu quy ra ETH. */
    ETHOriginalAmount: DecimalString;
    /** v4: giá USD ứng với 1 point = giá đầu kỳ / 1000. Map theo symbol. */
    price1Point: SymbolMap;
}

/** Token của mốc TRƯỚC, lưu trong `config.itemPre.arrToken` (chỉ field mà mốc sau đọc lại). */
export interface TokenPre {
    symbol: TokenSymbol;
    address: TokenAddress;
    price: DecimalString;
    perETH: DecimalString;
    perETHChangePercentage: DecimalString;
    pointAfterCheck: DecimalString;
}

/** `config.itemPre` — mốc giá trước (thay cho `listData[index - 1]` của backtest). */
export interface ItemPre {
    /** Độ dài = số token của bot (3, 5, 12... đều được). */
    arrToken: TokenPre[];
}

/**
 * `config` — khối state trả về sau MỖI lần gọi, lưu ĐÈ xuống bot, mốc sau truyền
 * NGUYÊN KHỐI trở lại. Lưu một phần (vd lưu point mà không lưu amountInput) là
 * mốc sau tính sai mà không báo lỗi.
 */
export interface TradeConfig {
    userConfig: UserConfig;
    state: TradeState;
    itemPre: ItemPre;
    /** true sau khi withdraw → run/withdraw/reset sau đó sẽ throw. */
    isStop: boolean;
}

/* ============================================================================
 * HISTORY — một bản ghi / một mốc giá, INSERT vào collection history
 * ========================================================================== */

/** Số liệu từng token của một mốc, lưu trong `history.arrToken`. */
export interface HistoryToken {
    symbol: TokenSymbol;
    address: TokenAddress;
    /** Giá USD của mốc này. */
    price: DecimalString;
    /** Giá quy ra ETH (= price / price ETH). */
    perETH: DecimalString;
    /** Biến động perETH so với mốc trước (tỉ lệ, -0.01 = -1%). */
    perETHChangePercentage: DecimalString;
    /** Biến động quy ra điểm. */
    changeByPoint: DecimalString;
    /** Điểm của mốc này (mốc có swap thì kéo về 1000). */
    pointAfterCheck: DecimalString;
}

/** Phần "lệnh swap" của history. Không swap → isSwap false, các field còn lại null. */
export interface SwapFields {
    isSwap: boolean;
    /** Symbol token đem swap. */
    inputSwap: TokenSymbol | null;
    /** Symbol token nhận về. */
    outputSwap: TokenSymbol | null;
    /** Số token nhận về (lấy nguyên từ hàm swap). */
    amountSwap: DecimalString | null;
    txHash: string | null;
}

/** `history` — trả về sau mỗi lần gọi. Lưu ĐÚNG các field này, không thêm không bớt. */
export interface TradeHistory extends SwapFields {
    action: HistoryAction;
    /** Token đang nắm giữ SAU khi xử lý mốc này. */
    currentToken: TokenSymbol;
    currentAmount: DecimalString;
    arrToken: HistoryToken[];
    /** CHỈ có khi action = WITHDRAW. */
    amountWithdraw?: DecimalString;
    /** CHỈ có khi action = WITHDRAW — amountWithdraw - userConfig.amountStart. */
    pnl?: DecimalString;
}

/** Kết quả chung của cả 4 hàm register / run / withdraw / reset. */
export interface TradeResult {
    /** → INSERT vào collection history. */
    history: TradeHistory;
    /** → UPDATE đè vào bot. */
    config: TradeConfig;
}

/* ============================================================================
 * THAM SỐ 4 HÀM
 * ========================================================================== */

/** `registerTradeV4(params)` */
export interface RegisterTradeParams {
    config: RegisterConfigInput;
    arrToken: ArrTokenInput[];
}

/** `runTradeV4` / `withdrawTradeV4` / `resetTradeV4` */
export interface RunTradeParams {
    /** config lấy từ DB (output của lần gọi trước). */
    config: TradeConfig;
    arrToken: ArrTokenInput[];
    /** Truyền nguyên xuống hàm swap (tìm ví ký của bot). */
    idBot: string | number;
    /** Truyền nguyên xuống hàm swap. */
    chainId: string | number;
    /** Khoá chống gửi trùng tx. */
    swapId?: string;
    /**
     * Hàm swap GIẢ cho backtest / test. KHÔNG truyền (chạy thật) → helper không gửi
     * tx: history SWAP_PENDING mang `amountSwap = '0'`, `txHash = '0x'` tạm, server
     * tự gọi web3 swap rồi cập nhật lại (xem `TODO(server)` trong helper/tradeV4.ts).
     */
    swap?: SwapFn;
}
