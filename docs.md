# Trade V4 — tài liệu logic và cách ghép vào server

Tài liệu này mô tả thuật toán trading trong `helper/tradeV4.ts`: nó nhận gì, trả gì, quyết định swap theo quy tắc nào, và server phải gọi nó theo trình tự nào.

Người đọc: team server ghép thuật toán vào project, và các AI agent (GPT, Claude, Gemini...) được giao đọc hoặc sửa code liên quan. Mọi công thức và ví dụ số ở đây khớp với code hiện tại; ví dụ ở mục 8 và dữ liệu mẫu ở mục 9 là kết quả chạy thật, lấy từ `helper/tradeV4_Data.ts`.

## 1. Phạm vi

| Thuật toán làm | Thuật toán KHÔNG làm (việc của server) |
| --- | --- |
| Tính chỉ số của từng token tại một mốc giá | Lấy giá token |
| Quyết định có swap hay không, swap sang token nào | Theo dõi tx sau khi đã gửi, retry |
| Gọi `swapV4.ts` để GỬI tx swap | Ký tx, nối contract (nằm trong `swapV4.ts`) |
| Tính `config` mới và `history` của mốc đó | Lưu DB, khoá bot, chuyển tiền về ví user |
| Kiểm tra đầu vào, sai thì throw | |

Thuật toán không biết thời gian. Mỗi lần gọi là một **mốc giá**; server quyết định bao lâu gọi một lần.

**Swap chỉ GỬI tx, không chờ confirm.** `swapV4.ts` tạo hash rồi trả về ngay — chờ tx lên chain thì rất lâu mà không cần thiết. Vì vậy mốc có swap mang `action = "SWAP_PENDING"`: chắc chắn đã gửi tx, chưa chắc đã swap xong. Theo dõi `txHash` để chốt trạng thái là việc của server.

File liên quan:

| File | Vai trò |
| --- | --- |
| `helper/tradeV4.ts` | Toàn bộ thuật toán, chạy thật từng mốc giá. Chỉ phụ thuộc `bignumber.js` và `swapV4.ts`. |
| `helper/swapV4.ts` | Hàm gửi tx swap. Chỗ duy nhất chạm contract. Hiện là stub, phải nối contract thật. |
| `helper/tradeV4_Data.ts` | Data mẫu + schema mẫu. Không có logic, chỉ để đọc và làm fixture test. |
| `indexV4.ts` (project trade-coin-pro) | Bản backtest, chạy for() qua cả mảng lịch sử. `tradeV4.ts` là port 1-1 của file này, giữ nguyên tên hàm để so sánh được từng dòng. |

## 2. Thuật ngữ

| Từ | Nghĩa |
| --- | --- |
| Mốc giá | Một lần chạy thuật toán với một bộ giá. Mốc sau luôn so với mốc ngay trước nó. |
| `perETH` | Giá token chia giá ETH. ETH luôn có `perETH = 1`. |
| Token đang giữ | Token bot đang nắm toàn bộ vốn (`config.state.outputSwap`). Bot luôn giữ đúng một token. |
| Ứng viên | Token có mức thay đổi thấp nhất (rớt mạnh nhất) tại mốc này. Mỗi mốc chỉ có một ứng viên. Trong code là `tokenOutput` / `symbolOutput`. |
| Cụm ETH/BTC | ETH và BTC được coi là một cụm: khi ứng viên là ETH hoặc BTC, mọi mốc so sánh lấy theo `perETH` của BTC. |
| Point | Thước đo giá của token so với lúc register, bắt đầu từ 1000. Chỉ dùng để quyết định khi nào dời mốc gốc (mục 6). |
| `itemPre` | Số liệu của mốc ngay trước, nằm trong `config`. Thay cho `listData[index - 1]` của bản backtest. |

Nhóm symbol: `ETH`, `WETH`, `CBETH` được coi là ETH. `BTC`, `WBTC`, `CBBTC`, `BTCB` được coi là BTC.

## 3. Các hàm

Server dùng đúng bốn hàm. **Cả bốn đều trả về cùng một dạng: `{ history, config }`.**

| Hàm | Khi nào gọi | Đồng bộ? |
| --- | --- | --- |
| `registerTradeV4({ config, arrToken })` | User gọi api init (nạp tiền) | Đồng bộ, không swap |
| `runTradeV4({ config, arrToken, idBot, chainId, swapId })` | Mỗi mốc giá của cron | `async` — có thể gửi tx |
| `withdrawTradeV4({ ...như trên })` | User rút → swap hết về đồng gốc rồi **dừng bot** | `async` |
| `resetTradeV4({ ...như trên })` | User reset → swap hết về đồng gốc rồi **chạy lại từ đầu** | `async` |

```js
const { history, config } = await runTradeV4({
  config: bot.config,   // khối config lấy từ DB
  arrToken,             // [{ symbol, address, price }]
  idBot: bot._id,       // truyền nguyên xuống swapV4.ts
  chainId: "56",        // truyền nguyên xuống swapV4.ts
  swapId,               // khoá chống gửi trùng tx
  // swap: fn           // tuỳ chọn — mặc định là swapOnchainV4 của swapV4.ts
});
```

