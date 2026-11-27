/**
 * ============================================================================
 * TRADE V4 — DATA MẪU & SCHEMA MẪU  (dành cho team server)
 * ============================================================================
 *
 * File này KHÔNG có logic, chỉ có data. Đọc file này là đủ để biết phải lưu gì
 * xuống DB và nhận lại gì từ `tradeV4.ts`, không cần đọc thuật toán.
 *
 * Bộ số dưới đây là một bot 3 token (ETH / BTC / BNB) chạy 4 mốc giá, cố tình
 * chọn giá tròn để dễ nhẩm. Mọi `HISTORY_*` và `CONFIG_*` đều là output THẬT
 * của `tradeV4.ts` khi nạp các `ARR_TOKEN_*` trong file này.
 *
 * ---------------------------------------------------------------------------
 * 4 HÀM — tất cả đều trả về { history, config }
 * ---------------------------------------------------------------------------
 *
 *   registerTradeV4({ config, arrToken })                    user nạp tiền (đồng bộ, không swap)
 *   runTradeV4({ config, arrToken, idBot, chainId, swapId })  mỗi mốc giá của cron
 *   withdrawTradeV4({ ...như trên })                          rút + dừng bot
 *   resetTradeV4({ ...như trên })                             rút rồi chạy lại từ đầu
 *
 *   history  → INSERT một bản ghi vào collection history
 *   config   → UPDATE đè vào bot, mốc sau truyền NGUYÊN KHỐI trở lại
 *
 * Luồng cron:
 *
 *     const res = await runTradeV4({ config: bot.config, arrToken, idBot: bot._id, chainId, swapId });
 *     await History.create({ tradingSettingId: bot._id, swapId, ...res.history });
 *     await Setting.updateOne({ _id: bot._id }, { config: res.config });
 *
 * Hàm throw (gửi tx lỗi, giá rác, config thiếu) → KHÔNG lưu gì cả. Config
 * trong DB giữ nguyên, mốc sau xét lại từ đầu theo giá mới.
 *
 * Đừng chạy hai mốc song song cho cùng một bot.
 *
 * ---------------------------------------------------------------------------
 * 5 GIÁ TRỊ `history.action`
 * ---------------------------------------------------------------------------
 *
 *   DEPOSIT        register xong. Không có tx.
 *   NOSWAP         mốc giá bình thường, chưa đủ điều kiện. Không có tx.
 *   SWAP_PENDING   mốc này ĐÃ GỬI tx swap. CHƯA chắc tx thành công onchain —
 *                  `swapV4.ts` chỉ tạo hash rồi trả về ngay, không chờ confirm.
 *                  Theo dõi `txHash` để set `status` là việc của server.
 *   WITHDRAW       đã gửi tx swap hết về đồng gốc, bot dừng (config.isStop = true).
 *   RESET          đã gửi tx swap hết về đồng gốc, và mở vòng mới luôn.
 *
 * ---------------------------------------------------------------------------
 * TYPE + SCHEMA DATABASE — nằm riêng ở thư mục `types/`
 * ---------------------------------------------------------------------------
 *
 *   types/trade.ts      type của mọi khối dưới đây (ArrTokenInput, TradeConfig,
 *                       TradeHistory, ...) — mỗi field có chú thích
 *   types/database.ts   SettingV4Document / HistoryV4Document + mẫu mongoose,
 *                       index đề xuất, enum HISTORY_ACTIONS / HISTORY_STATUSES
 *
 *   Mỗi khối data trong file này đều khai type, nên sửa type mà data lệch là
 *   `npm run typecheck` báo lỗi ngay.
 *
 *   MỌI SỐ ĐỀU LÀ STRING, KHÔNG DÙNG Number (xem `DecimalString`).
 *
 * ---------------------------------------------------------------------------
 * arrToken — INPUT server phải chuẩn bị mỗi mốc
 * ---------------------------------------------------------------------------
 *
 *     [{ symbol: "ETH", address: "0x2170...", price: "2500" }, ...]
 *
 *   symbol   ETH nhận ETH/WETH/CBETH, BTC nhận BTC/WBTC/CBBTC/BTCB. Bắt buộc
 *            có cả ETH và BTC trong danh sách. Symbol là KEY của state nên
 *            phải giữ y nguyên suốt vòng đời bot.
 *   address  address token để gọi contract swap. Khoá từ lúc register — mốc
 *            sau truyền address khác là hàm throw (chống swap nhầm token).
 *   price    giá USD (bên server là `tokenPricePerUsd`), string hoặc number.
 *
 *   Danh sách token CỐ ĐỊNH từ lúc register. Muốn thêm/bớt token thì reset
 *   hoặc mở bot mới, không sửa bot đang chạy.
 *
 * ---------------------------------------------------------------------------
 * KỊCH BẢN CỦA BỘ DATA NÀY — vì sao mốc 3 mới swap
 * ---------------------------------------------------------------------------
 *
 *   User nạp 1 ETH, ngưỡng biến động 0.3%, bot 3 token.
 *
 *   register   ETH 2500   BTC 100000   BNB 650
 *              → perETH: ETH 1, BTC 40, BNB 0.26   (perETH = giá token / giá ETH)
 *              → mọi token 1000 điểm, price1Point: ETH 2.5, BTC 100, BNB 0.65
 *              → perETHOriginal (mốc gốc để so về sau) = perETH lúc này
 *
 *   mốc 1      ETH 2500   BTC 100000   BNB 643.5        → NOSWAP
 *              BNB perETH 0.2574, biến động -1% → rớt quá ngưỡng, BNB thành
 *              ứng viên. Nhưng 0.2574 < ETHLastSwap.BNB (0.26) → KHÔNG swap.
 *              Thuật toán ghi nhận: ETHLastSwap.BNB = 0.2574, outputSwapTemp = BNB.
 *
 *   mốc 2      ETH 2400   BTC 100000   BNB 643.5        → NOSWAP
 *              ETH giảm 4% nên ETH là ứng viên, mà ETH đang là đồng bot giữ
 *              → không tự swap vào chính nó. outputSwapTemp = ETH.
 *              BNB perETH tăng lên 0.268125 (vì ETH rẻ đi).
 *
 *   mốc 3      ETH 2400   BTC 100000   BNB 640          → SWAP_PENDING
 *              BNB perETH 0.26666..., biến động -0.54% → qua đủ 4 tầng:
 *                1. ứng viên BNB ≠ outputSwapTemp (ETH)                  ✓
 *                2. -0.54% rớt quá ngưỡng -0.3%                          ✓
 *                3. perETH 0.26666 ≥ ETHLastSwap.BNB 0.2574             ✓
 *                4. vốn quy ra ETH = 1 ≥ ETHOriginalAmount 1            ✓
 *                   perETH 0.26666 ≥ perETHOriginal.BNB 0.26            ✓
 *              → GỬI tx swap 1 ETH sang BNB, nhận 3.7425 BNB.
 *              → điểm của cả 3 token kéo về 1000.
 *
 *   mốc 4      ETH 2400   BTC 100000   BNB 640
 *              withdraw → swap 3.7425 BNB về 0.996004 ETH, pnl -0.003996, bot dừng
 *              reset    → cũng swap về 0.996004 ETH nhưng mở vòng mới ngay với
 *                         amountStart = 0.996004
 *
 *   (Số nhận về 3.7425 / 0.996004 là của hàm swap — ở đây mô phỏng trừ 0.2%
 *   phí + slippage. Thuật toán lấy NGUYÊN số hàm swap trả về, không tính lại.)
 * ============================================================================
 */

