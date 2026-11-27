/**
 * ============================================================================
 * CONSTANT SWAP V4 — số/ngưỡng của luồng đặt lệnh limit order
 * ============================================================================
 *
 * Giá trị lấy đúng theo `src/common/constants/manualLimitOrder.ts` của
 * coinpool-client để bot và web chạy cùng một tham số.
 * ============================================================================
 */

/** API pool của KeyringOne. Đổi env `KEYRING_ONE_API_URL` khi lên staging/prod. */
export const POOL_API_URL: string = process.env.KEYRING_ONE_API_URL || "https://keyring-one-api.bacoor-test001.xyz";

/** Cache list pool 5 phút — pool rất ít đổi, mỗi mốc bot không nên gọi lại API. */
export const POOL_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Sau khi tx approve confirm, đọc allowance tới khi RPC trả về số mới: 1s x 20 lần.
 * Không chờ thì gas estimate của `placeOrder` chạy trước lúc RPC phục vụ allowance
 * mới và revert "transfer amount exceeds allowance" dù approve đã lên chain.
 */
export const ALLOWANCE_POLL_MS = 1000;
export const ALLOWANCE_POLL_ATTEMPTS = 20;

/** Ví còn native <= mức này (0.00001) thì không đủ trả gas cho approve + placeOrder. */
export const NATIVE_GAS_BUFFER = BigInt("10000000000000");

/** Số decimals của giá limit, bằng với "Marker" của UI. */
export const PRICE_DECIMALS = 4;

/* ------------------------------ tick math ------------------------------- */

export const MIN_TICK = -887272;
export const MAX_TICK = 887272;

export const ZERO = BigInt(0);
export const ONE = BigInt(1);
export const Q96 = ONE << BigInt(96);
export const MAX_UINT256 = (ONE << BigInt(256)) - ONE;

/**
 * Hằng số của `TickMath.getSqrtRatioAtTick` (Uniswap v3/v4 core).
 * [bit của |tick|, hệ số Q128.128 tương ứng].
 */
export const SQRT_RATIO_MULTIPLIERS: ReadonlyArray<readonly [bigint, bigint]> = [
    [BigInt("0x2"), BigInt("0xfff97272373d413259a46990580e213a")],
    [BigInt("0x4"), BigInt("0xfff2e50f5f656932ef12357cf3c7fdcc")],
    [BigInt("0x8"), BigInt("0xffe5caca7e10e4e61c3624eaa0941cd0")],
    [BigInt("0x10"), BigInt("0xffcb9843d60f6159c9db58835c926644")],
    [BigInt("0x20"), BigInt("0xff973b41fa98c081472e6896dfb254c0")],
    [BigInt("0x40"), BigInt("0xff2ea16466c96a3843ec78b326b52861")],
    [BigInt("0x80"), BigInt("0xfe5dee046a99a2a811c461f1969c3053")],
    [BigInt("0x100"), BigInt("0xfcbe86c7900a88aedcffc83b479aa3a4")],
    [BigInt("0x200"), BigInt("0xf987a7253ac413176f2b074cf7815e54")],
    [BigInt("0x400"), BigInt("0xf3392b0822b70005940c7a398e4b70f3")],
    [BigInt("0x800"), BigInt("0xe7159475a2c29b7443b29c7fa6e889d9")],
    [BigInt("0x1000"), BigInt("0xd097f3bdfd2022b8845ad8f792aa5825")],
    [BigInt("0x2000"), BigInt("0xa9f746462d870fdf8a65dc1f90e061e5")],
    [BigInt("0x4000"), BigInt("0x70d869a156d2a1b890bb3df62baf32f7")],
    [BigInt("0x8000"), BigInt("0x31be135f97d08fd981231505542fcfa6")],
    [BigInt("0x10000"), BigInt("0x9aa508b5b7a84e1c677de54f3e99bc9")],
    [BigInt("0x20000"), BigInt("0x5d6af8dedb81196699c329225ee604")],
    [BigInt("0x40000"), BigInt("0x2216e584f5fa1ea926041bedfe98")],
    [BigInt("0x80000"), BigInt("0x48a170391f7dc42444e8fa2")],
];

/** Hệ số của tick lẻ (bit 0x1). */
export const SQRT_RATIO_ODD_TICK = BigInt("0xfffcb933bd6fad37aa2d162d1a594001");
