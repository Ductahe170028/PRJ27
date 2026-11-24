# Hiệu chỉnh mật độ quái của shooter

Phần "Stage 4A" ngay dưới là số liệu mới nhất (bot bình thường); các phần sau nó là Stage 3 (bot giỏi) và cũ hơn, giữ để so sánh. Ngày chạy phần Stage 3: 2026-11-22. Kết quả của `npx tsx scripts/calibrate-shooter.ts --write` (cờ `--write` đã được thay bằng `--out=tệp` từ Stage 4A) chạy từ `apps/api` (PowerShell nuốt cờ qua `npm run`, nên chạy trực tiếp; 2700 ván mỗi pha, 7 tiến trình song song, 87 s).

Lưới: intensity 1-5 x mix quái (runner, brute, swarmer, cả ba) x map (5) x weapon (3) x health (3) x 3 seed; mục tiêu sống sót 60 s.
"Trước cổng" là bot chơi level đúng như compiler dựng; "sau cổng" là level service sẽ trả (compile + cổng), chơi trên seed mà cổng chưa dùng.

## Stage 4A: cổng dùng bot "người chơi bình thường" (mới nhất)

Người chơi thử Stage 3 thấy màn "khó" dù cổng đã chỉnh: bot trong cổng (`botInput`) ngắm chuẩn và phản xạ tức thì nên giỏi hơn người rõ rệt. Từ Stage 4A cổng dùng `createCasualBot(seed)` (`packages/contracts/src/shooter/casual-bot.ts`), mỗi ván một bot mới; `botInput` ("bot giỏi") chỉ còn để test và để so sánh ở đây. Báo cáo cổng ghi `bot: 'casual'`. Mọi số dưới đây là từ `npx tsx scripts/calibrate-shooter.ts` (chạy từ `apps/api`; `--bot=casual|expert`, `--casual=reaction=18,aim=12,flee=0.8,wall=0.5,fire=0.85` để thử số khác mà không sửa mã; `--out=tệp` để lưu bảng). `INTENSITY_RATE` không đổi.

### Tham số `CASUAL` (một nơi, đều là ước đoán)

| tham số | giá trị | ý nghĩa |
|---|---|---|
| `reactionTicks` | 18 (0,3 s) | chỉ "nhìn lại" sân mỗi 18 tick, giữa hai lần dùng ảnh cũ (giới hạn ≤ 24) |
| `aimErrorDeg` | 12° | mỗi lần nhìn thêm sai số góc đều trong ±12°, giữ đến lần nhìn sau (giới hạn ≤ 12) |
| `fireRangeShare` | 0,85 | chỉ bắn khi mục tiêu trong 85% tầm súng |
| `fleeScale` | 0,8 | né quái trong 120 px (bot giỏi 150 px) |
| `wallScale` | 0,5 | tránh tường và cạnh trong 30 px (bot giỏi 60 px); không có đường đi vòng |

Giá trị khởi điểm của prompt (12 tick, 5°) cho bot gần như ngang bot giỏi (100 / 98,9 / 83,7 / 55,4 / 42,6%): intensity 2 và 3 vượt khoảng đặt ra. Các bộ đã thử (thắng trước cổng, intensity 1 → 5, lưới 2700 ván):

| bot | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| bot giỏi | 100,0 | 100,0 | 87,6 | 63,3 | 48,0 |
| 12 tick, 5° (khởi điểm) | 100,0 | 98,9 | 83,7 | 55,4 | 42,6 |
| 18 tick, 8° | 99,4 | 94,3 | 74,8 | 48,9 | 30,7 |
| 24 tick, 10° | 98,9 | 92,2 | 58,9 | 42,6 | 24,8 |
| 24 tick, 12°, né 50%, tường 30% | 97,4 | 74,3 | 50,7 | 38,7 | 17,4 |
| 16 tick, 12° | 98,5 | 86,1 | 57,2 | 42,2 | 24,8 |
| **18 tick, 12° (chọn)** | **99,6** | **87,0** | **57,8** | **43,3** | **24,3** |
| khoảng yêu cầu | ≥ 90 | 70–90 | 50–75 | 30–55 | 15–40 |

Bộ chọn nằm trong khoảng ở cả 5 mức và giữ nguyên né quái 80%, tường 50%, bắn trong 85% tầm; độ trễ và sai số đều trong giới hạn (≤ 24 tick, ≤ 12°). Mức 2 sát cận trên (87,0 so với 90) nên là mức nhạy nhất với chỉnh sau này.