import type {
  ArrTokenInput,
  RegisterConfigInput,
  SwapParams,
  SwapResult,
  TradeConfig,
  TradeHistory,
} from "../types";

/** Một lần gọi hàm swap: tham số vào + kết quả ra. */
export interface SwapCall {
  in: Omit<SwapParams, "priceTokenIn" | "priceTokenOut"> & Partial<Pick<SwapParams, "priceTokenIn" | "priceTokenOut">>;
  out: SwapResult;
}

// ============================================================================
// INPUT — arrToken của 4 mốc giá
// ============================================================================

// Mốc register: ETH 2500, BTC 100000, BNB 650.
export const ARR_TOKEN_REGISTER: ArrTokenInput[] = [
  {
    "symbol": "ETH",
    "address": "0x2170Ed0880ac9A755fd29B2688956BD959F933F8",
    "price": "2500"
  },
  {
    "symbol": "BTC",
    "address": "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c",
    "price": "100000"
  },
  {
    "symbol": "BNB",
    "address": "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
    "price": "650"
  }
];

// Mốc 1: BNB giảm 1% so với ETH → ứng viên BNB, nhưng chưa swap.
export const ARR_TOKEN_T1: ArrTokenInput[] = [
  {
    "symbol": "ETH",
    "address": "0x2170Ed0880ac9A755fd29B2688956BD959F933F8",
    "price": "2500"
  },
  {
    "symbol": "BTC",
    "address": "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c",
    "price": "100000"
  },
  {
    "symbol": "BNB",
    "address": "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
    "price": "643.5"
  }
];

