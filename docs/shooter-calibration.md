# Hiệu chỉnh mật độ quái của shooter

Phần "Stage 4D.1" ngay dưới là số liệu mới nhất (máu căn cứ ở I4-I5); phần "Stage 4D" sau nó là căn cứ cần bảo vệ (các bảng của nó là trước 4D.1); phần "Stage 4C.1" sau nó là boss không kẹt (boss không kẹt, nhịp quái của màn boss); phần "Stage 4C" sau nó là boss cuối (các số của boss và bảng trước 4C.1: bảng I1–I5 của 4C đã bị 4C.1 thay thế); phần "Stage 4B" là hai súng mới, quái bắn xa và hồi máu; phần "Stage 4A" là bot bình thường; các phần sau nó là Stage 3 (bot giỏi) và cũ hơn, giữ để so sánh. Ngày chạy phần Stage 3: 2026-11-22. Kết quả của `npx tsx scripts/calibrate-shooter.ts --write` (cờ `--write` đã được thay bằng `--out=tệp` từ Stage 4A) chạy từ `apps/api` (PowerShell nuốt cờ qua `npm run`, nên chạy trực tiếp; 2700 ván mỗi pha, 7 tiến trình song song, 87 s).

Lưới: intensity 1-5 x mix quái (runner, brute, swarmer, cả ba) x map (5) x weapon (3) x health (3) x 3 seed; mục tiêu sống sót 60 s.
"Trước cổng" là bot chơi level đúng như compiler dựng; "sau cổng" là level service sẽ trả (compile + cổng), chơi trên seed mà cổng chưa dùng.

## Stage 4D.1: máu căn cứ ở độ khó 4 và 5 (mới nhất)

Sau Stage 4D chỉ còn một chỗ chưa đạt: I5 trước cổng 13,0% (mục tiêu 20-50%). Quyết định (của người review, thay người dùng): chỉ tăng máu căn cứ ở I4 và I5, không đụng I1-I3, không đổi núm nào khác, không đổi schema (máu căn cứ tối đa vốn là 200).

**Bộ số cuối:** `BASE_HP_BY_INTENSITY = [120, 120, 120, 150, 200]` (trước đó `[120 x 5]`); `BASE_HIT_INTERVAL_MS = 800`, `TARGET_SWITCH_MARGIN = 100`, `BOT_LEASH = 170`, `BASE_PLAYER_GAP = 64` như cũ. Giới hạn của núm máu căn cứ là 20..200 (không còn "không tăng theo intensity": máu căn cứ không bao giờ giảm khi độ khó tăng).

`--set=base` đầy đủ (4500 ván mỗi pha, bot bình thường), trước cổng, khớp từng số với phép đo của người review:

| intensity | mục tiêu % | trước 4D.1 | **sau 4D.1** | thua | do người chơi | do căn cứ | tỉ lệ người chơi / căn cứ |
|---|---|---|---|---|---|---|---|
| 1 | ≥ 80 | 97,0 | **97,0** | 27 | 6 | 21 | 22,2% / 77,8% |
| 2 | 65-90 | 89,3 | **89,3** | 96 | 42 | 54 | 43,8% / 56,3% |
| 3 | 50-80 | 65,9 | **65,9** | 307 | 137 | 170 | 44,6% / 55,4% |
| 4 | 35-65 | 37,2 | **46,8** | 479 | 249 | 230 | 52,0% / 48,0% |
| 5 | 20-50 | 13,0 | **29,9** | 631 | 415 | 216 | 65,8% / 34,2% |

Mọi intensity đạt mục tiêu; mọi kiểu thua ≥ 15% ở mọi mức. Ở I3 với `pistol`: 107 ván thua, 57,9% do căn cứ, 42,1% do người chơi (không đổi).

Bot thắng theo súng x intensity (trong ngoặc: tỉ lệ thua do căn cứ):

| súng | I1 | I2 | I3 | I4 | I5 |
|---|---|---|---|---|---|
| pistol | 94% (82%) | 82% (82%) | 41% (58%) | 8% (61%) | 1% (46%) |
| rapid | 98% (100%) | 99% (0%) | 93% (46%) | 89% (35%) | 71% (19%) |
| heavy | 98% (75%) | 90% (50%) | 72% (63%) | 48% (44%) | 18% (39%) |
| shotgun | 97% (50%) | 85% (33%) | 58% (34%) | 44% (30%) | 28% (25%) |
| piercing | 98% (100%) | 91% (56%) | 67% (73%) | 45% (52%) | 32% (28%) |

Sau cổng (bot thắng ở seed cổng chưa dùng):

| intensity | dựng được | bot thắng | màn bị giảm | máu căn cứ trung bình sau cổng | thua do căn cứ / số ván thua |
|---|---|---|---|---|---|
| 1 | 100,0% | 80,7% | 5,9% (53/900) | 121,1 | 168 / 174 |
| 2 | 100,0% | 82,3% | 8,7% (78/900) | 121,7 | 126 / 159 |
| 3 | 100,0% | 69,8% | 42,6% (383/900) | 131,2 | 182 / 272 |
| 4 | 100,0% | 69,4% | 59,7% (537/900) | 170,6 | 154 / 275 |
| 5 | 100,0% | 67,1% | 73,7% (663/900) | 200,0 | 104 / 296 |

Đạt: dựng được 100% (≥ 99%), bot thắng ≥ 67,1% (≥ 60%), `unwinnable_level` 0 trên 4500 (≤ 1%). Tỉ lệ màn bị giảm ở I4 và I5 giảm (67,7 → 59,7% và 88,6 → 73,7%). Cổng: ở I5 máu đã bắt đầu ở 200 (trần) nên cổng chỉ còn cách giảm quái; test mới kiểm tra máu căn cứ đứng ở 200 qua mọi bước và mọi màn đều qua schema. Ở I4 (150) máu căn cứ sau cổng tối đa 200 (không màn nào vượt). Bản đồ bị đơn giản hóa: 0,0% ở cả 5 map.

**Không thoái lui:** `--set=old|new|boss --seeds=1` giống từng ký tự (so bằng `cmp` với kết quả trước Stage 4D); ba bản chụp vàng cũ không đổi. `golden-sim-4d.json` tạo lại (ván I5 đổi): 18 ván, 9 thắng, 9 thua (4 do căn cứ, 5 do người chơi).

**Các lát phụ của Stage 4D** (`--goal=kill:40`, `--boss=crusher`, `--boss=gunner`, mục "Stage 4D" bên dưới) đo với `[120 x 5]` và chưa chạy lại ở 4D.1; I1-I3 không đổi, chỉ I4-I5 của chúng thay đổi.

**Điều tra ngắn: vì sao `--goal=kill:40` có bot thắng sau cổng ở I1-I2 chỉ 59,5% / 55,9% và `unwinnable` 0,6%.** Đo lại (225 ván mỗi ô, bot bình thường, `kill:40`, base `defend`, I1 / I2): có hai ô yếu, cả hai là chuyện mix quái trong màn có căn cứ, không phải màn bất khả thi nói chung.
- Hỗn hợp chỉ có `brute`: trước cổng thắng 3% / 3% (215 trên 225 ván thua do căn cứ bị phá, bot mới hạ trung bình 19 trên 40 quái); sau cổng thắng 30% / 20%, và 18/225 / 9/225 ván bị từ chối `unwinnable_level`: đó là toàn bộ 0,6% của lát này. Brute nhiều máu đi thẳng vào căn cứ và đánh nó liên tục, hạ đủ 40 con bằng súng bình thường mất lâu hơn thời gian căn cứ chịu được.
- `all4` ở I2: trước cổng 40% (91 thua do căn cứ, 44 do người chơi), sau cổng 43%, cổng không từ chối ván nào; còn `all4` ở I1 thắng 83% trước cổng và 70% sau cổng. Chưa rõ vì sao I2 thấp hơn I1 nhiều (có thể quái bắn xa đánh căn cứ từ xa); chưa điều tra.
- `runner` và `mixed` ổn (trước cổng 81-96%, sau cổng 65-94%). Chưa phân biệt được bao nhiêu phần do bot (dây xích quanh căn cứ) và bao nhiêu do mục tiêu "hạ 40 con" khó trong màn có căn cứ: cần đo bot giỏi hoặc `BOT_LEASH` khác trên hai ô này, chưa làm.

