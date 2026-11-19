/**
 * ============================================================================
 * TRADE V4 — bản chạy THẬT, port 1-1 từ indexV4.ts (trade-coin-pro)
 * ============================================================================
 *
 * File này cố tình giữ NGUYÊN tên hàm / thứ tự section / cách viết của
 * indexV4.ts để đặt hai file cạnh nhau là so sánh được từng dòng. Chỗ nào buộc
 * phải khác đều có comment `KHÁC BACKTEST:`.
 *
 * ---------------------------------------------------------------------------
 * KHÁC BACKTEST Ở ĐÂU
 * ---------------------------------------------------------------------------
 *
 *   indexV4.ts (backtest)                 tradeV4.js (chạy thật)
 *   -----------------------------------   -----------------------------------
 *   listData[] — cả mảng lịch sử          MỘT mốc giá mỗi lần gọi
 *   for (index = 1..n) calculateData      không có for, mốc trước lấy từ config
 *   listData[index - 1]                   config.itemPre
 *   state là biến trong RAM               config.state, caller tự lưu DB
 *   số nhận về tính theo giá              số nhận về do swapV4.js trả
 *   swap là phép tính                     swap = GỬI tx, không chờ confirm
 *   không có address                      arrToken phải có address để swap
 *   try/catch rồi return sớm              throw ra ngoài, caller không lưu config
 *
 * ---------------------------------------------------------------------------
 * 4 HÀM
 * ---------------------------------------------------------------------------
 *
 *   registerTradeV4({ config, arrToken })   user nạp tiền, khoá giá gốc. KHÔNG swap.
 *   runTradeV4({ config, arrToken, ... })   mỗi mốc giá của cron. Swap nếu đủ điều kiện.
 *   withdrawTradeV4({ config, arrToken, ... })  swap hết về inputStart rồi DỪNG bot (stop).
 *   resetTradeV4({ config, arrToken, ... })     swap hết về inputStart rồi CHẠY LẠI TỪ ĐẦU.
 *
 * Cả 4 hàm LUÔN trả về đúng một dạng:  { history, config }
 *
 *   history  bản ghi của mốc này → lưu vào collection history
 *   config   state mới → lưu đè xuống DB, mốc sau truyền lại vào đây
 *
 * 3 hàm run / withdraw / reset là `async` vì phải chờ tx swap. register ĐỒNG BỘ
 * — nó không hề chạm onchain, chỉ khoá giá gốc.
 *
 * ---------------------------------------------------------------------------
 * arrToken — token của bot tại mốc này
 * ---------------------------------------------------------------------------
 *
 *   [
 *     { symbol: "ETH", address: "0x2170...", price: 2487.19 },
 *     { symbol: "BTC", address: "0x7130...", price: 107167.69 },
 *     { symbol: "BNB", address: "0xbb4C...", price: 657.02 },
 *   ]
 *
 *   symbol   ETH nhận ETH/WETH/CBETH, BTC nhận BTC/WBTC/CBBTC/BTCB.
 *            Bắt buộc có cả ETH và BTC. Symbol là KEY của state → phải giữ y
 *            nguyên suốt vòng đời bot.
 *   address  address token để gọi contract swap (KHÁC BACKTEST: backtest không cần).
 *   price    giá USD (server gọi là tokenPricePerUsd). perETH do thuật toán tự chia.
 *
 * Danh sách token CỐ ĐỊNH từ lúc register: price1Point và point của mỗi token
 * khoá tại thời điểm nạp. Muốn thêm/bớt token → reset hoặc mở bot mới.
 *
 * ---------------------------------------------------------------------------
 * config — khối state, lưu nguyên khối
 * ---------------------------------------------------------------------------
 *
 *   {
 *     userConfig: { amountStart, inputStart, volatility },
 *     state:      { amountInput, outputSwap, outputSwapTemp, ETHLastSwap,
 *                   perETHOriginal, ETHOriginalAmount, price1Point },
 *     itemPre:    { arrToken: [...] },   // KHÁC BACKTEST: thay cho listData[index - 1]
 *     isStop:     false,                 // true sau khi withdraw
 *   }
 *
 *   userConfig  cài đặt user — thuật toán CHỈ ĐỌC, không bao giờ ghi
 *   state       đúng interface State của indexV4.ts, không thêm không bớt
 *   itemPre     mốc giá trước: price / perETH / pointAfterCheck của từng token
 *
 * Phải lưu NGUYÊN KHỐI. Lưu một phần (vd lưu point mà không lưu amountInput)
 * là mốc sau tính sai mà không báo lỗi.
 *
 * ---------------------------------------------------------------------------
 * GHÉP VÀO CRON
 * ---------------------------------------------------------------------------
 *
 *     // 1. user gọi api init
 *     const { history, config } = registerTradeV4({ config: setting, arrToken });
 *     await History.create({ tradingId, ...history });
 *     await Setting.updateOne({ _id: tradingId }, { config });
 *
 *     // 2. mỗi mốc giá (1 bot 1 lần/giờ như cron cũ)
 *     const res = await runTradeV4({ config: trading.config, arrToken, idBot, chainId, swapId });
 *     await History.create({ tradingId, ...res.history });
 *     await Setting.updateOne({ _id: tradingId }, { config: res.config });
 *
 * Swap throw → hàm throw theo, KHÔNG có config mới, caller không lưu gì cả.
 * Mốc sau xét lại từ đầu theo giá mới. Đừng chạy hai mốc song song cho cùng
 * một bot.
 *
 * SWAP CHỈ GỬI TX, KHÔNG CHỜ CONFIRM. `swapV4.js` tạo hash rồi trả về ngay —
 * chờ tx lên chain thì rất lâu mà không cần thiết. Nên:
 *   - `history.action = "SWAP_PENDING"`, không phải "SWAP": mốc này chắc chắn
 *     đã GỬI tx, chưa chắc đã swap xong
 *   - `config` lưu luôn số swapV4.js trả về, coi như mốc sau chạy trên số đó
 *   - theo dõi `history.txHash` về sau là việc của server. Tx fail onchain thì
 *     file này không biết, lúc đó số trong config lệch với số dư thật
 *
 * withdraw/reset cũng vậy: `history` của chúng là tx vừa gửi, chưa confirm.
 * ============================================================================
 */

