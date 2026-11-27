/**
 * ============================================================================
 * SWAP V4 — đặt lệnh limit order Uniswap v4 hook (viem) cho bot
 * ============================================================================
 *
 * Port từ source `coinpool-client` (KeyringOne, trang `/trading`):
 *   - docs/logs/logManualLimitOrder.md                        tài liệu luồng
 *   - src/app/(auth)/trading/.../PlaceOrderForm.tsx           UI buy / sell
 *   - src/hooks/manualLimitOrder/usePlaceManualLimitOrder.tsx approve → place
 *
 * File này CHỈ export 4 hàm:
 *   - swapBuy(params)   mua base token bằng USDC   (UI = tab Buy)
 *   - swapSell(params)  bán base token lấy USDC    (UI = tab Sell)
 *   - approve(params)   approve ERC20 cho hook của pool
 *   - withdraw(params)  rút lệnh đã khớp về ví (UI = nút Withdraw / Cancel)
 *
 * Các phần khác đã tách ra:
 *   constant/token.ts      USDC / stablecoin cố định theo chain
 *   constant/abis.ts       ABI hook + StateView
 *   constant/swapV4.ts     số, ngưỡng, hằng số tick math
 *   utils/tickMathV4.ts    toán tick / sqrtPrice / liquidity, poolKey, poolId
 *   utils/quoteV4.ts       sizeOrder + quoteLimitOrder
 *   services/poolV4.ts     API /pool
 *   services/web3V4.ts     ví ký, RPC, client viem, approve ERC20
 *   types/swap.ts          type tham số / kết quả của 4 hàm
 *
 * ----------------------------------------------------------------------------
 * VÀO (giống hệt `swapOnchainV4` cũ):
 *     idBot          id của bot → tìm ví ký (private key) của bot
 *     chainId        chain đang chạy bot (vd 8453)
 *     swapId         khoá chống gửi trùng tx (gọi lại cùng swapId → trả tx cũ)
 *     tokenIn        ADDRESS token đang giữ (swapBuy: phải là USDC)
 *     priceTokenIn   giá USD của tokenIn tại mốc swap
 *     tokenOut       ADDRESS token muốn nhận (swapSell: phải là USDC)
 *     priceTokenOut  giá USD của tokenOut tại mốc swap
 *     amount         số tokenIn, đơn vị token (vd "1.5"), KHÔNG phải wei
 *
 * RA:
 *     { txHash, amount, ... }   `amount` = số tokenOut nhận được của lệnh,
 *                               đơn vị token (đúng field tradeV4.ts đang đọc)
 *
 * LỖI: không gửi được tx → THROW. Chỉ return khi tx đã được gửi lên mạng.
 *
 * ----------------------------------------------------------------------------
 * GIÁ LIMIT
 *
 * Hook không swap ngay: một lệnh là một position nằm trong ĐÚNG MỘT tick range
 * `[tickLower, tickLower + tickSpacing]` đặt ở phía bên kia giá thị trường.
 * Giá limit lấy từ giá USD truyền vào, quy về quote per base:
 *     swapSell → price = priceTokenIn  / priceTokenOut
 *     swapBuy  → price = priceTokenOut / priceTokenIn
 *
 * ⚠ KHÁC `swapOnchainV4` cũ ở bản chất: đây là LIMIT ORDER, không phải swap
 * market. Tx `placeOrder` thành công nghĩa là lệnh ĐÃ ĐẶT, token chỉ về ví khi
 * giá pool đi qua hết tick range (rồi phải gọi `withdraw`). `amount` trả về là
 * số sẽ nhận khi lệnh khớp (`minAmountOut`), không phải số đã nằm trong ví.
 *
 * ----------------------------------------------------------------------------
 * VÒNG ĐỜI MỘT LỆNH (vì sao cần `withdraw`)
 *
 *     swapBuy / swapSell  →  placeOrder   lệnh nằm trong pool, token đã rời ví
 *     giá pool qua hết range  →  hook `afterSwap` set `filled`
 *     withdraw            →  token mua được về ví
 *
 * Token KHÔNG tự về ví. Sau `placeOrder`, caller phải lưu lại
 * `{ poolId, hook, tickLower, zeroForOne }` (hoặc `orderId` đọc được từ chain)
 * để gọi `withdraw`, nếu không thì không có đường lấy lại tiền.
 * ============================================================================
 */