## Stage 4D: căn cứ cần bảo vệ (các bảng dưới đây là TRƯỚC Stage 4D.1, máu căn cứ 120 cả năm)

Căn cứ là một tòa nhà vuông 56 px ở giữa sân (máu 5..200). Quái có thể nhắm vào nó (đi thẳng tới, chạm thì gây sát thương mỗi 0,5 giây theo tổng quái đang chạm, quái bắn xa đứng giữ tầm và bắn vào tâm căn cứ). Thua khi người chơi chết HOẶC căn cứ hết máu (thua được xét trước thắng). Bot bảo vệ căn cứ (nhắm quái gần căn cứ nhất, dây xích 170 px). Số liệu dưới đây do `npx tsx scripts/calibrate-shooter.ts --set=base` (từ `apps/api`) in ra; bot "bình thường" là thước đo.

**Lưới `--set=base`**: intensity 1-5 x súng (5) x map (5) x máu (3) x hỗn hợp quái (`mixed`, `runner`, `brute`, `all4`) x 3 seed = 4500 ván mỗi pha, `survive 60`, `base: 'defend'`. Lát phụ: `--goal=kill:40`, `--boss=crusher`, `--boss=gunner`. Mỗi bảng tách "thua do người chơi chết" và "thua do căn cứ bị phá".

### Các bộ số đã thử (trước cổng, bot bình thường; bot thắng % ở I1 / I2 / I3 / I4 / I5)

Mục tiêu: I1 ≥ 80, I2 65-90, I3 50-80, I4 35-65, I5 20-50. Núm và giới hạn: `BASE_HP_BY_INTENSITY` 20..120 (không tăng theo intensity; giới hạn này được nới thành 20..200 ở Stage 4D.1), `BASE_HIT_INTERVAL_MS` 300..800, `TARGET_SWITCH_MARGIN` 30..100, `BOT_LEASH` 120..220, `BASE_PLAYER_GAP` 56..90.

Vòng thăm dò (1 seed, 1500 ván, chỉ trước cổng):

| máu căn cứ | hit ms | margin | leash | gap | I1 | I2 | I3 | I4 | I5 |
|---|---|---|---|---|---|---|---|---|---|
| 60/50/40/32/26 (bộ đầu) | 500 | 60 | 170 | 64 | 67,7 | 35,7 | 7,7 | 2,7 | 0,0 |
| 120/110/100/90/80 | 500 | 60 | 170 | 64 | 88,7 | 76,3 | 40,7 | 13,0 | 3,3 |
| 120 cả năm | 500 | 60 | 170 | 64 | 88,7 | 82,3 | 46,7 | 22,3 | 7,0 |
| 120 cả năm | 800 | 60 | 170 | 64 | 96,7 | 93,0 | 67,0 | 42,3 | 16,3 |
| 120 cả năm | 800 | 60 | 220 | 64 | 96,7 | 93,0 | 67,0 | 42,3 | 16,3 |
| 120 cả năm | 800 | 60 | 120 | 64 | 96,7 | 93,0 | 68,0 | 42,0 | 14,3 |
| 120 cả năm | 800 | 100 | 170 | 64 | 98,0 | 92,3 | 75,3 | 38,7 | 15,7 |
| 120 cả năm | 800 | 30 | 170 | 64 | 98,7 | 87,3 | 59,0 | 46,0 | 11,7 |
| 120 cả năm | 800 | 60 | 170 | 56 | 97,7 | 92,0 | 62,7 | 39,3 | 13,3 |
| 120 cả năm | 800 | 60 | 170 | 90 | 97,7 | 92,7 | 63,7 | 39,7 | 15,7 |

Quét có 3 seed (4500 ván, leash 220, máu 120 cả năm):

| hit ms | margin | gap | I1 | I2 | I3 | I4 | I5 |
|---|---|---|---|---|---|---|---|
| 700 | 60 | 64 | 94,1 | 85,7 | 54,3 | 31,6 | 9,7 |
| 700 | 60 | 90 | 94,9 | 81,3 | 53,4 | 28,9 | 7,4 |
| 700 | 80 | 64 | 96,4 | 90,0 | 55,1 | 29,3 | 10,8 |
| 700 | 80 | 90 | 96,9 | 87,7 | 57,6 | 30,3 | 9,7 |
| 700 | 100 | 64 | 95,3 | 86,4 | 62,1 | 32,0 | 10,4 |
| 700 | 100 | 90 | 96,4 | 87,0 | 59,9 | 30,8 | 12,4 |
| 800 | 60 | 64 | 97,0 | 88,8 | 62,4 | 36,6 | 12,8 |
| 800 | 60 | 90 | 97,3 | 87,9 | 60,3 | 33,0 | 11,4 |
| 800 | 80 | 64 | 97,4 | 91,0 | 60,3 | 34,0 | 11,3 |
| 800 | 80 | 90 | 97,9 | 91,6 | 63,2 | 33,9 | 11,0 |
| **800** | **100** | **64** | **97,0** | **89,3** | **65,8** | **37,3** | **13,0** |
| 800 | 100 | 90 | 97,8 | 90,0 | 64,4 | 34,3 | 13,8 |

Thử thêm quanh bộ tốt nhất (hit 800, margin 100, gap 64): leash 120 / 170 / 220 cho I5 13,1 / 13,0 / 13,0 (gần như không đổi); máu 120/120/120/100/90 cho 97,0 / 89,3 / 65,8 / 28,9 / 8,2; máu 100 cả năm cho 94,7 / 84,0 / 58,8 / 28,9 / 9,9.

### Bộ số cuối

`BASE_HP_BY_INTENSITY = [120, 120, 120, 120, 120]`, `BASE_HIT_INTERVAL_MS = 800`, `TARGET_SWITCH_MARGIN = 100`, `BOT_LEASH = 170`, `BASE_PLAYER_GAP = 64`. (Bộ số của Stage 4D, đã được Stage 4D.1 thay: `[120, 120, 120, 150, 200]`.) Mọi núm nằm trong giới hạn; máu căn cứ phải để ở mức trần 120 vì ngay cả mức đó, I5 vẫn dưới mục tiêu.

**Chưa đạt: I5 trước cổng (13,0% so với mục tiêu 20-50%).** Giữ nguyên giới hạn các núm (không nới). Lý do: ở I4-I5 nhịp quái (`INTENSITY_RATE`, không được chỉnh ở Stage này) quá dày so với một căn cứ 120 máu; đổi `BOT_LEASH`, `TARGET_SWITCH_MARGIN`, `BASE_PLAYER_GAP` chỉ dịch I5 trong khoảng 7 đến 14%. Cổng vẫn đưa I5 về mức chơi được (bảng sau cổng bên dưới: 65,7% thắng). Đề xuất (cần người quyết định, chưa làm): nới trần máu căn cứ lên 160-200 (schema cho phép tới 200), hoặc hạ `INTENSITY_RATE` ở I5 chỉ cho màn có căn cứ.

