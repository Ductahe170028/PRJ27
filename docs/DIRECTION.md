# Hướng phát triển

Quyết định chốt sau Standard 1A–1C. Cập nhật khi có quyết định mới, không viết lại lịch sử.

## Sản phẩm

- **Top-down Survival Shooter**: một engine, nhiều game tùy biến bằng prompt (bối cảnh, quái, tốc độ, độ khó).
- Không còn hứa "tạo mọi thể loại". Yêu cầu ngoài khả năng engine được báo rõ, không làm im lặng.

## Đóng băng (đã xong: phần này bị xóa, xem mục "Dọn nhà" ở cuối)

- Platformer, Top-down Dodge/Collect (GameSpec v1) và Advanced Mode: giữ nguyên code, không phát triển thêm, không chạy mặc định (Advanced tắt, UI không hiện nút chọn chế độ).
- Tag `legacy-standard-v1` giữ nguyên bản chạy được. Phần đặc thù platformer sẽ xóa sau khi shooter qua benchmark.
- Test Advanced chạy riêng bằng `npm run test:advanced`; `npm test` tập trung Standard/shooter.

## Kiến trúc đích

```
ShooterBrief (AI sinh, chỉ ngữ nghĩa, không tọa độ)
  → compileShooter(brief, seed)   engine, xác định: dựng map, spawn, cân bằng
  → ShooterLevel đã validate
  → renderer
```

- Spec mới, tách hẳn GameSpec cũ. Standard/shooter không import `agent/` hay `sandbox/` (có test kiểm tra).
- Logic game (di chuyển, va chạm, đạn, sát thương, spawn, thắng/thua) là module TypeScript thuần, không phụ thuộc Phaser. Phaser chỉ vẽ.
- Hiện module nằm ở `packages/contracts/src/shooter/` (cùng package với schema để web và api cùng import, `npm run dev` đã build sẵn). Có test chặn import Phaser/DOM/`Math.random`/đồng hồ. Có thể tách thành package riêng sau này; nó chỉ phụ thuộc `zod`.
- Lý do: không lệch giữa mô phỏng và render như ở platformer; test không cần trình duyệt; có thể thêm bot mô phỏng chạy trong worker.

## Quy tắc xử lý đầu vào

- Giá trị tinh chỉnh (tốc độ, máu, tần suất): kẹp vào khoảng hợp lệ, không từ chối.
- Yêu cầu engine không hỗ trợ: trả về danh sách "chưa hỗ trợ" cho người dùng.

## MVP

- WASD + chuột ngắm/bắn; đạn không giới hạn có hồi chiêu; quái đuổi.
- Mục tiêu: sống sót N giây hoặc diệt N quái. Khoảng 3 loại quái.
- Không mobile, không âm thanh, không asset ngoài.

## Ngoài MVP

Bảo vệ căn cứ, pickup đạn, mobile/cảm ứng, chỉnh game bằng prompt, bot mô phỏng.

## Lộ trình

0. Dọn nền (xong)
1. Lõi shooter không AI (xong)
2. Brief + compiler + AI (xong, xem dưới)
3. Kiểm chứng (ngân sách phân tích, sau đó bot)
4. Đa dạng
5. Benchmark 30 prompt (mục tiêu ≥ 85% thành công lần đầu)
6. Chỉnh bằng prompt

## Stage 2: từ prompt đến game

`prompt → AI sinh ShooterBrief → compileShooter(brief, seed) → bot kiểm chứng → ShooterLevel → game`, qua `POST /api/shooter/generate`.