- `history` → INSERT một bản ghi vào collection history.
- `config` → UPDATE đè vào bot; mốc sau truyền nguyên khối này trở lại.
- Tham số truyền vào không bị sửa (hàm tự `deepClone`).
- `swap` chỉ để inject hàm giả khi test; chạy thật thì bỏ trống.

**Hàm throw thì không lưu gì cả.** Gửi tx lỗi, giá rác, config thiếu → throw, không có `config` mới. Config trong DB giữ nguyên, mốc sau xét lại từ đầu theo giá mới.

Không có luồng plan/commit hai bước, không có khối `pending`. Một lần gọi là xong một mốc.

## 4. Dữ liệu

Mọi số (giá, số lượng, tỷ lệ) được lưu và trả về dạng **chuỗi thập phân**, không dùng wei, không dùng kiểu number của JS.

### 4.1. `arrToken` — đầu vào của mỗi mốc

```js
[
  { symbol: "ETH", address: "0x2170...", price: "2500" },
  { symbol: "BTC", address: "0x7130...", price: "100000" },
  { symbol: "BNB", address: "0xbb4C...", price: "650" },
]
```

- `price` là giá USD của token (bên server là `tokenPricePerUsd`), phải là số dương.
- `address` là address token để gọi contract swap. Khoá từ lúc register; mốc sau truyền address khác thì throw.
- Bắt buộc có một token nhóm ETH và một token nhóm BTC. Số token còn lại tuỳ ý (3, 5, 7 token đều được).
- Danh sách token, `symbol`, `address` và **thứ tự trong mảng** cố định từ lúc register. Truyền lệch thì throw.
- Không đưa hai token cùng nhóm vào một bot (ví dụ cả `BTC` lẫn `WBTC`).

### 4.2. `config` — trạng thái của bot

Server lưu nguyên khối này trong DB và truyền lại nguyên khối ở mốc sau. Khối này có bốn nhánh:

```js
{
  userConfig: { amountStart, inputStart, volatility },
  state:      { amountInput, outputSwap, outputSwapTemp, ETHLastSwap,
                perETHOriginal, ETHOriginalAmount, price1Point },
  itemPre:    { arrToken: [{ symbol, address, price, perETH,
                             perETHChangePercentage, pointAfterCheck }] },
  isStop:     false,
}
```

`config.userConfig` — cài đặt user, server truyền vào lúc register, thuật toán **chỉ đọc**:

| Field | Nghĩa |
| --- | --- |
| `inputStart` | Token user nạp vào. Cũng là token trả lại khi rút / reset. |
| `amountStart` | Số lượng nạp. Sau reset, đây là số vừa unwind được của vòng trước. |
| `volatility` | Ngưỡng biến động, đơn vị %. Ví dụ `"0.3"` là 0,3%. |

`config.state` — trạng thái, thuật toán tự quản, server **không sửa**:

| Field | Nghĩa |
| --- | --- |
| `outputSwap` | Token đang giữ. |
| `amountInput` | Số lượng token đang giữ. |
| `outputSwapTemp` | Ứng viên được xét gần nhất. Tên có "Temp" nhưng **không** phải biến tạm: tầng 1 của mốc sau đọc lại nó. |
| `ETHLastSwap` | Theo symbol: `perETH` của token ở lần gần nhất nó được xét swap. |
| `perETHOriginal` | Theo symbol: `perETH` mốc gốc. Được dời khi thị trường tăng đủ xa (mục 6). |
| `ETHOriginalAmount` | Vốn gốc quy ra ETH tại lúc register. |
| `price1Point` | Theo symbol: giá lúc register chia 1000. Không đổi trong suốt vòng. |

`config.itemPre` — số liệu mốc ngay trước, để mốc sau so sánh. Chỉ giữ 6 field mà mốc sau đọc lại:

| Field | Mốc sau dùng làm gì | Lưu sai thì |
| --- | --- | --- |
| `symbol` | Khớp token với mốc trước | Throw |
| `address` | Chặn swap nhầm token khi `arrToken` lệch setup | Throw |
| `price` | Tính `perETHChangePercentage` của ETH, và `changeByPoint` | Sai mức biến động → chọn sai ứng viên |
| `perETH` | Tính `perETHChangePercentage` của token khác ETH | Sai mức biến động → chọn sai ứng viên |
| `perETHChangePercentage` | Không dùng để tính. Là số để UI hiện và để đối chiếu về sau. | Vẫn chạy đúng, mất dấu vết |
| `pointAfterCheck` | Cộng dồn ra point mới, và đếm cho phép xét dời mốc gốc | Sai thời điểm dời mốc gốc |

`config.isStop` — `true` sau khi `withdrawTradeV4` chạy xong. Gọi run / withdraw / reset với config có `isStop = true` thì throw.

**Lưu nguyên khối, không lưu một phần.** Nếu `ETHLastSwap`, `perETH` hoặc `price` bị mất / lưu sai, thuật toán vẫn chạy và **không báo lỗi**, chỉ ra kết quả sai.

**`ETHLastSwap` đổi cả ở mốc không swap.** Khi ứng viên qua tầng 2 mà trượt tầng 3 hoặc 4, `ETHLastSwap` của token so sánh vẫn được cập nhật. Vì vậy mốc `NOSWAP` cũng phải lưu `config`, không được bỏ qua vì "không có gì xảy ra".