### Trước cổng (final, 4500 ván)

| intensity | mục tiêu % | bot thắng % | thua | do người chơi chết | do căn cứ bị phá | tỉ lệ người chơi | tỉ lệ căn cứ |
|---|---|---|---|---|---|---|---|
| 1 | ≥ 80 | 97,0 | 27 | 6 | 21 | 22,2% | 77,8% |
| 2 | 65-90 | 89,3 | 96 | 42 | 54 | 43,8% | 56,3% |
| 3 | 50-80 | 65,9 | 307 | 137 | 170 | 44,6% | 55,4% |
| 4 | 35-65 | 37,2 | 565 | 210 | 355 | 37,2% | 62,8% |
| 5 | 20-50 | **13,0** | 783 | 296 | 487 | 37,8% | 62,2% |

Hai kiểu thua cùng có ý nghĩa: ở intensity 3 với `pistol`, trong 107 ván thua, 57,9% do căn cứ và 42,1% do người chơi chết (cả hai ≥ 15%). Bot thắng theo súng x intensity (trong ngoặc: tỉ lệ thua do căn cứ):

| súng | I1 | I2 | I3 | I4 | I5 |
|---|---|---|---|---|---|
| pistol | 94% (82%) | 82% (82%) | 41% (58%) | 1% (70%) | 0% (66%) |
| rapid | 98% (100%) | 99% (0%) | 93% (46%) | 83% (61%) | 49% (60%) |
| heavy | 98% (75%) | 90% (50%) | 72% (63%) | 34% (59%) | 4% (66%) |
| shotgun | 97% (50%) | 85% (33%) | 58% (34%) | 37% (51%) | 1% (60%) |
| piercing | 98% (100%) | 91% (56%) | 67% (73%) | 31% (66%) | 11% (56%) |

`pistol` từ I4 trở lên gần như không thắng được trước cổng (cổng giảm mật độ và tăng máu căn cứ); `rapid` thắng dễ nhất.

### Sau cổng (final, 4500 ván, bot thắng ở seed cổng chưa dùng)

| intensity | dựng được | bot thắng | màn bị giảm (có thông báo) | máu căn cứ trung bình sau cổng | thua do căn cứ trong số ván thua |
|---|---|---|---|---|---|
| 1 | 100,0% | 80,7% | 5,9% (53/900) | 121,1 | 168 / 174 |
| 2 | 100,0% | 82,3% | 8,7% (78/900) | 121,7 | 126 / 159 |
| 3 | 100,0% | 69,8% | 42,6% (383/900) | 131,2 | 182 / 272 |
| 4 | 100,0% | 67,7% | 67,7% (609/900) | 142,3 | 190 / 291 |
| 5 | 100,0% | 65,7% | 88,6% (797/900) | 156,7 | 156 / 309 |

Đạt: dựng được 100% (≥ 99%), bot thắng ≥ 65,7% (≥ 60%), `unwinnable_level` 0 trên 4500 (0%, ≤ 1%). Cổng làm màn DỄ HƠN theo hai cách mỗi bước: quái thường ×0,8 và máu căn cứ ×1,15 (làm tròn lên, trần 200). Tỉ lệ màn phải giảm mật độ tăng theo intensity: 5,9% / 8,7% / 42,6% / 67,7% / 88,6%.

**Tỉ lệ bản đồ bị "đơn giản hóa thành đấu trường trống" vì luật căn cứ, theo map** (không map nào vượt 25%): open-arena 0,0%, pillars 0,0%, cross-corridors 0,0%, rooms 0,0%, ring 0,0% (0 trên 900 mỗi map). (Căn cứ ở giữa sân, người chơi cách 64 px; mọi map vẫn có đường nối từ các điểm xuất hiện tới căn cứ và tới người chơi.)

### Các lát phụ (cùng bộ số cuối)

| lát | dựng được I1..I5 | bot thắng sau cổng I1..I5 | màn bị giảm I1..I5 | `unwinnable` | tỉ lệ thua do căn cứ, I3 pistol |
|---|---|---|---|---|---|
| `--goal=kill:40` | 98,0 / 99,0 / 100 / 100 / 100 | 59,5 / 55,9 / 62,6 / 63,2 / 57,7 | 17,4 / 28,3 / 43,1 / 53,0 / 69,0 % | 0,60% (27/4500) | 75,0% |
| `--boss=crusher` | 100 / 100 / 100 / 99,9 / 100 | 79,7 / 73,0 / 68,7 / 66,7 / 64,0 | 11,9 / 12,4 / 22,4 / 41,9 / 63,3 % | 0,02% (1/4500) | 50,6% |
| `--boss=gunner` | 100 / 100 / 100 / 99,9 / 99,9 | 81,1 / 75,8 / 73,6 / 66,3 / 69,2 | 7,1 / 15,4 / 24,7 / 44,3 / 66,7 % | 0,04% (2/4500) | 43,6% |

Trước cổng, `--boss=crusher`: bot thắng 84,9 / 83,7 / 73,0 / 61,1 / 47,9%; `--boss=gunner`: 93,1 / 85,8 / 74,2 / 56,7 / 43,3%; `--goal=kill:40`: 64,0 / 55,6 / 49,6 / 47,8 / 26,9%. Với `kill:40` bot thắng ít hơn `survive 60` ở I1-I2 và tỉ lệ thắng sau cổng ở I1-I2 (59,5% và 55,9%) thấp hơn 60% một chút (nguyên nhân chưa được điều tra). Đây là lát phụ, không nằm trong tiêu chí đạt/không đạt của prompt.

### Không thoái lui

`--set=old --seeds=1`, `--set=new --seeds=1`, `--set=boss --seeds=1` được chạy trước và sau Stage 4D và cho kết quả GIỐNG TỪNG KÝ TỰ (so bằng `cmp`). Ba bản chụp vàng `golden-sim.json`, `golden-sim-4b.json`, `golden-sim-4c.json` không đổi một byte (SHA-256 đúng như ghi ở đầu Stage này). Bản chụp vàng mới `golden-sim-4d.json` có 18 ván (12 dựng từ brief + 6 màn tay `base-siege`, `base-boss`, `base-fall`, bot giỏi và đứng yên; 8 thắng, 10 thua: 5 do căn cứ, 5 do người chơi).

### Thời gian dựng (40 lần mỗi ca, qua worker thật, `node scripts/measure-compile-time.mjs 40`)

| ca | median | p95 | max | chạm giới hạn 8 s |
|---|---|---|---|---|
| survive 60 s | 0,35 s | 0,56 s | 0,59 s | 0 |
| survive 180 s | 0,47 s | 0,71 s | 0,98 s | 0 |
| worst boss (kill 200, all4, shotgun, I5, gunner) | 0,85 s | 1,41 s | 2,10 s | 0 |
| **worst căn cứ (I5, all4, shotgun, máu yếu, gunner, `base: defend`)** | 0,82 s | **1,02 s** | 1,24 s | 0 |
| worst 4B | 1,63 s | 2,32 s | 2,51 s | 0 |
| worst brutes | 1,37 s | 1,90 s | 2,02 s | 0 |

Ca xấu nhất của căn cứ p95 1,02 s (< 5 s), không lần nào chạm giới hạn 8 s. (22 trên 40 dựng được, 18 bị từ chối `unwinnable_level` vì máu yếu x kill 200: đúng như các ca xấu khác.)

### Groq thật (6 prompt, mỗi prompt một lần, `shooter-live.smoke.ts --set=stage4d`)

