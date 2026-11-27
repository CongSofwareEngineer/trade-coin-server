/**
 * BACKTEST — chạy thuật toán tradeV4 trên data giả (helper/data_fake.ts),
 * swap bằng helper/swapV4_backtest.ts: không viem, không gọi pool / contract.
 *
 *     npm run backtest        (= npx tsx index_backtest.ts)
 *
 * tradeV4.ts chỉ import swapV4.ts (viem + RPC) khi KHÔNG truyền `swap`. Ở đây
 * luôn truyền `swap: swapBuy` của bản backtest nên viem không bao giờ được load.
 */

import BigNumber from "bignumber.js"
import { ARR_TOKEN } from "./helper/data_fake"
import { registerTradeV4, runTradeV4, withdrawTradeV4 } from "./helper/tradeV4"
import { filterTradeTokens, convertSymbolToken } from "./utils/token"
import { swapBuy, setBacktestOptions, getBacktestOrders, resetBacktest } from "./helper/swapV4_backtest"
import type { ArrTokenInput, BacktestOptions, RegisterConfigInput, TradeConfig, TradeHistory, TradeResult } from "./types"

/** Một dòng history của backtest: history thật + thời điểm + giá trị quy đổi. */
type BacktestHistory = TradeHistory & {
  time: string
  value?: { usd: string | null; inInputStart: string | null }
}

// Giả định của backtest — xem đầu file helper/swapV4_backtest.ts
const BACKTEST_OPTIONS: Partial<BacktestOptions> = {
  priceSlippage: "0.001", // biên giá limit 0.1% như swapV4.js
  feeRate: "0",           // phí trừ trên số nhận về
  log: false,             // true = in từng lệnh swap
}

// Cuối data có swap hết về inputStart (withdrawTradeV4) để ra PnL không
const WITHDRAW_AT_END = true

// address giả: tradeV4 bắt buộc có address, backtest không dùng tới
const arrToken: Array<{ time: string; arrToken: ArrTokenInput[] }> = ARR_TOKEN.map(e => {
  return {
    time: e.time,
    arrToken: e.arrToken.map((token, index) => ({ ...token, address: `0x9f276af79b2b5de2946a88b0fe2717318f924d${index}c` })),
  }
})

// Giống index.js
const initConfig: RegisterConfigInput = {
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
const valueOf = (history: TradeHistory, tokens: ArrTokenInput[], inputStart: string) => {
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

  const histories: BacktestHistory[] = []
  let config: TradeConfig | null = null
  let lastTokens: ArrTokenInput[] | null = null

  for (const [index, { time, arrToken: tokens }] of arrToken.entries()) {
    const tradeTokens = filterTradeTokens(tokens, initConfig.tradeTokens)
    lastTokens = tradeTokens

    const res: TradeResult = index === 0 || !config
      ? registerTradeV4({ config: initConfig, arrToken: tradeTokens })
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

  let withdrawResult: TradeResult | null = null
  if (WITHDRAW_AT_END && lastTokens && config) {
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
    amount: BigNumber(h.amountSwap as string).toFixed(8),
    valueUSD: h.value?.usd,
    [`value${initConfig.inputStart}`]: h.value?.inInputStart,
  })))

  const first = arrToken[0]
  const last = arrToken[arrToken.length - 1]
  const holdUSD = BigNumber(initConfig.amountStart).times(
    first.arrToken.find(t => convertSymbolToken(t.symbol) === initConfig.inputStart)!.price
  )
  const priceInputLast = last.arrToken.find(t => convertSymbolToken(t.symbol) === initConfig.inputStart)!.price

  console.log("\n=========== TỔNG KẾT ===========")
  console.log({
    from: first.time,
    to: last.time,
    points: arrToken.length,
    amountSwap: swaps.length,
    ordersSimulated: getBacktestOrders().length,
    amountStart: `${initConfig.amountStart} ${initConfig.inputStart}`,
    holding: `${config?.state.amountInput} ${config?.state.outputSwap}`,
    ...(withdrawResult && {
      amountWithdraw: `${withdrawResult.history.amountWithdraw} ${initConfig.inputStart}`,
      pnl: `${withdrawResult.history.pnl} ${initConfig.inputStart}`,
      pnlPercent: BigNumber(withdrawResult.history.pnl as string).dividedBy(initConfig.amountStart).times(100).toFixed(4) + "%",
    }),
    holdOnlyUSD: `${holdUSD.toFixed(2)} -> ${BigNumber(initConfig.amountStart).times(priceInputLast).toFixed(2)}`,
  })
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