### Bot bình thường và bot giỏi cạnh nhau (survive 60 s, 2700 ván mỗi pha)

| intensity | thắng trước cổng: giỏi → bình thường | hp còn trước | dựng được sau cổng | bot thắng sau cổng (seed chưa dùng) | ván bị giảm mật độ (trên 540) |
|---|---|---|---|---|---|
| 1 | 100,0 → 99,6% | 1,000 → 0,980 | 100 → 100% | 100,0 → 98,9% | 0 → 1 (0%) |
| 2 | 100,0 → 87,0% | 0,991 → 0,774 | 100 → 100% | 99,8 → 96,3% | 0 → 75 (14%) |
| 3 | 87,6 → 57,8% | 0,834 → 0,502 | 100 → 100% | 94,4 → 84,1% | 66 → 233 (43%) |
| 4 | 63,3 → 43,3% | 0,570 → 0,389 | 100 → 100% | 92,6 → 84,3% | 190 → 299 (55%) |
| 5 | 48,0 → 24,3% | 0,443 → 0,195 | 100 → 100% | 88,9 → 82,0% | 286 → 390 (72%) |

0 trên 2700 ván không dựng được (cả hai bot). Theo vũ khí (thắng trước cổng, bình thường / giỏi): súng ngắn 46 / 72%, bắn nhanh 94 / 100%, nặng 47 / 68%. Người ngắm lệch cần nhịp bắn cao để bù: với súng ngắn và súng nặng bot bình thường thua gần một nửa số ván trước cổng. Theo máu: yếu 58%, thường 62%, bền 67%; theo map: 61–64% (không map nào lệch); theo quái: runner 63%, trâu 72%, swarmer 63%, trộn 52%.

### Cổng: `MAX_THIN_STEPS` từ 4 lên 6 (sai lệch so với Stage 3, có số liệu)

Giữ 4 bước (sàn 41% mật độ) thì bot bình thường chỉ dựng được 100 / 100 / 100 / **98,0** / **87,0**% ở intensity 1-5 (81 trên 2700 ván bị `unwinnable_level`), thấp hơn mức ≥ 99% yêu cầu. Đo số bước cần (không giới hạn): intensity 4 cần 0 / 1 / 2 / 3 / 4 / 5 / 6 bước ở 241 / 58 / 102 / 83 / 45 / 10 / 1 ván; intensity 5 ở 150 / 77 / 77 / 96 / 70 / 56 / 14 ván. Không ván nào cần quá 6 bước, nên 6 bước (0,8^6 = 26%) cho 100%; 5 bước chỉ cho 97,4% ở intensity 5. Tham số bot không bù được: ván khó nhất là súng nặng với quái swarmer và máu yếu, nơi một phát một con quái không đủ ngay cả ở mật độ thấp. Hệ quả: màn khó nhất bị giảm xuống mật độ ngang intensity 1-2 và có thông báo "Độ khó được điều chỉnh để màn chơi thắng được."; nếu muốn giữ sàn 41%, đặt lại `MAX_THIN_STEPS = 4` và chấp nhận 13% ván intensity 5 bị từ chối.

### Mục tiêu khác, bot bình thường (một seed, 900 ván mỗi mục tiêu, 6 bước)

| mục tiêu | thắng trước cổng (intensity 1…5) | dựng được sau cổng | bot thắng sau cổng | ván bị giảm mật độ (trên 180) | ván bị giảm mục tiêu (trên 180) |
|---|---|---|---|---|---|
| survive 20 | 100 / 100 / 97,8 / 95,0 / 86,7% | 100% ở cả 5 | 100 / 100 / 99,4 / 97,8 / 97,2% | 0 / 0 / 0 / 7 / 29 | 0 |
| survive 180 | 85,6 / 68,3 / 51,1 / 45,6 / 28,9% | 100 / 100 / 100 / 100 / **99,4%** | 93,3 / 82,8 / 82,2 / 80,6 / 81,0% | 17 / 51 / 87 / 95 / 124 | 0 |
| kill 10 | 100 / 100 / 97,8 / 93,3 / 91,1% | 100% ở cả 5 | 100 / 100 / 97,8 / 95,6 / 96,1% | 3 / 0 / 12 / 15 / 17 | 0 |
| kill 40 | 92,8 / 87,2 / 72,2 / 53,9 / 47,2% | 100% ở cả 5 | 94,4 / 91,7 / 81,1 / 80,6 / 71,1% | 16 / 33 / 59 / 87 / 104 | 5 / 5 / 12 / 20 / 25 |
| kill 100 | 55,6 / 37,8 / 41,1 / 30,0 / 20,6% | 96,7 / 96,7 / 95,6 / 91,1 / 93,3% | 85,1 / 78,7 / 68,0 / 68,9 / 66,1% | 50 / 65 / 89 / 102 / 125 | 54 / 66 / 62 / 70 / 92 (30 / 37 / 34 / 39 / 51%) |
| kill 200 | 25,0 / 26,1 / 25,0 / 23,3 / 12,8% | 71,7 / 76,1 / 76,1 / 72,2 / 55,6% | 74,4 / 75,2 / 71,5 / 73,1 / 69,0% | 36 / 49 / 60 / 70 / 65 | 78 / 87 / 93 / 82 / 55 (43 / 48 / 52 / 46 / 31%) |