Cả sáu dựng được. 1) `base: defend`, không thông báo căn cứ, `healthDrops: none`. 2) `defend` + boss crusher, mục tiêu "Bảo vệ căn cứ: Hạ boss", thông báo "Màn có boss", không hồi máu, máu căn cứ 120 (không bị giảm). 3) `defend`, spitter, `healthDrops: some`. 4) `defend`; thông báo về tháp là câu do model viết ("Chức năng xây tháp pháo không được hỗ trợ trong engine này"), câu chuẩn của engine không thêm vì trùng ý. Model còn đặt `healthDrops: some` dù không được xin: chốt chặn không gỡ vì từ "rồi" ("rồi bảo vệ nó") bị đọc như "rơi" khi bỏ dấu; đã chủ ý để chốt chặn rộng (giữ nhầm tốt hơn từ chối nhầm). 5) `base: none`, không thông báo căn cứ. 6) một căn cứ, thông báo "Hai căn cứ không được hỗ trợ" (câu của model) và thông báo hộ tống `escort`.

## Stage 4C.1: boss không kẹt, màn boss tập trung vào boss

Hai lỗi của Stage 4C đã được đo (không phải phỏng đoán) rồi sửa. `maps.ts`, `CASUAL`, `INTENSITY_RATE`, `gate.ts`, số của quái, súng và boss (máu, chu kỳ, tốc độ) KHÔNG đổi. Số liệu từ `npx tsx scripts/calibrate-shooter.ts --set=boss` (cùng lưới 6750 ván của Stage 4C, brief `survive 60`) và từ `npx tsx scripts/measure-boss-reach.ts` (chạy từ `apps/api`).

### Lỗi 1: boss crusher bị kẹt

Bài đo: người chơi đứng yên, không chết được; mỗi cặp (boss × map) 30 seed (seed = số thứ tự × 7919), intensity 1, brief `survive 60`, quái `runner`, súng `pistol`, máu `sturdy`, không hồi máu. Boss phải tới trong `max(140, holdRange + 40)` px (crusher 140, gunner 340) trong 120 giây mô phỏng. Script `measure-boss-reach.ts`, và thành test lâu dài `shooter-boss-reach.test.ts`.

| trước khi sửa (cuối Stage 4C) | tới được | kẹt |
|---|---|---|
| crusher / pillars | 29/30 | seed 174218 (gần nhất 167 px) |
| crusher / rooms | 29/30 | seed 221732 (380 px) |
| crusher / ring | 29/30 | seed 15838 (361 px) |
| mọi cặp khác (gunner cả 5 map; crusher open-arena, cross-corridors) | 30/30 | |

**Nguyên nhân (xác nhận bằng cách theo dõi từng bước):** đường dẫn (flow field) của mô phỏng chỉ nới vật cản thêm 12 px cho MỌI quái, trong khi thân crusher rộng 68 px (bán kính 34). Boss được dẫn dọc sát tường và qua khe mà thân nó không lọt, rồi đứng im tới hết ván (ví dụ ở `rooms` 221732: kẹt ở góc tường tại (98, 309), dù khe giữa hai bức tường rộng tới 142 px: đường đi ngắn nhất ôm sát góc, cách tường chỉ 22 px).

**Thử trước: chỉ đổi luật chọn bố cục ở `compile.ts`** (mọi khe giữa vật cản và với mép sân đóng hoặc ≥ 2 × bán kính + 8 px, và đường đi có chỗ cho thân boss). Chưa đủ: bản đồ bị đơn giản hóa thành đấu trường trống (crusher: pillars 20%, cross-corridors 17%, ring 3%; gunner: cross-corridors 3%) mà vẫn kẹt 2/300 (đường đi vẫn ôm sát góc). Bỏ cách này.

**Cách sửa chọn:** (1) trong mô phỏng, màn có boss mang một lưới đi riêng cho boss (`bossBlockedCells`: vật cản được nới thêm bán kính boss + 4 px, và ô nằm quá sát mép sân so với thân boss bị chặn) cùng flow field riêng (`state.bossBlocked`, `state.bossFlow`; chỉ có ở màn boss, màn khác không có hai trường này); (2) `compile.ts` chỉ dùng bố cục mà MỌI điểm xuất hiện (boss ra ở một trong số đó, nên chỗ ra nào cũng phải đi tới được người chơi) nối tới người chơi trên chính lưới đó (`usableLayout(obstacles, bossRadius)`; bán kính lấy từ `ENEMY_TYPES`). Bố cục không đạt thì thử biến thể kế tiếp, hết biến thể thì đấu trường trống kèm thông báo như cũ. Không đụng `maps.ts`.

| sau khi sửa | tới được |
|---|---|
| 30 seed × 5 map × 2 boss | **300/300** |
| 200 seed × 5 map × 2 boss (kiểm tra thêm) | **2000/2000** |

Tỉ lệ bản đồ bị đơn giản hóa thành đấu trường trống vì luật mới: **0%** ở mọi map và cả hai boss (0/200 mỗi cặp). Luật bố cục không phải từ chối một bố cục nào trong 2000 màn: lưới riêng của boss mới là thứ sửa lỗi, luật bố cục là lưới an toàn. Bỏ qua kiểm tra khe rộng (cách thử trước) nên không cần dùng tới cách "nới" ở Phần 1.3.

**Giới hạn còn lại (đã đo):** kiểm tra thêm với người chơi đứng ở 8 chỗ khác ngoài điểm xuất phát (2772 ván): 2769 tới được. 3 ván không tới: người chơi đứng ở chỗ lưới của boss không nối tới (ví dụ một lối 68 px giữa hai bức tường: ôm vừa khít thân crusher nên bị coi là chắn). Người chơi có thể trốn ở một chỗ như vậy và đứng ngoài tầm với của boss. Không sửa trong lần này (cần đổi cách boss tìm đường khi không có đường, hoặc đổi `maps.ts`).

### Lỗi 2: màn boss quá khó ở intensity 3–5

Nhịp quái thường của màn boss (`BOSS_TIMING` trong `waves.ts`): thêm `beforePace` (nhân vào nhịp TRƯỚC khi boss ra), đổi `afterPace` và `afterSeconds`. Chỉ đụng lịch màn boss; lịch của brief không boss giống từng bit. Bot bình thường, TRƯỚC cổng, lưới 6750 ván:

| bộ số | I1 | I2 | I3 | I4 | I5 |
|---|---|---|---|---|---|
| Stage 4C (before 1, after 30 s × 0,4; boss đi trên lưới cũ) | 89,6 | 68,4 | 29,2 | 20,2 | 11,0 |
| boss đi trên lưới mới, vẫn nhịp cũ (before 1, after 30 s × 0,4) | 87,6 | 67,2 | 30,4 | 20,0 | 11,1 |
| **cuối: before 0,7, after 20 s × 0,25** (đúng khởi điểm của prompt) | **94,6** | **83,5** | **67,9** | **44,4** | **27,7** |
| mục tiêu | ≥ 80 | 65–90 | 50–80 | 35–65 | 20–50 |

Đạt ở mọi intensity ngay bộ số khởi điểm, nên không thử thêm bộ nào. `atShare` giữ 0,7. Dòng thứ hai cho thấy việc sửa lỗi kẹt không đổi độ khó; toàn bộ cải thiện là do nhịp quái. Theo boss: crusher 97,5 / 82,1 / 67,1 / 43,6 / 27,0; gunner 91,7 / 84,9 / 68,7 / 45,3 / 28,4.

**Sau cổng** (6750 ván, tối đa 6 bước giảm):