**Hai thứ KHÔNG lưu DB**, vì chúng chỉ là biến xử lý trong một mốc:

| Tên | Bản backtest | Vì sao bỏ |
| --- | --- | --- |
| `ETHLastSwapTemp` | nằm trong `state` | Trong một mốc nó luôn được ghi ở trên rồi mới đọc ở dưới, cùng key cùng nhánh `if`. Mốc sau không bao giờ đọc lại. Ở đây là biến local của `checkToSwap`. |
| `pointBeforeCheck` | nằm trong mỗi token | Không được đọc lại ở đâu. Bằng đúng `pointAfterCheck` khi mốc đó không swap. |

### 4.3. `history` — bản ghi của một mốc

| Field | Nghĩa |
| --- | --- |
| `action` | `"DEPOSIT"`, `"NOSWAP"`, `"SWAP_PENDING"`, `"WITHDRAW"` hoặc `"RESET"` (mục 4.5) |
| `isSwap` | Mốc này có gửi tx swap hay không |
| `inputSwap`, `outputSwap` | Symbol token swap từ / sang. `null` nếu không swap. |
| `amountSwap` | Số token nhận về, lấy nguyên từ `swapV4.ts`. `null` nếu không swap. |
| `txHash` | Hash của tx swap. `null` nếu không swap. |
| `currentToken`, `currentAmount` | Token và số lượng đang giữ sau mốc này |
| `arrToken[]` | Số liệu từng token (mục 4.4) |
| `amountWithdraw`, `pnl` | Chỉ có ở `"WITHDRAW"`. `pnl = amountWithdraw - userConfig.amountStart`. |

### 4.4. `arrToken[]` trong history — số liệu từng token

Mỗi phần tử là một token tại mốc đó, đủ để UI dựng lại bảng và để đối chiếu về sau:

| Field | Nghĩa |
| --- | --- |
| `symbol`, `address` | Token |
| `price` | Giá USD tại mốc này |
| `perETH` | Giá token chia giá ETH. ETH luôn là `1`. |
| `perETHChangePercentage` | Mức thay đổi so với mốc trước, dạng **tỷ lệ**. `-0.0054...` là giảm 0,54%. UI muốn hiện % thì nhân 100. |
| `changeByPoint` | Số point thay đổi trong mốc này = `(giá - giá trước) / price1Point` |
| `pointAfterCheck` | Point của mốc này. Mốc có swap thì token đích về 1000, token nào dưới 1000 cũng lên 1000. |

Ví dụ BNB tại mốc 3 của mục 8 (BNB 643,5 → 640, có swap nên point về 1000):

```json
{
  "symbol": "BNB",
  "address": "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
  "price": "640",
  "perETH": "0.26666666666666666667",
  "perETHChangePercentage": "-0.00543900543900543899",
  "changeByPoint": "-5.38461538461538461538",
  "pointAfterCheck": "1000"
}
```

### 4.5. Năm giá trị `history.action`

| `action` | Khi nào | Có tx? |
| --- | --- | --- |
| `DEPOSIT` | `registerTradeV4` xong | Không |
| `NOSWAP` | Mốc giá bình thường, chưa đủ điều kiện swap | Không |
| `SWAP_PENDING` | Mốc này **đã gửi** tx swap. Chưa chắc tx thành công onchain. | Có |
| `WITHDRAW` | Đã gửi tx swap hết về đồng gốc, bot dừng (`config.isStop = true`) | Có, trừ khi đang giữ sẵn đồng gốc |
| `RESET` | Đã gửi tx swap hết về đồng gốc, và mở vòng mới luôn | Có, trừ khi đang giữ sẵn đồng gốc |

`WITHDRAW` và `RESET` cũng là tx vừa gửi chưa confirm; chỉ `action` không mang chữ `_PENDING` vì bản thân hai lệnh đó là hành động một lần của user, không phải mốc giá định kỳ.

### 4.6. Gọi sang `swapV4.ts`

Thuật toán gọi đúng một hàm để swap:

```js
// tradeV4.ts gửi:
{
  idBot: "68f1c0a9e3b94a0012ab34cd",  // truyền nguyên từ tham số vào
  chainId: "56",
  swapId: "swap-0003",
  tokenIn:  "0x2170...",   // address token đang giữ
  tokenOut: "0xbb4C...",   // address token swap sang
  amount:   "1",           // toàn bộ số đang giữ, ĐƠN VỊ TOKEN (không phải wei)
}

// swapV4.ts trả:
{
  txHash: "0x9f2c...",
  amount: "3.7425",        // số tokenOut nhận về
}
```

Lưu ý tên field: `amount` **truyền vào** là số tokenIn đem swap, `amount` **trả về** là số tokenOut nhận được. Hai thứ khác nhau, cùng tên.

`amount` trả về không phải số dương → throw, không có config mới.

Thuật toán lấy **nguyên** `amount` trả về làm vốn cho mốc sau: không tính lại theo giá, không tự trừ phí hay slippage. Không có tham số affiliate nào — phí nằm sẵn trong số contract trả về.

## 5. Quy tắc quyết định swap

Đây là phần lõi. `runTradeV4` làm đúng các bước sau, theo thứ tự.

### Bước A — tính chỉ số từng token

