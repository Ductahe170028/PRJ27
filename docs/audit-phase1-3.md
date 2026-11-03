# Code Audit + Refactor — Phase 1–3

Ngày: 2026-11-03. Mốc trước refactor: `6e277d3`, working tree sạch. Môi trường kiểm tra: Windows, Node 22.11, npm workspaces, Chromium Playwright.

Phạm vi gồm frontend, backend, contracts, providers, agent, compiler worker, browser tester, hai runtime Phaser, cấu hình build và toàn bộ tests. Đây là đợt rà soát mã và hồi quy local, không phải chứng nhận an toàn để mở Advanced công khai. Không triển khai Phase 4.

## Vấn đề và cách xử lý

| Mức | Phát hiện | Sửa / bằng chứng |
| --- | --- | --- |
| P2 | `reserve().release()` gọi lần hai có thể mở slot của job mới, phá giới hạn một job Advanced. | Release idempotent theo từng reservation; test giữ job thứ hai rồi gọi lại release cũ. Đây là lỗi tiềm ẩn, chưa thấy route hiện tại gọi release hai lần. |
| P2 | Orchestrator chưa kiểm tra cancellation sau compile/browser test; có thể chuyển bước hoặc phát `completed` khi đã hủy. | Kiểm tra abort tại các ranh giới bất đồng bộ; không bắt đầu browser/repair hoặc phát artifact sau hủy. Test cả cancel trước chạy, trong validation/testing và ngắt HTTP stream thật. Route trước đây đã chặn ghi lên socket đóng; sửa này ngăn xử lý thừa bên trong pipeline. |
| P2 | Compiler trả kết quả ngay khi gọi `worker.terminate()` mà chưa chờ worker thoát. | Chờ termination, dọn listeners, xử lý termination rejection. Test trì hoãn termination, late message/exit, timeout và pre-abort; vẫn có test compiler worker thật. |
| P2 | Route đặt/flush stream headers trước `try/finally`; lỗi tại đây có thể giữ slot mãi. Error middleware cũng chưa xét `headersSent`. | Đưa toàn bộ setup stream vào vùng cleanup; khi headers đã gửi thì chuyển lỗi cho Express đóng stream, không cố ghi JSON lần nữa. Test giả lập lỗi flush headers và xác nhận có thể reserve lượt tiếp theo. |
| P2 | Client nhận và publish artifact `completed` trước khi kiểm tra hết NDJSON; dữ liệu lỗi phía sau hoặc kết nối đứt vẫn có thể để lại preview. | Chỉ commit event cuối sau EOF hợp lệ. Giữ schema, thứ tự event và giới hạn 200 KB. Test UTF-8 chia chunk, stream cụt, JSON/schema sai, terminal lặp, dữ liệu thừa, lỗi transport và giới hạn byte. |
| P2 | Advanced ép kiểu error body, khác Standard đang validate bằng Zod; content type sai cũng chưa hủy response body. | Dùng chung `ApiErrorSchema`, giữ code/retryAfter khi hợp lệ và dùng thông báo HTTP khi sai; cancel body không hợp lệ. Test cả Standard/Advanced, quota và không tự retry. |
| P2 | Watchdog có thể hiểu nhầm tab vừa được đánh thức là game treo vì timer/heartbeat đều bị trình duyệt tạm ngừng. | Reset mốc heartbeat khi tab trở lại visible, gỡ listener khi unmount. E2E mô phỏng thời gian bị gián đoạn, đồng thời kiểm tra game thật sự không phản hồi vẫn bị dừng. |
| P3 | API config Advanced chưa có timeout; code URL/auto-model và response-abort bị lặp. | Dùng timeout JSON hiện có 60 giây và helpers chung; giữ timeout generation 255 giây. Test timeout và cleanup khi response đóng/hoàn tất/lỗi. |
| P3 | `PlaywrightGameTester.test` trộn quản lý process với toàn bộ thao tác gameplay; có thể launch browser sau khi hủy trong lúc đọc runtime. | Tách smoke checks, kiểm tra abort trước launch. Giữ mọi check gameplay, network block, sandbox, timeout và kill fallback. Thêm lifecycle tests; E2E vẫn dùng Chromium thật. |
| P3 | Typecheck frontend bỏ sót `vite.advanced.config.ts`; unit runner chỉ nhận tests backend. | Bổ sung config và frontend tests vào phạm vi kiểm tra. |