| intensity | dựng được | bot thắng trên seed chưa dùng | ván bị giảm mật độ (trên 1350): trước → sau |
|---|---|---|---|
| 1 | 100,0% | 97,3% | 80 (5,9%) → 31 (2,3%) |
| 2 | 100,0% | 86,3% | 477 (35,3%) → 130 (9,6%) |
| 3 | 100,0% | 76,7% | 939 (69,6%) → 444 (32,9%) |
| 4 | 100,0% | 71,6% | 1072 (79,4%) → 775 (57,4%) |
| 5 | 100,0% | 69,8% | 1218 (90,2%) → 993 (73,6%) |

("Trước" là Stage 4C.) Đạt: dựng được 100% (0 trên 6750 bị từ chối, ≤ 1%), bot thắng ≥ 60% (thấp nhất 69,8%). Số màn boss phải giảm mật độ (người dùng thấy thông báo "độ khó được điều chỉnh") giảm rõ ở intensity 3–5 (từ 70/79/90% xuống 33/57/74%) mà vẫn còn nhiều ở intensity 5: ở mức đó màn boss vẫn khó đối với bot bình thường, bộ lọc xử lý phần còn lại. `bossHp` trung bình sau giảm: crusher 16,0 / 17,8 / 19,0 / 19,2 / 19,4, gunner 11,9 / 13,8 / 14,2 / 15,0 / 14,8 (mức 1…5).

**Thời gian trận đánh boss** (giây từ lúc boss ra tới lúc bị hạ, ván bot bình thường thắng trước cổng; mọi intensity / intensity 3):

| boss | pistol | rapid | heavy | shotgun | piercing |
|---|---|---|---|---|---|
| crusher | 13,4 / 16,8 | 9,4 / 9,0 | 11,9 / 13,5 | 13,0 / 14,3 | 13,6 / 13,3 |
| gunner | 15,2 / 18,6 | 9,7 / 9,7 | 12,6 / 13,7 | 30,5 / 35,1 | 14,2 / 14,7 |

Pistol ở intensity 3: 16,8 s và 18,6 s (trong 10–60 s); không súng nào hạ boss trung bình dưới 9 s (≥ 6 s).

**Không thoái lui:** `--set=old` và `--set=new` chạy lại SAU mọi thay đổi: giống HỆT từng ký tự các bảng Stage 4A và 4B.

**Thời gian dựng + cổng qua worker** (bản build, `node scripts/measure-compile-time.mjs 40`): survive 60 s median 0,45 / p95 0,65 / max 0,85 s; survive 180 s 0,55 / 0,79 / 1,19 s; ca xấu nhất boss (kill 200, all4, shotgun, mức 5, máu yếu, gunner; 7 dựng được, 33 bị từ chối) 0,87 / **1,37** / 1,54 s (giới hạn p95 < 5 s); ca xấu nhất 4B 2,01 / 2,82 / 2,95 s; ca xấu nhất cũ 1,58 / 2,27 / 2,51 s.


## Stage 4C: boss cuối, hai loại

Bot bình thường (`CASUAL`, không đổi) là thước đo; `INTENSITY_RATE`, `CASUAL`, `maps.ts` và mọi số của quái và súng đã có không đổi. Số liệu từ `npx tsx scripts/calibrate-shooter.ts --set=boss` (chạy từ `apps/api`): lưới intensity 1–5 × 2 boss × 5 súng × 5 map × 3 mức máu × 3 hỗn hợp quái thường (`mixed`, `runner`, `all4`) × 3 seed = 6750 ván mỗi pha, brief `survive 60`. Script có thêm `--tune=` cho boss: `crusher.hp`, `gunner.hp`, `crusher.cycle`, `crusher.telegraph`, `crusher.rush`, `gunner.fan`, `gunner.ring`, `gunner.fanspeed`, `gunner.ringspeed`, `boss.at`, `bossmult.1`…`bossmult.5` (và `boss.after`, `boss.afterpace` chỉ để đo đề xuất).

### 1. Không thoái lui: `--set=old` và `--set=new` giống HỆT bảng cũ

Chạy SAU khi hoàn tất mọi thay đổi Stage 4C: `--set=old` so với bảng Stage 4A (10 dòng gốc: 5 dòng intensity, 4 dòng vũ khí/máu/map/quái, dòng "0 trên 2700 không dựng được") và `--set=new` so với bảng Stage 4B (21 dòng gồm cả bảng theo súng và theo hỗn hợp sau cổng): **giống nhau từng ký tự** (so bằng máy). Thêm bằng chứng độc lập: một brief không boss dựng ra đúng 30 màn của file vàng cũ (`golden-sim.json`, test `shooter-boss-brief`), và 525 lịch quái không boss vẫn có digest `a4aa7b68`.

### 2. Số cuối cùng và những số đã thử

| thứ | khởi điểm (prompt) | cuối cùng | giới hạn cho phép |
|---|---|---|---|
| crusher: máu gốc | 70 | **40** | 40 … 110 |
| gunner: máu gốc | 50 | **30** | 30 … 90 |
| `BOSS_HP_BY_INTENSITY` | 0,6 / 0,8 / 1 / 1,2 / 1,4 | **0,4 / 0,45 / 0,5 / 0,55 / 0,6** | 0,4 … 1,8, tăng dần |
| crusher: chu kỳ lao | 4,5 s | **6 s** | 3,5 … 6 s |
| gunner: nhịp quạt 3 viên | 2,0 s | **2,6 s** | 1,5 … 2,6 s |
| gunner: nhịp vòng 12 viên | 5,0 s | **7 s** | 4 … 7 s |
| tốc độ đạn của boss (quạt / vòng) | 200 / 150 | **120 / 120** | 120 … 220 |
| boss xuất hiện lúc | 70% | 70% (làm tròn 5 s) | 65% … 80% |

Từ đó `bossHp` của màn là: crusher 16 / 18 / 20 / 22 / 24, gunner 12 / 14 / 15 / 17 / 18 (intensity 1…5). Mọi núm đều nằm ở MÉP dễ nhất của giới hạn.

Thắng của bot bình thường trước cổng, intensity 1…5 (lưới boss, 6750 ván):

| bộ số | cả lưới | crusher | gunner |
|---|---|---|---|
| khởi điểm | 51,9 / 24,3 / 8,3 / 4,1 / 1,5 | 46,2 / 24,1 / 7,7 / 3,4 / 1,6 | 57,6 / 24,4 / 8,9 / 4,9 / 1,3 |
| máu nhỏ nhất, hệ số 0,4–0,6 | 86,2 / 62,7 / 26,4 / 18,5 / 10,3 | 90,8 / 68,6 / 27,4 / 20,7 / 12,4 | 81,6 / 56,9 / 25,5 / 16,3 / 8,1 |
| **+ chu kỳ chậm nhất, đạn chậm nhất (cuối)** | **89,6 / 68,4 / 29,2 / 20,2 / 11,0** | 90,1 / 69,8 / 28,7 / 20,3 / 11,4 | 89,2 / 67,1 / 29,6 / 20,1 / 10,5 |
| khoảng yêu cầu | ≥ 80 / 65–90 / 50–80 / 35–65 / 20–50 | | |

(Đặt boss xuất hiện lúc 65% thay vì 70% cho đúng số cũ: 60 s × 0,65 = 39 s và 60 × 0,7 = 42 s đều làm tròn về 40 s.)