// Mốc 2: ETH giảm 4% → ứng viên là chính đồng đang giữ, không swap.
export const ARR_TOKEN_T2: ArrTokenInput[] = [
  {
    "symbol": "ETH",
    "address": "0x2170Ed0880ac9A755fd29B2688956BD959F933F8",
    "price": "2400"
  },
  {
    "symbol": "BTC",
    "address": "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c",
    "price": "100000"
  },
  {
    "symbol": "BNB",
    "address": "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
    "price": "643.5"
  }
];

// Mốc 3: BNB giảm 0.54% so với ETH → đủ điều kiện, swap ETH sang BNB.
export const ARR_TOKEN_T3: ArrTokenInput[] = [
  {
    "symbol": "ETH",
    "address": "0x2170Ed0880ac9A755fd29B2688956BD959F933F8",
    "price": "2400"
  },
  {
    "symbol": "BTC",
    "address": "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c",
    "price": "100000"
  },
  {
    "symbol": "BNB",
    "address": "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
    "price": "640"
  }
];

// Mốc 4: dùng cho withdraw / reset (giá giữ nguyên như mốc 3).
export const ARR_TOKEN_T4: ArrTokenInput[] = [
  {
    "symbol": "ETH",
    "address": "0x2170Ed0880ac9A755fd29B2688956BD959F933F8",
    "price": "2400"
  },
  {
    "symbol": "BTC",
    "address": "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c",
    "price": "100000"
  },
  {
    "symbol": "BNB",
    "address": "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
    "price": "640"
  }
];

// ============================================================================
// INPUT — cài đặt của user, chỉ truyền một lần lúc register
// ============================================================================

// amountStart: số user nạp | inputStart: nạp bằng đồng gì | volatility: ngưỡng biến động %
export const CONFIG_REGISTER_INPUT: RegisterConfigInput = {
  "amountStart": "1",
  "inputStart": "ETH",
  "volatility": "0.3"
};

// ============================================================================
// OUTPUT — registerTradeV4({ config: CONFIG_REGISTER_INPUT, arrToken: ARR_TOKEN_REGISTER })
// ============================================================================

// INSERT vào history. Không có tx: inputSwap/outputSwap/amountSwap/txHash = null.
export const HISTORY_DEPOSIT: TradeHistory = {
  "action": "DEPOSIT",
  "isSwap": false,
  "inputSwap": null,
  "outputSwap": null,
  "amountSwap": null,
  "txHash": null,
  "currentToken": "ETH",
  "currentAmount": "1",
  "arrToken": [
    {
      "symbol": "ETH",
      "address": "0x2170Ed0880ac9A755fd29B2688956BD959F933F8",
      "price": "2500",
      "perETH": "1",
      "perETHChangePercentage": "0",
      "changeByPoint": "0",
      "pointAfterCheck": "1000"
    },
    {
      "symbol": "BTC",
      "address": "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c",
      "price": "100000",
      "perETH": "40",
      "perETHChangePercentage": "0",
      "changeByPoint": "0",
      "pointAfterCheck": "1000"
    },
    {
      "symbol": "BNB",
      "address": "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
      "price": "650",
      "perETH": "0.26",
      "perETHChangePercentage": "0",
      "changeByPoint": "0",
      "pointAfterCheck": "1000"
    }
  ]
};

