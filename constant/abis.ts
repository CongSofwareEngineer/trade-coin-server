/**
 * ============================================================================
 * CONSTANT ABI — Uniswap v4 limit order hook + StateView
 * ============================================================================
 *
 * Copy từ `src/common/constants/abis/limit-order-hook.ts` của coinpool-client,
 * chỉ giữ phần bot cần:
 *   - `placeOrder` để đặt lệnh
 *   - `withdraw` / `cancelOrder` để rút lệnh đã khớp / huỷ lệnh chưa khớp hết
 *   - `getOrderId` / `getOrderLiquidity` / `getOrderInfo` để đọc trạng thái một
 *     lệnh trước khi rút (lệnh đã `filled` chưa, ví còn bao nhiêu liquidity,
 *     tổng tiền đã đổi được của cả orderId)
 *   - list `error` để viem decode được revert của hook (CrossedRange, InRange,
 *     ZeroLiquidity, NotFilled, ...) thành tên lỗi thay vì một chuỗi hex
 *   - `getSlot0` của StateView để đọc giá / tick hiện tại của pool
 *
 * KHÔNG có event (`Place` / `Cancel` / `Withdraw`): bot chỉ GỬI tx, không chờ
 * receipt nên không decode log.
 * ============================================================================
 */

/** Tuple PoolKey của Uniswap v4 — dùng để encode poolId (keccak của poolKey). */
export const POOL_KEY_PARAM = {
    type: "tuple",
    components: [
        { name: "currency0", type: "address" },
        { name: "currency1", type: "address" },
        { name: "fee", type: "uint24" },
        { name: "tickSpacing", type: "int24" },
        { name: "hooks", type: "address" },
    ],
} as const;

/** Cùng tuple đó nhưng ở dạng input của function/event. */
export const POOL_KEY_INPUT = { type: "tuple", name: "key", components: POOL_KEY_PARAM.components } as const;

/** ABI hook limit order. */
export const LIMIT_ORDER_HOOK_ABI = [
    {
        name: "placeOrder",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [
            POOL_KEY_INPUT,
            { type: "int24", name: "tick" },
            { type: "bool", name: "zeroForOne" },
            { type: "uint128", name: "liquidity" },
        ],
        outputs: [],
    },
    {
        name: "cancelOrder",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [
            POOL_KEY_INPUT,
            { type: "int24", name: "tickLower" },
            { type: "bool", name: "zeroForOne" },
            { type: "address", name: "to" },
        ],
        outputs: [],
    },
    {
        name: "withdraw",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [
            { type: "uint232", name: "orderId" },
            { type: "address", name: "to" },
        ],
        outputs: [
            { type: "uint256", name: "amount0" },
            { type: "uint256", name: "amount1" },
        ],
    },
    {
        name: "getOrderId",
        type: "function",
        stateMutability: "view",
        inputs: [POOL_KEY_INPUT, { type: "int24", name: "tickLower" }, { type: "bool", name: "zeroForOne" }],
        outputs: [{ type: "uint232" }],
    },
    {
        name: "getOrderLiquidity",
        type: "function",
        stateMutability: "view",
        inputs: [
            { type: "uint232", name: "orderId" },
            { type: "address", name: "owner" },
        ],
        outputs: [{ type: "uint256" }],
    },
    {
        name: "getOrderInfo",
        type: "function",
        stateMutability: "view",
        inputs: [{ type: "uint232", name: "orderId" }],
        outputs: [
            { type: "bool", name: "filled" },
            { type: "address", name: "currency0" },
            { type: "address", name: "currency1" },
            { type: "uint256", name: "currency0Total" },
            { type: "uint256", name: "currency1Total" },
            { type: "uint128", name: "liquidityTotal" },
        ],
    },
    { name: "CrossedRange", type: "error", inputs: [] },
    { name: "Filled", type: "error", inputs: [] },
    { name: "HookNotImplemented", type: "error", inputs: [] },
    { name: "InRange", type: "error", inputs: [] },
    { name: "InvalidPoolHook", type: "error", inputs: [] },
    { name: "InvalidTreasury", type: "error", inputs: [] },
    { name: "NativeCurrencyNotSupported", type: "error", inputs: [] },
    { name: "NotFilled", type: "error", inputs: [] },
    { name: "NotPoolManager", type: "error", inputs: [] },
    { name: "SafeERC20FailedOperation", type: "error", inputs: [{ type: "address", name: "token" }] },
    { name: "UnexpectedFeeDelta", type: "error", inputs: [] },
    { name: "ZeroLiquidity", type: "error", inputs: [] },
] as const;

/** ABI StateView của Uniswap v4 (`poolAddress` trong API /pool chính là StateView). */
export const STATE_VIEW_ABI = [
    {
        name: "getSlot0",
        type: "function",
        stateMutability: "view",
        inputs: [{ type: "bytes32", name: "poolId" }],
        outputs: [
            { type: "uint160", name: "sqrtPriceX96" },
            { type: "int24", name: "tick" },
            { type: "uint24", name: "protocolFee" },
            { type: "uint24", name: "lpFee" },
        ],
    },
] as const;