import BigNumber from "bignumber.js";
import { formatUnits, getAddress, isAddress, parseUnits, type Address, type Hex } from "viem";
import { LIMIT_ORDER_HOOK_ABI, STATE_VIEW_ABI } from "../constant/abis";
import { MAX_UINT256, NATIVE_GAS_BUFFER, PRICE_DECIMALS, ZERO } from "../constant/swapV4";
import { isSameAddress } from "../constant/token";
import {
    amount0ForLiquidity,
    amount1ForLiquidity,
    buildPoolKey,
    getAmountsForLiquidity,
    getPoolId,
    getSqrtRatioAtTick,
} from "../utils/tickMathV4";
import { quoteLimitOrder } from "../utils/quoteV4";
import { findPool } from "../services/poolV4";
import { getClients, readPreflight, sendApprove, type BotClients } from "../services/web3V4";
import type { Pool, PoolToken } from "../types/pool";
import type {
    ApproveParams,
    ApproveResult,
    OrderFillStatus,
    PlaceOrderResult,
    SwapParams,
    WithdrawParams,
    WithdrawResult,
} from "../types/swap";

/* ============================================================================
 * HELPER NỘI BỘ
 * ========================================================================== */

/** Biên giá cộng thêm cho lệnh limit: bán +0.1%, mua -0.1%. */
const PRICE_SLIPPAGE = BigNumber(0.001);

/**
 * Chống gửi trùng tx: cùng `swapId` gọi lại (server retry) thì trả kết quả cũ,
 * đang chạy thì chờ chính promise đó, KHÔNG gửi tx thứ hai.
 */
const inflight = new Map<string, Promise<unknown>>();

const withSwapId = <T>(swapId: string | undefined, action: string, run: () => Promise<T>): Promise<T> => {
    if (!swapId) return run();

    const key = `${action}:${swapId}`;
    const cached = inflight.get(key);
    if (cached) return cached as Promise<T>;

    const promise = run().catch((error) => {
        // Gửi tx thất bại thì bỏ khoá để lần retry sau được gửi lại.
        inflight.delete(key);
        throw error;
    });
    inflight.set(key, promise);

    return promise;
};

const requireAddress = (value: string | null | undefined, label: string): Address => {
    console.log({ value, label });

    if (!value || !isAddress(value)) throw new Error(`[swapV4] ${label} không phải address: ${value}`);

    return getAddress(value);
};

const requirePositive = (value: BigNumber.Value, label: string): BigNumber => {
    const number = BigNumber(value);
    if (!number.isFinite() || number.lte(0)) throw new Error(`[swapV4] ${label} phải là số > 0: ${value}`);

    return number;
};

/** Giá + tick hiện tại của pool, từ `StateView.getSlot0`. */
const getSlot0 = async ({
    publicClient,
    pool,
}: {
    publicClient: BotClients["publicClient"];
    pool: Pool;
}): Promise<{ sqrtPriceX96: bigint; tick: number }> => {
    const slot0 = await publicClient.readContract({
        abi: STATE_VIEW_ABI,
        address: pool.stateView,
        functionName: "getSlot0",
        args: [pool.poolId],
    });

    return { sqrtPriceX96: slot0[0], tick: Number(slot0[1]) };
};

/** Tick hiện tại của pool. */
const getCurrentTick = async ({
    publicClient,
    pool,
}: {
    publicClient: BotClients["publicClient"];
    pool: Pool;
}): Promise<number> => (await getSlot0({ publicClient, pool })).tick;

/**
 * Giá limit (quote per base) và hai số base / quote của lệnh.
 *
 * Làm tròn đúng như `PlaceOrderForm`: bên user nhập luôn được tôn trọng —
 * bán nhận về ít nhất `base * price`, mua trả nhiều nhất `amount`.
 */