**Không đạt trong giới hạn cho phép (báo cáo theo đúng yêu cầu):** intensity 1 và 2 đạt (89,6 và 68,4%); intensity 3, 4 và 5 **không đạt** (29,2 / 20,2 / 11,0% so với 50–80 / 35–65 / 20–50). Nguyên nhân không phải boss: với boss chỉ còn 10 máu (dưới giới hạn cho phép) cả lưới là 91,9 / 76,7 / 35,6 / 24,7 / 16,1%. Phần quái thường cùng 30 giây sau boss mới là gánh nặng với bot bình thường (bot này chỉ thắng 57,8 / 43,3 / 24,3% ở intensity 3–5 ngay cả khi không có boss, trung bình mọi hỗn hợp; ba hỗn hợp của lưới boss khó hơn trung bình). Các đề xuất đã đo (không áp dụng, vì ngoài giới hạn cho phép):

| thay đổi | I1 | I2 | I3 | I4 | I5 |
|---|---|---|---|---|---|
| bộ số cuối | 89,6 | 68,4 | 29,2 | 20,2 | 11,0 |
| giai đoạn sau boss 15 s thay vì 30 s | 93,9 | 68,4 | 33,1 | 23,5 | 12,1 |
| nhịp quái sau boss 0,2 thay vì 0,4 | 89,6 | 67,6 | 35,3 | 23,0 | 13,4 |
| cả hai (15 s, nhịp 0,2) | 93,9 | 74,1 | 37,5 | 23,8 | 14,7 |
| không có quái sau boss (hạ boss là hết màn) | 97,1 | 81,8 | 44,4 | 27,8 | 19,2 |
| boss 10 máu, không có quái sau boss | 97,9 | 87,6 | 51,9 | 31,9 | 22,9 |

Ngay cả khi bỏ hẳn quái sau boss và để boss 10 máu, intensity 4 vẫn dưới 35%. Muốn đạt các khoảng ở intensity 3–5 cần giảm nhịp quái thường TRƯỚC boss ở màn boss (ví dụ ×0,7), hoặc hạ yêu cầu xuống cho khớp bot (3: 30–45, 4: 20–35, 5: 10–25). Vì cổng giảm mật độ quái thường và máu boss cho tới khi bot thắng được, người dùng vẫn nhận màn thắng được (bảng sau cổng bên dưới).

### 3. Bảng sau cổng (bot bình thường, survive 60 s, 6750 ván, tối đa 6 bước giảm)

| intensity | dựng được | bot thắng trên seed chưa dùng | ván bị giảm (trên 1350) |
|---|---|---|---|
| 1 | 100,0% | 91,9% | 80 |
| 2 | 100,0% | 73,8% | 477 |
| 3 | 99,9% | 70,2% | 939 |
| 4 | 99,9% | 65,4% | 1072 |
| 5 | 99,9% | 65,9% | 1218 |

**Đạt:** dựng được ≥ 99% ở mọi mức (thấp nhất 99,9%), bot thắng ≥ 60% (thấp nhất 65,4%), `unwinnable_level` 4 trên 6750 ván (0,06%, ≤ 1%). Theo boss (dựng được / bot thắng / ván bị giảm trên 675 / `bossHp` trung bình sau giảm): crusher I1 100% / 92,9% / 35 / 15,9; I2 100 / 73,9 / 247 / 16,8; I3 100 / 70,1 / 479 / 17,0; I4 100 / 64,3 / 533 / 17,3; I5 99,9 / 65,7 / 609 / 16,9. gunner I1 100 / 90,8 / 45 / 11,9; I2 100 / 73,6 / 230 / 13,0; I3 99,9 / 70,3 / 460 / 12,5; I4 99,7 / 66,4 / 539 / 13,3; I5 100 / 66,1 / 609 / 12,8. Mỗi bước giảm hạ `bossHp` ×0,9 (làm tròn xuống, sàn 40% giá trị gốc và 10) và quái thường ×0,8; đợt boss không bao giờ bị bỏ hay giảm số lượng.

### 4. Độ dài trận đấu với boss

Từ lúc boss xuất hiện tới lúc bị hạ, ván bot bình thường thắng trước cổng, trung bình (mọi intensity / intensity 3), giây:

| boss | pistol | rapid | heavy | shotgun | piercing |
|---|---|---|---|---|---|
| crusher | 13,4 / 16,0 | 10,2 / 11,2 | 11,4 / 14,4 | 13,4 / 17,3 | 12,5 / 12,2 |
| gunner | 15,0 / 18,0 | 11,0 / 12,0 | 11,4 / 13,5 | 27,0 / 26,7 | 13,2 / 12,9 |

Pistol ở intensity 3: 16,0 s (crusher) và 18,0 s (gunner), trong khoảng 10–60 s. Shotgun và súng xuyên không làm boss chết dưới 6 giây trung bình (nhỏ nhất ở từng ván lẻ là 4–9 s, vì cổng còn giảm máu boss).

### 5. Thời gian dựng + cổng qua worker (bản build, `node scripts/measure-compile-time.mjs 40`)

| trường hợp (40 lần, nhiều seed / map / intensity) | median | p95 | lớn nhất |
|---|---|---|---|
| survive 60 s | 0,33 s | 0,57 s | 0,61 s |
| survive 180 s | 0,43 s | 0,68 s | 0,92 s |
| xấu nhất boss: kill 200, all4, shotgun, intensity 5, máu yếu, boss gunner (9 dựng được, 31 bị từ chối) | 0,70 s | 0,90 s | 0,93 s |
| xấu nhất Stage 4B: kill 200, all4, shotgun, intensity 5, máu yếu (cả 40 bị từ chối) | 1,66 s | 2,20 s | 2,41 s |
| xấu nhất cũ: kill 200, toàn quái trâu, intensity 5, máu yếu | 1,33 s | 1,81 s | 1,91 s |

Mọi p95 dưới 5 s; giới hạn 8 s của worker không đổi và không lần nào hết giờ. (Ca boss xấu nhất bị từ chối sớm vì một màn boss không còn kéo dài theo mục tiêu `kill`.)

### 6. Cách làm và giới hạn đã biết

- Màn có boss luôn thắng bằng cách hạ boss; `goal` của brief chỉ quyết định thời lượng giai đoạn trước boss (70%, làm tròn 5 s, tối thiểu 20 s; với `kill N` là 70% của thời lượng `killHorizon`). Mục tiêu `kill N` không được hạ khi bị từ chối (hạ N cũng chẳng đổi gì): cổng chỉ giảm quái và máu boss.
- Boss ra ở điểm xuất hiện xa người chơi nhất và không dùng số ngẫu nhiên của game; boss không bị quái thường đẩy (quái thường bị đẩy ra khỏi boss); bán kính lớn nhất của màn được lưu theo màn (20, hoặc bán kính boss), nên màn cũ không đổi bit nào.
- Bot bình thường vẫn bỏ qua vật phẩm hồi máu, né boss từ xa hơn một quái thường (cộng bán kính boss) và nhắm boss khi boss nằm trong 85% tầm súng.
- Một cú lao chạm tường thì dừng; các khe giữa vật cản của `maps.ts` rộng khoảng 60 px, hẹp hơn thân boss (60–68 px), nên boss có thể bị kẹt ở lối hẹp (chưa đo).
- `golden-sim-4c.json` (18 ván, 547 hash) được sinh từ mã mới nên chỉ chứng minh "không đổi về sau"; tính đúng do `shooter-boss.test.ts` chịu trách nhiệm.

## Stage 4B: hai súng mới, quái bắn xa, hồi máu