Đạt: dựng được ≥ 99% với survive 20/60/180 và kill 10/40 ở mọi intensity (thấp nhất 99,4%: survive 180 intensity 5, 1 trên 180 ván); bot bình thường thắng trên seed chưa dùng ≥ 55% ở mọi intensity và mọi mục tiêu (thấp nhất 66,1%).

So với Stage 3 (bot giỏi, 4 bước; bảng ở dưới): kill 100 dựng được 100 / 100 / 100 / 99,4 / 100% → 96,7 / 96,7 / 95,6 / 91,1 / 93,3%, phải giảm mục tiêu 17 / 19 / 23 / 24 / 24% → 30 / 37 / 34 / 39 / 51%; kill 200 dựng được 90,0 / 93,9 / 93,3 / 94,4 / 86,7% → 71,7 / 76,1 / 76,1 / 72,2 / 55,6%, phải giảm mục tiêu 41 / 45 / 43 / 44 / 43% → 43 / 48 / 52 / 46 / 31%. Mục tiêu hạ rất nhiều quái (nhất là quái trâu với súng ngắn hoặc nặng) vẫn bị từ chối `unwinnable_level` thay vì đưa ra một màn người không thắng nổi; đây là hệ quả có chủ ý của bot yếu hơn.

### Thời gian dựng + cổng qua worker (bản build, `node scripts/measure-compile-time.mjs 40`)

| trường hợp (40 lần, nhiều seed / map / intensity) | median | p95 | lớn nhất |
|---|---|---|---|
| survive 60 s | 0,35 s | 0,54 s | 0,60 s |
| survive 180 s | 0,41 s | 0,68 s | 0,94 s |
| xấu nhất: kill 200, toàn quái trâu, intensity 5, máu yếu (cả 40 lần bị từ chối sau khi dùng hết 6 bước và 3 lần giảm mục tiêu) | 1,29 s | 1,81 s | 2,01 s |

Giới hạn 8 s của worker (`COMPILE_TIMEOUT_MS`) không đổi; không lần nào hết giờ.

## Quy tắc của cổng từ Stage 3

**Bot chơi giỏi hơn người, vì vậy cổng chỉ làm màn DỄ HƠN, không bao giờ KHÓ HƠN.** Một màn dễ với bot không có nghĩa là dễ với người; một màn bot chỉ thắng 1 trong 3 ván thì gần như người không thắng nổi.

- Bot chơi 3 seed. Thắng ít hơn 2 (`MIN_WINS = 2`) thì giảm mật độ quái, tối đa 4 lần x0,8 (`MAX_THIN_STEPS = 4`, sàn 41%); **từ Stage 4A là 6 lần, sàn 26%**, xem trên. Hết bước mà vẫn dưới 2 thì `unwinnable_level`.
- Thắng 2/3 hoặc 3/3 thì nhận ngay, không đổi gì, kể cả khi bot thắng dễ ở intensity 5. Bước "làm khó" (x1,2, thông báo "khó hơn") của Stage 2 đã bị xóa.
- Mục tiêu `kill` quá nặng (cổng báo `unwinnable_level`): giảm `count` x0,7 (làm tròn xuống, tối thiểu 10), dựng lại cùng brief và seed, chạy cổng lại, tối đa 3 lần. Thành công thì có đúng một thông báo `Mục tiêu hạ N quái quá nặng; đã giảm còn M.` (N là số được yêu cầu, M là số cuối). Mục tiêu `survive` không có bước này.