const buildAmounts = ({
    isSell,
    amount,
    usdIn,
    usdOut,
    baseToken,
    quoteToken,
}: {
    isSell: boolean;
    amount: BigNumber.Value;
    usdIn: BigNumber;
    usdOut: BigNumber;
    baseToken: PoolToken;
    quoteToken: PoolToken;
}): { price: BigNumber; baseAmount: BigNumber; quoteAmount: BigNumber } => {
    // Cộng 0.1% biên lợi cho bot: bán nâng giá 0.1%, mua hạ giá 0.1%.
    const slippage = isSell ? BigNumber(1).plus(PRICE_SLIPPAGE) : BigNumber(1).minus(PRICE_SLIPPAGE);
    const price = (isSell ? usdIn.dividedBy(usdOut) : usdOut.dividedBy(usdIn))
        .times(slippage)
        .decimalPlaces(PRICE_DECIMALS, BigNumber.ROUND_DOWN);
    if (price.lte(0)) throw new Error("[swapV4] giá limit làm tròn về 0, giá USD truyền vào quá lệch");

    let baseAmount: BigNumber;
    let quoteAmount: BigNumber;
    if (isSell) {
        baseAmount = BigNumber(amount).decimalPlaces(baseToken.decimals, BigNumber.ROUND_DOWN);
        quoteAmount = baseAmount.times(price).decimalPlaces(quoteToken.decimals, BigNumber.ROUND_DOWN);
    } else {
        quoteAmount = BigNumber(amount).decimalPlaces(quoteToken.decimals, BigNumber.ROUND_DOWN);
        baseAmount = quoteAmount.dividedBy(price).decimalPlaces(baseToken.decimals, BigNumber.ROUND_DOWN);
    }
    if (baseAmount.lte(0) || quoteAmount.lte(0)) throw new Error("[swapV4] amount quá nhỏ, lệnh làm tròn về 0");

    return { price, baseAmount, quoteAmount };
};

/* ============================================================================
 * LÕI: đặt lệnh limit (dùng chung cho swapBuy / swapSell)
 * ========================================================================== */