const BigNumber = require("bignumber.js");
const { swapBuy } = require("./swapV4");
const { uppercase } = require("../utils/token");

// ================== Types & Config ==================

/**
 * @typedef {Object} Token
 * @property {string} symbol
 * @property {string} address                   KHÁC BACKTEST: cần để swap thật
 * @property {string} price
 * @property {string} [perETH]
 * @property {string} [perETHChangePercentage]
 * @property {string} [changeByPoint]           v4
 * @property {string} [pointAfterCheck]         v4
 *
 * @typedef {Object<string, string>} SwapState
 *
 * @typedef {Object} Item
 * @property {Token[]} arrToken
 * @property {boolean} [isSwap]
 * @property {string} [inputSwap]
 * @property {string} [outputSwap]
 * @property {string} [amountSwap]
 * @property {string} [txHash]                  KHÁC BACKTEST: tx của swap thật
 *
 * @typedef {Object} UserConfig
 * @property {string} amountStart
 * @property {string} inputStart                symbol token bỏ vào lúc đầu
 * @property {string} volatility
 *
 * @typedef {Object} State
 * @property {string} amountInput
 * @property {string} outputSwap
 * @property {string} outputSwapTemp
 * @property {SwapState} ETHLastSwap
 * @property {SwapState} perETHOriginal
 * @property {string} ETHOriginalAmount
 * @property {SwapState} price1Point            v4: giá ứng 1 point, giá đầu kỳ / 1000
 *
 * @typedef {Object} Config
 * @property {UserConfig} userConfig
 * @property {State} state
 * @property {Item} itemPre
 * @property {boolean} [isStop]
 */

/** Điểm khởi tạo mỗi token. Swap xong, token đích được kéo về mốc này. */
const BASE_POINT = "1000";

/** resetPoint = 1000 + 1000 * vol% * 10. Với vol = 0.3 → 1030. */
const RESET_POINT_MULTIPLIER = 10;

/**
 * `SWAP_PENDING`: swapV4.js chỉ GỬI tx rồi trả hash ngay, KHÔNG chờ tx thành
 * công onchain (chờ rất lâu mà không cần thiết). Nên mốc có swap chỉ chắc chắn
 * "đã gửi tx", chưa chắc "đã swap xong" — tên action nói đúng điều đó. Việc
 * theo dõi hash đó về sau là của server.
 */
const ACTION = {
    DEPOSIT: "DEPOSIT",
    SWAP_PENDING: "SWAP_PENDING",
    NOSWAP: "NOSWAP",
    WITHDRAW: "WITHDRAW",
    RESET: "RESET",
};

/** Phần "lệnh swap" của history khi mốc đó không swap. */
const NO_SWAP = Object.freeze({
    isSwap: false,
    inputSwap: null,
    outputSwap: null,
    amountSwap: null,
    txHash: null,
});

// ================== Utility Functions ==================

const deepClone = (obj) => JSON.parse(JSON.stringify(obj));

/**
 * KHÁC BACKTEST: backtest nhận normalizeSymbol(listData) cho cả mảng lịch sử,
 * ở đây chỉ có MỘT mốc nên nhận arrToken. Làm luôn phần kiểm đầu vào mà
 * backtest không cần: address bắt buộc (để swap), giá phải là số dương, symbol
 * không được trùng.
 */
