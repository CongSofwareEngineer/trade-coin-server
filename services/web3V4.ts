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

import {
    createPublicClient,
    createWalletClient,
    erc20Abi,
    http,
    type Account,
    type Address,
    type Chain,
    type Hex,
    type PublicClient,
    type Transport,
    type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import * as viemChains from "viem/chains";
import { ALLOWANCE_POLL_ATTEMPTS, ALLOWANCE_POLL_MS } from "../constant/swapV4";

/** public client + wallet client của một (chain, ví). */
export interface BotClients {
    account: Account;
    publicClient: PublicClient<Transport, Chain>;
    walletClient: WalletClient<Transport, Chain, Account>;
}

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** `idBot` → tên biến môi trường, vd "bot-1" → "BOT_1". */
const toEnvKey = (idBot: string | number | null | undefined): string => String(idBot || "").trim().replace(/[^0-9a-zA-Z]+/g, "_").toUpperCase();

/**
 * Private key ví ký của bot. Truyền thẳng `privateKey` để bỏ qua env (server
 * tự quản ví).
 */
export const resolvePrivateKey = ({ idBot, privateKey }: { idBot: string | number; privateKey?: string }): Hex => {
    const key =
        privateKey ||
        process.env[`BOT_PRIVATE_KEY_${toEnvKey(idBot)}`] ||
        process.env.BOT_PRIVATE_KEY ||
        process.env.PRIVATE_KEY;

    if (!key) throw new Error(`[web3V4] không tìm thấy private key của bot "${idBot}"`);

    const hex = String(key).trim();

    return (hex.startsWith("0x") ? hex : `0x${hex}`) as Hex;
};

/** Chain object của viem theo chainId. */
export const resolveChain = (chainId: string | number): Chain => {
    const id = Number(chainId);
    const chain = (Object.values(viemChains) as unknown[]).find(
        (item): item is Chain => !!item && typeof item === "object" && (item as Chain).id === id
    );

    if (!chain) throw new Error(`[web3V4] viem không có chain ${chainId}`);

    return chain;
};

/** RPC của chain: ưu tiên env của server. */
export const resolveRpcUrl = (chainId: string | number): string | undefined => process.env[`RPC_URL_${Number(chainId)}`] || undefined;

const clientCache = new Map<string, BotClients>();

/**
 * public client + wallet client của một (chain, ví). Cache lại để không tạo
 * lại mỗi mốc bot.
 */
export const getClients = ({
    chainId,
    idBot,
    privateKey,
}: {
    chainId: string | number;
    idBot: string | number;
    privateKey?: string;
}): BotClients => {
    const pk = resolvePrivateKey({ idBot, privateKey });
    const cacheKey = `${Number(chainId)}-${pk.slice(-8)}`;
    const cached = clientCache.get(cacheKey);
    if (cached) return cached;

    const chain = resolveChain(chainId);
    const transport = http(resolveRpcUrl(chainId));
    const account = privateKeyToAccount(pk);

    const clients: BotClients = {
        account,
        publicClient: createPublicClient({ chain, transport }) as PublicClient<Transport, Chain>,
        walletClient: createWalletClient({ account, chain, transport }),
    };
    clientCache.set(cacheKey, clients);

    return clients;
};

/** Balance native + balance token + allowance của ví với spender. */
export const readPreflight = async ({
    publicClient,
    owner,
    token,
    spender,
}: {
    publicClient: BotClients["publicClient"];
    owner: Address;
    token: Address;
    spender: Address;
}): Promise<{ nativeBalance: bigint; tokenBalance: bigint; allowance: bigint }> => {
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
export const sendApprove = async ({
    publicClient,
    walletClient,
    owner,
    token,
    spender,
    amount,
}: {
    publicClient: BotClients["publicClient"];
    walletClient: BotClients["walletClient"];
    owner: Address;
    token: Address;
    spender: Address;
    amount: bigint;
}): Promise<Hex> => {
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
