/**
 * ============================================================================
 * TYPES — DATABASE: schema gợi ý cho team server (2 collection)
 * ============================================================================
 *
 * File này KHÔNG có logic. Đọc file này (cùng `types/trade.ts`) là đủ để cấu
 * hình schema database, không cần đọc thuật toán.
 *
 *   1) SETTING  — một bản ghi / một bot       → `SettingV4Document`
 *   2) HISTORY  — một bản ghi / một mốc giá   → `HistoryV4Document`
 *
 * Mỗi document gồm 2 phần:
 *   - phần của THUẬT TOÁN: lưu nguyên văn output của tradeV4.ts, không sửa
 *   - phần SERVER TỰ QUẢN: thuật toán không đọc, server tự đặt tên/thêm bớt
 *
 * Generic `TId` = kiểu id của DB (mongoose: `Types.ObjectId`, SQL: `string`/`number`).
 *
 * ---------------------------------------------------------------------------
 * LUỒNG CRON
 * ---------------------------------------------------------------------------
 *
 *     // 1. user gọi api init
 *     const { history, config } = registerTradeV4({ config: setting, arrToken });
 *     await History.create({ tradingSettingId: bot._id, ...history });
 *     await Setting.updateOne({ _id: bot._id }, { config });
 *
 *     // 2. mỗi mốc giá
 *     const res = await runTradeV4({ config: bot.config, arrToken, idBot: bot._id, chainId, swapId });
 *     await History.create({ tradingSettingId: bot._id, swapId, ...res.history });
 *     await Setting.updateOne({ _id: bot._id }, { config: res.config });
 *
 * Hàm throw (gửi tx lỗi, giá rác, config thiếu) → KHÔNG lưu gì cả. Config
 * trong DB giữ nguyên, mốc sau xét lại từ đầu theo giá mới.
 * Đừng chạy hai mốc song song cho cùng một bot.
 *
 * ---------------------------------------------------------------------------
 * MẪU MONGOOSE
 * ---------------------------------------------------------------------------
 *
 *     const SettingV4Schema = new Schema({
 *       userId:     { type: ObjectId, index: true },
 *       chainId:    { type: String },
 *       minute:     { type: Number },
 *       config:     { type: Schema.Types.Mixed },   // TradeConfig — LƯU NGUYÊN KHỐI
 *       lastSwapId: { type: String },
 *       closed:     { type: Boolean, default: false },
 *       deleted:    { type: Boolean, default: false },
 *     }, { timestamps: true });
 *
 *   `config` để Mixed (Postgres: JSONB) là CỐ Ý: `state.ETHLastSwap`,
 *   `state.price1Point`, `state.perETHOriginal` là map có key là symbol của chính
 *   bot đó, còn `itemPre.arrToken` dài theo số token của bot. Khai cứng từng
 *   field sẽ vỡ ngay khi mở bot có bộ token khác. Cấu trúc bên trong: `TradeConfig`.
 *
 *     const HistoryTokenSchema = new Schema({
 *       symbol: String, address: String, price: String, perETH: String,
 *       perETHChangePercentage: String, changeByPoint: String, pointAfterCheck: String,
 *     }, { _id: false });
 *
 *     const HistoryV4Schema = new Schema({
 *       tradingSettingId: { type: ObjectId, index: true },
 *       action:         { type: String, enum: HISTORY_ACTIONS },
 *       isSwap:         { type: Boolean },
 *       inputSwap:      { type: String, default: null },
 *       outputSwap:     { type: String, default: null },
 *       amountSwap:     { type: String, default: null },
 *       txHash:         { type: String, default: null },
 *       currentToken:   { type: String },
 *       currentAmount:  { type: String },
 *       arrToken:       [HistoryTokenSchema],
 *       amountWithdraw: { type: String },
 *       pnl:            { type: String },
 *       swapId:         { type: String, index: true },
 *       status:         { type: String, enum: HISTORY_STATUSES },
 *       retries:        { type: Number, default: 0 },
 *     }, { timestamps: true });
 *
 *   Index đề xuất: history { tradingSettingId: 1, createdAt: -1 }, { swapId: 1 },
 *   { txHash: 1 } (sparse); setting { userId: 1 }, { minute: 1, closed: 1, deleted: 1 }.
 *
 *   ⚠ MỌI SỐ CỦA THUẬT TOÁN ĐỀU LÀ STRING (Mongo: String, SQL: TEXT/NUMERIC(78,30)),
 *   KHÔNG dùng Number/Double — mất chữ số thập phân là mốc sau tính lệch.
 * ============================================================================
 */

import type { HistoryAction, TradeConfig, TradeHistory } from "./trade";

export { HISTORY_ACTIONS } from "./trade";
export type { HistoryAction } from "./trade";

/* ============================================================================
 * Trạng thái tx do SERVER quản (thuật toán không đọc / không ghi)
 * ========================================================================== */

/**
 * `history.status` — server theo dõi `txHash` rồi set.
 *   PENDING     vừa gửi tx (mặc định của SWAP_PENDING / WITHDRAW / RESET)
 *   PROCESSING  đang theo dõi / limit-order đang chờ khớp
 *   SUCCESS     tx thành công onchain
 *   FAILED      tx fail → số trong config lệch số dư thật, server phải xử lý
 */
export const HISTORY_STATUS = {
    PENDING: "PENDING",
    PROCESSING: "PROCESSING",
    SUCCESS: "SUCCESS",
    FAILED: "FAILED",
} as const;

export type HistoryStatus = (typeof HISTORY_STATUS)[keyof typeof HISTORY_STATUS];

export const HISTORY_STATUSES = Object.values(HISTORY_STATUS) as HistoryStatus[];

/* ============================================================================
 * 1) SETTING — một bản ghi / một bot
 * ========================================================================== */

export interface SettingV4Document<TId = string> {
    _id: TId;
    userId: TId;
    /** vd "8453" */
    chainId: string;
    /** Phút trong giờ để cron gom bot. */
    minute?: number;

    /** ----- khối của thuật toán: LƯU NGUYÊN KHỐI, KHÔNG lưu một phần ----- */
    config: TradeConfig;

    /** ----- server tự quản, thuật toán không đọc ----- */
    /** Đang có tx thì khoá, không chạy mốc mới. */
    lastSwapId?: string | null;
    /** Set true khi config.isStop = true. */
    closed: boolean;
    deleted: boolean;
    createdAt?: Date;
    updatedAt?: Date;
}

/* ============================================================================
 * 2) HISTORY — một bản ghi / một mốc giá
 * ========================================================================== */

/**
 * = `TradeHistory` (nguyên văn output của tradeV4.ts) + field server tự quản.
 *
 * KHÔNG lưu `pointBeforeCheck` và `ETHLastSwapTemp`: đó là biến xử lý trong
 * một mốc, thuật toán không trả về.
 */
export interface HistoryV4Document<TId = string> extends TradeHistory {
    _id: TId;
    /** id của SettingV4Document. */
    tradingSettingId: TId;
    action: HistoryAction;

    /** ----- server tự quản, thuật toán không đọc ----- */
    swapId?: string | null;
    status?: HistoryStatus;
    retries?: number;
    createdAt?: Date;
    updatedAt?: Date;
}