Tiêu chí đạt (Stage 3), kết quả thật bên dưới: (a) dựng được sau cổng ≥ 99% với `survive` 20/60/180 và `kill` 10/40 ở mọi intensity: **đạt** (thấp nhất 99,8%: survive 60 intensity 5, 1 trên 540 ván; còn lại 100%), nên `MAX_THIN_STEPS` giữ 4, không phải tăng. (b) bot thắng trên seed chưa dùng sau cổng ≥ 55% ở mọi intensity: **đạt** (thấp nhất 76,3%, ở `kill` 200 intensity 5). (c) không ván nào bị làm khó thêm: **đạt** (không còn mã làm khó).

## Bảng mới (Stage 3), survive 60 s, 2700 ván

```
INTENSITY_RATE = [0.6, 1.2, 1.7, 2.15, 2.7]
goal: {"type":"survive","seconds":60}

| intensity | games | bot wins before gate | hp left before | compiled after gate | bot wins after gate | hp left after | thinned | goal reduced |
|---|---|---|---|---|---|---|---|---|
| 1 | 540 | 100.0% | 1.000 | 100.0% | 100.0% | 1.000 | 0 | 0 |
| 2 | 540 | 100.0% | 0.991 | 100.0% | 99.8% | 0.994 | 0 | 0 |
| 3 | 540 | 87.6% | 0.834 | 100.0% | 94.4% | 0.876 | 66 | 0 |
| 4 | 540 | 63.3% | 0.570 | 100.0% | 92.6% | 0.851 | 190 | 0 |
| 5 | 540 | 48.0% | 0.443 | 99.8% | 88.9% | 0.763 | 285 | 0 |

Combinations that did not compile after the gate: 1 of 2700.
- intensity 5, mixed, cross-corridors, pistol, fragile, seed 202: Không dựng được màn chơi thắng được với yêu cầu này. Hãy giảm độ khó hoặc đổi vũ khí/số máu.

Before the gate, by weapon / health / map (bot wins):
- weapon: pistol 72%, rapid 100%, heavy 68%
- health: fragile 78%, sturdy 82%, normal 80%
- map: open-arena 82%, pillars 77%, cross-corridors 76%, rooms 80%, ring 82%
- mix: runner 80%, brute 85%, swarmer 80%, mixed 74%
```

Bảng cũ (cổng Stage 2: loại khi thua cả 3; làm khó khi bot thắng 3/3 với ≥ 90% máu ở intensity ≥ 3) cạnh bảng mới. "Trước cổng" không đổi vì không phụ thuộc cổng (khớp từng số, nên bảng cũ là số "trước Stage 3" hợp lệ). "Bị giảm" = số ván cổng phải giảm mật độ; "bị làm khó" chỉ có ở cổng cũ.

| intensity | thắng trước cổng | dựng được sau cổng: cũ → mới | bot thắng sau cổng: cũ → mới | hpLeft sau: cũ → mới | ván bị giảm: cũ → mới | ván bị làm khó: cũ → mới |
|---|---|---|---|---|---|---|
| 1 | 100,0% | 100% → 100% | 100,0% → 100,0% | 1,000 → 1,000 | 0 → 0 | 0 → 0 |
| 2 | 100,0% | 100% → 100% | 99,8% → 99,8% | 0,994 → 0,994 | 0 → 0 | 0 → 0 |
| 3 | 87,6% | 100% → 100% | 87,6% → 94,4% | 0,783 → 0,876 | 48 → 66 | 285 → 0 |
| 4 | 63,3% | 100% → 100% | 82,0% → 92,6% | 0,722 → 0,851 | 120 → 190 | 250 → 0 |
| 5 | 48,0% | 100% → 99,8% | 75,4% → 88,9% | 0,610 → 0,763 | 263 → 285 | 163 → 0 |

Cổng cũ làm khó 698 trong 2700 ván (26%) và vì thế kéo tỷ lệ thắng của bot xuống; cổng mới không làm khó ván nào, nhận ngay màn bot thắng 2/3, và đẩy bot thắng sau cổng lên 88,9 đến 94,4% ở intensity 3-5. Tham số không đổi: `INTENSITY_RATE`, trọng số loại quái, hệ số nhịp, `THIN_FACTOR = 0,8`, `MAX_THIN_STEPS = 4`.

