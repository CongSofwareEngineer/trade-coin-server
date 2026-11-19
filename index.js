const { ARR_TOKEN } = require("./helper/data_fake")
const { registerTradeV4, runTradeV4 } = require("./helper/tradev4")
const { filterTradeTokens, convertSymbolToken } = require("./utils/token")

let arrToken = ARR_TOKEN.map(e => {
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


let histories = []


const main = async () => {
  initConfig.inputStart = convertSymbolToken(initConfig.inputStart)
  for (const [index, tokens] of arrToken.entries()) {
    const tradeTokens = filterTradeTokens(tokens, initConfig.tradeTokens)

    if (index === 0) {
      const register = registerTradeV4({ config: initConfig, arrToken: tradeTokens })
      initConfig = register.config
      histories.push(register.history)
    } else {
      const data = await runTradeV4({
        config: initConfig,
        arrToken: tradeTokens,
        idBot: 'no-bot',
        chainId: '8453'
      })

      initConfig = data.config
      histories.push(data.history)
    }
  }
  let amountSwap = 0
  histories.forEach(e => {
    if (e.action === 'SWAP_PENDING') {
      amountSwap++
    }
  })

  console.log({ initConfig, amountSwap });
}
main()

