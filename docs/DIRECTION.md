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

Pickup đạn, mobile/cảm ứng, chỉnh game bằng prompt, bot mô phỏng. (Đổi súng trong game có từ Stage 6A.) (Bảo vệ căn cứ đã có từ Stage 4D, xem bên dưới.)

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
- **Thông báo cho người dùng** (`notices.ts`): yêu cầu engine không có (boss, xe, nhiều người, xây tháp, nhiều căn cứ, sửa căn cứ, bảo vệ hoặc hộ tống nhân vật khác, màn không có quái, hết đạn, vật phẩm, đổi vũ khí, chế tạo, bẫy) luôn hiện ra. Model ghi vào `unsupported`, và một bảng từ khóa cố định bổ sung câu chuẩn nếu model quên. Mục `unsupported` chỉ chép lại nguyên lời người dùng bị thay bằng một câu chung ("Một phần yêu cầu chưa được hỗ trợ."). Từ Stage 4D "bảo vệ căn cứ" và "bảo vệ thành phố" không còn là thông báo: chúng là một tính năng thật.
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

## Stage 4D: căn cứ cần bảo vệ

- **Căn cứ là một bức tường của mô phỏng.** Tòa nhà vuông 56 px (`level.base`, máu 5..200) được thêm vào `state.walls = [...level.obstacles, baseRect]`: người chơi, quái, đạn và đường nhìn đều dùng `state.walls`; không có căn cứ thì `state.walls === level.obstacles` (cùng mảng), nên màn cũ chạy ra đúng từng bit (ba bản chụp vàng cũ không đổi một byte). Bước mới `8b hurtBase` nằm sau `hurtPlayer`.
- **Quái chọn mục tiêu** (`aimAtBase`, chỉ quái thường): chọn thứ gần hơn, đổi ý chỉ khi mục tiêu kia gần hơn ít nhất `TARGET_SWITCH_MARGIN` px (chống rung). Đường tới căn cứ là một flow field tính một lần (`baseFlow`, lưới không chặn bởi căn cứ); trong 140 px thì đi thẳng, chạm thì dừng. Quái bắn xa giữ tầm và bắn vào tâm căn cứ. Boss chỉ nhắm người chơi (quyết định, để màn boss vẫn là về boss).
- **Sát thương**: chạm gây sát thương mỗi `BASE_HIT_INTERVAL_MS` theo TỔNG các quái đang chạm (cả boss); đạn của quái trúng là mất máu ngay. Căn cứ chặn cả đạn của người chơi (quyết định: nó là tường; bot đã học đứng sao cho đường bắn thông).
- **Thua**: người chơi chết HOẶC căn cứ hết máu (`state.lostBy`); thua xét trước thắng; nếu người chơi chết cùng tick với căn cứ thì `lostBy` là `player`.
- **Bot** (`steering.ts`, `bot.ts`, `casual-bot.ts`): coi căn cứ là tường, nhắm quái gần căn cứ nhất có đường bắn thông, bị kéo về trong dây xích (`BOT_LEASH`), không thêm lần gọi `random()` nào. Hai bot chỉ khác nhau ở độ hiểu biết.
- **Brief và compiler**: `base: 'none' | 'defend'`; căn cứ ở giữa sân, người chơi cách `BASE_PLAYER_GAP` px ở một trong bốn phía theo `seed % 4`; máu theo `BASE_HP_BY_INTENSITY`; kiểm tra thêm khả năng nối (có căn cứ, có boss, tới căn cứ) và rơi về đấu trường trống nếu không vừa. Cổng: mỗi bước giảm quái còn nâng máu căn cứ ×1,15 (làm tròn lên, trần 200).
- **Chốt chặn `guardUnrequested`**: gỡ `healthDrops` và `base` mà model tự thêm khi lời người dùng không có từ nào có thể có nghĩa đó (bỏ dấu, từ rộng cố ý; boss không đụng; không báo người dùng, ghi vào chẩn đoán `guardRemoved`). Nhóm thông báo mới: xây tháp, nhiều căn cứ, sửa căn cứ; "bảo vệ căn cứ" không còn là thông báo.
- **Giao diện**: vẽ căn cứ, thanh máu căn cứ ở góc trên phải (trong dải HUD), biểu ngữ "Bảo vệ căn cứ: …", HUD "Giữ căn cứ · …", lý do thua "Căn cứ đã bị phá." / "Bạn đã bị hạ.", dòng căn cứ trong thẻ "Thông tin màn"; ba màn tay `base-siege`, `base-boss`, `base-fall`.
- **Hiệu chỉnh** ([shooter-calibration.md](shooter-calibration.md), mục "Stage 4D"): máu căn cứ `[120, 120, 120, 150, 200]` (Stage 4D.1; trước đó 120 cả năm), `BASE_HIT_INTERVAL_MS` 800, `TARGET_SWITCH_MARGIN` 100, `BOT_LEASH` 170, `BASE_PLAYER_GAP` 64. Trước cổng bot thắng 97,0 / 89,3 / 65,9 / 46,8 / 29,9% ở I1-I5 (đạt mọi mục tiêu); sau cổng dựng được 100%, bot thắng ≥ 67,1%, không màn nào bị từ chối. Lát phụ `kill:40` yếu ở hỗn hợp toàn brute và `all4` I2 (xem Stage 4D.1 trong shooter-calibration.md).
- **Chưa làm**: xây tháp, nhiều căn cứ, sửa căn cứ; căn cứ chỉ ở giữa sân.
## Stage 5A: hệ thống diện mạo (gói ảnh, chuyển động mượt, nhiều phong cảnh)

