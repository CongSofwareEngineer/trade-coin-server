const SYMBOL_ETH = ["ETH", "WETH", "CBETH"];
const SYMBOL_BTC = ["BTC", "WBTC", "CBBTC", "BTCB"];

//symbol token luôn uppercase, dùng chung cho mọi so sánh / key
const uppercase = (value) => {
    if (!value) return "";

    return String(value).trim().toUpperCase();
};

//ETH/WETH/CBETH coi là ETH, BTC/WBTC/CBBTC/BTCB coi là BTC
const isSymbolETHOrBTC = (symbol, type = "eth") => {
    if (type === "eth") return SYMBOL_ETH.includes(uppercase(symbol));

    return SYMBOL_BTC.includes(uppercase(symbol));
};




/**
 * Lọc arrToken của một mốc giá xuống đúng list token user muốn chạy.
 *
 * @param {Array<{symbol: string, price: number|string, address?: string}>} arrToken  token server trả về tại mốc này
 * @param {string[]} tradeTokens  list symbol user đăng ký (initConfig.tradeTokens)
 * @returns {Array} arrToken đã lọc, thứ tự theo tradeTokens
 *
 * Throw nếu thiếu token user đăng ký — thiếu một đồng là state sai từ mốc đó
 * trở đi mà không báo lỗi, nên dừng sớm hơn là chạy tiếp.
 */
const filterTradeTokens = (arrToken = [], tradeTokens = []) => {
    if (!Array.isArray(arrToken) || arrToken.length === 0) {
        throw new Error('[filterTradeTokens] arrToken rỗng')
    }

    // không khai báo tradeTokens → chạy hết arrToken như cũ
    if (!Array.isArray(tradeTokens) || tradeTokens.length === 0) return arrToken

    const missing = []

    const filtered = tradeTokens.map((symbol) => {
        const token = arrToken.find(e => {
            const symbolParent = convertSymbolToken(symbol)
            const symbolE = convertSymbolToken(e.symbol)
            return symbolE === symbolParent
        })

        if (!token) missing.push(symbolParent)

        return token
    }).filter(Boolean)

    if (missing.length) {
        throw new Error(`[filterTradeTokens] arrToken không có token user đăng ký: ${missing.join(', ')}`)
    }

    return filtered
}

const convertSymbolToken = (symbol) => {
    if (!symbol) return ''
    if (isSymbolETHOrBTC(symbol, 'eth')) return 'ETH'
    if (isSymbolETHOrBTC(symbol, 'btc')) return 'BTC'
    return uppercase(symbol)
}

module.exports = {
    uppercase,
    isSymbolETHOrBTC,
    filterTradeTokens,
    convertSymbolToken
};