Năm assertions hồi quy đầu tiên đã thất bại trên implementation cũ (release cũ, cancellation và worker lifecycle), sau đó qua với bản sửa. Các tests cũ đều được giữ.

## Những file đã refactor

| File / nhóm | Lý do |
| --- | --- |
| `apps/api/src/agent/orchestrator.ts` | Bảo vệ slot, chặn xử lý sau abort; deadline 4 phút có cleanup trong `finally`. |
| `apps/api/src/agent/isolated-validator.ts` | Đợi worker dừng trước khi chuyển bước, dọn listeners. |
| `apps/api/src/agent/game-tester.ts`, `browser-smoke-checks.ts` | Tách quản lý Chromium khỏi checks canvas/input/restart; các bước kiểm tra được chuyển nguyên logic. |
| `apps/api/src/app.ts`, `agent/routes.ts`, `http/response-abort.ts` | Dùng một lifecycle response-abort cho ba endpoint; bảo vệ setup stream và error middleware. |
| `apps/web/src/lib/api.ts`, `api-client.ts`, `agent-api.ts`, `agent-stream.ts` | Tách endpoint khỏi transport/error handling; parser stream có thể kiểm thử độc lập, giữ validation trước preview. |
| `apps/web/src/components/CodePreview.tsx` | Sửa watchdog khi resume tab và cleanup visibility listener. |
| `apps/api/src/providers/game-provider.ts` | Sửa comment Phase 1 lỗi thời: đây là demo contract; AI đã có interface riêng. |
| `apps/web/tsconfig.json`, `vitest.config.ts` | Bao phủ config Advanced và frontend unit tests. |
| `apps/api/test/code-agent.test.ts`, `isolated-validator.test.ts`, `game-tester.test.ts`, `response-abort.test.ts` | Hồi quy slot, cancel, timeout, worker/process/listener cleanup và HTTP stream. |
| `apps/web/test/agent-stream.test.ts`, `api-client.test.ts`, `e2e/advanced.spec.ts` | Hồi quy dữ liệu stream, lỗi HTTP, timeout và watchdog. |

## Code và dependencies

- Gộp ba bản response-abort thành một helper; loại phần xử lý lặp tại các route.
- Gộp API base URL, chuyển `auto` thành request không có model ID, và parse error body; loại ép kiểu error response thiếu validation của Advanced.
- Chuyển smoke checks khỏi hàm quản lý browser, bỏ imports tại vị trí cũ; sửa comment hướng dẫn thay demo bằng AI không còn đúng kiến trúc hiện tại.
- `strict`, `noUnusedLocals`, `noUnusedParameters` và lint đều qua. Đối chiếu manifests với imports, scripts/configs và `npm ls --depth=0`: chưa có bằng chứng về dependency trực tiếp dư để gỡ. Không xóa package hoặc thay đổi lockfile/phiên bản.
- TypeScript ở root phục vụ tooling; TypeScript ở API là dependency runtime của compiler. `playwright` ở API chạy GameTester, `@playwright/test` ở root chạy E2E. Đây không phải dependencies thừa chỉ vì tên gần nhau hoặc được npm hoist.
- Giữ demo provider/service và hai scene Standard: chúng phục vụ các luồng đang dùng. Giữ các lớp validation ở backend, client và iframe vì mỗi lớp bảo vệ một ranh giới khác nhau.
- Không xóa tests chỉ vì có dữ liệu fixture trùng: API tests kiểm tra rejection/error contract; browser tests kiểm tra input, va chạm, thắng/thua, restart và cách ly thật.

## Kiến trúc, bảo mật và hiệu năng đã rà soát