const normalizeSymbol = (arrToken) => {
    if (!Array.isArray(arrToken) || arrToken.length === 0) {
        throw new Error("[tradeV4] arrToken rỗng");
    }

    const seen = new Set();

    return arrToken.map((token) => {
        const symbol = uppercase(token && token.symbol);

        if (!symbol) throw new Error("[tradeV4] token thiếu symbol");
        if (seen.has(symbol)) throw new Error(`[tradeV4] symbol trùng lặp: ${symbol}`);
        seen.add(symbol);

        // address giữ nguyên hoa/thường như truyền vào — contract cần đúng chuỗi đó
        const address = typeof token.address === "string" ? token.address.trim() : "";

        if (!address) throw new Error(`[tradeV4] token ${symbol} thiếu address`);

        const price = toNumberOrNull(token.price);

        if (!price || price.lte(0)) {
            throw new Error(`[tradeV4] giá không hợp lệ cho ${symbol}: ${token.price}`);
        }

        return { symbol, address, price: price.toFixed() };
    });
};

/** bignumber.js bản này THROW với chuỗi rác (vd "abc") thay vì trả NaN. */
const toNumberOrNull = (value) => {
    try {
        const num = BigNumber(value);

        return num.isFinite() ? num : null;
    } catch (error) {
        return null;
    }
};


const getTokenETH = (arrToken = []) => {
    return arrToken.find((token) => uppercase(token.symbol) === "ETH");
};

const getTokenBTC = (arrToken = []) => {
    return arrToken.find((token) => uppercase(token.symbol) === "BTC");
};

const getTokenBySymbol = (arrToken = [], symbol) => {
    return arrToken.find((token) => {
        return uppercase(token.symbol) === uppercase(symbol)
    });
};

//token có perETHChangePercentage nhỏ nhất => token sẽ swap ra
const getTokenMinChangePercentage = (arrToken = []) => {
    const minChangePercentage = arrToken.reduce((min, token) => {
        return BigNumber(min).lt(token.perETHChangePercentage) ? min : token.perETHChangePercentage;
    }, arrToken[0].perETHChangePercentage);

    return arrToken.find((token) => BigNumber(minChangePercentage).isEqualTo(token.perETHChangePercentage));
};

// ================== Point (v4) ==================

/**
 * KHÁC BACKTEST: backtest còn `updatePointBeforeCheck` ghi `pointBeforeCheck`
 * cho từng token. Bỏ hẳn ở đây: `pointBeforeCheck` không hề được đọc lại ở đâu
 * (bằng đúng `pointAfterCheck` khi mốc đó không swap), chỉ để xem nên không
 * cần lưu lịch sử.
 */
const updatePointAfterCheckBeforeSwap = (arrToken = [], arrTokenPre = []) => {
    arrToken.forEach((token, index) => {
        const tokenPre = arrTokenPre[index];

        token.pointAfterCheck = BigNumber(tokenPre.pointAfterCheck).plus(token.changeByPoint).toFixed();
        arrToken[index] = token;
    });

    return arrToken;
};

//swap xong: token output về 1000, token khác đang < 1000 kéo lên 1000
const updatePointAfterCheckInSwap = (arrToken = [], tokenOutput) => {
    const symbolOutput = uppercase(tokenOutput.symbol);

    arrToken.forEach((token, index) => {
        if (symbolOutput === uppercase(token.symbol)) {
            token.pointAfterCheck = BASE_POINT;
        }
        arrToken[index] = token;
    });

    arrToken.forEach((token, index) => {
        if (symbolOutput !== uppercase(token.symbol)) {
            if (BigNumber(token.pointAfterCheck).isLessThan(BASE_POINT)) {
                token.pointAfterCheck = BASE_POINT;
            }
        }
        arrToken[index] = token;
    });

    return arrToken;
};

//reset perETHOriginal khi có >= 2 token vượt resetPoint
const updatePerETHOriginal = (arrToken = [], arrTokenPre = [], tokenInput, userConfig, perETHOriginal) => {
    const resetPoint = BigNumber(BASE_POINT)
        .plus(
            BigNumber(BASE_POINT)
                .multipliedBy(userConfig.volatility)
                .dividedBy(100)
                .multipliedBy(RESET_POINT_MULTIPLIER)
        )
        .toFixed(); //2000 + 30% = 2600

    const symbolInput = uppercase(tokenInput && tokenInput.symbol);

    let currentAmountMoreThanRest = 0;
    let preAmountMoreThanRest = 0;
    let isChangeETHAndBTC = false;

    arrTokenPre.forEach((token) => {
        if (BigNumber(token.pointAfterCheck).isGreaterThan(resetPoint)) {
            preAmountMoreThanRest++;
        }
    });

    arrToken.forEach((token) => {
        if (BigNumber(token.pointAfterCheck).isGreaterThan(resetPoint)) {
            currentAmountMoreThanRest++;
        }
    });

    if (currentAmountMoreThanRest >= 2 && preAmountMoreThanRest <= 1) {
        arrToken.forEach((token) => {
            const symbol = uppercase(token.symbol);

            if (symbol === "ETH" || symbol === "BTC") {
                if (symbolInput !== symbol) {
                    isChangeETHAndBTC = true;
                }
            } else {
                if (symbolInput !== symbol) {
                    perETHOriginal[symbol] = token.perETH;
                }
            }
        });
    }

    if (isChangeETHAndBTC) {
        arrToken.forEach((token) => {
            const symbol = uppercase(token.symbol);

            if (symbol === "ETH" || symbol === "BTC") {
                perETHOriginal[symbol] = token.perETH;
            }
        });
    }

    return perETHOriginal;
};

