/**
 * ============================================================================
 * CONSTANT TOKEN — cố định token USDC (đồng quote) của từng chain
 * ============================================================================
 *
 * Pool limit order v4 bên KeyringOne luôn là cặp TOKEN / STABLE:
 *   - base token  = đồng đem trade (WETH, cbBTC, AMZNc, NVDAc, ...)
 *   - quote token = stablecoin của chain (USDC, riêng chain 4663 là USDG)
 *
 * Uniswap v4 sort token0 / token1 theo address, nên stablecoin có thể nằm ở
 * token0 (Base USDC/cbBTC) hoặc token1 (Base WETH/USDC). File này là nguồn
 * duy nhất để biết bên nào là quote → từ đó suy ra `baseIsToken0`.
 *
 * Address lấy đúng theo `stableCoinsByChain` của coinpool-client.
 * ============================================================================
 */

import type { StableToken } from "../types/pool";

/** USDC (hoặc stablecoin tương đương) theo chainId. Address luôn so sánh lowercase. */
export const STABLE_COIN_BY_CHAIN: Record<number, StableToken> = {
    1: { address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", symbol: "USDC", decimals: 6, chainId: 1 },
    10: { address: "0x0b2c639c533813f4aa9d7837caf62653d097ff85", symbol: "USDC", decimals: 6, chainId: 10 },
    56: { address: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d", symbol: "USDC", decimals: 18, chainId: 56 },
    130: { address: "0x078d782b760474a361dda0af3839290b0ef57ad6", symbol: "USDC", decimals: 6, chainId: 130 },
    4663: { address: "0x5fc5360d0400a0fd4f2af552add042d716f1d168", symbol: "USDG", decimals: 6, chainId: 4663 },
    5042: { address: "0x3600000000000000000000000000000000000000", symbol: "USDC", decimals: 6, chainId: 5042 },
    8453: { address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", symbol: "USDC", decimals: 6, chainId: 8453 },
    42161: { address: "0xaf88d065e77c8cc2239327c5edb3a432268e5831", symbol: "USDC", decimals: 6, chainId: 42161 },
};

/** Chain bot đang chạy mặc định (Base). */
export const DEFAULT_CHAIN_ID = 8453;

/** USDC trên Base — đồng quote bot dùng cho mọi lệnh buy/sell. */
export const USDC: StableToken = STABLE_COIN_BY_CHAIN[DEFAULT_CHAIN_ID];

const lower = (value: unknown): string => String(value || "").trim().toLowerCase();

export const isSameAddress = (a: string | null | undefined, b: string | null | undefined): boolean =>
    !!a && !!b && lower(a) === lower(b);

/** Stablecoin (đồng quote) của một chain. */
export const getStableCoin = (chainId: string | number): StableToken | null => STABLE_COIN_BY_CHAIN[Number(chainId)] || null;

/** Token này có phải đồng quote (USDC/USDG) của chain đó không. */
export const isStableCoin = (chainId: string | number, address: string): boolean => {
    const stable = getStableCoin(chainId);
    if (!stable) return false;

    return isSameAddress(stable.address, address);
};