- **Diện mạo chỉ là "áo".** Lõi mô phỏng không đổi hành vi, hộp va chạm hay số liệu; `snapshotHash` không chứa `look`; ba bản chụp vàng cũ và bản `4d` không đổi một byte; các lát hiệu chỉnh `old|new|boss|base` giống từng ký tự.
- **Dữ liệu**: màn có thêm trường tùy chọn `look` ({biome, hero, family, base, weapon}, mỗi cái là id chuỗi; contracts không liệt kê id). Brief có thêm `enemyFamily: auto|bug|mutant|robot` (bắt buộc, `normalizeBrief` điền `auto`; chốt chặn không áp). `apps/api/src/shooter/look.ts` (`LOOK_OPTIONS`, `pickLook`) chọn nhân vật, căn cứ, súng (và họ quái khi `auto`) bằng băm số nguyên theo hạt giống của màn; phong cảnh là `theme`.
- **Gói ảnh**: thư mục `apps/web/public/art/<loại>/<id>/{manifest.json, sheet.png}`; định dạng ở [art-packs.md](art-packs.md), schema `ManifestSchema` ở `packages/contracts/src/art.ts`. PNG thật được ưu tiên hơn gói do code vẽ; thiếu hay lỗi thì rơi về gói do code vẽ (`apps/web/src/game/art/procedural/`). Thả ảnh thật vào (Stage 5B) không phải sửa code.
- **Đường truyền**: khung game có CSP `img-src data: blob:` (không đổi), nên trang cha đọc `art/index.json`, tải đúng các gói PNG của màn (song song, 4 giây, không thử lại), gửi dưới dạng data URL trong `runtime:init.art` (tối đa 12 gói, 1,5 MB mỗi ảnh, 6 MB tổng). Khung game kiểm tra lại từng gói; gói hỏng bị bỏ và tính vào `data-art-fallbacks`.
- **Dựng hình** (`apps/web/src/game/render/`): sprite theo id, làm mượt giữa hai nhịp (nội suy), hoạt ảnh theo thời gian thật, xoay dần, trạng thái hoạt ảnh suy ra từ thay đổi giữa hai khung hình (không thêm gì vào mô phỏng), nền vẽ một lần vào một canvas, vật trang trí rải theo hạt giống, rung màn hình (tắt khi `prefers-reduced-motion`). `#game-hud` thêm `data-look`, `data-art-fallbacks`, `data-art-sources`, `data-enemies`, `data-update-ms`; các `data-*` cũ giữ nguyên và vẫn là vị trí mô phỏng thật.
- **Xem thử**: `/?shooter=art-showcase&biome=…&hero=…&family=…&base=…&weapon=…&boss=crusher|gunner&stress=120`, và `art-test` dùng gói PNG thật `hero/grunt-test` (làm bởi `apps/web/scripts/make-test-art.mjs`).
- **Chưa làm**: ảnh thật (Stage 5B), âm thanh, cảm ứng.
## Stage 6A: đổi súng ngay trong game