// ================== Init data ==================

const initFirstItem = (item, userConfig, state) => {
    const tokenETH = getTokenETH(item.arrToken);
    const inputStart = uppercase(userConfig.inputStart);
    const isETH = inputStart === "ETH";

    // KHÁC BACKTEST: backtest sai data thì chỉ lệch số, ở đây sai là nạp tiền
    // vào bot chạy sai → chặn ngay lúc register.
    if (!tokenETH) throw new Error("[tradeV4] thiếu token ETH trong arrToken");
    if (!getTokenBTC(item.arrToken)) throw new Error("[tradeV4] thiếu token BTC trong arrToken");
    if (!getTokenBySymbol(item.arrToken, inputStart)) {
        throw new Error(`[tradeV4] inputStart "${inputStart}" không có trong arrToken`);
    }

    item.arrToken.forEach((token, index) => {
        const symbol = uppercase(token.symbol);

        token.perETH = symbol === "ETH" ? "1" : BigNumber(token.price).dividedBy(tokenETH.price).toFixed();
        token.perETHChangePercentage = "0";

        state.ETHLastSwap[symbol] = token.perETH;
        state.perETHOriginal[symbol] = token.perETH;

        if (symbol === inputStart) {
            state.ETHOriginalAmount = isETH
                ? userConfig.amountStart
                : BigNumber(userConfig.amountStart).multipliedBy(token.price).dividedBy(tokenETH.price).toFixed();
        }

        //v4: point đầu kỳ = 1000, price1Point = giá đầu kỳ / 1000
        token.changeByPoint = "0";
        token.pointAfterCheck = BASE_POINT;
        state.price1Point[symbol] = BigNumber(token.price).dividedBy(BASE_POINT).toFixed();

        item.arrToken[index] = token;
    });

    return { item, state };
};

const initItem = (item, itemPre, state) => {
    const tokenETH = getTokenETH(item.arrToken);

    if (!tokenETH) throw new Error("[tradeV4] thiếu token ETH trong arrToken");

    item.arrToken.forEach((token, index) => {
        const tokenPre = itemPre.arrToken[index];
        const symbol = uppercase(token.symbol);
        const price1Point = state.price1Point[symbol];

        // KHÁC BACKTEST: mốc trước lấy từ DB nên phải kiểm, sai khớp token là
        // swap nhầm đồng. Backtest luôn cùng một mảng nên không cần.
        assertTokenPre(token, tokenPre, price1Point);

        if (symbol === "ETH") {
            token.perETH = "1";
            token.perETHChangePercentage = BigNumber(BigNumber(token.price).minus(tokenPre.price))
                .dividedBy(tokenPre.price)
                .toFixed();
        } else {
            token.perETH = BigNumber(token.price).dividedBy(tokenETH.price).toFixed();
            token.perETHChangePercentage = BigNumber(BigNumber(token.perETH).minus(tokenPre.perETH))
                .dividedBy(tokenPre.perETH)
                .toFixed();
        }

        // ・ETHChangeByPoint: bằng (ETHPrice giờ đó / ETHPrice1Point) - (ETHPrice giờ trước đó / ETHPrice1Point)
        token.changeByPoint = BigNumber(BigNumber(token.price).dividedBy(price1Point))
            .minus(BigNumber(tokenPre.price).dividedBy(price1Point))
            .toFixed();

        item.arrToken[index] = token;
    });

    return item;
};

/**
 * KHÁC BACKTEST: state đi qua DB nên mốc trước có thể thiếu field hoặc lệch
 * token. Thiếu hàm này thì thuật toán vẫn chạy ra số — chỉ là số sai, không
 * lỗi nào bắn ra.
 */
const TOKEN_PRE_FIELDS = ["price", "perETH", "pointAfterCheck"];

const assertTokenPre = (token, tokenPre, price1Point) => {
    const symbol = uppercase(token.symbol);

    if (!tokenPre) throw new Error(`[tradeV4] itemPre thiếu mốc trước của ${symbol}`);

    if (uppercase(tokenPre.symbol) !== symbol) {
        throw new Error(
            `[tradeV4] arrToken lệch thứ tự so với mốc trước: ${symbol} != ${uppercase(tokenPre.symbol)}`
        );
    }

    // address khoá từ lúc register — lệch là swap nhầm token
    if (tokenPre.address && uppercase(tokenPre.address) !== uppercase(token.address)) {
        throw new Error(
            `[tradeV4] address của ${symbol} lệch so với lúc register: ${token.address} != ${tokenPre.address}`
        );
    }

    TOKEN_PRE_FIELDS.forEach((field) => {
        if (tokenPre[field] === undefined || tokenPre[field] === null || tokenPre[field] === "") {
            throw new Error(`[tradeV4] itemPre.${symbol} thiếu ${field} — mốc trước lưu không đủ`);
        }
    });

    if (!price1Point) throw new Error(`[tradeV4] state.price1Point thiếu ${symbol}`);
};

