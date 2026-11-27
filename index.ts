import { ARR_TOKEN } from "./helper/data_fake";
import { registerTradeV4, runTradeV4 } from "./helper/tradeV4";
import { filterTradeTokens, convertSymbolToken } from "./utils/token";
import type { ArrTokenInput, RegisterConfigInput, TradeConfig, TradeHistory } from "./types";

const arrToken: ArrTokenInput[][] = ARR_TOKEN.map(e => {
  return e.arrToken.map(token => {
    return {
      ...token,
      address: '0x'
    }
  })
})

// tradeTokens: list token user ĐĂNG KÝ cho bot này chạy.
// arrToken từ server có thể 10-12 đồng, bot chỉ chạy đúng những đồng trong đây.
// Bắt buộc có cả ETH và BTC (thuật toán V4 lấy ETH làm đơn vị, BTC làm mốc).
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


const histories: TradeHistory[] = []


const main = async () => {
  initConfig.inputStart = convertSymbolToken(initConfig.inputStart)
  let config: TradeConfig | null = null

  for (const [index, tokens] of arrToken.entries()) {
    const tradeTokens = filterTradeTokens(tokens, initConfig.tradeTokens)

    if (index === 0 || !config) {
      const register = registerTradeV4({ config: initConfig, arrToken: tradeTokens })
      config = register.config
      histories.push(register.history)
    } else {
      const data = await runTradeV4({
        config,
        arrToken: tradeTokens,
        idBot: 'no-bot',
        chainId: '8453'
      })

      config = data.config
      histories.push(data.history)
    }
  }
  let amountSwap = 0
  histories.forEach(e => {
    if (e.action === 'SWAP_PENDING') {
      amountSwap++
    }
  })

  console.log({ config, amountSwap });
}
main()