- **Brief** (`apps/api/src/shooter/brief.ts`): chỉ ngữ nghĩa, chọn từ danh sách cố định (8 theme, 5 map, 4 loại quái từ Stage 4B, độ khó 1-5, máu, 5 vũ khí từ Stage 4B, hồi máu rơi, boss từ Stage 4C, mục tiêu) cộng `unsupported`. AI không bao giờ sinh tọa độ hay số vật lý. Giá trị số và độ dài được kẹp (`normalizeBrief`), giá trị enum sai thì từ chối, không đoán.
- **Preset** (`presets.ts`): bảng duy nhất biến từ thành số (máu 3/5/8, ba vũ khí, màu theo theme, tốc độ người chơi 210).
- **Compiler** (`compile.ts`, `maps.ts`, `waves.ts`): xác định theo `seed`. Bố cục map phải qua schema, nối được mọi điểm xuất hiện tới người chơi cho một con brute, và khe ≥ 60 px; không vừa thì thử 8 biến thể rồi rơi về đấu trường trống kèm thông báo. Lịch wave theo nhịp `INTENSITY_RATE` (đe dọa mỗi giây, chia cho trọng số trung bình của loại quái) và giảm nhịp khi màn dài hơn 60 s.
- **Cổng bot** (`gate.ts`, `compile-job.ts`): bot chơi level trên 3 seed. Thắng dưới 2/3 thì giảm mật độ (tối đa 6 lần x0.8, từ Stage 4A; trước đó 4), hết bước mà vẫn dưới 2/3 thì `unwinnable_level`; thắng 2/3 trở lên thì nhận nguyên vẹn. Bot vẫn chơi giỏi hơn nhiều người, nên cổng chỉ làm màn DỄ HƠN, không bao giờ KHÓ HƠN. Mục tiêu `kill` quá nặng thì giảm x0.7 (tối thiểu 10, tối đa 3 lần, cùng seed) thay vì từ chối; `survive` không bị đổi thời gian. Mỗi điều chỉnh có một thông báo cố định. Chạy trong worker, tối đa 8 s.
- **Hiệu chỉnh** (`npm run shooter:calibrate -w @game-creator/api`, kết quả ở [shooter-calibration.md](shooter-calibration.md)): chỉ chỉnh `INTENSITY_RATE`, trọng số loại quái và hệ số nhịp.
- **Thông báo cho người dùng** (`notices.ts`): yêu cầu engine không có (boss, xe, nhiều người, bảo vệ căn cứ, bảo vệ hoặc hộ tống nhân vật khác, màn không có quái, hết đạn, vật phẩm, đổi vũ khí, chế tạo, bẫy) luôn hiện ra. Model ghi vào `unsupported`, và một bảng từ khóa cố định bổ sung câu chuẩn nếu model quên. Mục `unsupported` chỉ chép lại nguyên lời người dùng bị thay bằng một câu chung ("Một phần yêu cầu chưa được hỗ trợ."). "Bảo vệ thành phố" vẫn nhận thông báo bảo vệ căn cứ: người dùng nói bảo vệ thì mong có thứ cần bảo vệ, và nói rõ là chưa có là trung thực. Không im lặng bỏ qua.
- **Giao diện**: `/` là ShooterApp; `/?shooter=<level>` là sân chơi level viết tay; `/?legacy=standard` là app Standard cũ (GameSpec v1), giữ nguyên.
- **Không có retry, không gọi AI lần hai, không game dự phòng khi lỗi.** Biến thể map nội bộ là điều chỉnh của engine và được báo cho người dùng.

## Stage 4A: bot bình thường cho cổng