/**
 * KHÁC BACKTEST: backtest có initData() chạy for() qua cả listData. Ở đây mỗi
 * lần gọi đúng một mốc nên không có hàm đó — register dùng initFirstItem, các
 * mốc sau dùng initItem.
 */

// ================== Swap Logic ==================

/**
 * KHÁC BACKTEST: gọi swap THẬT.
 *
 * `swapBuy` trong swapV4.js nhận { idBot, chainId, swapId, tokenIn,
 * priceTokenIn, tokenOut, priceTokenOut, amount } và trả { txHash, amount }.
 *
 * `priceTokenIn` / `priceTokenOut` là giá USD của tokenIn / tokenOut tại mốc
 * này (lấy nguyên `token.price` của arrToken), để swapV4.js tự tính rate.
 *
 * `amount` TRẢ VỀ là số tokenOut nhận được của lệnh swap vừa gửi (đừng lẫn với
 * `amount` TRUYỀN VÀO là số tokenIn đem swap). Thuật toán lấy NGUYÊN số đó làm
 * vốn cho mốc sau, không tính lại theo giá, không tự trừ phí/slippage.
 *
 * swapV4.js chỉ GỬI tx rồi trả hash, KHÔNG chờ tx thành công onchain. Nên:
 *   - hàm này trả về là tx MỚI GỬI, chưa chắc đã lên chain
 *   - gửi tx không được → throw, caller không lưu config
 *   - tx gửi rồi mà sau đó fail onchain thì file này không biết: server theo
 *     `history.txHash` mà xử lý (số trong config lúc đó lệch với số dư thật)
 */
const callSwap = async (swapCtx, { tokenIn, tokenOut, amount }) => {
    const { idBot, chainId, swapId, swap } = swapCtx;

    const result = await swap({
        idBot,
        chainId,
        swapId,
        tokenIn: tokenIn.address,
        priceTokenIn: BigNumber(tokenIn.price).toFixed(),
        tokenOut: tokenOut.address,
        priceTokenOut: BigNumber(tokenOut.price).toFixed(),
        amount: BigNumber(amount).toFixed(),
    });

    // số nhận về nằm ở `result.amount` — đúng field swapV4.js đang trả
    const amountOut = toNumberOrNull(result && result.amount);

    if (!amountOut || amountOut.lte(0)) {
        throw new Error(
            `[tradeV4] swap ${tokenIn.symbol}->${tokenOut.symbol} trả amount không hợp lệ: ${result && result.amount
            }`
        );
    }

    return { amountOut: amountOut.toFixed(), txHash: (result && result.txHash) || null };
};

// KHÁC BACKTEST: backtest nhận thêm param số nhận về tính theo giá. Ở đây bỏ
// param đó: số của mốc này là số thực nhận của tx.
const onSwap = async (item, tokenOutput, state, swapCtx) => {
    const symbolOutput = uppercase(tokenOutput.symbol);
    const symbolInput = state.outputSwap;
    const tokenInput = getTokenBySymbol(item.arrToken, symbolInput);

    if (!tokenInput) {
        throw new Error(`[tradeV4] token đang nắm giữ "${symbolInput}" không có trong arrToken`);
    }

    // gửi tx swap trước, số swapV4.js trả về mới là số của mốc này
    const { amountOut, txHash } = await callSwap(swapCtx, {
        tokenIn: tokenInput,
        tokenOut: tokenOutput,
        amount: state.amountInput,
    });

    //v4: token output về 1000 sau khi swap
    item.arrToken = updatePointAfterCheckInSwap(item.arrToken, tokenOutput);

    state.amountInput = amountOut;
    state.outputSwap = symbolOutput;

    item.isSwap = true;
    item.inputSwap = symbolInput;
    item.outputSwap = symbolOutput;
    item.amountSwap = amountOut;
    item.txHash = txHash;

    return { item, state };
};