- **Mục đích**: mỗi màn có một súng cố định do câu lệnh chọn; người chơi giờ đổi được súng khi chơi: phím **1–5** (cả phím số phụ) và **cuộn chuột** (vòng tròn). Thứ tự: 1 `pistol`, 2 `shotgun`, 3 `piercing`, 4 `rapid`, 5 `heavy`.
- **Lõi** (`packages/contracts/src/shooter/equip.ts`, bước **3b `equipWeapon`** giữa "ngắm" và "bắn"): màn có `arsenal` (2..5 mục `{id, weapon}`; `weapon` của màn phải giống hệt một mục, đó là súng khởi đầu) có thêm `state.weaponSlot` và `state.equipUntilTick`; `ShooterInput.slot` tùy chọn, giá trị không hợp lệ (không nguyên, âm, ≥ số ô, NaN, vô cực, chuỗi) bị bỏ qua. Đổi súng mất `EQUIP_MS = 300` ms không bắn được; `player.nextShotTick` dùng chung nên đổi súng không làm bắn nhanh hơn. Mỗi viên đạn giữ `damage` và `range` của súng đã bắn nó (chỉ trong màn có `arsenal`), vì người chơi có thể đổi súng khi đạn đang bay. `snapshotHash` thêm `weaponSlot`, `equipUntilTick` (và damage/range của đạn) ở cuối, chỉ khi có.
- **Cộng thêm**: màn không có `arsenal` (mọi màn cũ, màn đã lưu, `loadout: single`) chạy ra đúng từng bit; bốn bản chụp vàng cũ và bốn lát hiệu chỉnh `old|new|boss|base` không đổi. Bot (`botInput`, `createCasualBot`) không bao giờ gửi `slot`, nên cổng và hiệu chỉnh vẫn đo bằng súng khởi đầu; người chơi thật đổi được súng sẽ dễ thắng hơn bot một chút (chấp nhận).
- **Brief**: `loadout: all|single` (bắt buộc, `normalizeBrief` điền `all`); `weapon` nay là súng **khởi đầu**. `guardUnrequested` giữ `single` chỉ khi câu của người dùng có ý giới hạn súng (từ khóa rộng, VN và EN; không báo người dùng, ghi vào `guardRemoved`); từ khóa rộng nên "chỉ có zombie" cũng giữ `single` (chấp nhận), còn "chỉ huy" thì không. Nhóm thông báo "đổi giữa nhiều vũ khí" bị bỏ (đã hỗ trợ); hết đạn, nâng cấp, nhặt súng vẫn báo chưa hỗ trợ.
- **Biên dịch**: `loadout: all` ra `arsenal` đủ 5 súng theo thứ tự phím (số liệu của bảng `WEAPONS`), `level.weapon` là súng của `brief.weapon`; `single` không có `arsenal`. Cổng và các số hiệu chỉnh không đổi.
- **Giao diện**: thanh súng giữa phía dưới sân (chỉ khi có `arsenal`; ô 40×40 có số phím, biểu tượng súng từ trường `icon` của gói `weapon`, ô đang cầm viền trắng, lớp tối quét theo thời gian chờ); nhân vật cầm đúng súng đang dùng, súng "nhấc lên" trong 300 ms khi đổi; dòng gợi ý "1–5 hoặc cuộn chuột: đổi súng" trong biểu ngữ; thẻ thông tin có hàng "Đổi súng". `#game-hud` thêm `data-weapon`, `data-slot`, `data-equip`, `data-weapon-bar`, `data-bullets` (chỉ khi có `arsenal`, trừ `data-bullets`). Màn tay mới `arsenal`; playground có `&loadout=single`.
- **Chưa làm**: hết đạn, nạp đạn, nhặt súng, nâng cấp súng, bot biết đổi súng. Số liệu bot thắng theo súng cho thấy `rapid` vượt trội và `pistol` yếu nhất (xem báo cáo của Stage 6A); đề xuất chưa thực hiện: giới hạn đạn cho súng mạnh.
## Stage 6B: sửa lỗi chọn súng và căn cứ to hơn