So với số liệu mốc trước trong `config.itemPre`:

| Chỉ số | Token nhóm ETH | Token khác |
| --- | --- | --- |
| `perETH` | `1` | `giá / giá ETH` |
| `perETHChangePercentage` | `(giá - giá trước) / giá trước`, tính theo USD | `(perETH - perETH trước) / perETH trước` |

Với mọi token:

- `changeByPoint = (giá - giá trước) / price1Point`
- `pointAfterCheck = point mốc trước + changeByPoint` (còn bị chỉnh tiếp nếu mốc này có swap)

`perETHChangePercentage` là tỷ lệ, không phải phần trăm: `-0.0054` nghĩa là giảm 0,54%.

### Bước B — chọn ứng viên

Ứng viên là token có `perETHChangePercentage` nhỏ nhất. Nếu bằng nhau thì lấy token đứng trước trong `arrToken`.

### Bước C — bốn tầng điều kiện

Ký hiệu: `ngưỡng = -volatility / 100` (với 0,3% là `-0.003`).

| Tầng | Điều kiện | Không đạt thì |
| --- | --- | --- |
| 1a | Ứng viên khác `outputSwapTemp` | Không swap, không ghi gì thêm |
| 1b | Mức thay đổi của ứng viên nhỏ hơn `ngưỡng` | như tầng 1a |
| 2 | Ứng viên khác token đang giữ | Không swap; `outputSwapTemp` đã đổi thành ứng viên |
| 3 | `perETH so sánh` vượt mốc `ETHLastSwap` của `token so sánh` | Không swap; `ETHLastSwap` vẫn được cập nhật |
| 4a | Vốn hiện tại quy ra ETH ≥ `ETHOriginalAmount` | như tầng 3 |
| 4b | `perETH so sánh` ≥ `perETHOriginal` của `token so sánh` | như tầng 3 |

Trong đó:

- **Token so sánh**: nếu ứng viên thuộc cụm ETH/BTC thì là BTC; ngược lại là chính ứng viên.
- **`perETH so sánh`**: `perETH` của token so sánh tại mốc này.
- **Tầng 3** dùng dấu **lớn hơn hẳn** (`>`) cho cụm ETH/BTC và **lớn hơn hoặc bằng** (`≥`) cho token khác.
- **Vốn hiện tại quy ra ETH** = `amountInput × giá token đang giữ / giá ETH`.

Đạt cả sáu điều kiện thì swap **toàn bộ** `amountInput` từ token đang giữ sang ứng viên.

Diễn giải bằng lời: bot mua một token khi nó vừa rớt quá ngưỡng trong mốc này, nhưng vẫn cao hơn lần gần nhất nó được xét, vẫn trên mốc gốc, và vốn của bot không lỗ so với lúc bắt đầu.

### Bước D — những gì được ghi

| Thời điểm | Ghi vào `config.state` |
| --- | --- |
| Qua tầng 1 | `outputSwapTemp = ứng viên` |
| Qua tầng 2 (dù có swap hay không) | `ETHLastSwap[token so sánh] = perETH của token so sánh tại mốc này` |
| Có swap | `outputSwap = ứng viên`, `amountInput = amount` do `swapV4.ts` trả về. Point của ứng viên về 1000; token nào có point dưới 1000 cũng lên 1000. |
| Cuối mỗi mốc | Xét dời mốc gốc (mục 6). `itemPre` = số liệu mốc này. |

Hệ quả cần nhớ:

- Một token vừa được xét (qua tầng 1) sẽ không được xét lại ở mốc kế tiếp, cho tới khi token khác trở thành ứng viên qua tầng 1.
- Nếu ứng viên chính là token đang giữ thì không có gì xảy ra ngoài việc `outputSwapTemp` được ghi lại.
- Điều kiện 4a dùng `amountInput`, tức số nhận về của lần swap trước. Số này sai thì quyết định ở các mốc sau sai theo.

## 6. Point và việc dời mốc gốc

`perETHOriginal` là "sàn" của điều kiện 4b. Khi cả thị trường đã tăng đủ xa, sàn được dời lên theo giá hiện tại.

- `điểm reset = 1000 + 1000 × volatility / 100 × 10`. Với 0,3% là **1030**.
- Đếm số token có `pointAfterCheck` lớn hơn điểm reset, ở mốc này và ở mốc trước.

Mốc gốc được dời khi **mốc này có ≥ 2 token vượt điểm reset mà mốc trước có ≤ 1 token vượt**. Nó chỉ kích hoạt đúng lúc chuyển trạng thái, không lặp lại khi vẫn đang ở trạng thái đó.

Khi kích hoạt, `perETHOriginal[token] = perETH hiện tại` cho:

- ETH và BTC: luôn dời cùng nhau.
- Token khác: dời, trừ token đang giữ lúc đầu mốc.

## 7. Trình tự server phải làm

### 7.1. Register

```js
const { history, config } = registerTradeV4({
  arrToken,
  config: { inputStart: "ETH", amountStart: "1", volatility: "0.3" },
});

await History.create({ tradingSettingId: bot._id, ...history });
await Setting.updateOne({ _id: bot._id }, { config });
```

