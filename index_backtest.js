/**
 * BACKTEST — chạy thuật toán tradeV4 trên data giả (helper/data_fake.js),
 * swap bằng helper/swapV4_backtest.js: không viem, không gọi pool / contract.
 *
 *     node index_backtest.js
 */

const path = require("path")

// tradeV4.js `require("./swapV4")` ngay đầu file → bản thật kéo theo viem + RPC.
// Đặt sẵn bản backtest vào cache của require để tradeV4.js nhận bản giả,
// không phải sửa tradeV4.js và không load viem.
const swapBacktest = require("./helper/swapV4_backtest")
const swapV4Path = require.resolve(path.join(__dirname, "helper", "swapV4.js"))
require.cache[swapV4Path] = {
  id: swapV4Path,
  filename: swapV4Path,
  loaded: true,
  exports: swapBacktest,
}

const BigNumber = require("bignumber.js")
const { ARR_TOKEN } = require("./helper/data_fake")
const { registerTradeV4, runTradeV4, withdrawTradeV4 } = require("./helper/tradeV4")
const { filterTradeTokens, convertSymbolToken } = require("./utils/token")

const { swapBuy, setBacktestOptions, getBacktestOrders, resetBacktest } = swapBacktest

// Giả định của backtest — xem đầu file helper/swapV4_backtest.js
const BACKTEST_OPTIONS = {
  priceSlippage: "0.001", // biên giá limit 0.1% như swapV4.js
  feeRate: "0",           // phí trừ trên số nhận về
  log: false,             // true = in từng lệnh swap
}

// Cuối data có swap hết về inputStart (withdrawTradeV4) để ra PnL không
const WITHDRAW_AT_END = true

// address giả: tradeV4 bắt buộc có address, backtest không dùng tới
let arrToken = ARR_TOKEN.map(e => {
  return {
    time: e.time,
    arrToken: e.arrToken.map((token, index) => ({ ...token, address: `0x9f276af79b2b5de2946a88b0fe2717318f924d${index}c` })),
  }
})

// Giống index.js
let initConfig = {
  "address": "0x9f276af79b2b5de2946a88b0fe2717318f924d7c",
  chainId: 8453,
  "amountStart": "1",
  "inputStart": "WETH",
  "volatility": "0.5",
  "tradeTokens": [
    "WETH",
    "cbBTC",
    "AMZNC",
    "NVDAC",
    "GOOGLC",
    "AAPLC",
    "MSFTC",
    "SPCXC",
    "TSLAC",
    "METAC",
    "SNDKC",
    "MSTRC",
  ]
}

const ID_BOT = "backtest"
const CHAIN_ID = String(initConfig.chainId)

/** Giá trị số đang giữ quy ra USD và ra inputStart, theo giá của mốc đó. */
const valueOf = (history, tokens, inputStart) => {
  const holding = tokens.find(t => convertSymbolToken(t.symbol) === convertSymbolToken(history.currentToken))
  const base = tokens.find(t => convertSymbolToken(t.symbol) === convertSymbolToken(inputStart))
  if (!holding || !base) return { usd: null, inInputStart: null }

  const usd = BigNumber(history.currentAmount).times(holding.price)
  return { usd: usd.toFixed(2), inInputStart: usd.dividedBy(base.price).toFixed(8) }
}

const main = async () => {
  resetBacktest()
  setBacktestOptions(BACKTEST_OPTIONS)

  initConfig.inputStart = convertSymbolToken(initConfig.inputStart)

  const histories = []
  let config = initConfig
  let lastTokens = null

  for (const [index, { time, arrToken: tokens }] of arrToken.entries()) {
    const tradeTokens = filterTradeTokens(tokens, initConfig.tradeTokens)
    lastTokens = tradeTokens

    const res = index === 0
      ? registerTradeV4({ config, arrToken: tradeTokens })
      : await runTradeV4({
        config,
        arrToken: tradeTokens,
        idBot: ID_BOT,
        chainId: CHAIN_ID,
        swapId: `${ID_BOT}-${index}`,
        swap: swapBuy,
      })

    config = res.config
    histories.push({ time, ...res.history, value: valueOf(res.history, tradeTokens, initConfig.inputStart) })
  }

  let withdrawResult = null
  if (WITHDRAW_AT_END && lastTokens) {
    withdrawResult = await withdrawTradeV4({
      config,
      arrToken: lastTokens,
      idBot: ID_BOT,
      chainId: CHAIN_ID,
      swapId: `${ID_BOT}-withdraw`,
      swap: swapBuy,
    })
    config = withdrawResult.config
    histories.push({ time: arrToken[arrToken.length - 1].time, ...withdrawResult.history })
  }

  // ---------------- báo cáo ----------------
  const swaps = histories.filter(h => h.action === "SWAP_PENDING")

  console.log("\n=========== LỆNH SWAP ===========")
  console.table(swaps.map(h => ({
    time: h.time,
    from: h.inputSwap,
    to: h.outputSwap,
    amount: BigNumber(h.amountSwap).toFixed(8),
    valueUSD: h.value.usd,
    [`value${initConfig.inputStart}`]: h.value.inInputStart,
  })))

  const first = arrToken[0]
  const last = arrToken[arrToken.length - 1]
  const holdUSD = BigNumber(initConfig.amountStart).times(
    first.arrToken.find(t => convertSymbolToken(t.symbol) === initConfig.inputStart).price
  )
  const priceInputLast = last.arrToken.find(t => convertSymbolToken(t.symbol) === initConfig.inputStart).price

  console.log("\n=========== TỔNG KẾT ===========")
  console.log({
    from: first.time,
    to: last.time,
    points: arrToken.length,
    amountSwap: swaps.length,
    ordersSimulated: getBacktestOrders().length,
    amountStart: `${initConfig.amountStart} ${initConfig.inputStart}`,
    holding: `${config.state.amountInput} ${config.state.outputSwap}`,
    ...(withdrawResult && {
      amountWithdraw: `${withdrawResult.history.amountWithdraw} ${initConfig.inputStart}`,
      pnl: `${withdrawResult.history.pnl} ${initConfig.inputStart}`,
      pnlPercent: BigNumber(withdrawResult.history.pnl).dividedBy(initConfig.amountStart).times(100).toFixed(4) + "%",
    }),
    holdOnlyUSD: `${holdUSD.toFixed(2)} -> ${BigNumber(initConfig.amountStart).times(priceInputLast).toFixed(2)}`,
  })
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