/** `isSell`: true = bán base lấy quote (Sell), false = mua base bằng quote (Buy). */
const placeLimitOrder = async ({
    isSell,
    idBot,
    chainId,
    tokenIn,
    priceTokenIn,
    tokenOut,
    priceTokenOut,
    amount,
    privateKey,
}: SwapParams & { isSell: boolean }): Promise<PlaceOrderResult> => {
    const addressIn = requireAddress(tokenIn, "tokenIn");
    const addressOut = requireAddress(tokenOut, "tokenOut");
    if (isSameAddress(addressIn, addressOut)) throw new Error("[swapV4] tokenIn và tokenOut giống nhau");

    const usdIn = requirePositive(priceTokenIn, "priceTokenIn");
    const usdOut = requirePositive(priceTokenOut, "priceTokenOut");
    requirePositive(amount, "amount");

    const pool = await findPool({ chainId, tokenA: addressIn, tokenB: addressOut });

    // Sell: bán base lấy quote. Buy: trả quote lấy base. Sai chiều là đặt sai lệnh.
    const expectedIn = isSell ? pool.baseToken : pool.quoteToken;
    const expectedOut = isSell ? pool.quoteToken : pool.baseToken;
    if (!isSameAddress(addressIn, expectedIn.address) || !isSameAddress(addressOut, expectedOut.address)) {
        throw new Error(
            `[swapV4] ${isSell ? "swapSell" : "swapBuy"} sai chiều: pool ${pool.baseToken.symbol}/${pool.quoteToken.symbol} ` +
            `cần tokenIn = ${expectedIn.symbol}, tokenOut = ${expectedOut.symbol}`
        );
    }

    const { price, baseAmount, quoteAmount } = buildAmounts({
        isSell,
        amount,
        usdIn,
        usdOut,
        baseToken: pool.baseToken,
        quoteToken: pool.quoteToken,
    });

    const { account, publicClient, walletClient } = getClients({ chainId, idBot, privateKey });
    const owner = account.address;

    const poolKey = buildPoolKey({
        tokenA: pool.token0.address,
        tokenB: pool.token1.address,
        fee: pool.fee,
        tickSpacing: pool.tickSpacing,
        hooks: pool.hook,
    });
    // poolKey sai (API đổi fee / tickSpacing) thì placeOrder vào pool khác → chặn sớm.
    if (pool.poolId && !isSameAddress(getPoolId(poolKey), pool.poolId)) {
        throw new Error(`[swapV4] poolKey không khớp poolId của API (pool ${pool.id})`);
    }

    // `zeroForOne` của hook nghĩa là "bán token0".
    const zeroForOne = isSell ? pool.baseIsToken0 : !pool.baseIsToken0;
    const sellToken = zeroForOne ? pool.token0 : pool.token1;
    const buyToken = zeroForOne ? pool.token1 : pool.token0;

    const currentTick = await getCurrentTick({ publicClient, pool });

    const quote = quoteLimitOrder({
        amountIn: (isSell ? baseAmount : quoteAmount).toFixed(),
        amountOut: (isSell ? quoteAmount : baseAmount).toFixed(),
        zeroForOne,
        currentTick,
        tickSpacing: pool.tickSpacing,
        sellToken,
        buyToken,
    });

    // Hook kéo đúng `settleIn` (giá mint round UP), có thể hơn actualIn 1 wei.
    const settleIn = quote.raw.settleIn;
    const { nativeBalance, tokenBalance, allowance } = await readPreflight({
        publicClient,
        owner,
        token: getAddress(sellToken.address),
        spender: pool.hook,
    });

    if (nativeBalance <= NATIVE_GAS_BUFFER) {
        throw new Error(`[swapV4] ví ${owner} không đủ native trả gas trên chain ${chainId}`);
    }
    if (settleIn > tokenBalance) {
        throw new Error(
            `[swapV4] ví ${owner} không đủ ${sellToken.symbol}: cần ${formatUnits(settleIn, sellToken.decimals)}, ` +
            `đang có ${formatUnits(tokenBalance, sellToken.decimals)}`
        );
    }

    let approveTxHash: Hex | null = null;
    if (allowance < settleIn) {
        approveTxHash = await sendApprove({
            publicClient,
            walletClient,
            owner,
            token: getAddress(sellToken.address),
            spender: pool.hook,
            amount: settleIn,
        });
    }

    // Chỉ GỬI tx, không chờ confirm (giống swapOnchainV4 cũ).
    const txHash = await walletClient.writeContract({
        abi: LIMIT_ORDER_HOOK_ABI,
        address: pool.hook,
        functionName: "placeOrder",
        args: [poolKey, quote.tickLower, zeroForOne, quote.liquidity],
    });

    return {
        txHash,
        // số tokenOut nhận được khi lệnh khớp — field `amount` tradeV4.js đang đọc
        amount: quote.amountOut,
        approveTxHash,
        owner,
        poolId: pool.poolId,
        hook: pool.hook,
        side: isSell ? "SELL" : "BUY",
        price: price.toFixed(),
        amountIn: quote.amountIn,
        amountOut: quote.amountOut,
        settleIn: formatUnits(settleIn, sellToken.decimals),
        tickLower: quote.tickLower,
        tickUpper: quote.tickUpper,
        currentTick,
        liquidity: quote.liquidity.toString(),
        zeroForOne,
    };
};

/* ============================================================================
 * 3 HÀM EXPORT
 * ========================================================================== */

/**
 * MUA base token bằng USDC (tab Buy của UI).
 *
 * `tokenIn` phải là USDC của chain, `tokenOut` là đồng muốn mua.
 * `amount` là số USDC đem đi mua (trả NHIỀU NHẤT số này).
 * Tham số: xem `SwapParams` (types/swap.ts).
 */
export const swapBuy = async (params: SwapParams): Promise<PlaceOrderResult> =>
    withSwapId(params && params.swapId, "buy", () => placeLimitOrder({ ...params, isSell: false }));

/**
 * BÁN base token lấy USDC (tab Sell của UI).
 *
 * `tokenIn` là đồng đang giữ, `tokenOut` phải là USDC của chain.
 * `amount` là số token đem bán (nhận về ÍT NHẤT `amount * price`).
 * Tham số giống `swapBuy`, đổi chiều token.
 */
export const swapSell = async (params: SwapParams): Promise<PlaceOrderResult> =>
    withSwapId(params && params.swapId, "sell", () => placeLimitOrder({ ...params, isSell: true }));