Register không swap. Nó khoá giá gốc (`price1Point`, `perETHOriginal`, `ETHOriginalAmount`), đặt mọi point về 1000, và đặt `ETHLastSwap` bằng `perETH` hiện tại. Config đã register rồi mà gọi lại thì throw — muốn mở vòng mới cho bot đang chạy thì dùng reset.

### 7.2. Mỗi mốc giá

```text
1. Bot đang có tx swap chưa chốt?  → bỏ qua mốc này cho bot đó.
2. khoá bot (lastSwapId = swapId mới)
3. res = await runTradeV4({ config, arrToken, idBot, chainId, swapId })
     - throw  → mở khoá bot, KHÔNG lưu gì. Mốc sau xét lại theo giá mới.
4. lưu res.history (kèm swapId, status) + res.config
5. res.history.isSwap = true  → còn tx đang chờ onchain: theo dõi res.history.txHash,
   cập nhật status của bản ghi history, rồi mở khoá bot.
   res.history.isSwap = false → mở khoá bot luôn.
```

Đừng chạy hai mốc song song cho cùng một bot.

Vì hàm chỉ gửi tx chứ không chờ confirm, `config` đã lưu số `amount` mà `swapV4.ts` trả về. Nếu tx fail onchain về sau, thuật toán không biết: lúc đó số trong `config` lệch với số dư thật và server phải xử lý (xem 7.3).

### 7.3. Tx fail onchain sau khi đã lưu

| Tình huống | Server làm |
| --- | --- |
| `swapV4.ts` throw (chưa gửi được tx) | Không có gì để lưu. `config` trong DB chưa đổi. Mốc sau xét lại từ đầu. |
| Tx đã gửi, sau đó fail / revert | `config` đang ghi nhận token mới trong khi ví vẫn giữ token cũ. Phải quyết định: gửi lại tx theo đúng `history.inputSwap`/`outputSwap`/`amountSwap`, hoặc đưa bot về trạng thái cũ. Thuật toán không tự xử lý được việc này. |
| Tx treo quá lâu | Giữ khoá bot, không chạy mốc mới cho tới khi rõ kết quả. |

### 7.4. Rút và reset

Cùng trình tự như 7.2, chỉ khác tên hàm. Cả hai đều swap toàn bộ số đang giữ về `userConfig.inputStart`.

| | `withdrawTradeV4` | `resetTradeV4` |
| --- | --- | --- |
| `history.action` | `"WITHDRAW"`, kèm `amountWithdraw`, `pnl` | `"RESET"` |
| `config` trả về | Cùng khối, `isStop = true` → bot dừng | Config vòng mới: `amountStart` = số vừa nhận, point về 1000, giá gốc khoá lại theo mốc reset, `isStop = false` |
| Đang giữ sẵn `inputStart` | `isSwap = false`, không có tx, không mất phí | `isSwap = false`, không có tx |

Với lệnh rút, thuật toán chỉ lo phần swap. Chuyển tiền từ contract về ví user là việc của server, làm sau khi tx unwind đã lên chain. Server nên set `closed = true` cho bot khi thấy `config.isStop = true`.

## 8. Ví dụ số thật

Bot 3 token, nạp 1 ETH, ngưỡng 0,3%. Giá USD từng mốc — đây đúng là bộ số trong `helper/tradeV4_Data.ts`:

| Mốc | ETH | BTC | BNB | Kết quả |
| --- | --- | --- | --- | --- |
| register | 2500 | 100000 | 650 | DEPOSIT, giữ 1 ETH |
| 1 | 2500 | 100000 | 643,5 | NOSWAP |
| 2 | 2400 | 100000 | 643,5 | NOSWAP |
| 3 | 2400 | 100000 | 640 | SWAP_PENDING, ETH → BNB |
| 4 | 2400 | 100000 | 640 | WITHDRAW hoặc RESET |

**Register.** `perETH`: ETH 1, BTC 40, BNB 0,26. `price1Point`: ETH 2,5, BTC 100, BNB 0,65. Mọi point 1000. `ETHLastSwap` và `perETHOriginal` = `perETH` hiện tại. `ETHOriginalAmount` = 1.

**Mốc 1.** BNB `perETH` 0,26 → 0,2574, giảm 1%. BNB là ứng viên và rớt quá ngưỡng.

- Tầng 1: BNB khác `outputSwapTemp` (ETH), −1% dưới −0,3%. Đạt → `outputSwapTemp = "BNB"`.
- Tầng 2: BNB khác ETH đang giữ. Đạt.
- Tầng 3: 0,2574 ≥ `ETHLastSwap.BNB` 0,26? **Không** → NOSWAP.
- `ETHLastSwap.BNB` vẫn được dời xuống 0,2574.

**Mốc 2.** ETH giảm 4% (2500 → 2400) nên ETH là ứng viên với −4%; BNB và BTC `perETH` tăng 4,17%.

- Tầng 1: ETH khác `outputSwapTemp` (BNB), −4% dưới −0,3%. Đạt → `outputSwapTemp = "ETH"`.
- Tầng 2: ứng viên ETH **chính là** token đang giữ → NOSWAP, không ghi gì thêm.
- BNB `perETH` lên 0,268125.

Mốc này tuy không swap nhưng cần thiết: nó đổi `outputSwapTemp` sang ETH, nhờ vậy mốc 3 ứng viên BNB mới qua được tầng 1.

