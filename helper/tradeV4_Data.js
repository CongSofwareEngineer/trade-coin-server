/**
 * ============================================================================
 * TRADE V4 — DATA MẪU & SCHEMA MẪU  (dành cho team server)
 * ============================================================================
 *
 * File này KHÔNG có logic, chỉ có data. Đọc file này là đủ để biết phải lưu gì
 * xuống DB và nhận lại gì từ `tradeV4.js`, không cần đọc thuật toán.
 *
 * Bộ số dưới đây là một bot 3 token (ETH / BTC / BNB) chạy 4 mốc giá, cố tình
 * chọn giá tròn để dễ nhẩm. Mọi `HISTORY_*` và `CONFIG_*` đều là output THẬT
 * của `tradeV4.js` khi nạp các `ARR_TOKEN_*` trong file này.
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
 *                  `swapV4.js` chỉ tạo hash rồi trả về ngay, không chờ confirm.
 *                  Theo dõi `txHash` để set `status` là việc của server.
 *   WITHDRAW       đã gửi tx swap hết về đồng gốc, bot dừng (config.isStop = true).
 *   RESET          đã gửi tx swap hết về đồng gốc, và mở vòng mới luôn.
 *
 * ---------------------------------------------------------------------------
 * SCHEMA MẪU — 2 collection
 * ---------------------------------------------------------------------------
 *
 * 1) SETTING — một bản ghi / một bot
 *
 *     const SettingV4Schema = new Schema({
 *       userId:  { type: ObjectId, index: true },
 *       chainId: { type: String },              // "56"
 *       minute:  { type: Number },              // phút trong giờ để cron gom bot
 *
 *       // ----- khối của thuật toán: LƯU NGUYÊN KHỐI, KHÔNG lưu một phần -----
 *       config:  { type: Schema.Types.Mixed },
 *
 *       // ----- server tự quản, thuật toán không đọc -----
 *       lastSwapId: { type: String },                   // đang có tx thì khoá, không chạy mốc mới
 *       closed:     { type: Boolean, default: false },  // set true khi config.isStop = true
 *       deleted:    { type: Boolean, default: false },
 *     }, { timestamps: true });
 *
 *   `config` để Mixed là CỐ Ý: `state.ETHLastSwap`, `state.price1Point`,
 *   `state.perETHOriginal` là map có key là symbol của chính bot đó, còn
 *   `itemPre.arrToken` dài theo số token của bot (3, 5, 7 token đều được).
 *   Khai cứng từng field sẽ vỡ ngay khi mở bot 5 token.
 *
 *   Muốn khai rõ thì theo đúng 4 nhánh của `CONFIG_AFTER_REGISTER`:
 *
 *     config.userConfig  { amountStart, inputStart, volatility }
 *     config.state       { amountInput, outputSwap, outputSwapTemp, ETHLastSwap,
 *                          perETHOriginal, ETHOriginalAmount, price1Point }
 *     config.itemPre     { arrToken: [{ symbol, address, price, perETH,
 *                          perETHChangePercentage, pointAfterCheck }] }
 *     config.isStop      Boolean
 *
 * 2) HISTORY — một bản ghi / một mốc giá
 *
 *     const HistoryV4Schema = new Schema({
 *       tradingSettingId: { type: ObjectId, index: true },
 *
 *       // ----- nguyên văn `history` của tradeV4.js, không sửa, không bớt -----
 *       action:        { type: String },   // DEPOSIT | NOSWAP | SWAP_PENDING | WITHDRAW | RESET
 *       isSwap:        { type: Boolean },
 *       inputSwap:     { type: String },   // symbol token đem swap,  null nếu không swap
 *       outputSwap:    { type: String },   // symbol token nhận về,   null nếu không swap
 *       amountSwap:    { type: String },   // số token nhận về,       null nếu không swap
 *       txHash:        { type: String },   // null nếu không swap
 *       currentToken:  { type: String },   // đang nắm giữ SAU khi xử lý mốc này
 *       currentAmount: { type: String },
 *       arrToken:      [{
 *         symbol:                 String,
 *         address:                String,
 *         price:                  String,  // giá USD của mốc này
 *         perETH:                 String,  // giá quy ra ETH
 *         perETHChangePercentage: String,  // biến động perETH so với mốc trước
 *         changeByPoint:          String,  // biến động quy ra điểm
 *         pointAfterCheck:        String,  // điểm của mốc này (mốc có swap thì kéo về 1000)
 *       }],
 *       amountWithdraw: { type: String },  // CHỈ action WITHDRAW
 *       pnl:            { type: String },  // CHỈ action WITHDRAW — so với userConfig.amountStart
 *
 *       // ----- server tự quản, thuật toán không đọc -----
 *       swapId:  { type: String, index: true },
 *       status:  { type: String },         // PENDING | PROCESSING | SUCCESS | FAILED
 *       retries: { type: Number, default: 0 },
 *     }, { timestamps: true });
 *
 *   Lưu ĐÚNG các field trên, không thêm. `pointBeforeCheck` và
 *   `ETHLastSwapTemp` là biến xử lý trong một mốc, không lưu DB: cái đầu không
 *   được đọc lại ở đâu, cái sau luôn được ghi rồi đọc trong cùng một mốc.
 *
 *   MỌI SỐ ĐỀU LÀ STRING, KHÔNG DÙNG Number. Giá và số token là BigNumber 20+
 *   chữ số thập phân (vd perETH "41.66666666666666666667"). Number của JS làm
 *   tròn mất, mốc sau đọc lại là tính lệch, càng chạy càng lệch.
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

// ============================================================================
// INPUT — arrToken của 4 mốc giá
// ============================================================================

// Mốc register: ETH 2500, BTC 100000, BNB 650.
const ARR_TOKEN_REGISTER = [
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
const ARR_TOKEN_T1 = [
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
const ARR_TOKEN_T2 = [
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
const ARR_TOKEN_T3 = [
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
const ARR_TOKEN_T4 = [
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
const CONFIG_REGISTER_INPUT = {
  "amountStart": "1",
  "inputStart": "ETH",
  "volatility": "0.3"
};

// ============================================================================
// OUTPUT — registerTradeV4({ config: CONFIG_REGISTER_INPUT, arrToken: ARR_TOKEN_REGISTER })
// ============================================================================

// INSERT vào history. Không có tx: inputSwap/outputSwap/amountSwap/txHash = null.
const HISTORY_DEPOSIT = {
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
const CONFIG_AFTER_REGISTER = {
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
const HISTORY_NOSWAP_T1 = {
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
const CONFIG_AFTER_T1 = {
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
const HISTORY_NOSWAP_T2 = {
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
const CONFIG_AFTER_T2 = {
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

// tradeV4.js gọi swapV4.swapOnchainV4(IN) và nhận OUT.
// OUT.amount là số tokenOut của lệnh VỪA GỬI — không chờ tx confirm onchain.
// amount trong IN là số tokenIn đem swap, đơn vị token (KHÔNG phải wei).
const SWAP_CALL = {
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
const HISTORY_SWAP_PENDING = {
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
const CONFIG_AFTER_SWAP = {
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
const SWAP_CALL_WITHDRAW = {
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
const HISTORY_WITHDRAW = {
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
const CONFIG_AFTER_WITHDRAW = {
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
const HISTORY_RESET = {
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
const CONFIG_AFTER_RESET = {
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

module.exports = {
  // input
  CONFIG_REGISTER_INPUT,
  ARR_TOKEN_REGISTER,
  ARR_TOKEN_T1,
  ARR_TOKEN_T2,
  ARR_TOKEN_T3,
  ARR_TOKEN_T4,
  // gọi sang swapV4.js
  SWAP_CALL,
  SWAP_CALL_WITHDRAW,
  // output: history
  HISTORY_DEPOSIT,
  HISTORY_NOSWAP_T1,
  HISTORY_NOSWAP_T2,
  HISTORY_SWAP_PENDING,
  HISTORY_WITHDRAW,
  HISTORY_RESET,
  // output: config
  CONFIG_AFTER_REGISTER,
  CONFIG_AFTER_T1,
  CONFIG_AFTER_T2,
  CONFIG_AFTER_SWAP,
  CONFIG_AFTER_WITHDRAW,
  CONFIG_AFTER_RESET,
};
