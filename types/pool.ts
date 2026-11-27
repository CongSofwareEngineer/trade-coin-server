/**
 * ============================================================================
 * TYPES — POOL V4: response API /pool của KeyringOne + pool đã chuẩn hoá
 * ============================================================================
 *
 * `GET /pool?limit=50&page=1&version=v4` → `PoolApiResponse`.
 * services/poolV4.ts chuẩn hoá mỗi `PoolApiItem` thành `Pool`.
 * ============================================================================
 */

import type { Address } from "viem";

/** Stablecoin (đồng quote) của một chain — constant/token.ts. */
export interface StableToken {
    /** lowercase */
    address: string;
    symbol: string;
    decimals: number;
    chainId: number;
}

/** token0 / token1 trong item API. */
export interface PoolApiToken {
    address: string;
    symbol: string;
    decimals: number;
    [key: string]: unknown;
}

/** Một item của API /pool (chỉ các field bot đọc). */
export interface PoolApiItem {
    _id: string;
    poolId: `0x${string}`;
    hookAddress: string;
    /** v4: địa chỉ StateView. */
    poolAddress: string;
    chainId: number | string;
    token0: PoolApiToken;
    token1: PoolApiToken;
    tickSpacing: number;
    feeTier: number;
    version: string;
    /** Pool test → bỏ. */
    isDev?: boolean;
    createdAt?: string;
    [key: string]: unknown;
}

export interface PoolApiResponse {
    statusCode: number;
    data: {
        items: PoolApiItem[];
        total: number;
        limit: number;
        page: number;
        totalPages: number;
    };
}

/** Token của pool đã checksum address. */
export interface PoolToken {
    address: Address;
    symbol: string;
    decimals: number;
}

/** Pool đã chuẩn hoá: base = đồng đem trade, quote = stablecoin của chain. */
export interface Pool {
    id: string;
    chainId: number;
    poolId: `0x${string}`;
    hook: Address;
    stateView: Address;
    fee: number;
    tickSpacing: number;
    token0: PoolToken;
    token1: PoolToken;
    baseToken: PoolToken;
    quoteToken: PoolToken;
    baseIsToken0: boolean;
    createdAt?: string;
}

/** PoolKey của Uniswap v4 (token0 < token1 theo address). */
export interface PoolKey {
    currency0: Address;
    currency1: Address;
    fee: number;
    tickSpacing: number;
    hooks: Address;
}
