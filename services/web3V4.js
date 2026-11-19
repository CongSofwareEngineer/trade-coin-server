/**
 * ============================================================================
 * WEB3 V4 — ví ký, RPC, client viem và approve ERC20
 * ============================================================================
 *
 * Tất cả phần "chạm chain" nằm ở đây. `helper/swapV4.js` chỉ gọi xuống, không
 * tự tạo client hay đọc env.
 *
 * ENV:
 *     BOT_PRIVATE_KEY_<ID_BOT>   private key riêng của một bot
 *     BOT_PRIVATE_KEY            key chung, dùng khi bot không có key riêng
 *     PRIVATE_KEY                fallback cuối
 *     RPC_URL_<chainId>          RPC của server; không có thì dùng RPC public
 *                                mặc định của viem cho chain đó
 * ============================================================================
 */

const { createPublicClient, createWalletClient, erc20Abi, http } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const viemChains = require("viem/chains");
const { ALLOWANCE_POLL_ATTEMPTS, ALLOWANCE_POLL_MS } = require("../constant/swapV4");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** `idBot` → tên biến môi trường, vd "bot-1" → "BOT_1". */
const toEnvKey = (idBot) => String(idBot || "").trim().replace(/[^0-9a-zA-Z]+/g, "_").toUpperCase();

/**
 * Private key ví ký của bot. Truyền thẳng `privateKey` để bỏ qua env (server
 * tự quản ví).
 */
const resolvePrivateKey = ({ idBot, privateKey }) => {
    const key =
        privateKey ||
        process.env[`BOT_PRIVATE_KEY_${toEnvKey(idBot)}`] ||
        process.env.BOT_PRIVATE_KEY ||
        process.env.PRIVATE_KEY;

    if (!key) throw new Error(`[web3V4] không tìm thấy private key của bot "${idBot}"`);

    const hex = String(key).trim();

    return hex.startsWith("0x") ? hex : `0x${hex}`;
};

/** Chain object của viem theo chainId. */
const resolveChain = (chainId) => {
    const id = Number(chainId);
    const chain = Object.values(viemChains).find((item) => item && item.id === id);

    if (!chain) throw new Error(`[web3V4] viem không có chain ${chainId}`);

    return chain;
};

/** RPC của chain: ưu tiên env của server. */
const resolveRpcUrl = (chainId) => process.env[`RPC_URL_${Number(chainId)}`] || undefined;

const clientCache = new Map();

/**
 * public client + wallet client của một (chain, ví). Cache lại để không tạo
 * lại mỗi mốc bot.
 *
 * @returns {{ account: Object, publicClient: Object, walletClient: Object }}
 */
const getClients = ({ chainId, idBot, privateKey }) => {
    const pk = resolvePrivateKey({ idBot, privateKey });
    const cacheKey = `${Number(chainId)}-${pk.slice(-8)}`;
    const cached = clientCache.get(cacheKey);
    if (cached) return cached;

    const chain = resolveChain(chainId);
    const transport = http(resolveRpcUrl(chainId));
    const account = privateKeyToAccount(pk);

    const clients = {
        account,
        publicClient: createPublicClient({ chain, transport }),
        walletClient: createWalletClient({ account, chain, transport }),
    };
    clientCache.set(cacheKey, clients);

    return clients;
};

/** Balance native + balance token + allowance của ví với spender. */
const readPreflight = async ({ publicClient, owner, token, spender }) => {
    const [nativeBalance, tokenBalance, allowance] = await Promise.all([
        publicClient.getBalance({ address: owner }),
        publicClient.readContract({ abi: erc20Abi, address: token, functionName: "balanceOf", args: [owner] }),
        publicClient.readContract({ abi: erc20Abi, address: token, functionName: "allowance", args: [owner, spender] }),
    ]);

    return { nativeBalance, tokenBalance, allowance };
};

/**
 * Approve rồi CHỜ receipt + chờ RPC trả về allowance mới.
 *
 * Không chờ thì gas estimate của `placeOrder` chạy trước lúc RPC phục vụ
 * allowance mới và revert "transfer amount exceeds allowance" dù approve đã
 * lên chain (đã gặp trên Base — xem logManualLimitOrder.md).
 */
const sendApprove = async ({ publicClient, walletClient, owner, token, spender, amount }) => {
    const hash = await walletClient.writeContract({
        abi: erc20Abi,
        address: token,
        functionName: "approve",
        args: [spender, amount],
    });

    await publicClient.waitForTransactionReceipt({ hash });

    for (let attempt = 0; attempt < ALLOWANCE_POLL_ATTEMPTS; attempt++) {
        const approved = await publicClient
            .readContract({ abi: erc20Abi, address: token, functionName: "allowance", args: [owner, spender] })
            .catch(() => null);
        if (approved !== null && approved >= amount) return hash;
        await sleep(ALLOWANCE_POLL_MS);
    }

    return hash;
};

module.exports = {
    sleep,
    resolvePrivateKey,
    resolveChain,
    resolveRpcUrl,
    getClients,
    readPreflight,
    sendApprove,
};