Bot bình thường (`CASUAL`, không đổi) là thước đo. `INTENSITY_RATE`, `CASUAL` và các số của quái và súng cũ không đổi. Số liệu từ `npx tsx scripts/calibrate-shooter.ts` (chạy từ `apps/api`); script có thêm `--set=old|new|all` (old = lưới Stage 4A, new = mọi ván có súng hoặc hỗn hợp quái mới), hai hỗn hợp mới (`spitter`: một mình; `all4`: runner 3, brute 2, swarmer 3, spitter 2), hai súng mới, các bảng cắt lát, và `--tune=spitter.weight=4,shotgun.cooldown=1000,...` để thử số khác trong một lần chạy mà không sửa file. Hồi máu giữ `none` trong lưới đo (bot bỏ qua vật phẩm).

### 1. Không thoái lui: `--set=old` giống HỆT bảng Stage 4A

Chạy `--set=old` (3 súng cũ × 4 hỗn hợp cũ, 2700 ván mỗi pha, bot bình thường) SAU khi hoàn tất mọi thay đổi Stage 4B, rồi so từng dòng với bảng Stage 4A phía dưới: 5 dòng intensity (thắng trước cổng, hp còn trước, dựng được sau cổng, bot thắng sau cổng, hp còn sau, số ván bị giảm, số ván bị giảm mục tiêu), 4 dòng theo vũ khí/máu/map/quái và dòng "0 trên 2700 không dựng được": **giống nhau từng ký tự** (so bằng máy, 10 dòng). Thêm một bằng chứng độc lập: 525 lịch quái của brief không có spitter (5 intensity × 5 hỗn hợp × 7 mục tiêu × 3 seed) có digest `a4aa7b68` giống mã `waves.ts` của Stage 4A (test `shooter-4b-brief`).

### 2. Số cuối cùng và những số đã thử

| thứ | khởi điểm (prompt) | cuối cùng | giới hạn cho phép |
|---|---|---|---|
| `ENEMY_WEIGHT.spitter` | 2,5 | **4** | 1,5 … 4 |
| spitter `cooldownMs` | 1800 | **2400** | 1400 … 2400 |
| spitter `bulletSpeed` | 230 | **180** | 180 … 280 |
| spitter `holdRange` | 260 | 260 | 200 … 300 |
| `SPITTER_NOT_BEFORE` | 0,2 | 0,2 | 0,1 … 0,35 |
| shotgun | 800 ms, 320 px, 6 viên, 36° | **1000 ms**, 320 px, 6 viên, 36° | cooldown ±200, range ±120 |
| piercing | 500 ms, sát thương 2, tầm 800, xuyên 3 | **600 ms**, sát thương 2, tầm 800, **xuyên 2** | cooldown ±200, xuyên 2…4 |

Ba núm của spitter (trọng số, nhịp bắn, tốc độ đạn) đều nằm ở MÉP dễ nhất của giới hạn. Đó là cái giá của việc bot bình thường ngắm lệch ±12°: nó khó hạ một quái đứng xa 260 px.

**Cách né đạn: sai lệch có chủ đích so với prompt (F.1).** Prompt yêu cầu mỗi viên đạn đẩy bot "ra xa theo cùng công thức trọng số như với quái" (lùi thẳng khỏi viên đạn). Đã làm đúng như vậy trước và đo: đạn (180–230 px/s) nhanh hơn người (210 px/s), nên bot chạy dọc đường bay và bị đuổi kịp. Pistol, intensity 1…5, thắng trước cổng:

| cách né | hỗn hợp | cấu hình spitter | I1 | I2 | I3 | I4 | I5 |
|---|---|---|---|---|---|---|---|
| lùi thẳng (theo prompt) | spitter | khởi điểm | 0 | 0 | 0 | 0 | 0 |
| lùi thẳng | spitter | mọi số dễ nhất cho phép (w4, 2400, 180) | 11 | 11 | 4 | 9 | 0 |
| lùi thẳng | spitter | + holdRange 200 | 13 | 13 | 4 | 2 | 0 |
| lùi thẳng | all4 | mọi số dễ nhất cho phép | 80 | 51 | 7 | 0 | 0 |
| **bước ngang** (vuông góc đường bay) | spitter | khởi điểm | 18 | 2 | 0 | 0 | 0 |
| **bước ngang** | spitter | w4, 2400, 180 (**cuối**) | **78** | **78** | **62** | **44** | **38** |
| **bước ngang** | all4 | w4, 2400, 180 (**cuối**) | **100** | **91** | **42** | **24** | **9** |
| khoảng yêu cầu (±8) | | | ≥ 82 | 62–98 | 42–83 | 22–63 | 7–48 |

Với cách lùi thẳng không có tổ hợp số nào trong giới hạn đưa spitter vào khoảng yêu cầu (đúng tình huống mà prompt bảo dừng và báo cáo). Với cách bước ngang thì được, nên chọn nó. Chỉ thay đổi khi có đạn quái trong không khí, nên màn cũ không đổi (`--set=old` giống hệt). Bot giỏi và bot bình thường cùng dùng cách này (bot bình thường thấy đạn ở lần "nhìn" gần nhất, bán kính né 72 px so với 90 px). Một lần thử thêm tầm giữ (hold 200 / 220 / 230 / 240 / 250 / 300) cho kết quả dao động không theo quy luật (mỗi ô chỉ 45 ván), nên giữ 260 là giá trị thiết kế.

**Súng mới** (thắng trước cổng, mọi hỗn hợp, mọi map, mọi mức máu, 3 seed, bot bình thường):

| súng | I1 | I2 | I3 | I4 | I5 |
|---|---|---|---|---|---|
| pistol | 95,6 | 87,8 | 38,5 | 19,6 | 7,8 |
| rapid | 97,4 | 94,1 | 91,9 | 87,4 | 66,3 |
| heavy | 97,0 | 77,8 | 51,1 | 28,5 | 9,6 |
| shotgun, số khởi điểm | 97,0 | 96,7 | 79,6 | 54,1 | 25,2 |
| piercing, số khởi điểm | 94,8 | 92,2 | 82,6 | 63,3 | 35,2 |
| shotgun 1000 ms / 260 px / 5 viên / 40° (thử) | 85,6 | 63,3 | 16,7 | 7,0 | 3,0 |
| piercing 600 ms / xuyên 2 / tầm 700 (thử) | 89,6 | 84,1 | 50,4 | 21,9 | 9,3 |
| shotgun 900 ms / 300 px / 5 viên (thử) | 90,4 | 77,8 | 35,6 | 15,6 | 5,9 |
| **shotgun cuối: 1000 ms, 320 px, 6 viên** | **96,3** | **88,9** | **47,8** | **16,7** | **7,0** |
| **piercing cuối: 600 ms, xuyên 2** | **89,6** | **84,4** | **49,6** | **21,9** | **9,6** |

Mục tiêu: ở intensity 3, mỗi súng mới trong ±15 điểm so với pistol (38,5, tức 23,5–53,5) và nằm giữa 30% và 95%: shotgun 47,8 và piercing 49,6, **đạt** (và cả đường cong 5 mức bám sát pistol: chênh nhiều nhất 11 điểm). Với số khởi điểm hai súng thắng nhiều hơn pistol 41 và 44 điểm ở intensity 3, nên bị giảm. Hai súng mới được làm yếu tới mức tương đương pistol, mà pistol là súng yếu nhất của bot bình thường; rapid vẫn mạnh nhất (91,9 ở intensity 3).

**Điều không thể đạt hoàn toàn: so sánh từng hỗn hợp riêng.** "±15 so với pistol ở cùng hỗn hợp quái" không thể thỏa đồng thời với "từ 30%": pistol ở intensity 3 chỉ thắng 6,7% runner, 13,3% brute, 0% mixed, nhưng 93,3% swarmer. Bảng cắt lát (intensity 3, máu bình thường, 5 map × 3 seed = 15 ván mỗi ô):

