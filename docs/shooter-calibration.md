# Hiệu chỉnh mật độ quái của shooter

Ngày chạy: 2026-11-22 (Stage 3). Kết quả của `npx tsx scripts/calibrate-shooter.ts --write` chạy từ `apps/api` (PowerShell nuốt cờ qua `npm run`, nên chạy trực tiếp; 2700 ván mỗi pha, 7 tiến trình song song, 87 s).

Lưới: intensity 1-5 x mix quái (runner, brute, swarmer, cả ba) x map (5) x weapon (3) x health (3) x 3 seed; mục tiêu sống sót 60 s.
"Trước cổng" là bot chơi level đúng như compiler dựng; "sau cổng" là level service sẽ trả (compile + cổng), chơi trên seed mà cổng chưa dùng.

## Quy tắc của cổng từ Stage 3

**Bot chơi giỏi hơn người, vì vậy cổng chỉ làm màn DỄ HƠN, không bao giờ KHÓ HƠN.** Một màn dễ với bot không có nghĩa là dễ với người; một màn bot chỉ thắng 1 trong 3 ván thì gần như người không thắng nổi.

- Bot chơi 3 seed. Thắng ít hơn 2 (`MIN_WINS = 2`) thì giảm mật độ quái, tối đa 4 lần x0,8 (`MAX_THIN_STEPS = 4`, sàn 41%). Hết bước mà vẫn dưới 2 thì `unwinnable_level`.
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