**Mốc 3.** BNB `perETH` 0,268125 → 0,266666..., giảm 0,544%. BNB là ứng viên.

- Tầng 1: BNB khác `outputSwapTemp` (ETH), −0,544% dưới −0,3%. Đạt.
- Tầng 2: BNB khác ETH đang giữ. Đạt.
- Tầng 3: 0,266666 ≥ `ETHLastSwap.BNB` 0,2574. Đạt.
- Tầng 4a: vốn quy ETH = 1 × 2400 / 2400 = 1 ≥ `ETHOriginalAmount` 1. Đạt.
- Tầng 4b: 0,266666 ≥ `perETHOriginal.BNB` 0,26. Đạt.

→ Gửi tx swap 1 ETH sang BNB. `swapV4.ts` trả 3,7425 BNB (mô phỏng trừ 0,2% phí + slippage). `action = "SWAP_PENDING"`, point cả 3 token về 1000, `ETHLastSwap.BNB = 0,266666...`, `perETHOriginal.BNB` vẫn giữ mốc gốc 0,26.

Nếu số BNB ghi nhận sau mốc 3 thấp hơn thực tế (ví dụ đọc sai số nhận về), tầng 4a ở các mốc sau sẽ chặn sai.

**Mốc 4.**

- `withdrawTradeV4` → swap 3,7425 BNB về 0,996004 ETH. `amountWithdraw = "0.996004"`, `pnl = "-0.003996"`, `config.isStop = true`.
- `resetTradeV4` → cũng swap về 0,996004 ETH, nhưng mở vòng mới ngay: `userConfig.amountStart = "0.996004"`, point về 1000, `price1Point` khoá lại theo giá mốc 4 (ETH 2,4, BTC 100, BNB 0,64).

## 9. Mẫu schema database (tham khảo)

Type của mọi field nằm ở `types/trade.ts`; schema gợi ý (`SettingV4Document`, `HistoryV4Document`, mẫu mongoose, index, enum `HISTORY_ACTIONS` / `HISTORY_STATUSES`) nằm ở `types/database.ts`. 20 khối data mẫu (output thật của từng hàm, đã gắn type) nằm ở `helper/tradeV4_Data.ts`. Mục này là bản rút gọn.

Mục này là **đề xuất để team server tham khảo**, không phải yêu cầu của thuật toán. Backend tự quyết tên collection, tên field phía server và index.

Chỉ ba điều sau là bắt buộc, vì thuật toán đọc / ghi trực tiếp:

- `config` lưu **nguyên khối**, truyền lại nguyên khối ở mốc sau.
- Lưu **đúng** các field của `history`, không thêm (`pointBeforeCheck`, `ETHLastSwapTemp` không tồn tại — xem 4.2).
- Mọi số của thuật toán là **chuỗi thập phân** — không dùng number (mất chữ số), không dùng wei.

### 9.1. Collection bot

```js
const SettingV4Schema = new Schema({
  userId:  { type: ObjectId, index: true },
  chainId: { type: String },              // "56"
  minute:  { type: Number },              // phút trong giờ để cron gom bot

  // khối của thuật toán — lưu nguyên khối
  config:  { type: Schema.Types.Mixed },

  // server tự quản, thuật toán không đọc
  lastSwapId: { type: String },                   // đang có tx thì khoá, không chạy mốc mới
  closed:     { type: Boolean, default: false },  // set true khi config.isStop = true
  deleted:    { type: Boolean, default: false },
}, { timestamps: true });
```

`config` để `Mixed` là cố ý: `state.ETHLastSwap`, `state.price1Point`, `state.perETHOriginal` là map có key là symbol của chính bot đó, còn `itemPre.arrToken` dài theo số token của bot. Khai cứng từng field sẽ vỡ ngay khi mở bot 5 token.

Giá trị `config` ngay sau register (bot 3 token, nạp 1 ETH):

```json
{
  "userConfig": { "amountStart": "1", "inputStart": "ETH", "volatility": "0.3" },
  "state": {
    "amountInput": "1",
    "outputSwap": "ETH",
    "outputSwapTemp": "ETH",
    "ETHLastSwap":    { "ETH": "1", "BTC": "40", "BNB": "0.26" },
    "perETHOriginal": { "ETH": "1", "BTC": "40", "BNB": "0.26" },
    "ETHOriginalAmount": "1",
    "price1Point": { "ETH": "2.5", "BTC": "100", "BNB": "0.65" }
  },
  "itemPre": {
    "arrToken": [
      { "symbol": "ETH", "address": "0x2170...", "price": "2500",   "perETH": "1",    "perETHChangePercentage": "0", "pointAfterCheck": "1000" },
      { "symbol": "BTC", "address": "0x7130...", "price": "100000", "perETH": "40",   "perETHChangePercentage": "0", "pointAfterCheck": "1000" },
      { "symbol": "BNB", "address": "0xbb4C...", "price": "650",    "perETH": "0.26", "perETHChangePercentage": "0", "pointAfterCheck": "1000" }
    ]
  },
  "isStop": false
}
```

### 9.2. Collection history

