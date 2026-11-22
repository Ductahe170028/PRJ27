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

0. Dọn nền
1. Lõi shooter không AI
2. Brief + compiler + AI
3. Kiểm chứng (ngân sách phân tích, sau đó bot)
4. Đa dạng
5. Benchmark 30 prompt (mục tiêu ≥ 85% thành công lần đầu)
6. Chỉnh bằng prompt