## Mục tiêu khác (Stage 3, một seed, 900 ván mỗi mục tiêu)

Cùng lưới nhưng đổi mục tiêu (`--goal=survive:180`, `--goal=kill:100`, ... và `--seeds=1`). Nhịp quái được giảm theo `(60 / độ dài)^0.5` khi độ dài hơn 60 s.

```
goal survive:20
| intensity | games | bot wins before gate | hp left before | compiled after gate | bot wins after gate | hp left after | thinned | goal reduced |
|---|---|---|---|---|---|---|---|---|
| 1 | 180 | 100.0% | 1.000 | 100.0% | 100.0% | 1.000 | 0 | 0 |
| 2 | 180 | 100.0% | 1.000 | 100.0% | 100.0% | 1.000 | 0 | 0 |
| 3 | 180 | 100.0% | 0.996 | 100.0% | 100.0% | 1.000 | 0 | 0 |
| 4 | 180 | 100.0% | 0.996 | 100.0% | 100.0% | 0.996 | 0 | 0 |
| 5 | 180 | 97.8% | 0.947 | 100.0% | 98.3% | 0.939 | 4 | 0 |

goal survive:180
| intensity | games | bot wins before gate | hp left before | compiled after gate | bot wins after gate | hp left after | thinned | goal reduced |
|---|---|---|---|---|---|---|---|---|
| 1 | 180 | 98.3% | 0.969 | 100.0% | 98.9% | 0.963 | 0 | 0 |
| 2 | 180 | 96.7% | 0.948 | 100.0% | 95.6% | 0.939 | 1 | 0 |
| 3 | 180 | 91.1% | 0.871 | 100.0% | 92.2% | 0.859 | 11 | 0 |
| 4 | 180 | 73.9% | 0.685 | 100.0% | 90.6% | 0.822 | 44 | 0 |
| 5 | 180 | 52.2% | 0.458 | 100.0% | 89.4% | 0.787 | 76 | 0 |

goal kill:10
| intensity | games | bot wins before gate | hp left before | compiled after gate | bot wins after gate | hp left after | thinned | goal reduced |
|---|---|---|---|---|---|---|---|---|
| 1 | 180 | 98.3% | 0.983 | 100.0% | 100.0% | 0.993 | 0 | 0 |
| 2 | 180 | 100.0% | 1.000 | 100.0% | 100.0% | 1.000 | 0 | 0 |
| 3 | 180 | 100.0% | 1.000 | 100.0% | 99.4% | 0.987 | 0 | 0 |
| 4 | 180 | 98.3% | 0.976 | 100.0% | 94.4% | 0.937 | 3 | 0 |
| 5 | 180 | 91.7% | 0.909 | 100.0% | 97.2% | 0.951 | 11 | 0 |

goal kill:40
| intensity | games | bot wins before gate | hp left before | compiled after gate | bot wins after gate | hp left after | thinned | goal reduced |
|---|---|---|---|---|---|---|---|---|
| 1 | 180 | 98.3% | 0.976 | 100.0% | 98.9% | 0.974 | 0 | 0 |
| 2 | 180 | 98.3% | 0.972 | 100.0% | 98.3% | 0.966 | 0 | 0 |
| 3 | 180 | 98.3% | 0.969 | 100.0% | 96.1% | 0.929 | 5 | 0 |
| 4 | 180 | 85.6% | 0.805 | 100.0% | 90.6% | 0.859 | 36 | 2 |
| 5 | 180 | 70.6% | 0.631 | 100.0% | 90.0% | 0.790 | 59 | 0 |

goal kill:100
| intensity | games | bot wins before gate | hp left before | compiled after gate | bot wins after gate | hp left after | thinned | goal reduced |
|---|---|---|---|---|---|---|---|---|
| 1 | 180 | 74.4% | 0.704 | 100.0% | 91.7% | 0.869 | 13 | 31 |
| 2 | 180 | 74.4% | 0.716 | 100.0% | 92.8% | 0.849 | 17 | 34 |
| 3 | 180 | 60.0% | 0.556 | 100.0% | 91.7% | 0.848 | 34 | 42 |
| 4 | 180 | 58.9% | 0.578 | 99.4% | 87.7% | 0.778 | 51 | 43 |
| 5 | 180 | 42.8% | 0.406 | 100.0% | 83.9% | 0.730 | 97 | 43 |

goal kill:200
| intensity | games | bot wins before gate | hp left before | compiled after gate | bot wins after gate | hp left after | thinned | goal reduced |
|---|---|---|---|---|---|---|---|---|
| 1 | 180 | 49.4% | 0.469 | 90.0% | 89.5% | 0.825 | 34 | 73 |
| 2 | 180 | 50.0% | 0.476 | 93.9% | 86.4% | 0.809 | 40 | 81 |
| 3 | 180 | 49.4% | 0.458 | 93.3% | 86.3% | 0.796 | 39 | 77 |
| 4 | 180 | 38.3% | 0.356 | 94.4% | 91.8% | 0.834 | 62 | 80 |
| 5 | 180 | 30.0% | 0.272 | 86.7% | 76.3% | 0.678 | 79 | 78 |
```