```js
const HistoryV4Schema = new Schema({
  tradingSettingId: { type: ObjectId, index: true },

  // nguyên văn history của tradeV4.ts
  action:        { type: String },   // DEPOSIT | NOSWAP | SWAP_PENDING | WITHDRAW | RESET
  isSwap:        { type: Boolean },
  inputSwap:     { type: String },
  outputSwap:    { type: String },
  amountSwap:    { type: String },
  txHash:        { type: String },
  currentToken:  { type: String },
  currentAmount: { type: String },
  arrToken:      [{
    symbol:                 String,
    address:                String,
    price:                  String,
    perETH:                 String,
    perETHChangePercentage: String,
    changeByPoint:          String,
    pointAfterCheck:        String,
  }],
  amountWithdraw: { type: String },  // chỉ WITHDRAW
  pnl:            { type: String },  // chỉ WITHDRAW

  // server tự quản
  swapId:  { type: String, index: true },
  status:  { type: String },         // PENDING | SUCCESS | FAILED
  retries: { type: Number, default: 0 },
}, { timestamps: true });
```

Bản ghi mốc 3 (có swap) của ví dụ mục 8:

```json
{
  "action": "SWAP_PENDING",
  "isSwap": true,
  "inputSwap": "ETH",
  "outputSwap": "BNB",
  "amountSwap": "3.7425",
  "txHash": "0x9f2c1b7a4e8d3f56a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f708192a3b4c5d",
  "currentToken": "BNB",
  "currentAmount": "3.7425",
  "arrToken": [
    { "symbol": "ETH", "price": "2400",   "perETH": "1",                      "perETHChangePercentage": "0",                      "changeByPoint": "0",                     "pointAfterCheck": "1000" },
    { "symbol": "BTC", "price": "100000", "perETH": "41.66666666666666666667","perETHChangePercentage": "0",                      "changeByPoint": "0",                     "pointAfterCheck": "1000" },
    { "symbol": "BNB", "price": "640",    "perETH": "0.26666666666666666667", "perETHChangePercentage": "-0.00543900543900543899","changeByPoint": "-5.38461538461538461538","pointAfterCheck": "1000" }
  ]
}
```

Bản ghi WITHDRAW (lược `arrToken` cho gọn):

```json
{
  "action": "WITHDRAW",
  "isSwap": true,
  "inputSwap": "BNB",
  "outputSwap": "ETH",
  "amountSwap": "0.996004",
  "txHash": "0x3a7e...",
  "currentToken": "ETH",
  "currentAmount": "0.996004",
  "amountWithdraw": "0.996004",
  "pnl": "-0.003996",
  "arrToken": [ "..." ]
}
```

Bản ghi NOSWAP: `isSwap = false`, bốn field `inputSwap` / `outputSwap` / `amountSwap` / `txHash` đều `null`, `arrToken` vẫn đủ số liệu.

Bản ghi RESET: `inputSwap` / `outputSwap` / `amountSwap` / `txHash` là lệnh swap về đồng gốc của vòng cũ, còn `arrToken` + `currentAmount` đã là trạng thái **đầu vòng mới** (point 1000, biến động 0).

### 9.3. Index đề xuất

| Collection | Index | Dùng để |
| --- | --- | --- |
| bot | `{ minute, closed, deleted }` | Cron lấy bot theo phút |
| bot | `{ lastSwapId: 1 }` sparse | Tìm bot đang bị khoá |
| history | `{ swapId }` unique, sparse | Cập nhật đúng bản ghi swap, chống ghi trùng |
| history | `{ tradingSettingId, createdAt: -1 }` | Xem lịch sử một bot |
| history | `{ status, updatedAt }` | Cron quét tx treo |

## 10. Test offline

`tradeV4.ts` nhận tham số `swap` để thay hàm swap thật bằng hàm giả, nên chạy được hoàn toàn offline, không gửi tx nào:

```js
const d = require("./helper/tradeV4_Data.ts");
const { registerTradeV4, runTradeV4 } = require("./helper/tradeV4.ts");

const reg = registerTradeV4({ config: d.CONFIG_REGISTER_INPUT, arrToken: d.ARR_TOKEN_REGISTER });
// reg.history trùng d.HISTORY_DEPOSIT, reg.config trùng d.CONFIG_AFTER_REGISTER

const res = await runTradeV4({
  config: d.CONFIG_AFTER_T2,
  arrToken: d.ARR_TOKEN_T3,
  idBot: "x", chainId: "56", swapId: "swap-0003",
  swap: async () => d.SWAP_CALL.out,     // hàm giả
});
// res.history trùng d.HISTORY_SWAP_PENDING, res.config trùng d.CONFIG_AFTER_SWAP
```

Mọi khối data trong `tradeV4_Data.ts` là output thật của code, nên dùng làm expected value của test được ngay.

## 11. Số nhận về từ swap — con số quan trọng nhất

`amount` mà `swapV4.ts` trả về trở thành vốn của mọi mốc sau. Thuật toán không tự tính lại, không tự trừ phí hay trượt giá, và không kiểm được số này có thật hay không.

Yêu cầu với `swapV4.ts`:

- Trả số tokenOut **thực sự của lệnh swap**, đơn vị token, đã chia đúng `decimals` của `tokenOut`.
- Cách lấy đề xuất: đọc từ kết quả gọi contract / event swap; nếu chưa có thì dùng số quote tại thời điểm gửi.
- Gửi tx không thành công → **throw**, đừng trả số 0 hay số ước. Throw thì `config` trong DB không bị ghi sai.