/**
 * APPROVE ERC20 cho hook của pool (spender = hook address).
 *
 * `swapBuy` / `swapSell` tự approve đúng số cần khi allowance thiếu, nên hàm
 * này chỉ dùng khi muốn approve trước một lần cho nhiều mốc (amount rỗng =
 * approve max uint256). Tham số: xem `ApproveParams`.
 */
export const approve = async (params: ApproveParams): Promise<ApproveResult> =>
    withSwapId(params.swapId, "approve", async (): Promise<ApproveResult> => {
        const { idBot, chainId, tokenIn, tokenOut, amount, spender, privateKey } = params;

        const addressIn = requireAddress(tokenIn, "tokenIn");
        const addressOut = requireAddress(tokenOut, "tokenOut");

        const pool = await findPool({ chainId, tokenA: addressIn, tokenB: addressOut });
        const token = [pool.token0, pool.token1].find((item) => isSameAddress(item.address, addressIn));
        if (!token) throw new Error(`[swapV4] tokenIn ${addressIn} không thuộc pool ${pool.id}`);

        const target = spender ? requireAddress(spender, "spender") : pool.hook;
        const amountUnits = amount ? parseUnits(BigNumber(amount).toFixed(), token.decimals) : MAX_UINT256;
        if (amountUnits <= ZERO) throw new Error(`[swapV4] amount approve phải > 0: ${amount}`);

        const { account, publicClient, walletClient } = getClients({ chainId, idBot, privateKey });

        const txHash = await sendApprove({
            publicClient,
            walletClient,
            owner: account.address,
            token: getAddress(token.address),
            spender: target,
            amount: amountUnits,
        });

        return {
            txHash,
            amount: amountUnits === MAX_UINT256 ? "max" : formatUnits(amountUnits, token.decimals),
            spender: target,
            owner: account.address,
            token: getAddress(token.address),
        };
    });

/**
 * RÚT LỆNH ĐÃ KHỚP VỀ VÍ (UI = nút Withdraw / Cancel của Order history).
 *
 * `placeOrder` chỉ đặt lệnh: token mua được nằm ở hook tới khi gọi hàm này.
 * Hàm đọc trạng thái lệnh trên chain rồi chọn ĐÚNG MỘT trong hai tx, giống hệt
 * nút Withdraw bên web:
 *
 *   - lệnh đã `filled` (giá đi qua hết tick range)
 *         → `withdraw(orderId, to)`, nhận toàn bộ đồng mua. `mode = "WITHDRAW"`.
 *   - lệnh chưa khớp hết (OPEN / PARTIAL / MATCHED_PENDING)
 *         → `withdraw` sẽ revert `NotFilled()`, nên gọi `cancelOrder(poolKey,
 *           tickLower, zeroForOne, to)`: hook rút liquidity của ví theo GIÁ
 *           HIỆN TẠI, trả về phần đã đổi (đồng mua) + phần còn lại (đồng bán).
 *           `mode = "CANCEL"`. Truyền `allowCancel: false` để throw thay vì huỷ.
 *
 * Hook không có partial withdraw: `withdraw` không nhận số lượng, rút là rút hết
 * phần của ví trong `orderId`.
 *
 * ⚠ `orderId` là CHUNG: mọi ví đặt cùng tick + cùng chiều vào chung một
 * `orderId`, mỗi ví một phần `liquidity`. Số nhận về của ví =
 * `tổng tiền đã đổi * liquidity của ví / liquidityTotal`.
 *
 * ⚠ Số trả về là số ĐỌC TRƯỚC khi gửi tx (hàm chỉ gửi tx, không chờ receipt —
 * giống `swapBuy` / `swapSell`). Với `mode = "WITHDRAW"` số này chốt rồi nên
 * đúng; với `mode = "CANCEL"` nó theo giá lúc đọc, giá nhảy trước khi tx lên
 * chain thì số thực nhận lệch.
 *
 * Tham số: xem `WithdrawParams`. `amount` trả về = số ĐỒNG MUA về ví. Lệnh chưa
 * đổi được gì mà bị cancel thì `amount = "0"`, số gốc về ở `amountSellBack`.
 */