// UPDATE vào bot. Mốc giá đầu tiên truyền NGUYÊN KHỐI này vào runTradeV4.
export const CONFIG_AFTER_REGISTER: TradeConfig = {
  "userConfig": {
    "amountStart": "1",
    "inputStart": "ETH",
    "volatility": "0.3"
  },
  "state": {
    "amountInput": "1",
    "outputSwap": "ETH",
    "outputSwapTemp": "ETH",
    "ETHLastSwap": {
      "ETH": "1",
      "BTC": "40",
      "BNB": "0.26"
    },
    "perETHOriginal": {
      "ETH": "1",
      "BTC": "40",
      "BNB": "0.26"
    },
    "ETHOriginalAmount": "1",
    "price1Point": {
      "ETH": "2.5",
      "BTC": "100",
      "BNB": "0.65"
    }
  },
  "itemPre": {
    "arrToken": [
      {
        "symbol": "ETH",
        "address": "0x2170Ed0880ac9A755fd29B2688956BD959F933F8",
        "price": "2500",
        "perETH": "1",
        "perETHChangePercentage": "0",
        "pointAfterCheck": "1000"
      },
      {
        "symbol": "BTC",
        "address": "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c",
        "price": "100000",
        "perETH": "40",
        "perETHChangePercentage": "0",
        "pointAfterCheck": "1000"
      },
      {
        "symbol": "BNB",
        "address": "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
        "price": "650",
        "perETH": "0.26",
        "perETHChangePercentage": "0",
        "pointAfterCheck": "1000"
      }
    ]
  },
  "isStop": false
};

// ============================================================================
// OUTPUT — mốc 1: runTradeV4(config ở trên, ARR_TOKEN_T1)
// ============================================================================

// action NOSWAP — không tx. BNB biến động -1% nhưng chưa vượt mốc lần xét trước.
export const HISTORY_NOSWAP_T1: TradeHistory = {
  "action": "NOSWAP",
  "isSwap": false,
  "inputSwap": null,
  "outputSwap": null,
  "amountSwap": null,
  "txHash": null,
  "currentToken": "ETH",
  "currentAmount": "1",
  "arrToken": [
    {
      "symbol": "ETH",
      "address": "0x2170Ed0880ac9A755fd29B2688956BD959F933F8",
      "price": "2500",
      "perETH": "1",
      "perETHChangePercentage": "0",
      "changeByPoint": "0",
      "pointAfterCheck": "1000"
    },
    {
      "symbol": "BTC",
      "address": "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c",
      "price": "100000",
      "perETH": "40",
      "perETHChangePercentage": "0",
      "changeByPoint": "0",
      "pointAfterCheck": "1000"
    },
    {
      "symbol": "BNB",
      "address": "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
      "price": "643.5",
      "perETH": "0.2574",
      "perETHChangePercentage": "-0.01",
      "changeByPoint": "-10",
      "pointAfterCheck": "990"
    }
  ]
};

// state.ETHLastSwap.BNB dời xuống 0.2574, outputSwapTemp = BNB (ứng viên mốc này).
export const CONFIG_AFTER_T1: TradeConfig = {
  "userConfig": {
    "amountStart": "1",
    "inputStart": "ETH",
    "volatility": "0.3"
  },
  "state": {
    "amountInput": "1",
    "outputSwap": "ETH",
    "outputSwapTemp": "BNB",
    "ETHLastSwap": {
      "ETH": "1",
      "BTC": "40",
      "BNB": "0.2574"
    },
    "perETHOriginal": {
      "ETH": "1",
      "BTC": "40",
      "BNB": "0.26"
    },
    "ETHOriginalAmount": "1",
    "price1Point": {
      "ETH": "2.5",
      "BTC": "100",
      "BNB": "0.65"
    }
  },
  "itemPre": {
    "arrToken": [
      {
        "symbol": "ETH",
        "address": "0x2170Ed0880ac9A755fd29B2688956BD959F933F8",
        "price": "2500",
        "perETH": "1",
        "perETHChangePercentage": "0",
        "pointAfterCheck": "1000"
      },
      {
        "symbol": "BTC",
        "address": "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c",
        "price": "100000",
        "perETH": "40",
        "perETHChangePercentage": "0",
        "pointAfterCheck": "1000"
      },
      {
        "symbol": "BNB",
        "address": "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
        "price": "643.5",
        "perETH": "0.2574",
        "perETHChangePercentage": "-0.01",
        "pointAfterCheck": "990"
      }
    ]
  },
  "isStop": false
};