Mục tiêu `kill` lớn, cũ → mới (dựng được sau cổng, bot thắng sau cổng) và tỷ lệ phải giảm mục tiêu (Stage 3), theo intensity 1 đến 5:

| mục tiêu | dựng được: cũ (Stage 2.1) | dựng được: mới | phải giảm mục tiêu (mới) | bot thắng sau cổng: cũ → mới (intensity 1…5) |
|---|---|---|---|---|
| kill 100 | 89,4 / 87,2 / 81,7 / 77,8 / 79,4% | 100 / 100 / 100 / 99,4 / 100% | 17 / 19 / 23 / 24 / 24% | 90,7 94,3 88,4 85,0 79,7 → 91,7 92,8 91,7 87,7 83,9 |
| kill 200 | 51,7 / 50,0 / 55,0 / 50,6 / 47,2% | 90,0 / 93,9 / 93,3 / 94,4 / 86,7% | 41 / 45 / 43 / 44 / 43% | 94,6 95,6 83,8 90,1 67,1 → 89,5 86,4 86,3 91,8 76,3 |

Ván không dựng được ở `kill` 100 và 200 hầu hết là quái trâu dày (mix `brute` hoặc `mixed`) với súng ngắn: sau 3 lần giảm (200 → 140 → 98 → 68, 100 → 70 → 49 → 34) bot vẫn thua, và kết quả đúng là `unwinnable_level`. Thời gian của trường hợp xấu nhất (kill 200, chỉ quái trâu, intensity 5, mọi map, vũ khí, máu; 90 lần dựng, một tiến trình, chưa kể khởi động worker): median 1,2 s, p95 2,2 s, lớn nhất 2,7 s, so với giới hạn 8 s của worker (`COMPILE_TIMEOUT_MS`). Ván dựng thất bại (phải dùng hết 3 lần giảm) chậm nhất: median 1,9 s.

## Trước Stage 3

Nội dung dưới đây là các bảng cũ, giữ lại để so sánh. Cổng cũ loại màn khi bot thua cả 3 seed, và làm khó (x1,2 tối đa hai lần, cột "thickened") khi bot thắng 3/3 với ≥ 90% máu ở intensity ≥ 3.

Ngày chạy: 2026-11-22. Kết quả của `npm run shooter:calibrate -w @game-creator/api -- --write` (2700 ván mỗi pha, 7 tiến trình song song, 93 s).

Lưới: intensity 1-5 x mix quái (runner, brute, swarmer, cả ba) x map (5) x weapon (3) x health (3) x 3 seed; mục tiêu sống sót 60 s.
"Trước cổng" là bot chơi level đúng như compiler dựng; "sau cổng" là level service sẽ trả (compile + cổng), chơi trên seed mà cổng chưa dùng.

Ngưỡng đặt ra cho trước cổng: thắng intensity 1 ≥ 95%, 2 ≥ 90%, 3 ≥ 80%, 4 ≥ 55%, 5 ≥ 35%; sau cổng: 100% tổ hợp compile được.

