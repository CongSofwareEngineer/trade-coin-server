/**
 * ============================================================================
 * POOL V4 — list pool limit order từ API KeyringOne
 * ============================================================================
 *
 * `GET /pool?limit=50&page=1&version=v4`
 * → { statusCode, data: { items, total, limit, page, totalPages } }
 *
 * Mỗi item có `_id`, `poolId`, `hookAddress`, `poolAddress` (v4 là địa chỉ
 * StateView), `chainId`, `token0` / `token1`, `tickSpacing`, `feeTier`, và
 * `isDev` (pool test → bỏ).
 *
 * Không hard-code pool ở đâu cả: thêm cặp mới chỉ cần backend thêm vào /pool.
 * ============================================================================
 */

const { getAddress, isAddress } = require("viem");
const { POOL_API_URL, POOL_CACHE_TTL_MS } = require("../constant/swapV4");
const { getStableCoin, isSameAddress } = require("../constant/token");

let poolCache = { at: 0, items: [] };

/** Gọi API /pool, cache theo `POOL_CACHE_TTL_MS`. */
const fetchPools = async () => {
    const now = Date.now();
    if (poolCache.items.length && now - poolCache.at < POOL_CACHE_TTL_MS) return poolCache.items;

    const url = `${POOL_API_URL.replace(/\/+$/, "")}/pool?limit=50&page=1&version=v4`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`[poolV4] GET /pool lỗi ${res.status}`);

    const body = await res.json();
    const items = ((body && body.data && body.data.items) || []).filter(
        (item) => item && item.version === "v4" && !item.isDev
    );

    if (!items.length) throw new Error("[poolV4] API /pool không trả về pool v4 nào");

    poolCache = { at: now, items };

    return items;
};

/** Xoá cache (test hoặc khi backend vừa thêm pool mới). */
const clearPoolCache = () => {
    poolCache = { at: 0, items: [] };
};

/**
 * Chuẩn hoá một item API: base = đồng đem trade, quote = stablecoin của chain.
 *
 * Trả `null` cho pool bot không trade được (chain chưa khai stablecoin trong
 * constant/token.js, thiếu address, hoặc pool không có chân stablecoin).
 */
const toPool = (item) => {
    const chainId = Number(item.chainId);
    if (!isAddress(item.hookAddress) || !isAddress(item.poolAddress)) return null;
    if (!isAddress(item.token0 && item.token0.address) || !isAddress(item.token1 && item.token1.address)) return null;

    const token0 = { address: getAddress(item.token0.address), symbol: item.token0.symbol, decimals: item.token0.decimals };
    const token1 = { address: getAddress(item.token1.address), symbol: item.token1.symbol, decimals: item.token1.decimals };

    const stable = getStableCoin(chainId);
    if (!stable) return null;
    // Stablecoin là đồng quote. Uniswap sort theo address nên nó có thể là token0.
    const baseIsToken0 = !isSameAddress(token0.address, stable.address);
    if (baseIsToken0 && !isSameAddress(token1.address, stable.address)) return null;

    return {
        id: item._id,
        chainId,
        poolId: item.poolId,
        hook: getAddress(item.hookAddress),
        stateView: getAddress(item.poolAddress),
        fee: item.feeTier,
        tickSpacing: item.tickSpacing,
        token0,
        token1,
        baseToken: baseIsToken0 ? token0 : token1,
        quoteToken: baseIsToken0 ? token1 : token0,
        baseIsToken0,
        createdAt: item.createdAt,
    };
};

/**
 * Tìm pool của cặp (tokenA, tokenB) trên chain.
 *
 * Base đang có 2 hook cho WETH/USDC (hook cũ `0xbbEC…9040` backend chưa xoá)
 * → lấy pool mới nhất theo `createdAt`.
 *
 * @param {Object} params
 * @param {string|number} params.chainId
 * @param {string} params.tokenA
 * @param {string} params.tokenB
 * @returns {Promise<Object>} pool đã chuẩn hoá
 */
const findPool = async ({ chainId, tokenA, tokenB }) => {
    const items = await fetchPools();

    const matched = items
        .map(toPool)
        .filter(Boolean)
        .filter((pool) => {
            if (pool.chainId !== Number(chainId)) return false;
            const pair = [pool.token0.address, pool.token1.address];

            return (
                pair.some((address) => isSameAddress(address, tokenA)) &&
                pair.some((address) => isSameAddress(address, tokenB))
            );
        })
        .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    if (!matched.length) {
        throw new Error(`[poolV4] chain ${chainId} không có pool limit order cho cặp ${tokenA} / ${tokenB}`);
    }

    return matched[0];
};

module.exports = { fetchPools, clearPoolCache, toPool, findPool };