// ============================================================================
// OUTPUT — mốc 2: runTradeV4(CONFIG_AFTER_T1, ARR_TOKEN_T2)
// ============================================================================

// action NOSWAP — ứng viên là ETH, đúng đồng bot đang giữ nên không swap.
export const HISTORY_NOSWAP_T2: TradeHistory = {
  "action": "NOSWAP",
  "isSwap": false,
  "inputSwap": null,
  "outputSwap": null,
  "amountSwap": null,
  "txHash": null,
  "currentToken": "ETH",
  "currentAmount": "1",
  "arrToken": [
    {
      "symbol": "ETH",
      "address": "0x2170Ed0880ac9A755fd29B2688956BD959F933F8",
      "price": "2400",
      "perETH": "1",
      "perETHChangePercentage": "-0.04",
      "changeByPoint": "-40",
      "pointAfterCheck": "960"
    },
    {
      "symbol": "BTC",
      "address": "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c",
      "price": "100000",
      "perETH": "41.66666666666666666667",
      "perETHChangePercentage": "0.04166666666666666667",
      "changeByPoint": "0",
      "pointAfterCheck": "1000"
    },
    {
      "symbol": "BNB",
      "address": "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
      "price": "643.5",
      "perETH": "0.268125",
      "perETHChangePercentage": "0.04166666666666666667",
      "changeByPoint": "0",
      "pointAfterCheck": "990"
    }
  ]
};

// outputSwapTemp = ETH. Nhờ vậy mốc 3 ứng viên BNB mới qua được tầng 1.
export const CONFIG_AFTER_T2: TradeConfig = {
  "userConfig": {
    "amountStart": "1",
    "inputStart": "ETH",
    "volatility": "0.3"
  },
  "state": {
    "amountInput": "1",
    "outputSwap": "ETH",
    "outputSwapTemp": "ETH",
    "ETHLastSwap": {
      "ETH": "1",
      "BTC": "40",
      "BNB": "0.2574"
    },
    "perETHOriginal": {
      "ETH": "1",
      "BTC": "40",
      "BNB": "0.26"
    },
    "ETHOriginalAmount": "1",
    "price1Point": {
      "ETH": "2.5",
      "BTC": "100",
      "BNB": "0.65"
    }
  },
  "itemPre": {
    "arrToken": [
      {
        "symbol": "ETH",
        "address": "0x2170Ed0880ac9A755fd29B2688956BD959F933F8",
        "price": "2400",
        "perETH": "1",
        "perETHChangePercentage": "-0.04",
        "pointAfterCheck": "960"
      },
      {
        "symbol": "BTC",
        "address": "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c",
        "price": "100000",
        "perETH": "41.66666666666666666667",
        "perETHChangePercentage": "0.04166666666666666667",
        "pointAfterCheck": "1000"
      },
      {
        "symbol": "BNB",
        "address": "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
        "price": "643.5",
        "perETH": "0.268125",
        "perETHChangePercentage": "0.04166666666666666667",
        "pointAfterCheck": "990"
      }
    ]
  },
  "isStop": false
};

// ============================================================================
// OUTPUT — mốc 3: runTradeV4(CONFIG_AFTER_T2, ARR_TOKEN_T3) → CÓ SWAP
// ============================================================================

// tradeV4.ts gọi hàm swap (swapBuy của swapV4.ts) với IN và nhận OUT.
// OUT.amount là số tokenOut của lệnh VỪA GỬI — không chờ tx confirm onchain.
// amount trong IN là số tokenIn đem swap, đơn vị token (KHÔNG phải wei).
export const SWAP_CALL: SwapCall = {
  "in": {
    "idBot": "68f1c0a9e3b94a0012ab34cd",
    "chainId": "56",
    "swapId": "swap-0003",
    "tokenIn": "0x2170Ed0880ac9A755fd29B2688956BD959F933F8",
    "tokenOut": "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
    "amount": "1"
  },
  "out": {
    "txHash": "0x9f2c1b7a4e8d3f56a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f708192a3b4c5d",
    "amount": "3.7425"
  }
};