- **Cổng dùng bot "người chơi bình thường"** (`createCasualBot` trong `packages/contracts/src/shooter/casual-bot.ts`): chỉ nhìn sân mỗi 18 tick (0,3 s) và hành động theo ảnh cũ, ngắm lệch ngẫu nhiên đến ±12° giữ nguyên đến lần nhìn sau, chỉ bắn khi mục tiêu trong 85% tầm súng, giữ khoảng cách với quái và tường ngắn hơn bot giỏi, không có đường đi vòng. Mỗi ván một bot mới, mầm từ seed của ván; nhiễu lấy từ bộ sinh số riêng của bot (không `Math.random`), nên cổng vẫn tất định. Báo cáo cổng ghi `bot: 'casual'`.
- **Bot giỏi (`botInput`) chỉ còn để test** (`shooter-playable`, bản chụp vàng `shooter-golden`, so sánh trong script hiệu chỉnh `--bot=expert`). Nó không còn quyết định màn nào được giao cho người dùng.
- **Các tham số `CASUAL` là ước đoán về một người chơi bình thường**, chỉnh cho tỷ lệ thắng trước cổng rơi vào khoảng đặt ra (intensity 1 ≥ 90%, 2: 70–90%, 3: 50–75%, 4: 30–55%, 5: 15–40%). Chúng sẽ được chỉnh lại theo phản hồi của người chơi thật; chỉnh bằng `npx tsx scripts/calibrate-shooter.ts --casual=reaction=18,aim=12,...` rồi đổi `CASUAL`, không đổi logic. Số liệu: [shooter-calibration.md](shooter-calibration.md).
- Bot yếu hơn thì cần giảm mật độ sâu hơn: `MAX_THIN_STEPS` từ 4 lên 6 (sàn 26% thay vì 41%). `INTENSITY_RATE` không đổi.
- Lõi shooter đã tách theo bước của một tick (`state`, `player`, `weapons`, `spawn`, `enemies`, `combat`, `hash`, `sim` điều phối); thuộc tính từng loại quái nằm trong bảng `ENEMY_TYPES`. Bản chụp vàng `apps/api/test/fixtures/shooter/golden-sim.json` (42 ván, hash mỗi 60 tick) là lưới an toàn: refactor không được làm đổi một bit; chỉ tạo lại (`npx tsx scripts/make-golden-sim.ts`) khi cố ý đổi mô phỏng.
- Người chơi được biết mục tiêu: HUD `Sống sót 12/60s` hoặc `Hạ 12/40`, biểu ngữ `MỤC TIÊU: …` 3 giây đầu mỗi ván, thẻ "Thông tin màn" trong app.

## Stage 4B: cơ chế mới (hai súng, quái bắn xa, hồi máu)

- **Nguyên tắc cộng thêm.** Mọi trường mới của `ShooterLevel` là tùy chọn (`pellets`, `spreadDeg`, `pierce` trong `weapon`; `drops`), mọi thứ mới trong trạng thái chỉ có dữ liệu khi dùng tính năng (đạn xuyên, `nextShotTick`, `enemyBullets`, `pickups`; `snapshotHash` chỉ cộng chúng khi có). Màn cũ chạy ra đúng từng bit như trước: bản chụp vàng `golden-sim.json` (42 ván, không bao giờ tạo lại) vẫn xanh, và `calibrate-shooter --set=old` cho đúng bảng Stage 4A. Tính năng mới không dùng `state.rng` (hồi máu dùng hàm băm `dropRoll(seed, id)`).
- **Súng** (`presets.ts`, đọc theo DỮ LIỆU, không rẽ nhánh theo tên): `shotgun` (6 viên trong quạt 36°, tầm 320, mỗi 1 s) và `piercing` (một viên xuyên tối đa 2 quái, sát thương 2, tầm 800, mỗi 0,6 s). Tên súng mới có trong brief (`WEAPONS`) và prompt AI.
- **Quái bắn xa** (`spitter`, bảng `ENEMY_TYPES` có nhóm dữ liệu `ranged`): dừng ở cách người chơi 260 px khi thấy thẳng, bắn một viên chậm (180 px/s) mỗi 2,4 s vào chỗ người chơi đang đứng; tường chặn đạn; đạn không trúng quái khác; đang bất tử thì đạn bị hấp thụ. Thứ tự tick có thêm bước 6b (quái bắn), 7b (đạn quái bay), 7c (nhặt vật phẩm): xem chú thích đầu `sim.ts`.
- **Hồi máu rơi từ quái**: brief có `healthDrops` (`none`/`some`/`many` = 0/12/25%); quái bị hạ có thể rơi vật phẩm hồi 1 máu (tối đa 3 cái, tồn tại 10 s, chỉ nhặt khi thiếu máu).
- **Bot bỏ qua vật phẩm hồi máu (cố ý).** Cổng đánh giá màn như thể người chơi không bao giờ nhặt, nên màn có hồi máu dễ hơn mức cổng đo (phía an toàn).
- **Bot né đạn quái bằng cách bước ngang** (vuông góc đường bay), không lùi thẳng ra xa: đạn nhanh hơn người, nên lùi thẳng không bao giờ thoát (xem `docs/shooter-calibration.md`, mục Stage 4B). Bot bình thường chỉ thấy đạn ở lần "nhìn" gần nhất, với bán kính né nhỏ hơn bot giỏi.
- Số liệu và các điều chưa đạt: [shooter-calibration.md](shooter-calibration.md), mục "Stage 4B". Chỉnh các số `ranged`, súng và `ENEMY_WEIGHT.spitter` bằng `npx tsx scripts/calibrate-shooter.ts --tune=...` trước khi sửa file.

