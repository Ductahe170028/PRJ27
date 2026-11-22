# Hiệu chỉnh mật độ quái của shooter

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

Chạy lại: `npm run shooter:calibrate -w @game-creator/api` (thêm `-- --write` để ghi lại tệp này, `-- --pre-only` để chỉ đo trước cổng khi chỉnh `INTENSITY_RATE`). Không chạy trong `npm test`.

## Sau khi đa dạng hóa bản đồ (Stage 2.1)

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

## Mục tiêu khác (một seed, 900 ván mỗi mục tiêu)

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