// action SWAP_PENDING. amountSwap = SWAP_CALL.out.amount (lấy nguyên, không tính lại).
// pointAfterCheck của cả 3 token về 1000 vì mốc này có swap.
export const HISTORY_SWAP_PENDING: TradeHistory = {
  "action": "SWAP_PENDING",
  "isSwap": true,
  "inputSwap": "ETH",
  "outputSwap": "BNB",
  "amountSwap": "3.7425",
  "txHash": "0x9f2c1b7a4e8d3f56a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f708192a3b4c5d",
  "currentToken": "BNB",
  "currentAmount": "3.7425",
  "arrToken": [
    {
      "symbol": "ETH",
      "address": "0x2170Ed0880ac9A755fd29B2688956BD959F933F8",
      "price": "2400",
      "perETH": "1",
      "perETHChangePercentage": "0",
      "changeByPoint": "0",
      "pointAfterCheck": "1000"
    },
    {
      "symbol": "BTC",
      "address": "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c",
      "price": "100000",
      "perETH": "41.66666666666666666667",
      "perETHChangePercentage": "0",
      "changeByPoint": "0",
      "pointAfterCheck": "1000"
    },
    {
      "symbol": "BNB",
      "address": "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
      "price": "640",
      "perETH": "0.26666666666666666667",
      "perETHChangePercentage": "-0.00543900543900543899",
      "changeByPoint": "-5.38461538461538461538",
      "pointAfterCheck": "1000"
    }
  ]
};

// amountInput + outputSwap đổi sang BNB. ETHLastSwap.BNB dời theo ứng viên,
// perETHOriginal.BNB vẫn giữ mốc gốc 0.26. itemPre.arrToken là mốc 3.
export const CONFIG_AFTER_SWAP: TradeConfig = {
  "userConfig": {
    "amountStart": "1",
    "inputStart": "ETH",
    "volatility": "0.3"
  },
  "state": {
    "amountInput": "3.7425",
    "outputSwap": "BNB",
    "outputSwapTemp": "BNB",
    "ETHLastSwap": {
      "ETH": "1",
      "BTC": "40",
      "BNB": "0.26666666666666666667"
    },
    "perETHOriginal": {
      "ETH": "1",
      "BTC": "40",
      "BNB": "0.26"
    },
    "ETHOriginalAmount": "1",
    "price1Point": {
      "ETH": "2.5",
      "BTC": "100",
      "BNB": "0.65"
    }
  },
  "itemPre": {
    "arrToken": [
      {
        "symbol": "ETH",
        "address": "0x2170Ed0880ac9A755fd29B2688956BD959F933F8",
        "price": "2400",
        "perETH": "1",
        "perETHChangePercentage": "0",
        "pointAfterCheck": "1000"
      },
      {
        "symbol": "BTC",
        "address": "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c",
        "price": "100000",
        "perETH": "41.66666666666666666667",
        "perETHChangePercentage": "0",
        "pointAfterCheck": "1000"
      },
      {
        "symbol": "BNB",
        "address": "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
        "price": "640",
        "perETH": "0.26666666666666666667",
        "perETHChangePercentage": "-0.00543900543900543899",
        "pointAfterCheck": "1000"
      }
    ]
  },
  "isStop": false
};

// ============================================================================
// OUTPUT — withdrawTradeV4(CONFIG_AFTER_SWAP, ARR_TOKEN_T4)
// ============================================================================

// Swap hết 3.7425 BNB đang giữ về ETH (= userConfig.inputStart).
export const SWAP_CALL_WITHDRAW: SwapCall = {
  "in": {
    "idBot": "68f1c0a9e3b94a0012ab34cd",
    "chainId": "56",
    "swapId": "swap-0004",
    "tokenIn": "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
    "tokenOut": "0x2170Ed0880ac9A755fd29B2688956BD959F933F8",
    "amount": "3.7425"
  },
  "out": {
    "txHash": "0x3a7e5c1d9b2f84a6c0e1d2b3f4a5968778695a4b3c2d1e0f9a8b7c6d5e4f3a2b",
    "amount": "0.996004"
  }
};