| hỗn hợp | pistol | rapid | heavy | shotgun | piercing |
|---|---|---|---|---|---|
| runner | 6,7 | 100 | 33,3 | 6,7 | 93,3 |
| brute | 13,3 | 100 | 100 | 53,3 | 60,0 |
| swarmer | 93,3 | 100 | 0 | 66,7 | 26,7 |
| mixed | 0 | 100 | 26,7 | 13,3 | 26,7 |
| spitter | 66,7 | 80,0 | 86,7 | 60,0 | 66,7 |
| all4 | 40,0 | 86,7 | 53,3 | 53,3 | 33,3 |

Chọn thỏa tiêu chí ở mức tổng hợp (mọi hỗn hợp). Shotgun và piercing sai khác pistol nhiều ở vài hỗn hợp (shotgun: brute +40, swarmer −27; piercing: runner +87, brute +47, swarmer −67): cơ chế của chúng khác pistol (một viên xuyên rất hợp với runner đi hàng, quạt đạn hợp với quái dày).

**Tầm shotgun 320, không phải 300.** Thử 300 px thì spitter một mình + shotgun hầu như không dựng được (bot chỉ bắn trong 85% tầm = 255 px, mà spitter đứng giữ ở 260 px; bot không bao giờ tiến lại gần). Đưa về 320 (giá trị khởi điểm) thì 9 ván không dựng được còn 1 trên 4050.

### 3. Bảng hiệu chỉnh sau cổng (bot bình thường, survive 60 s)

Hỗn hợp mới và/hoặc súng mới (`--set=new`, 4050 ván mỗi pha, 6 bước giảm mật độ):

| intensity | thắng trước cổng | dựng được sau cổng | bot thắng sau cổng (seed chưa dùng) | ván bị giảm mật độ (trên 810) |
|---|---|---|---|---|
| 1 | 92,2% | 100,0% | 95,4% | 39 |
| 2 | 86,3% | 100,0% | 90,6% | 78 |
| 3 | 54,4% | 100,0% | 76,8% | 347 |
| 4 | 29,1% | 99,9% | 69,0% | 562 |
| 5 | 17,3% | 100,0% | 67,4% | 651 |

1 trên 4050 ván không dựng được (intensity 4, spitter một mình, piercing, máu yếu). Theo hỗn hợp (dựng được / bot thắng sau cổng): runner 100 / 89,2, brute 100 / 86,0, swarmer 100 / 89,3, mixed 100 / 82,0, spitter 99,9 / 76,6, all4 100 / 78,2. Theo súng: pistol 100 / 81,3, rapid 100 / 91,4, heavy 100 / 85,6, shotgun 100 / 77,6, piercing 99,9 / 81,8. Cả lưới (cũ + mới, 6750 ván): dựng được 100 / 100 / 100 / 99,9 / 100%, bot thắng sau cổng 96,8 / 92,9 / 79,7 / 75,1 / 73,3%.

**Đạt:** dựng được ≥ 99% ở mọi mức (thấp nhất 99,9%) và bot thắng ≥ 60% (thấp nhất 67,4%) với survive 60 s; kill 10 dựng được 100% ở cả 5 mức.

**Không đạt (báo cáo đúng số):**

| mục tiêu (phần mới, 1350 ván) | dựng được, intensity 1…5 | yêu cầu | bot thắng sau cổng | phải giảm mục tiêu (trên 270) |
|---|---|---|---|---|
| kill 10 | 100 / 100 / 100 / 100 / 100% | ≥ 99 (đạt) | 96,3 / 95,9 / 90,4 / 93,0 / 94,1% | 0 |
| kill 40 | 98,9 / 100 / **98,5** / 98,9 / 100% | ≥ 99 (**thiếu 0,1–0,5 điểm** ở I1, I3, I4) | 72,3 / 57,4 / 55,6 / 54,3 / 57,4% | 72 / 84 / 84 / 86 / 84 |
| kill 100 | **80,0 / 77,0 / 77,4 / 74,8 / 78,9%** | ≥ 90 (**không đạt**) | 65,7 / 62,0 / 52,2 / 48,0 / 54,0% | 154 / 152 / 149 / 151 / 165 |

Ván không dựng được tập trung ở một chỗ: spitter một mình với mục tiêu hạ nhiều quái. kill 40: spitter 97,3%, pistol 97,3% (10 trên 1350 ván hỏng). kill 100: spitter một mình chỉ dựng được 33,3% (các hỗn hợp khác: runner 98,0, brute 83,3, swarmer 100, mixed 100, all4 93,6); theo súng: pistol 54,7, rapid 75,3, heavy 79,3, shotgun 82,7, piercing 80,4. Đây là hệ quả của bot bình thường không bao giờ tiến lại gần và ngắm lệch: hạ 100 spitter đứng cách 260 px không thắng nổi dù đã giảm mục tiêu 3 lần, và cổng từ chối đúng cách (`unwinnable_level`). Phần cũ (Stage 4A, 3 súng cũ, 4 hỗn hợp cũ) không đổi: kill 100 dựng được 96,7 / 96,7 / 95,6 / 91,1 / 93,3%. Để nâng kill 100 với spitter lên cần một trong các việc sau (không làm ở stage này, vượt giới hạn cho phép): bot tiến lại gần mục tiêu, hoặc giảm số lượng spitter trong màn kill. Bot giỏi (cùng lưới, trước cổng): 100 / 98,5 / 89,6 / 74,8 / 58,5%, vẫn thắng 100% mọi ván chỉ có spitter.

### 4. Thời gian dựng + cổng qua worker (bản build, `node scripts/measure-compile-time.mjs 40`)

| trường hợp (40 lần, nhiều seed / map / intensity) | median | p95 | lớn nhất |
|---|---|---|---|
| survive 60 s | 0,46 s | 0,70 s | 0,95 s |
| survive 180 s | 0,44 s | 0,68 s | 0,89 s |
| xấu nhất mới (Stage 4B): kill 200, all4, shotgun, intensity 5, máu yếu (cả 40 lần bị từ chối sau khi dùng hết 6 bước và 3 lần giảm mục tiêu) | 1,56 s | 2,28 s | 2,32 s |
| xấu nhất cũ: kill 200, toàn quái trâu, intensity 5, máu yếu (cả 40 lần bị từ chối) | 1,37 s | 1,98 s | 2,26 s |

Mọi p95 dưới 5 s; giới hạn 8 s của worker (`COMPILE_TIMEOUT_MS`) không đổi và không lần nào hết giờ.

### 5. Giới hạn đã biết

- Bot bình thường **bỏ qua vật phẩm hồi máu** (cố ý): màn có hồi máu dễ hơn mức cổng đo, phía an toàn. Chưa đo mức "dễ hơn" bao nhiêu.
- Sáu mục trên dùng `healthDrops: none`; màn có hồi máu được dựng từ cùng lưới nhưng không đo riêng.
- Các số của spitter ở mép giới hạn dễ nhất: nếu người chơi thật thấy spitter vẫn quá khó, cần đổi thiết kế (bot hoặc luật spitter), không còn dư địa trong giới hạn.
- Bản chụp vàng mới `golden-sim-4b.json` (22 ván, 951 hash) được sinh từ mã mới nên chỉ chứng minh "không đổi về sau"; tính đúng do test đơn vị (`shooter-weapons-4b`, `shooter-spitter`, `shooter-pickups`) chịu trách nhiệm.

## Stage 4A: cổng dùng bot "người chơi bình thường"

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