- **Chọn súng bằng từ khóa, không tin hẳn vào mô hình** (`weapon-words.ts`, `weapon-guard.ts`, gọi sau `guardUnrequested` trong `service.ts`). Bảng tên súng (VN không dấu và EN): `pistol` = súng ngắn, súng lục; `shotgun` = shotgun, súng săn, súng hoa cải; `piercing` = súng xuyên, xuyên giáp, bắn xuyên; `rapid` = súng bắn nhanh, bắn nhanh, súng nhanh, liên thanh, **súng** liên tục (không phải "liên tục" một mình), tiểu liên, súng tự động, SMG, machine gun; `heavy` = súng nặng, hạng nặng, đại bác, heavy, cannon. Tên súng đứng ngay sau từ phủ định (không, đừng, bỏ, trừ, ngoài trừ, without, no, not, except) không tính ("đừng" tách khỏi "dùng" nhờ dấu). Hai nhóm từ giới hạn: `LIMIT_PHRASES` (nói thẳng về súng: một loại súng, không được đổi súng, súng cố định, one weapon...) và `LIMIT_WORDS` (chung chung: chỉ có, chỉ dùng, chỉ được, chỉ xài, duy nhất, only, just a...), nhóm sau chỉ có nghĩa khi đúng MỘT súng được gọi tên (nên "chỉ có zombie" và "chỉ huy" không ép một súng). Quy tắc: (1) một súng được nêu: `weapon` là súng đó; (2) kèm từ giới hạn: `loadout: single`, nếu không thì `single` do mô hình đưa về `all`; (3) không nêu súng nhưng có `LIMIT_PHRASES`: `single`, giữ súng của mô hình; (4) nêu từ hai súng: `weapon` là một trong chúng, `loadout: all`, và nếu có từ giới hạn thì thêm thông báo "Chưa hỗ trợ: chỉ giữ một vài súng; màn có đủ 5 súng, bắt đầu bằng ..."; (5) không có từ giới hạn thì `single` về `all`; (6) không nêu súng và không từ giới hạn thì không đụng `weapon`. Mọi thay đổi ghi vào chẩn đoán `guardChanged: [{field, from, to}]` cạnh `guardRemoved` (không báo người dùng, trừ trường hợp (4)).
- **Câu lệnh cho mô hình**: dòng `weapon` và `loadout` kèm bảng từ đồng nghĩa và câu "nêu MỘT súng và nói chỉ có/chỉ dùng thì `weapon` là súng đó VÀ `loadout` là `single`"; dòng `theme` không còn liệt kê `desert-ruins` hai lần; `normalizeBrief` không còn khối "missing loadout" lặp. Giới hạn độ dài câu lệnh trong test nâng từ 4.600 lên 5.200 (5.070 ký tự).
- **Tên súng tiếng Việt trong game** (`shooter-text.ts`, một bảng `WEAPON_TEXT`): 1 Súng ngắn, 2 Shotgun (súng săn), 3 Súng xuyên giáp, 4 Súng bắn nhanh (liên thanh), 5 Súng nặng, mỗi súng một câu mô tả (số lấy từ dữ liệu súng của màn). Thanh súng hiện tên súng đang cầm phía trên (`data-weapon-name`), thẻ thông tin liệt kê đủ 5 súng.
- **Căn cứ to hơn**: `level.base.size` (56..120, tùy chọn, mặc định `BASE_SIZE` 56); `baseRectOf` và `baseSizeOf` dùng chung; điều hướng, tường chắn đạn, chạm của quái, dây buộc bot (điểm canh gác = nửa cạnh + 46 px, đúng 74 với căn cứ 56) và các kiểm tra của schema đều đi qua hình vuông đúng kích thước. Căn cứ do compiler dựng: 72 px, máu 200, người chơi cách mép 30 px (xem [shooter-calibration.md](shooter-calibration.md), "Stage 6B"; thử 88, 80, 72, chỉ 72 đạt hết các dải). `BASE_TUNING` không đổi.
- **Giao diện**: sprite co theo `bodyScale(body, size)`, gói căn cứ vẽ bằng code 120×120 với thân 80 (`docs/art-packs.md`); màn tay mới `base-siege-big`, `base-boss-big` (80 px); `#game-hud` thêm `data-base-side`, `data-base-touching`, `data-base-inside`; playground thêm `&basehp=N`.