## Stage 4C: boss cuối

- **Một boss mỗi màn, hai kiểu** (`ENEMY_TYPES`, mỗi kiểu một dòng dữ liệu có nhóm `boss`, tra bằng `bossOf`, không so tên): `crusher` (quái khổng lồ: đứng yên báo hiệu 0,8 s rồi lao 0,6 s vào chỗ người chơi đứng lúc bắt đầu lao, tường chặn thì dừng) và `gunner` (giữ khoảng cách 300 px, bắn quạt 3 viên và vòng 12 viên). Dưới 50% máu thì cuồng nộ (nhanh hơn, chu kỳ ngắn hơn). Không dùng `random`, không lượng giác (vòng 12 viên là bảng vector viết sẵn).
- **Mục tiêu thắng `boss`** (`win: { type: 'boss' }`, `bossHp` tùy chọn 10..400): hạ boss thì thắng; thua vẫn kiểm tra trước thắng. Màn có boss LUÔN thắng bằng cách hạ boss, `goal` của brief chỉ quyết định thời lượng trước boss (70%) và engine luôn báo "Màn có boss: thắng bằng cách hạ boss." Nhiều boss, mini-boss, boss triệu hồi quái vẫn chưa hỗ trợ (có thông báo).
- **Cộng thêm**: màn cũ chạy ra đúng từng bit (ba bản chụp vàng: `golden-sim.json` Stage 4A và `golden-sim-4b.json` không bao giờ tạo lại, `golden-sim-4c.json` chỉ tạo lại khi cố ý đổi mô phỏng). Bán kính quái lớn nhất tính theo màn (20, hoặc bán kính boss) nên không đổi thứ tự duyệt của màn cũ.
- **Cổng với màn boss**: mỗi bước giảm quái thường ×0,8 và máu boss ×0,9 (sàn 40% và 10), không bao giờ xóa đợt boss; không hạ mục tiêu `kill`.
- **Bot**: né boss từ xa hơn (cộng bán kính boss), nhắm boss khi boss trong tầm, vẫn bỏ qua vật phẩm. Bot bình thường chỉ thắng các màn boss ở mức dễ nhất của giới hạn (xem `docs/shooter-calibration.md`, mục Stage 4C): các khoảng ở intensity 3–5 chưa đạt, cần giảm nhịp quái thường ở màn boss hoặc đổi yêu cầu.
- **Giao diện**: thanh máu boss, "BOSS XUẤT HIỆN!" 2 s, "CUỒNG NỘ", mục tiêu "Hạ boss", dòng boss trong thẻ "Thông tin màn"; hai màn tay `boss-crusher` và `boss-gunner` trong playground.

## Stage 4C.1: boss không kẹt, màn boss tập trung vào boss