// action WITHDRAW, có thêm amountWithdraw và pnl.
// pnl = amountWithdraw - userConfig.amountStart (vào/ra cùng một đồng nên trừ thẳng).
export const HISTORY_WITHDRAW: TradeHistory = {
  "action": "WITHDRAW",
  "isSwap": true,
  "inputSwap": "BNB",
  "outputSwap": "ETH",
  "amountSwap": "0.996004",
  "txHash": "0x3a7e5c1d9b2f84a6c0e1d2b3f4a5968778695a4b3c2d1e0f9a8b7c6d5e4f3a2b",
  "currentToken": "ETH",
  "currentAmount": "0.996004",
  "arrToken": [
    {
      "symbol": "ETH",
      "address": "0x2170Ed0880ac9A755fd29B2688956BD959F933F8",
      "price": "2400",
      "perETH": "1",
      "perETHChangePercentage": "0",
      "changeByPoint": "0",
      "pointAfterCheck": "1000"
    },
    {
      "symbol": "BTC",
      "address": "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c",
      "price": "100000",
      "perETH": "41.66666666666666666667",
      "perETHChangePercentage": "0",
      "changeByPoint": "0",
      "pointAfterCheck": "1000"
    },
    {
      "symbol": "BNB",
      "address": "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
      "price": "640",
      "perETH": "0.26666666666666666667",
      "perETHChangePercentage": "0",
      "changeByPoint": "0",
      "pointAfterCheck": "1000"
    }
  ],
  "amountWithdraw": "0.996004",
  "pnl": "-0.003996"
};

// isStop = true → gọi run/withdraw/reset với config này sẽ throw.
// Server nên set closed = true cho bot. Chuyển tiền về ví user làm sau khi tx lên chain.
export const CONFIG_AFTER_WITHDRAW: TradeConfig = {
  "userConfig": {
    "amountStart": "1",
    "inputStart": "ETH",
    "volatility": "0.3"
  },
  "state": {
    "amountInput": "0.996004",
    "outputSwap": "ETH",
    "outputSwapTemp": "BNB",
    "ETHLastSwap": {
      "ETH": "1",
      "BTC": "40",
      "BNB": "0.26666666666666666667"
    },
    "perETHOriginal": {
      "ETH": "1",
      "BTC": "40",
      "BNB": "0.26"
    },
    "ETHOriginalAmount": "1",
    "price1Point": {
      "ETH": "2.5",
      "BTC": "100",
      "BNB": "0.65"
    }
  },
  "itemPre": {
    "arrToken": [
      {
        "symbol": "ETH",
        "address": "0x2170Ed0880ac9A755fd29B2688956BD959F933F8",
        "price": "2400",
        "perETH": "1",
        "perETHChangePercentage": "0",
        "pointAfterCheck": "1000"
      },
      {
        "symbol": "BTC",
        "address": "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c",
        "price": "100000",
        "perETH": "41.66666666666666666667",
        "perETHChangePercentage": "0",
        "pointAfterCheck": "1000"
      },
      {
        "symbol": "BNB",
        "address": "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
        "price": "640",
        "perETH": "0.26666666666666666667",
        "perETHChangePercentage": "0",
        "pointAfterCheck": "1000"
      }
    ]
  },
  "isStop": true
};

// ============================================================================
// OUTPUT — resetTradeV4(CONFIG_AFTER_SWAP, ARR_TOKEN_T4)
// ============================================================================

// action RESET. inputSwap/outputSwap/amountSwap/txHash là lệnh swap về đồng gốc;
// arrToken + currentAmount đã là trạng thái ĐẦU VÒNG MỚI (điểm 1000, biến động 0).
export const HISTORY_RESET: TradeHistory = {
  "action": "RESET",
  "isSwap": true,
  "inputSwap": "BNB",
  "outputSwap": "ETH",
  "amountSwap": "0.996004",
  "txHash": "0x3a7e5c1d9b2f84a6c0e1d2b3f4a5968778695a4b3c2d1e0f9a8b7c6d5e4f3a2b",
  "currentToken": "ETH",
  "currentAmount": "0.996004",
  "arrToken": [
    {
      "symbol": "ETH",
      "address": "0x2170Ed0880ac9A755fd29B2688956BD959F933F8",
      "price": "2400",
      "perETH": "1",
      "perETHChangePercentage": "0",
      "changeByPoint": "0",
      "pointAfterCheck": "1000"
    },
    {
      "symbol": "BTC",
      "address": "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c",
      "price": "100000",
      "perETH": "41.66666666666666666667",
      "perETHChangePercentage": "0",
      "changeByPoint": "0",
      "pointAfterCheck": "1000"
    },
    {
      "symbol": "BNB",
      "address": "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
      "price": "640",
      "perETH": "0.26666666666666666667",
      "perETHChangePercentage": "0",
      "changeByPoint": "0",
      "pointAfterCheck": "1000"
    }
  ]
};