const checkToSwap = async (item, itemPre, userConfig, state, swapCtx) => {
    const tokenOutput = getTokenMinChangePercentage(item.arrToken);
    const tokenETH = getTokenETH(item.arrToken);
    const tokenBTC = getTokenBTC(item.arrToken);
    const tokenInput = getTokenBySymbol(item.arrToken, state.outputSwap);

    const symbolOutput = uppercase(tokenOutput.symbol);
    const symbolInput = uppercase(tokenInput && tokenInput.symbol);
    const symbolBTC = uppercase(tokenBTC && tokenBTC.symbol);

    const limitChangePercentage = BigNumber(BigNumber(userConfig.volatility).dividedBy(100))
        .multipliedBy(-1)
        .toNumber();

    // KHÁC BACKTEST: backtest để `ETHLastSwapTemp` trong state. Ở đây là biến
    // LOCAL, không lưu config: trong một mốc nó luôn được ghi ở trên rồi mới đọc
    // ở dưới (cùng key, cùng nhánh if), mốc sau không bao giờ đọc lại.
    const ETHLastSwapTemp = {};

    //v4: update pointAfterCheck before swap
    item.arrToken = updatePointAfterCheckBeforeSwap(item.arrToken, itemPre.arrToken);

    if (state.outputSwapTemp !== symbolOutput && Number(tokenOutput.perETHChangePercentage) < limitChangePercentage) {
        if (symbolOutput === "ETH") {
            ETHLastSwapTemp[symbolBTC] = tokenBTC.perETH;
        } else {
            ETHLastSwapTemp[symbolOutput] = tokenOutput.perETH;
        }

        state.outputSwapTemp = symbolOutput;

        if (state.outputSwap !== symbolOutput && symbolInput !== symbolOutput) {
            //(SwapInputTokenAmount * SwapInputTokenPrice) / ETHPrice
            const amountOutCheck = BigNumber(state.amountInput)
                .multipliedBy(tokenInput.price)
                .dividedBy(tokenETH.price)
                .toFixed();

            if (symbolOutput === "ETH" || symbolOutput === "BTC") {
                if (BigNumber(tokenBTC.perETH).gt(state.ETHLastSwap[symbolBTC])) {
                    //(SwapInputTokenAmount * SwapInputTokenPrice)/ ETHPrice của giờ đó => đem so sánh với ETHOriginalAmount
                    if (BigNumber(amountOutCheck).gte(state.ETHOriginalAmount)) {
                        if (BigNumber(tokenBTC.perETH).gte(state.perETHOriginal[symbolBTC])) {
                            const res = await onSwap(item, tokenOutput, state, swapCtx);

                            item = res.item;
                            state = res.state;
                        }
                    }
                }

                state.ETHLastSwap[symbolBTC] = ETHLastSwapTemp[symbolBTC];
            } else {
                if (BigNumber(tokenOutput.perETH).gte(state.ETHLastSwap[symbolOutput])) {
                    //(SwapInputTokenAmount * SwapInputTokenPrice)/ ETHPrice của giờ đó => đem so sánh với ETHOriginalAmount
                    if (BigNumber(amountOutCheck).gte(state.ETHOriginalAmount)) {
                        if (BigNumber(tokenOutput.perETH).gte(state.perETHOriginal[symbolOutput])) {
                            const res = await onSwap(item, tokenOutput, state, swapCtx);

                            item = res.item;
                            state = res.state;
                        }
                    }
                }

                state.ETHLastSwap[symbolOutput] = ETHLastSwapTemp[symbolOutput];
            }
        }
    }

    //v4: reset perETHOriginal theo point
    state.perETHOriginal = updatePerETHOriginal(
        item.arrToken,
        itemPre.arrToken,
        tokenInput,
        userConfig,
        state.perETHOriginal
    );

    return { item, state };
};

/**
 * KHÁC BACKTEST: backtest có calculateData() chạy for() qua listData và đếm
 * arrSwap. Ở đây mỗi lần gọi đúng một mốc → không có hàm đó, runTradeV4 gọi
 * trực tiếp initItem + checkToSwap.
 */

// ================== Withdraw / Reset ==================

/**
 * Swap toàn bộ số đang giữ về `userConfig.inputStart`.
 *
 * Đích đến là `inputStart` — đồng user NẠP lúc register, không phải
 * `state.outputSwap` (đồng bot tình cờ đang cầm sau lần swap cuối). Đây là lý
 * do `userConfig` phải lưu nguyên vẹn suốt vòng đời bot.
 *
 * Đang cầm sẵn đồng gốc → không swap, không mất phí.
 */
const unwindToInputStart = async (item, userConfig, state, swapCtx) => {
    const holding = uppercase(state.outputSwap);
    const target = uppercase(userConfig.inputStart);

    const tokenHolding = getTokenBySymbol(item.arrToken, holding);
    const tokenTarget = getTokenBySymbol(item.arrToken, target);

    if (!tokenHolding) {
        throw new Error(`[tradeV4] token đang nắm giữ "${holding}" không có trong arrToken`);
    }
    if (!tokenTarget) {
        throw new Error(`[tradeV4] inputStart "${target}" không có trong arrToken`);
    }

    if (holding === target) {
        return { amount: BigNumber(state.amountInput).toFixed(), swap: { ...NO_SWAP }, state };
    }

    const { amountOut, txHash } = await callSwap(swapCtx, {
        tokenIn: tokenHolding,
        tokenOut: tokenTarget,
        amount: state.amountInput,
    });

    state.amountInput = amountOut;
    state.outputSwap = target;

    return {
        amount: amountOut,
        swap: {
            isSwap: true,
            inputSwap: holding,
            outputSwap: target,
            amountSwap: amountOut,
            txHash,
        },
        state,
    };
};

// ================== Run ==================

const getStateDefault = (userConfig) => {
    const inputStart = uppercase(userConfig.inputStart);

    return {
        amountInput: userConfig.amountStart,
        outputSwap: inputStart,
        outputSwapTemp: inputStart,
        ETHLastSwap: {},
        perETHOriginal: {},
        ETHOriginalAmount: "0",
        price1Point: {},
    };
};