```
INTENSITY_RATE = [0.6, 1.2, 1.7, 2.15, 2.7]
goal: {"type":"survive","seconds":60}

| intensity | games | bot wins before gate | hp left before | compiled after gate | bot wins after gate | hp left after | thinned | thickened |
|---|---|---|---|---|---|---|---|---|
| 1 | 540 | 100.0% | 1.000 | 100.0% | 100.0% | 1.000 | 0 | 0 |
| 2 | 540 | 100.0% | 0.991 | 100.0% | 99.8% | 0.994 | 0 | 0 |
| 3 | 540 | 87.6% | 0.834 | 100.0% | 87.6% | 0.783 | 48 | 285 |
| 4 | 540 | 63.3% | 0.570 | 100.0% | 82.0% | 0.722 | 120 | 250 |
| 5 | 540 | 48.0% | 0.443 | 100.0% | 75.4% | 0.610 | 263 | 163 |

Combinations that did not compile after the gate: 0 of 2700.

Before the gate, by weapon / health / map (bot wins):
- weapon: pistol 72%, rapid 100%, heavy 68%
- health: fragile 78%, sturdy 82%, normal 80%
- map: open-arena 82%, pillars 77%, cross-corridors 76%, rooms 80%, ring 82%
- mix: runner 80%, brute 85%, swarmer 80%, mixed 74%
```



### Sau khi đa dạng hóa bản đồ (Stage 2.1)

Bố cục vật cản giờ được rút ngẫu nhiên trên toàn sân (`scatter`, tường đặt ở x/y bất kỳ, ngã tư không đối xứng) thay vì bám vị trí cố định. Bản đồ đổi nên độ khó đổi, vì vậy bảng ở trên là bảng **mới**. Không chỉnh tham số nào: `INTENSITY_RATE`, trọng số loại quái và hệ số nhịp giữ nguyên, mọi ngưỡng đạt ngay.

Bảng cũ (Stage 2, bản đồ vị trí cố định) cạnh bảng mới, lưới 2700 ván, mục tiêu sống sót 60 s:

| intensity | thắng trước cổng: cũ → mới (ngưỡng) | hpLeft trước: cũ → mới | dựng được sau cổng |
|---|---|---|---|
| 1 | 99,8% → 100,0% (≥ 95) | 0,993 → 1,000 | 100% → 100% |
| 2 | 99,1% → 100,0% (≥ 90) | 0,963 → 0,991 | 100% → 100% |
| 3 | 85,9% → 87,6% (≥ 80) | 0,810 → 0,834 | 100% → 100% |
| 4 | 62,6% → 63,3% (≥ 55) | 0,562 → 0,570 | 100% → 100% |
| 5 | 44,3% → 48,0% (≥ 35) | 0,408 → 0,443 | 100% → 100% |

Thắng trước cổng theo bản đồ (bot, mọi intensity gộp), cũ → mới: open-arena 82% → 82%, pillars 79% → 77%, cross-corridors 73% → 76%, rooms 76% → 80%, ring 81% → 82%. Không bản đồ nào quá khó với bot.

### Mục tiêu khác (một seed, 900 ván mỗi mục tiêu)

Cùng lưới nhưng đổi mục tiêu (`--goal=survive:180`, `--goal=kill:100`, ...) và chỉ một seed. Nhịp quái được giảm theo `(60 / độ dài)^0.5` khi độ dài hơn 60 s (máu không hồi nên rủi ro cộng dồn theo thời gian).