// Vòng mới: amountStart = số vừa swap về, điểm 1000, price1Point khoá lại theo
// giá mốc reset, perETHOriginal/ETHLastSwap lấy perETH mốc reset. isStop = false.
export const CONFIG_AFTER_RESET: TradeConfig = {
  "userConfig": {
    "amountStart": "0.996004",
    "inputStart": "ETH",
    "volatility": "0.3"
  },
  "state": {
    "amountInput": "0.996004",
    "outputSwap": "ETH",
    "outputSwapTemp": "ETH",
    "ETHLastSwap": {
      "ETH": "1",
      "BTC": "41.66666666666666666667",
      "BNB": "0.26666666666666666667"
    },
    "perETHOriginal": {
      "ETH": "1",
      "BTC": "41.66666666666666666667",
      "BNB": "0.26666666666666666667"
    },
    "ETHOriginalAmount": "0.996004",
    "price1Point": {
      "ETH": "2.4",
      "BTC": "100",
      "BNB": "0.64"
    }
  },
  "itemPre": {
    "arrToken": [
      {
        "symbol": "ETH",
        "address": "0x2170Ed0880ac9A755fd29B2688956BD959F933F8",
        "price": "2400",
        "perETH": "1",
        "perETHChangePercentage": "0",
        "pointAfterCheck": "1000"
      },
      {
        "symbol": "BTC",
        "address": "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c",
        "price": "100000",
        "perETH": "41.66666666666666666667",
        "perETHChangePercentage": "0",
        "pointAfterCheck": "1000"
      },
      {
        "symbol": "BNB",
        "address": "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
        "price": "640",
        "perETH": "0.26666666666666666667",
        "perETHChangePercentage": "0",
        "pointAfterCheck": "1000"
      }
    ]
  },
  "isStop": false
};

// ============================================================================
// Ghép lại một vòng đời bot
// ============================================================================
//
//   registerTradeV4({ config: CONFIG_REGISTER_INPUT, arrToken: ARR_TOKEN_REGISTER })
//       → { history: HISTORY_DEPOSIT,      config: CONFIG_AFTER_REGISTER }
//
//   runTradeV4({ config: CONFIG_AFTER_REGISTER, arrToken: ARR_TOKEN_T1, idBot, chainId, swapId })
//       → { history: HISTORY_NOSWAP_T1,    config: CONFIG_AFTER_T1 }
//
//   runTradeV4({ config: CONFIG_AFTER_T1,  arrToken: ARR_TOKEN_T2, ... })
//       → { history: HISTORY_NOSWAP_T2,    config: CONFIG_AFTER_T2 }
//
//   runTradeV4({ config: CONFIG_AFTER_T2,  arrToken: ARR_TOKEN_T3, ... })
//       → gọi swapV4:  SWAP_CALL.in → SWAP_CALL.out
//       → { history: HISTORY_SWAP_PENDING, config: CONFIG_AFTER_SWAP }
//
//   withdrawTradeV4({ config: CONFIG_AFTER_SWAP, arrToken: ARR_TOKEN_T4, ... })
//       → gọi swapV4:  SWAP_CALL_WITHDRAW.in → SWAP_CALL_WITHDRAW.out
//       → { history: HISTORY_WITHDRAW,     config: CONFIG_AFTER_WITHDRAW }   // isStop = true
//
//   resetTradeV4({ config: CONFIG_AFTER_SWAP, arrToken: ARR_TOKEN_T4, ... })
//       → { history: HISTORY_RESET,        config: CONFIG_AFTER_RESET }      // vòng mới