- API routes, request/response schemas, GameSpec, provider catalog/defaults, quota, số lần repair và cơ chế sandbox được giữ nguyên. Không chỉnh `packages/contracts`, AST policy, compiler instrumentation hoặc các runtime game.
- Provider SDK không được tự retry; selection resolve theo request; backend normalize lỗi trước khi gửi client. API key chỉ thuộc backend. Không đọc/sửa `.env` hoặc gọi Gemini/Groq thật trong đợt này.
- Advanced vẫn local-only. Source AI chỉ là dữ liệu trong Node/compiler worker; artifact chạy trong Chromium/iframe `allow-scripts`, opaque origin. CSP, chặn network, kiểm tra source/origin/session, giới hạn code/entity/CPU, worker memory limit và Chromium sandbox không bị loại bỏ.
- Phase 2 vẫn repair có giới hạn, bảo toàn số lượng/giá trị/mục tiêu, từ chối layout không chứng minh được đường đi an toàn. Các giới hạn số node/bước mô phỏng ngăn tính toán hình học tăng vô hạn.
- Provider requests có timeout/abort/budget; map budget giới hạn 1.000 client; agent một browser job; compiler worker có giới hạn tài nguyên; logs/stream/telemetry đều có giới hạn. Phaser scenes dọn các DOM/input listeners theo lifecycle scene; React abort requests và tháo listeners/timers khi unmount.
- Hai runtime bundle trước/sau giữ nguyên kích thước: Standard khoảng 1.600,52 kB (gzip 375,20), Advanced 1.486,18 kB (gzip 342,10). Phaser chiếm phần lớn. Không đổi cách bundle/runtime loading vì liên quan sandbox; đây không phải đợt tối ưu bundle hay benchmark.

## Kết quả trước và sau

| Kiểm tra | Trước | Sau |
| --- | --- | --- |
| `npm run lint` | Qua | Qua |
| `npm run typecheck` | Qua | Qua, gồm frontend tests/config Advanced |
| `npm run build` (chạy trong `test:e2e`) | Qua | Qua |
| `npm test` | 149/149, 6 files | 186/186, 11 files |
| `npm run test:e2e` | 22/22 | 23/23, khoảng 2 phút |
| `npm ls --depth=0` | Manifests/lockfile không đổi | Qua, không invalid/missing dependencies |
| `npm audit --omit=dev` | Dependencies không đổi | 0 cảnh báo |
| `npm audit` | Dependencies không đổi | 7 moderate, 0 high/critical, thuộc chuỗi lint tooling |

E2E dùng provider mock nhưng compiler, worker, HTTP, Chromium tester, React và Phaser thật. Bộ test bao phủ Demo, Standard platformer/top-down, Gemini/Groq settings, model auto/lưu selection, error/quota, geometric repair, Advanced shooter/paddle, repair, retry, runtime budget và sandbox.

Chạy lại từ thư mục root trên Windows:

```powershell
npm run lint
npm run typecheck
npm test
npm run test:e2e
```

`test:e2e` đã chạy build trước Playwright. Chạy ứng dụng vẫn bằng `npm run dev` tại root; không cần cài thêm dependency hoặc chỉnh `.env` cho bản refactor này.

## Rủi ro và giới hạn còn lại

1. **Lint tooling:** 7 mục moderate cùng bắt nguồn từ [minimatch GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249). npm chỉ gợi ý thay major/downgrade không phù hợp với bộ config đang dùng; không chạy `audit fix --force` hay ép override minimatch major khác. Pipeline tạo game không chạy ESLint trên code AI. Cần cập nhật tooling khi có bộ phiên bản tương thích đã kiểm thử.
2. **Advanced local MVP:** browser sandbox/AST/instrumentation không thay thế OS isolation hoặc hard RAM/CPU quotas. Đây vẫn là giới hạn đã ghi trong Phase 3, không được nới lỏng sau audit.
3. **Chất lượng gameplay:** smoke tester kiểm tra khởi động/input/restart, chưa chứng minh tất cả cơ chế/mục tiêu từ prompt hoặc quan hệ nhân quả của mỗi input. Kiểm tra đường đi Standard còn bảo thủ. Không thay các thuật toán này trong đợt refactor bảo toàn hành vi.
4. **Live AI:** không xác minh lại key, quota hay chất lượng output thực tế của từng tài khoản; regression dùng mock providers để tránh tiêu quota. Catalog là cấu hình tĩnh hiện có.
5. **Hiệu năng/cleanup:** tests xác nhận các nhánh cleanup, timeout và cancellation; chưa chạy soak test/heap profiling dài hạn hoặc kiểm chứng forced process termination ở cấp hệ điều hành.
6. **Build warnings:** cảnh báo Rollup về vị trí chú thích `@__PURE__` trong Zod và `NO_COLOR`/`FORCE_COLOR` vẫn có như mốc ban đầu; build thành công. Không che warnings hoặc sửa dependency trong `node_modules`.