/** 3 field cài đặt của user — thuật toán chỉ đọc, chuẩn hoá một lần lúc register. */
const getUserConfig = (config) => {
    const userConfig = {
        ...config,
        amountStart: BigNumber(config.amountStart).toFixed(),
        inputStart: uppercase(config.inputStart),
        volatility: String(config.volatility),
        tradeTokens: config.tradeTokens
    };

    ["amountStart", "volatility"].forEach((field) => {
        const value = toNumberOrNull(config[field]);

        if (!value || value.lte(0)) {
            throw new Error(`[tradeV4] ${field} không hợp lệ: ${config[field]}`);
        }
    });

    return userConfig;
};

/** `itemPre` của mốc sau — chỉ cần những field mà initItem đọc lại. */
const toItemPre = (item) => ({
    arrToken: item.arrToken.map((token) => ({
        symbol: token.symbol,
        address: token.address,
        price: token.price,
        perETH: token.perETH,
        perETHChangePercentage: token.perETHChangePercentage,
        pointAfterCheck: token.pointAfterCheck,
    })),
});

/** Dạng kết quả chung của cả 4 hàm. */
const toResult = (action, item, userConfig, state, extraHistory = {}) => {
    const history = {
        action,
        isSwap: !!item.isSwap,
        inputSwap: item.inputSwap || null,
        outputSwap: item.outputSwap || null,
        amountSwap: item.amountSwap || null,
        txHash: item.txHash || null,
        currentToken: state.outputSwap,
        currentAmount: state.amountInput,
        arrToken: item.arrToken,
        ...extraHistory,
    };

    return { history, config: { userConfig, state, itemPre: toItemPre(item), isStop: false } };
};

/** Mở config lấy từ DB ra, chặn sớm nếu bot chưa register hoặc đã stop. */
const openConfig = (config) => {
    if (!config || typeof config !== "object") throw new Error("[tradeV4] thiếu config");

    if (!config.userConfig || !config.state || !config.itemPre) {
        throw new Error("[tradeV4] config chưa register — gọi registerTradeV4 trước");
    }

    if (config.isStop) throw new Error("[tradeV4] bot đã withdraw (stop) — dùng register/reset để chạy lại");

    // deepClone: không sửa tham số của caller, throw giữa đường thì config trong
    // DB vẫn nguyên như trước mốc này
    const next = deepClone(config);

    return { userConfig: next.userConfig, state: next.state, itemPre: next.itemPre };
};

/** Tham số của hàm swap — chỉ run/withdraw/reset cần, register thì không. */
const getSwapCtx = ({ idBot, chainId, swapId, swap = swapBuy }) => {
    if (idBot === null || idBot === undefined || idBot === "") throw new Error("[tradeV4] thiếu idBot");
    if (chainId === null || chainId === undefined || chainId === "") throw new Error("[tradeV4] thiếu chainId");
    if (typeof swap !== "function") throw new Error("[tradeV4] swap phải là function");

    return { idBot, chainId, swapId, swap };
};

/**
 * REGISTER — user nạp tiền, gọi MỘT LẦN lúc api init.
 *
 * ĐỒNG BỘ, KHÔNG swap, không chạm onchain/DB. Khoá giá gốc (`price1Point`,
 * `perETHOriginal`, `ETHOriginalAmount`) theo `arrToken` hiện tại, mọi point về
 * 1000. `history.action = "DEPOSIT"`, `isSwap = false`.
 *
 * Config đã register (đã có state) → THROW, không ghi đè state đang chạy. Muốn
 * mở vòng mới cho bot đang chạy thì dùng resetTradeV4.
 *
 * @param {Object} params
 * @param {UserConfig} params.config  3 field cài đặt: amountStart, inputStart, volatility
 * @param {Array<{symbol: string, address: string, price: string|number}>} params.arrToken
 * @returns {{ history: Object, config: Config }}
 */
const registerTradeV4 = ({ config, arrToken } = {}) => {
    if (!config || typeof config !== "object") throw new Error("[tradeV4] thiếu config");

    if (config.state || config.itemPre) {
        throw new Error("[tradeV4] config đã register — dùng resetTradeV4 nếu muốn mở vòng mới");
    }

    const userConfig = getUserConfig(config);

    let item = { arrToken: normalizeSymbol(arrToken) };
    let state = getStateDefault(userConfig);

    const res = initFirstItem(item, userConfig, state);

    item = res.item;
    state = res.state;

    return toResult(ACTION.DEPOSIT, item, userConfig, state);
};

/**
 * RUN — một mốc giá của bot ĐÃ register. Đây là hàm cron gọi mỗi lần lấy giá.
 *
 * Tương đương một vòng lặp `calculateData` của backtest: tính perETH /
 * changeByPoint / point theo mốc trước, xét 4 tầng điều kiện, đủ thì swap THẬT
 * qua swapV4.js.
 *
 * `history.action` = "SWAP_PENDING" nếu mốc này có GỬI tx (chỉ gửi, không chờ
 * tx thành công onchain), "NOSWAP" nếu không.
 *
 * Swap throw → hàm throw theo, KHÔNG trả config. Caller không lưu gì, mốc sau
 * xét lại từ đầu theo giá mới.
 *
 * @param {Object} params
 * @param {Config} params.config            config lấy từ DB
 * @param {Array<{symbol: string, address: string, price: string|number}>} params.arrToken
 * @param {string|number} params.idBot      truyền nguyên xuống hàm swap
 * @param {string|number} params.chainId    truyền nguyên xuống hàm swap
 * @param {string} [params.swapId]          khoá chống gửi trùng tx
 * @param {Function} [params.swap]          mặc định swapBuy của swapV4.js
 * @returns {Promise<{ history: Object, config: Config }>}
 */