## Dọn nhà: shooter là sản phẩm duy nhất

- **Đã xóa** phần cũ từng bị đóng băng: "Standard" (GameSpec v1: platformer, Dodge/Collect, màn "Moonlight Run", route `/api/games/generate`, app `/?legacy=standard`, các dịch vụ sửa vị trí và mô phỏng nhảy) và "Advanced Mode" (AI Code Agent, sandbox Docker, hàng đợi job, các route `/api/agent/*`, biến `ADVANCED_AI_ENABLED`, `vitest.advanced*`). Bản cũ vẫn lấy lại được bằng tag **`legacy-standard-v1`** (`git checkout legacy-standard-v1`) và toàn bộ lịch sử git; không giữ gì "để phòng hờ" trong cây làm việc.
- **Cấu trúc mới.** `packages/contracts/src/shooter/` (lõi mô phỏng thuần + schema màn), `packages/contracts/src/{index,ai}.ts` (hợp đồng API và nhà cung cấp), `apps/api/src/shooter/` (brief, compiler, cổng bot, dịch vụ), `apps/api/src/{providers,services,http}/` (hạ tầng AI dùng chung: nhà cung cấp, `AiGateway`, ngân sách yêu cầu, chẩn đoán trên đĩa), `apps/web/src/` (App, các thành phần nhỏ, ShooterScene vẽ). Bốn route còn lại: `GET /api/health`, `GET /api/ai/providers`, `POST /api/ai/test-connection`, `POST /api/shooter/generate`.
- **Nguyên tắc.** Shooter là sản phẩm duy nhất; mô phỏng không biết Phaser, DOM, đồng hồ hay `Math.random` (test chặn); `apps/api` không import `apps/web` và ngược lại (có test); hạ tầng AI không biết gì về game. Muốn thêm một thể loại khác thì làm lại từ lõi, không nối vào đây.
- **Đổi nhỏ khi dọn:** lựa chọn "demo" của giao diện là `demo` / `shooter-arena` (trình duyệt đã lưu `demo` / `platformer-v1` được đọc thành demo mới); chẩn đoán trên đĩa đổi tên kiểu và hàm (`RunDiagnostics`, `openRunDiagnostics`) nhưng giữ nguyên biến môi trường `STANDARD_DIAGNOSTICS(_DIR)`, thư mục `.local-diagnostics/` và dạng file; trường `genres` của `capabilities` trong `/api/ai/providers` đã bỏ.
- Số liệu hiệu chỉnh và các bản chụp vàng không đổi một byte: [shooter-calibration.md](shooter-calibration.md); nhà cung cấp và giới hạn: [providers.md](providers.md).
