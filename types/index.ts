/**
 * Điểm import chung cho mọi type của project.
 *
 *   types/trade.ts     input/output của thuật toán (config, history, arrToken)
 *   types/database.ts  schema gợi ý cho 2 collection Setting / History
 *   types/swap.ts      tham số / kết quả của swapV4 (limit order)
 *   types/pool.ts      API /pool + pool đã chuẩn hoá
 */

export * from "./trade";
export * from "./database";
export * from "./swap";
export * from "./pool";