export const withdraw = async (params: WithdrawParams): Promise<WithdrawResult> =>
    withSwapId(params.swapId, "withdraw", async (): Promise<WithdrawResult> => {
        const {
            idBot,
            chainId,
            tokenIn,
            tokenOut,
            orderId,
            tickLower,
            zeroForOne,
            to,
            allowCancel = true,
            privateKey,
        } = params;

        const addressIn = requireAddress(tokenIn, "tokenIn");
        const addressOut = requireAddress(tokenOut, "tokenOut");
        if (isSameAddress(addressIn, addressOut)) throw new Error("[swapV4] tokenIn và tokenOut giống nhau");

        const hasOrderId = orderId !== undefined && orderId !== null && orderId !== "";
        const hasTick = tickLower !== undefined && tickLower !== null;
        if (!hasOrderId && !hasTick) throw new Error("[swapV4] withdraw cần orderId hoặc tickLower của lệnh");
        if (hasTick && !Number.isInteger(Number(tickLower))) {
            throw new Error(`[swapV4] tickLower phải là số nguyên: ${tickLower}`);
        }

        const pool = await findPool({ chainId, tokenA: addressIn, tokenB: addressOut });

        const pair = [pool.token0, pool.token1];
        const sellToken = pair.find((item) => isSameAddress(item.address, addressIn));
        const buyToken = pair.find((item) => isSameAddress(item.address, addressOut));
        if (!sellToken || !buyToken) {
            throw new Error(`[swapV4] tokenIn / tokenOut không thuộc pool ${pool.id}`);
        }

        // `zeroForOne` của hook nghĩa là "bán token0" → suy từ chính tokenIn.
        const side = isSameAddress(sellToken.address, pool.token0.address);
        if (typeof zeroForOne === "boolean" && zeroForOne !== side) {
            throw new Error(
                `[swapV4] zeroForOne = ${zeroForOne} không khớp chiều ${sellToken.symbol} -> ${buyToken.symbol} (phải là ${side})`
            );
        }

        const poolKey = buildPoolKey({
            tokenA: pool.token0.address,
            tokenB: pool.token1.address,
            fee: pool.fee,
            tickSpacing: pool.tickSpacing,
            hooks: pool.hook,
        });
        if (pool.poolId && !isSameAddress(getPoolId(poolKey), pool.poolId)) {
            throw new Error(`[swapV4] poolKey không khớp poolId của API (pool ${pool.id})`);
        }

        const tick = hasTick ? Number(tickLower) : null;
        if (tick !== null && tick % pool.tickSpacing !== 0) {
            throw new Error(`[swapV4] tickLower ${tick} không chia hết cho tickSpacing ${pool.tickSpacing}`);
        }

        const { account, publicClient, walletClient } = getClients({ chainId, idBot, privateKey });
        const owner = account.address;
        const receiver = to ? requireAddress(to, "to") : owner;

        // Không có orderId thì đọc orderId ĐANG hoạt động của (tick, chiều) đó.
        // Lưu ý: lệnh cũ đã khớp xong mà slot này có lệnh mới thì id ở đây là id
        // MỚI — nên lưu orderId lúc place là chắc nhất.
        const id: bigint = hasOrderId
            ? BigInt(orderId as string | number | bigint)
            : await publicClient.readContract({
                abi: LIMIT_ORDER_HOOK_ABI,
                address: pool.hook,
                functionName: "getOrderId",
                args: [poolKey, tick as number, side],
            });
        if (id <= ZERO) throw new Error(`[swapV4] không tìm thấy orderId của tick ${tick} (pool ${pool.id})`);

        const [liquidity, info] = await Promise.all([
            publicClient.readContract({
                abi: LIMIT_ORDER_HOOK_ABI,
                address: pool.hook,
                functionName: "getOrderLiquidity",
                args: [id, owner],
            }),
            publicClient.readContract({
                abi: LIMIT_ORDER_HOOK_ABI,
                address: pool.hook,
                functionName: "getOrderInfo",
                args: [id],
            }),
        ]);

        const [filled, , , currency0Total, currency1Total, liquidityTotal] = info;

        // Hook xoá liquidity[owner] ngay khi withdraw / cancel xong → 0 nghĩa là
        // lệnh đã rút rồi, hoặc ví này chưa từng có phần trong orderId đó.
        if (liquidity <= ZERO) {
            throw new Error(
                `[swapV4] ví ${owner} không còn liquidity ở orderId ${id} (đã withdraw/cancel, hoặc sai orderId)`
            );
        }

        let amountOut = ZERO;
        let amountSellBack = ZERO;
        let filledPercent = 100;
        let status: OrderFillStatus = "FILLED";

        if (filled) {
            // Đã khớp hết: chia tổng tiền đã đổi của orderId theo phần liquidity của ví.
            const proceedsTotal = side ? currency1Total : currency0Total;
            amountOut = liquidityTotal <= ZERO ? ZERO : (proceedsTotal * liquidity) / liquidityTotal;
        } else {
            // Chưa khớp hết: phải có tick mới tính được số và mới gọi được cancelOrder.
            if (tick === null) {
                throw new Error(
                    `[swapV4] orderId ${id} chưa khớp hết, phải truyền tickLower để huỷ lệnh lấy lại token`
                );
            }

            const sqrtLower = getSqrtRatioAtTick(tick);
            const sqrtUpper = getSqrtRatioAtTick(tick + pool.tickSpacing);
            const full0 = amount0ForLiquidity(sqrtLower, sqrtUpper, liquidity);
            const full1 = amount1ForLiquidity(sqrtLower, sqrtUpper, liquidity);
            const amountSell = side ? full0 : full1;

            const { sqrtPriceX96 } = await getSlot0({ publicClient, pool });
            const { amount0, amount1 } = getAmountsForLiquidity(sqrtPriceX96, sqrtLower, sqrtUpper, liquidity);
            amountSellBack = side ? amount0 : amount1;
            amountOut = side ? amount1 : amount0;

            const sold = amountSell > amountSellBack ? amountSell - amountSellBack : ZERO;
            filledPercent = amountSell <= ZERO ? 0 : Number((sold * BigInt(10000)) / amountSell) / 100;
            // 100% đã qua range nhưng hook chưa set `filled` (chờ swap tiếp theo
            // chạy afterSwap) — withdraw vẫn revert, chỉ cancel được.
            if (filledPercent >= 100) status = "MATCHED_PENDING";
            else if (filledPercent > 0) status = "PARTIAL";
            else status = "OPEN";

            if (!allowCancel) {
                throw new Error(
                    `[swapV4] orderId ${id} mới khớp ${filledPercent}% (${status}) — withdraw sẽ revert NotFilled, ` +
                    `gọi lại với allowCancel = true nếu muốn huỷ lệnh lấy token về`
                );
            }
        }

        const mode = filled ? "WITHDRAW" : "CANCEL";

        // Chỉ GỬI tx, không chờ confirm (giống placeOrder).
        const txHash = await walletClient.writeContract(
            filled
                ? {
                    abi: LIMIT_ORDER_HOOK_ABI,
                    address: pool.hook,
                    functionName: "withdraw",
                    args: [id, receiver],
                }
                : {
                    abi: LIMIT_ORDER_HOOK_ABI,
                    address: pool.hook,
                    functionName: "cancelOrder",
                    args: [poolKey, tick as number, side, receiver],
                }
        );

        return {
            txHash,
            // số đồng mua về ví — cùng field `amount` như swapBuy / swapSell
            amount: formatUnits(amountOut, buyToken.decimals),
            mode,
            status,
            filled,
            filledPercent,
            orderId: id.toString(),
            owner,
            to: receiver,
            poolId: pool.poolId,
            hook: pool.hook,
            amountOut: formatUnits(amountOut, buyToken.decimals),
            // phần chưa đổi được, chỉ có khi mode = "CANCEL"
            amountSellBack: formatUnits(amountSellBack, sellToken.decimals),
            sellToken: sellToken.symbol,
            buyToken: buyToken.symbol,
            liquidity: liquidity.toString(),
            liquidityTotal: liquidityTotal.toString(),
            tickLower: tick,
            tickUpper: tick === null ? null : tick + pool.tickSpacing,
            zeroForOne: side,
        };
    });