- **Boss đi trên lưới riêng.** Flow field chung nới vật cản chỉ 12 px nên dẫn thân boss (rộng 60–68 px) vào chỗ nó không lọt, và crusher đứng im 3 trên 30 màn đo được. Màn có boss nay mang lưới đi và flow field riêng cho boss (vật cản nới thêm bán kính boss + 4 px, mép sân tính theo thân boss); màn không có boss không có hai trường này và chạy y như cũ. `compile.ts` chỉ chọn bố cục mà mọi điểm xuất hiện nối tới người chơi trên lưới đó. Không đụng `maps.ts`.
- **Bài đo thành test lâu dài** (`shooter-boss-reach.test.ts`): người chơi đứng yên bất tử, boss phải tới trong `max(140, holdRange + 40)` px trong 120 s ở mọi cặp boss × map. 300/300 trên 30 seed, 2000/2000 trên 200 seed, 0% bản đồ bị đơn giản hóa.
- **Màn boss là về boss.** Quái thường nhẹ nhịp hơn trước boss (`beforePace` 0,7) và rất ít sau khi boss ra (20 s, `afterPace` 0,25). Bot bình thường trước cổng: 94,6 / 83,5 / 67,9 / 44,4 / 27,7% (intensity 1…5), đạt mọi khoảng mục tiêu; số màn boss bị cổng giảm mật độ ở intensity 3–5 giảm từ 70/79/90% xuống 33/57/74%.
- **Chưa làm:** người chơi vẫn có thể đứng ở chỗ lưới của boss không nối tới (ví dụ lối vừa khít 68 px) và ra ngoài tầm với của boss (đo: 3 trên 2772 ván thử vị trí khác).

## Dọn nhà: shooter là sản phẩm duy nhất

- **Đã xóa** phần cũ từng bị đóng băng: "Standard" (GameSpec v1: platformer, Dodge/Collect, màn "Moonlight Run", route `/api/games/generate`, app `/?legacy=standard`, các dịch vụ sửa vị trí và mô phỏng nhảy) và "Advanced Mode" (AI Code Agent, sandbox Docker, hàng đợi job, các route `/api/agent/*`, biến `ADVANCED_AI_ENABLED`, `vitest.advanced*`). Bản cũ vẫn lấy lại được bằng tag **`legacy-standard-v1`** (`git checkout legacy-standard-v1`) và toàn bộ lịch sử git; không giữ gì "để phòng hờ" trong cây làm việc.
- **Cấu trúc mới.** `packages/contracts/src/shooter/` (lõi mô phỏng thuần + schema màn), `packages/contracts/src/{index,ai}.ts` (hợp đồng API và nhà cung cấp), `apps/api/src/shooter/` (brief, compiler, cổng bot, dịch vụ), `apps/api/src/{providers,services,http}/` (hạ tầng AI dùng chung: nhà cung cấp, `AiGateway`, ngân sách yêu cầu, chẩn đoán trên đĩa), `apps/web/src/` (App, các thành phần nhỏ, ShooterScene vẽ). Bốn route còn lại: `GET /api/health`, `GET /api/ai/providers`, `POST /api/ai/test-connection`, `POST /api/shooter/generate`.
- **Nguyên tắc.** Shooter là sản phẩm duy nhất; mô phỏng không biết Phaser, DOM, đồng hồ hay `Math.random` (test chặn); `apps/api` không import `apps/web` và ngược lại (có test); hạ tầng AI không biết gì về game. Muốn thêm một thể loại khác thì làm lại từ lõi, không nối vào đây.
- **Đổi nhỏ khi dọn:** lựa chọn "demo" của giao diện là `demo` / `shooter-arena` (trình duyệt đã lưu `demo` / `platformer-v1` được đọc thành demo mới); chẩn đoán trên đĩa đổi tên kiểu và hàm (`RunDiagnostics`, `openRunDiagnostics`) nhưng giữ nguyên biến môi trường `STANDARD_DIAGNOSTICS(_DIR)`, thư mục `.local-diagnostics/` và dạng file; trường `genres` của `capabilities` trong `/api/ai/providers` đã bỏ.
- Số liệu hiệu chỉnh và các bản chụp vàng không đổi một byte: [shooter-calibration.md](shooter-calibration.md); nhà cung cấp và giới hạn: [providers.md](providers.md).