const runTradeV4 = async (params = {}) => {
    const { config, arrToken } = params;

    let { userConfig, state, itemPre } = openConfig(config);

    const swapCtx = getSwapCtx(params);

    let item = { arrToken: normalizeSymbol(arrToken), isSwap: false };

    item = initItem(item, itemPre, state);

    const res = await checkToSwap(item, itemPre, userConfig, state, swapCtx);

    item = res.item;
    state = res.state;

    return toResult(item.isSwap ? ACTION.SWAP_PENDING : ACTION.NOSWAP, item, userConfig, state);
};

/**
 * WITHDRAW — rút về cho user rồi DỪNG bot (stop).
 *
 * Swap hết số đang giữ về `inputStart` (đang cầm sẵn thì không swap, không mất
 * phí) và KHÔNG xét điều kiện nào. `history` kèm `amountWithdraw` và `pnl` (so
 * trực tiếp với `amountStart` vì vào/ra cùng một đồng).
 *
 * Config trả về có `isStop = true` → run/withdraw/reset sau đó sẽ throw. Hàm
 * chỉ lo phần swap, và chỉ GỬI tx chứ không chờ confirm; chuyển tiền từ
 * contract về ví user là việc của server, làm sau khi tx unwind đã lên chain.
 *
 * @param {Object} params  giống runTradeV4
 * @returns {Promise<{ history: Object, config: Config }>}
 */
const withdrawTradeV4 = async (params = {}) => {
    const { config, arrToken } = params;

    let { userConfig, state, itemPre } = openConfig(config);

    const swapCtx = getSwapCtx(params);

    let item = { arrToken: normalizeSymbol(arrToken), isSwap: false };

    // vẫn tính chỉ số của mốc cuối để history có đủ số liệu như mọi mốc khác
    item = initItem(item, itemPre, state);
    item.arrToken = updatePointAfterCheckBeforeSwap(item.arrToken, itemPre.arrToken);

    const res = await unwindToInputStart(item, userConfig, state, swapCtx);

    state = res.state;
    Object.assign(item, res.swap);

    const result = toResult(ACTION.WITHDRAW, item, userConfig, state, {
        amountWithdraw: res.amount,
        pnl: BigNumber(res.amount).minus(userConfig.amountStart).toFixed(),
    });

    result.config.isStop = true;

    return result;
};

/**
 * RESET — swap hết về `inputStart` rồi CHẠY LẠI TỪ ĐẦU ngay, vốn là số vừa
 * nhận được.
 *
 * Vòng mới giữ đúng 3 field cài đặt (`inputStart`, `volatility` như
 * cũ, `amountStart` = số vừa unwind được); state vòng cũ
 * (`price1Point`, `perETHOriginal`, `ETHLastSwap`, point) bị bỏ hết: point về
 * 1000, `price1Point` khoá lại theo giá của mốc reset.
 *
 * `history.action = "RESET"`: `inputSwap`/`outputSwap`/`amountSwap` là lệnh
 * swap unwind, `arrToken` + `currentToken`/`currentAmount` là trạng thái ĐẦU
 * VÒNG MỚI. Một bản ghi, server lưu như mọi mốc khác.
 *
 * @param {Object} params  giống runTradeV4
 * @returns {Promise<{ history: Object, config: Config }>}
 */
const resetTradeV4 = async (params = {}) => {
    const { config, arrToken } = params;

    let { userConfig, state, itemPre } = openConfig(config);

    const swapCtx = getSwapCtx(params);

    let item = { arrToken: normalizeSymbol(arrToken), isSwap: false };

    item = initItem(item, itemPre, state);

    const res = await unwindToInputStart(item, userConfig, state, swapCtx);

    // vòng mới: cùng cài đặt, vốn là số vừa unwind được, point về 1000
    const userConfigNext = getUserConfig({ ...userConfig, amountStart: res.amount });

    let itemNext = { arrToken: normalizeSymbol(arrToken), isSwap: false };
    let stateNext = getStateDefault(userConfigNext);

    const resInit = initFirstItem(itemNext, userConfigNext, stateNext);

    itemNext = resInit.item;
    stateNext = resInit.state;

    // lệnh swap unwind của vòng cũ, gắn vào bản ghi RESET
    Object.assign(itemNext, res.swap);

    return toResult(ACTION.RESET, itemNext, userConfigNext, stateNext);
};

module.exports = {
    registerTradeV4,
    runTradeV4,
    withdrawTradeV4,
    resetTradeV4,
};
