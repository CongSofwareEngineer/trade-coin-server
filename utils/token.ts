const SYMBOL_ETH = ["ETH", "WETH", "CBETH"];
const SYMBOL_BTC = ["BTC", "WBTC", "CBBTC", "BTCB"];

//symbol token luôn uppercase, dùng chung cho mọi so sánh / key
export const uppercase = (value: unknown): string => {
    if (!value) return "";

    return String(value).trim().toUpperCase();
};

//ETH/WETH/CBETH coi là ETH, BTC/WBTC/CBBTC/BTCB coi là BTC
export const isSymbolETHOrBTC = (symbol: string, type: "eth" | "btc" = "eth"): boolean => {
    if (type === "eth") return SYMBOL_ETH.includes(uppercase(symbol));

    return SYMBOL_BTC.includes(uppercase(symbol));
};

/**
 * Lọc arrToken của một mốc giá xuống đúng list token user muốn chạy.
 *
 * @param arrToken     token server trả về tại mốc này
 * @param tradeTokens  list symbol user đăng ký (initConfig.tradeTokens)
 * @returns arrToken đã lọc, thứ tự theo tradeTokens
 *
 * Throw nếu thiếu token user đăng ký — thiếu một đồng là state sai từ mốc đó
 * trở đi mà không báo lỗi, nên dừng sớm hơn là chạy tiếp.
 */
export const filterTradeTokens = <T extends { symbol: string }>(arrToken: T[] = [], tradeTokens: string[] = []): T[] => {
    if (!Array.isArray(arrToken) || arrToken.length === 0) {
        throw new Error('[filterTradeTokens] arrToken rỗng')
    }

    // không khai báo tradeTokens → chạy hết arrToken như cũ
    if (!Array.isArray(tradeTokens) || tradeTokens.length === 0) return arrToken

    const missing: string[] = []

    const filtered = tradeTokens.map((symbol) => {
        const symbolParent = convertSymbolToken(symbol)
        const token = arrToken.find(e => convertSymbolToken(e.symbol) === symbolParent)

        if (!token) missing.push(symbolParent)

        return token
    }).filter((token): token is T => Boolean(token))

    if (missing.length) {
        throw new Error(`[filterTradeTokens] arrToken không có token user đăng ký: ${missing.join(', ')}`)
    }

    return filtered
}

export const convertSymbolToken = (symbol: string | null | undefined): string => {
    if (!symbol) return ''
    if (isSymbolETHOrBTC(symbol, 'eth')) return 'ETH'
    if (isSymbolETHOrBTC(symbol, 'btc')) return 'BTC'
    return uppercase(symbol)
}
