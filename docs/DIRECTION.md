# Hướng phát triển

Quyết định chốt sau Standard 1A–1C. Cập nhật khi có quyết định mới, không viết lại lịch sử.

## Sản phẩm

- **Top-down Survival Shooter**: một engine, nhiều game tùy biến bằng prompt (bối cảnh, quái, tốc độ, độ khó).
- Không còn hứa "tạo mọi thể loại". Yêu cầu ngoài khả năng engine được báo rõ, không làm im lặng.

## Đóng băng

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

- **Brief** (`apps/api/src/shooter/brief.ts`): chỉ ngữ nghĩa, chọn từ danh sách cố định (8 theme, 5 map, 3 loại quái, độ khó 1-5, máu, vũ khí, mục tiêu) cộng `unsupported`. AI không bao giờ sinh tọa độ hay số vật lý. Giá trị số và độ dài được kẹp (`normalizeBrief`), giá trị enum sai thì từ chối, không đoán.
- **Preset** (`presets.ts`): bảng duy nhất biến từ thành số (máu 3/5/8, ba vũ khí, màu theo theme, tốc độ người chơi 210).
- **Compiler** (`compile.ts`, `maps.ts`, `waves.ts`): xác định theo `seed`. Bố cục map phải qua schema, nối được mọi điểm xuất hiện tới người chơi cho một con brute, và khe ≥ 60 px; không vừa thì thử 8 biến thể rồi rơi về đấu trường trống kèm thông báo. Lịch wave theo nhịp `INTENSITY_RATE` (đe dọa mỗi giây, chia cho trọng số trung bình của loại quái) và giảm nhịp khi màn dài hơn 60 s.
- **Cổng bot** (`gate.ts`): bot chơi level trên 3 seed. Thua cả 3 thì giảm mật độ (tối đa 4 lần x0.8); thắng hết, còn ≥ 90% máu, độ khó ≥ 3 thì tăng (tối đa 2 lần x1.2). Mỗi điều chỉnh có một thông báo. Bot là giám khảo "một người chơi đơn giản thắng được không", không đại diện người thật. Chạy trong worker, tối đa 8 s.
- **Hiệu chỉnh** (`npm run shooter:calibrate -w @game-creator/api`, kết quả ở [shooter-calibration.md](shooter-calibration.md)): chỉ chỉnh `INTENSITY_RATE`, trọng số loại quái và hệ số nhịp.
- **Thông báo cho người dùng** (`notices.ts`): yêu cầu engine không có (boss, xe, nhiều người, bảo vệ căn cứ, hết đạn, vật phẩm, đổi vũ khí, chế tạo, bẫy) luôn hiện ra. Model ghi vào `unsupported`, và một bảng từ khóa cố định bổ sung câu chuẩn nếu model quên. Không im lặng bỏ qua.
- **Giao diện**: `/` là ShooterApp; `/?shooter=<level>` là sân chơi level viết tay; `/?legacy=standard` là app Standard cũ (GameSpec v1), giữ nguyên.
- **Không có retry, không gọi AI lần hai, không game dự phòng khi lỗi.** Biến thể map nội bộ là điều chỉnh của engine và được báo cho người dùng.
