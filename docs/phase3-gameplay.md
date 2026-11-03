# Phase 3 — kiểm tra chính xác cơ chế bắn

Ngày kiểm tra: 2026-11-03. Phạm vi: Advanced AI Mode; không triển khai Phase 4 hay thay đồ họa.

## Nguyên nhân và thay đổi

Runtime Phaser của Advanced vẽ entity nhưng không tự áp dụng `vx/vy`. Code đặt vận tốc mà không cộng `x/y` theo `dt`, hoặc chỉ cập nhật đạn trong nhánh giữ Space, vẫn compile và tạo vật thể nhìn thấy được. Tester cũ chỉ so sánh ảnh/HUD sau thao tác; chuyển động của địch cũng có thể làm ảnh thay đổi. Vì thế nó chưa loại được hai lỗi này. Không có source của chính lượt lỗi người dùng đã chơi để xác nhận nhánh nào xảy ra trong lượt đó; cả hai trường hợp đã được tái hiện bằng chương trình compile và khởi động thành công.

- `agents.ts`: hướng dẫn rõ bắn khác đặt mìn; spawn ngoài mép trước player, cập nhật mọi viên đạn mỗi frame dù đã nhả nút, collision/hp và cleanup. Tránh `continue` bỏ qua việc cập nhật đạn.
- `gameplay-requirements.ts`: suy ra yêu cầu bắn và hướng từ request gốc/plan, phân biệt hướng di chuyển với hướng bắn. Request gốc ưu tiên hơn plan. Không mở rộng public API/GamePlan/GameSpec.
- `gameplay-probe.ts`: facade quan sát chỉ trong tài liệu test Chromium, giữ getter và chuyển tiếp API đến host thật. Ghi nhận ID/tọa độ spawn và collision có giới hạn; không đưa probe vào preview hay artifact trả về.
- `browser-gameplay-checks.ts`, `projectile-checks.ts`: thao tác phím/chuột thật, kiểm tra vị trí phóng, hai khoảng di chuyển sau nhả nút, sát thương khi trúng và thu hồi ngoài màn hình. Không dựa vào tên aircraft/bullet/enemy, màu hoặc vị trí máy bay cố định.
- `browser-smoke-checks.ts`, `game-tester.ts`, `orchestrator.ts`: giữ smoke/restart checks, chuyển request gốc đến kiểm tra gameplay. Lỗi quay về Repairing như lỗi runtime, tối đa 2 lần. Giới hạn browser test tăng từ 15 lên 25 giây để đủ các kịch bản; deadline job vẫn 4 phút.

Đường bay được quan sát tự nhiên. Hai tình huống có sắp xếp: đưa một target thật vào đường bắn, giữ nguyên hp để kiểm tra damage; đưa đạn đã quan sát ra ngoài biên để kiểm tra cleanup bằng update thật. Không chèn logic di chuyển/sát thương thay AI. Sandbox `allow-scripts`, CSP, compiler policy, loop/CPU budgets, runtime và giao diện preview giữ nguyên.

## Kiểm thử

| Kiểm tra | Kết quả |
| --- | --- |
| ESLint | Qua |
| TypeScript strict / workspaces / test / tooling | Qua |
| Build frontend/backend và hai runtime | Qua |
| Unit/API/frontend | 215/215 qua |
| E2E Chromium | 33/33 qua |

Unit thêm kiểm tra suy ra hướng bắn Việt/Anh, ưu tiên request, phân biệt di chuyển/hướng địch, không áp dụng cho bóng bật/đặt mìn, pointer, launch offset và chuyển động. Orchestrator test xác nhận request/diagnostics đi qua đúng vòng repair.

E2E thêm 8 ca gameplay: đứng yên dù đã gán vận tốc, chỉ bay khi giữ nút, thiếu damage, thiếu cleanup, sai hướng, sinh giữa player, game bắn ngang đúng và game dùng chuột đúng. Một ca HTTP/UI nữa xác nhận đạn đứng yên bị bắt, sửa 1 lần rồi mới Completed; pixel trong preview tiếp tục đi lên sau nhả Space. Các test Standard, Settings, provider, quota, runtime budget và sandbox tiếp tục được chạy.

Lệnh kiểm tra:

```powershell
npm run lint
npm run typecheck
npm test
# Nếu Windows báo kill EPERM lúc đóng Vitest fork worker:
npx vitest run --pool=threads --maxWorkers=2
npm run test:e2e
```

`npm test` đã chạy qua các assertion nhưng môi trường kiểm tra Windows báo `kill EPERM` lúc đóng một fork worker. Chạy lại toàn bộ bằng worker threads đạt 215/215, exit 0 và không có cảnh báo đó; không sửa cấu hình pool của dự án. Build vẫn có warning annotation Zod như trước.

## Một lượt Groq thật

Dùng cấu hình hiện có, model `openai/gpt-oss-20b`, prompt máy bay đơn giản trong diagnostic `groq-live.smoke.ts --live --simple`. Hoàn thành sau 1 repair sửa lỗi cú pháp, rồi vượt Chromium tester có các kiểm tra gameplay mới. Không gặp 429 trong lượt này.

| Bước | Input token | Output token | Tổng |
| --- | ---: | ---: | ---: |
| Planning | 386 | 123 | 509 |
| Coding | 1210 | 675 | 1885 |
| Repairing 1 | 1889 | 615 | 2504 |
| Tổng | 3485 | 1413 | 4898 |

Số liệu lấy từ `usage` của Groq, output bao gồm reasoning. Cap giữ nguyên: Planning 450, Coding/Repairing 2400; vẫn chờ theo header, chia request quá lớn và không đổi provider/model. Không thêm AI judge hoặc provider call để kiểm tra gameplay. Bộ unit/E2E dùng mock provider, không đọc key; lượt live là phép thử riêng. Kết quả một lượt không bảo đảm mọi prompt đều thành công.

## Giới hạn

Phân tích yêu cầu dùng mẫu Việt/Anh có giới hạn, chưa phải hiểu toàn bộ mô tả tự nhiên. Chọn target và thời gian quan sát còn bảo thủ; game nhiều vật trang trí/vật cản, projectile sống cực ngắn hoặc target xuất hiện quá muộn có thể bị từ chối. Không chứng minh đầy đủ cân bằng, boss hoặc mọi điều kiện thắng. Các cơ chế ngoài bắn vẫn được kiểm bằng smoke/restart và bộ E2E riêng; không tuyên bố đã có trình tự chơi tổng quát cho mọi thể loại.

Để thử lại, chạy `npm run dev` tại root và Generate Game mới trong Advanced. Artifact đang mở trước thay đổi không tự được sửa lại.