`tradeV4.ts` chỉ chặn được giá trị không phải số dương. Sai decimals hoặc đọc nhầm token vẫn cho ra một số dương hợp lệ và sẽ không bị phát hiện.

**Trạng thái hiện tại:** `swapV4.ts` là stub, trả `{ txHash: "0x", amount: "0" }`. Vì `amount = "0"` nên `tradeV4.ts` sẽ throw `trả amount không hợp lệ: 0` ngay khi gặp mốc cần swap. Phải nối contract thật trước khi chạy production.

## 12. Quy tắc bắt buộc

Danh sách này dành cho cả người và AI agent khi viết hoặc sửa code gọi thuật toán.

PHẢI:

- Lưu `config` nguyên khối và truyền lại nguyên khối.
- Lưu nguyên `arrToken` của history, kể cả field `null`: đó là dữ liệu để đối chiếu về sau, không phải chỗ để rút gọn.
- Lưu `config` ở **mọi** mốc, kể cả `NOSWAP`: mốc không swap vẫn có thể đổi `ETHLastSwap` và `outputSwapTemp`.
- Giữ nguyên danh sách token, `symbol`, `address` và thứ tự trong `arrToken` suốt vòng đời bot.
- Truyền `price` là giá USD.
- Khoá bot khi còn tx chưa rõ kết quả.

KHÔNG ĐƯỢC:

- Chạy hai mốc song song cho cùng một bot.
- Gọi `runTradeV4` khi bot còn tx swap chưa rõ kết quả.
- Sửa field trong `config.state` / `config.itemPre`, hoặc lưu một phần `config`.
- Lưu `config` khi hàm đã throw (lúc đó không có `config` mới).
- Tự tính số nhận về theo giá thay cho số `swapV4.ts` trả.
- Thêm field vào `history` rồi coi đó là của thuật toán.
- Đổi công thức, dấu so sánh (`>` và `≥`) hoặc thứ tự các tầng ở mục 5 khi không có yêu cầu từ team logic.

## 13. Các lỗi thuật toán throw

Mọi lỗi có tiền tố `[tradeV4]`. Khi throw, không có `config` mới; server giữ nguyên DB.

| Thông báo chứa | Nguyên nhân |
| --- | --- |
| `thiếu config` | Không truyền `config` |
| `arrToken rỗng`, `thiếu symbol`, `symbol trùng lặp`, `thiếu address`, `giá không hợp lệ` | `arrToken` sai |
| `thiếu token ETH`, `thiếu token BTC` | Thiếu token bắt buộc |
| `config chưa register — gọi registerTradeV4 trước` | Gọi run / withdraw / reset trước khi register |
| `config đã register — dùng resetTradeV4 nếu muốn mở vòng mới` | Gọi register lần hai |
| `bot đã withdraw (stop)` | Gọi tiếp sau khi đã withdraw (`config.isStop = true`) |
| `amountStart không hợp lệ`, `volatility không hợp lệ` | Cài đặt lúc register không phải số dương |
| `inputStart "X" không có trong arrToken` | `inputStart` không thuộc danh sách token |
| `itemPre thiếu mốc trước của X` | Thêm token mới vào bot đang chạy |
| `arrToken lệch thứ tự so với mốc trước` | Đổi thứ tự token trong `arrToken` |
| `address của X lệch so với lúc register` | Address token khác lúc register |
| `itemPre.X thiếu <field> — mốc trước lưu không đủ` | DB lưu thiếu `price`, `perETH` hoặc `pointAfterCheck` của token X |
| `state.price1Point thiếu X` | DB lưu thiếu `price1Point` của token X |
| `token đang nắm giữ "X" không có trong arrToken` | Bỏ bớt token bot đang giữ |
| `swap X->Y trả amount không hợp lệ` | `swapV4.ts` trả `amount` không phải số dương |
| `thiếu idBot`, `thiếu chainId`, `swap phải là function` | Thiếu tham số của run / withdraw / reset |

## 14. Điểm chưa chốt

Các điểm sau chưa có quyết định cuối và cần team logic cùng team server thống nhất:

- **Nối contract trong `swapV4.ts`.** Hiện là stub. Phải chốt cách lấy số tokenOut trả về (mục 11) và khi nào coi là gửi tx thất bại để throw.
- **Tx fail onchain sau khi đã lưu `config`.** Vì không chờ confirm, trường hợp này cần một luồng bù trừ ở phía server (mục 7.3).
- **Chu kỳ gọi.** Cron cũ chạy mỗi bot một lần mỗi giờ. Tài liệu giả định giữ nguyên; ngưỡng biến động được so giữa hai mốc liền nhau nên đổi chu kỳ sẽ đổi hành vi.
- **Bot đang chạy theo schema cũ.** Chưa có hàm chuyển state cũ sang `config` mới. Hiện tại bot phải register lại.
- **`action` của withdraw / reset.** Hai lệnh này cũng chỉ gửi tx chưa confirm; nếu team server muốn đồng bộ với `SWAP_PENDING` thì đổi thành `WITHDRAW_PENDING` / `RESET_PENDING`.