```
goal survive:20
| intensity | games | bot wins before gate | hp left before | compiled after gate | bot wins after gate | hp left after | thinned | thickened |
|---|---|---|---|---|---|---|---|---|
| 1 | 180 | 100.0% | 1.000 | 100.0% | 100.0% | 1.000 | 0 | 0 |
| 2 | 180 | 100.0% | 1.000 | 100.0% | 100.0% | 1.000 | 0 | 0 |
| 3 | 180 | 100.0% | 0.996 | 100.0% | 100.0% | 0.973 | 0 | 89 |
| 4 | 180 | 100.0% | 0.996 | 100.0% | 100.0% | 0.982 | 0 | 128 |
| 5 | 180 | 97.8% | 0.947 | 100.0% | 96.7% | 0.890 | 2 | 154 |

goal survive:180
| intensity | games | bot wins before gate | hp left before | compiled after gate | bot wins after gate | hp left after | thinned | thickened |
|---|---|---|---|---|---|---|---|---|
| 1 | 180 | 98.3% | 0.969 | 100.0% | 98.9% | 0.963 | 0 | 0 |
| 2 | 180 | 96.7% | 0.948 | 100.0% | 95.6% | 0.937 | 0 | 0 |
| 3 | 180 | 91.1% | 0.871 | 100.0% | 86.7% | 0.762 | 5 | 87 |
| 4 | 180 | 73.9% | 0.685 | 100.0% | 86.1% | 0.755 | 41 | 94 |
| 5 | 180 | 52.2% | 0.458 | 100.0% | 71.1% | 0.617 | 63 | 62 |

goal kill:10
| intensity | games | bot wins before gate | hp left before | compiled after gate | bot wins after gate | hp left after | thinned | thickened |
|---|---|---|---|---|---|---|---|---|
| 1 | 180 | 98.3% | 0.983 | 100.0% | 100.0% | 0.993 | 0 | 0 |
| 2 | 180 | 100.0% | 1.000 | 100.0% | 100.0% | 1.000 | 0 | 0 |
| 3 | 180 | 100.0% | 1.000 | 100.0% | 97.8% | 0.959 | 0 | 175 |
| 4 | 180 | 98.3% | 0.976 | 100.0% | 94.4% | 0.937 | 3 | 165 |
| 5 | 180 | 91.7% | 0.909 | 100.0% | 93.3% | 0.896 | 6 | 161 |

goal kill:40
| intensity | games | bot wins before gate | hp left before | compiled after gate | bot wins after gate | hp left after | thinned | thickened |
|---|---|---|---|---|---|---|---|---|
| 1 | 180 | 98.3% | 0.976 | 100.0% | 98.9% | 0.974 | 0 | 0 |
| 2 | 180 | 98.3% | 0.972 | 100.0% | 98.3% | 0.966 | 0 | 0 |
| 3 | 180 | 98.3% | 0.969 | 100.0% | 90.0% | 0.853 | 0 | 152 |
| 4 | 180 | 85.6% | 0.805 | 100.0% | 82.8% | 0.755 | 25 | 103 |
| 5 | 180 | 70.6% | 0.631 | 100.0% | 84.4% | 0.699 | 45 | 77 |

goal kill:100
| intensity | games | bot wins before gate | hp left before | compiled after gate | bot wins after gate | hp left after | thinned | thickened |
|---|---|---|---|---|---|---|---|---|
| 1 | 180 | 74.4% | 0.704 | 89.4% | 90.7% | 0.872 | 12 | 0 |
| 2 | 180 | 74.4% | 0.716 | 87.2% | 94.3% | 0.882 | 14 | 0 |
| 3 | 180 | 60.0% | 0.556 | 81.7% | 88.4% | 0.830 | 27 | 94 |
| 4 | 180 | 58.9% | 0.578 | 77.8% | 85.0% | 0.756 | 28 | 85 |
| 5 | 180 | 42.8% | 0.406 | 79.4% | 79.7% | 0.708 | 60 | 55 |

goal kill:200
| intensity | games | bot wins before gate | hp left before | compiled after gate | bot wins after gate | hp left after | thinned | thickened |
|---|---|---|---|---|---|---|---|---|
| 1 | 180 | 49.4% | 0.469 | 51.7% | 94.6% | 0.903 | 0 | 0 |
| 2 | 180 | 50.0% | 0.476 | 50.0% | 95.6% | 0.937 | 0 | 0 |
| 3 | 180 | 49.4% | 0.458 | 55.0% | 83.8% | 0.792 | 0 | 56 |
| 4 | 180 | 38.3% | 0.356 | 50.6% | 90.1% | 0.835 | 16 | 53 |
| 5 | 180 | 30.0% | 0.272 | 47.2% | 67.1% | 0.576 | 15 | 38 |
```

Nhận xét:
- Mục tiêu sống sót (20 s đến 180 s) và `kill` đến 40: 100% tổ hợp dựng được sau cổng.
- `kill` 100 và 200 với quái trâu (brute, 12 máu): không dựng được ở một phần tổ hợp. 130 hoặc 260 quái trong tối đa 300 s vượt sức bot kể cả khi cổng kéo giãn thời gian, nên trả `unwinnable_level` (kết quả đúng: hạ hàng trăm quái trâu bằng súng ngắn không thắng được).

Chạy lại: từ `apps/api`, với thư mục hiện tại viết `C:\...` bằng chữ C hoa, chạy trực tiếp `npx tsx scripts/calibrate-shooter.ts` (thêm `--write` để ghi lại phần bảng mới nhất vào tệp này, `--pre-only` để chỉ đo trước cổng khi chỉnh `INTENSITY_RATE`, `--goal=kill:100 --seeds=1` để đo mục tiêu khác). `npm run shooter:calibrate -w @game-creator/api -- --cờ` làm PowerShell nuốt cờ. Không chạy trong `npm test`.
