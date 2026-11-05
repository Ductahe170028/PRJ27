# Phase 3 — AI Code Agent (local MVP)

Standard giữ nguyên endpoints, renderer, provider và validation của Phase 1–2. Advanced là pipeline riêng, nhận cùng lựa chọn Gemini/Groq/model. Không có provider mặc định ngầm hoặc fallback template. Advanced chờ quota Groq ngắn hạn theo header; không tự retry quota ngày/lỗi xác thực hoặc đổi provider/model. Không cần dịch vụ hoặc asset trả phí; các model vẫn bị giới hạn bởi catalog/allowlist hiện có. Việc tài khoản provider đã bật billing hay chưa vẫn do chủ tài khoản kiểm soát.

## Chạy thử trên Windows

Tại root, dùng Node 22+ và npm:

```powershell
npm install
npx playwright install chromium
npm run dev
```

Mở http://127.0.0.1:5173, chọn Advanced AI Mode rồi chọn Gemini hoặc Groq trong Settings. Key chỉ đặt trong `apps/api/.env`. Không thay nội dung key hiện có. `npm run dev` build/watch cả hai runtime; nếu chạy frontend/backend riêng, chạy `npm run build` trước để tester đọc được `apps/web/public/runtime/advanced.js`.

Hai prompt gợi ý:

- `Tạo game bắn máy bay, có đạn, kẻ địch xuất hiện liên tục, điểm số và boss. Đánh bại boss để thắng.`
- `Tạo game đỡ bóng phá gạch. Thanh đỡ di chuyển ngang, bóng bật vào tường và thanh đỡ, phá hết gạch để thắng, bóng rơi xuống dưới thì thua.`

Mỗi yêu cầu phải được model viết thành code mới. Hai chương trình mẫu trong `apps/api/test/agent-fixtures.ts` chỉ dùng cho test, không được import vào entrypoint production và không thay thế kết quả AI.

## Module và luồng xử lý

| File/module | Trách nhiệm |
| --- | --- |
| `packages/contracts/src/code-agent.ts` | Plan, source, project, stream events, GameAPI và HTML sandbox chung |
| `apps/api/src/agent/agents.ts` | GamePlanner, CodeGenerator, CodeRepairAgent; dùng lại GameGenerationService và ProviderRegistry |
| `code-validator.ts` | AST policy, strict TypeScript trên thư viện kiểu tối thiểu, compile và chèn bộ đếm |
| `isolated-validator.ts`, `validator-worker.mjs` | Worker kiểm tra/biên dịch, giới hạn tài nguyên, hủy và timeout |
| `game-tester.ts`, `browser-smoke-checks.ts` | Quản lý Chromium process riêng và kiểm tra gameplay/input/restart; không profile người dùng |
| `orchestrator.ts`, `routes.ts` | Planning → Coding → Validating → Testing → Repairing → Completed/Failed, khóa 1 job |
| `apps/web/src/game/code-runtime.ts` | Phaser host, API giới hạn, input, render, score, restart, ngân sách runtime |
| `AdvancedWorkspace.tsx`, `CodePreview.tsx`, `lib/agent-api.ts`, `lib/agent-stream.ts` | Mode, stream trạng thái có validation, kế hoạch/log lỗi, preview và Retry |

Plan là một JSON gồm title, summary, mechanics, movement, action, objective. Model trả phần thân `setup`, `update`, cùng `helpers`; backend thêm chữ ký hai hàm có kiểu, rồi CodeGenerator trả lại đúng contract `{ "source": "..." }` cho duy nhất `game.ts`. Toàn bộ logic chơi vẫn do AI viết; không thêm template game hoặc tự sửa logic. Source ghép phải qua nguyên vẹn AST policy, strict TypeScript, instrumentation và Chromium. Không trả file tùy ý, package.json hoặc lệnh shell. CodeRepairAgent nhận yêu cầu gốc, mechanics/input/objective, source một lần ở dạng text và tối đa 5 chẩn đoán khác nhau, mỗi dòng tối đa 240 ký tự. Mỗi bản sửa phải kiểm tra và chạy thử lại. Không lưu source/project vào database hoặc file theo tên do AI cung cấp.

## Giao diện code

Model viết hai hàm TypeScript:

```typescript
function create(api: GameAPI): void {
  const player = api.spawn("player", 480, 470, 32, 24, 0xc5f277);
  api.setPlayer(player);
  api.state.player = player.id;
}

function update(api: GameAPI, dt: number): void {
  const player = api.get(api.state.player!);
  if (!player) { return; }
  if (api.input.left) { player.x -= 240 * dt; }
  if (api.input.right) { player.x += 240 * dt; }
}
```

Ví dụ chỉ minh họa interface; game hoàn chỉnh cần tương tác, điểm, thắng/thua. `GAME_CODE_API` trong contracts là hợp đồng kiểu dùng cho typecheck. Planning, coding và repair cùng nhận `CODE_CONTRACT` (`apps/api/src/agent/code-contract.ts`): state chỉ là số, nhóm vật thể là `api.entities` theo `kind`, màn hình là `api.width`/`api.height`, `dt` là tham số sẵn có. Comment trong `GAME_CODE_API` không còn bị xóa trước khi gửi model. API cung cấp entity hình chữ nhật, input bàn phím/chuột, AABB overlap, score, status, win/lose. Entity có x/y, kích thước, màu, vx/vy/hp; engine không tự áp dụng vx/vy. Groq `json_validate_failed` là lỗi schema, không phải lỗi TypeScript hay hết quota; nếu provider kèm `failed_generation` là JSON đúng thì backend ghép lại, không gọi thêm một request.

Không cho code cầm trực tiếp Phaser.Scene/Game hoặc DOM: đó là các đối tượng có thể dẫn tới loader/network/browser host. Vì vậy đây là một **tập con TypeScript với facade Phaser**, không phải môi trường chạy mọi thư viện/code Phaser. Hỗ trợ helper functions, vòng lặp có braces, mảng đánh chỉ số số học và một số hàm Math. State bền giữa frame chỉ là số; String nối động, `any`, cast, import/export, `new`, class, async, try/catch, reflection/prototype và truy cập thuộc tính động đều bị từ chối. API/AST policy chưa phù hợp game cần asset ngoài, audio, nhiều scene hoặc thư viện bổ sung.

## Giới hạn chi phí và thời gian

| Mục | Giới hạn |
| --- | --- |
| Prompt | 1–2000 ký tự |
| Source | 1 file, tối đa 24 KB UTF-8 |
| Plan | 450 output tokens |
| Generate/repair | 2400 output tokens mỗi lần, gồm reasoning |
| Chia nhỏ request quá lớn | Setup tối đa 900, update/helpers tối đa 2200 output tokens; hạ tiếp theo dung lượng còn lại |
| AI calls | 1 planning + 1 coding + tối đa 2 repair; coding/repair có thể chia 2 phần, mỗi request chỉ retry throttle ngắn hạn tối đa 1 lần |
| Jobs Advanced | 1, từ chối job đồng thời bằng 429; không xếp hàng |
| Ngân sách provider | Dùng chung AI_REQUESTS_PER_MINUTE/PER_DAY/MAX_CONCURRENT với Standard; mỗi AI step tính một request |
| Toàn pipeline | 4 phút; đóng tab/hủy request sẽ hủy công việc |
| Compile worker | 5 giây, V8 old generation 128 MiB + young generation 32 MiB, stack 4 MiB |
| Chromium test | Launch tối đa 15 giây, kiểm tra tối đa 25 giây gồm gameplay, kill process khi timeout/hủy |
| Chromium heap | V8 old space 128 MiB; không phải giới hạn tổng RAM của process |
| Runtime | 160 entity, 256 trường state số, entity size 1–200px; 5000 lần kiểm tra hàm/vòng lặp và 20ms cho mỗi callback |
| Preview | Heartbeat/watchdog, phiên tối đa 10 phút |

Giới hạn CPU runtime là hợp tác bằng code đã instrument, không phải OS quota. Một phép native vẫn có thể kéo dài hơn deadline trước khi tới điểm kiểm tra tiếp theo; AST/API hạn chế các phép cấp phát lớn để giảm nguy cơ. Browser iframe không có hard memory quota riêng. Groq Advanced đọc header TPM/reset/retry-after để giãn request, chờ ngoài timeout HTTP 45 giây nhưng trong deadline pipeline 4 phút. Mỗi HTTP attempt vẫn tính vào budget; nếu chia nhỏ chạm budget phút nội bộ thì chờ cửa sổ kế tiếp, không tăng budget. Quota ngày, lỗi xác thực, quota không rõ loại hoặc thời gian retry quá dài vẫn dừng rõ ràng. Request riêng lẻ lớn hơn TPM được chia setup và gameplay theo dung lượng, không cắt source hoặc bỏ cơ chế; nếu phần nhỏ vẫn không đủ chỗ thì báo lỗi. Không đổi model/provider. Chi tiết và số token thực đo: [Groq Free](groq-free-phase3.md). Không cam kết mọi prompt/model sẽ tạo game hợp lệ trong ngân sách này.

## API và trạng thái

- `GET /api/agent/config`: `{enabled, localOnly:true, maxRepairs:2, message}`; không gọi AI.
- `POST /api/agent/generate`: `{prompt, providerId, modelId?}`, `Content-Type: application/json`.
- Response thành công bắt đầu bằng `200 application/x-ndjson`. Mỗi dòng là một event strict: `status`, `plan`, `log`, `completed` hoặc `failed`. `completed.project` chứa JavaScript đã biên dịch và đã qua smoke test, plan, provider/model thực tế và số lần sửa.
- Các lỗi trước stream (local gate, input, selection, concurrency) dùng HTTP 400/403/429/503 như thường. Sau khi stream bắt đầu, lỗi nằm trong event `failed.error` gồm code/message/retryAfterSeconds; không thể đổi HTTP status đã gửi. Frontend luôn đọc event kết thúc và báo lỗi nếu mất kết nối giữa chừng.
- `invalid_code`: kế hoạch/đầu ra không hợp lệ; `agent_failed`: chưa qua kiểm tra sau 2 sửa; `tester_unavailable`: thiếu browser/runtime hoặc Chromium sandbox không chạy; `advanced_unavailable`: bị chặn bởi local gate. Các lỗi upstream dùng mã hiện có.

Retry là một Generate mới, không phải Phase 4 chỉnh sửa game. Không có background provider call khi mở Settings hoặc chuyển mode. Standard giữ nguyên `/api/games/generate`.

## Cách ly và giới hạn bảo mật

Backend **không chạy source AI** bằng eval, vm, import, shell hoặc require. Worker chỉ nhận source làm dữ liệu cho TypeScript AST/compiler. Module được worker import là validator tin cậy trong repo, không phải đường dẫn từ model. Browser mới chạy artifact đã compile; frontend main không eval/new Function nội dung AI.

Preview và Playwright dùng cùng HTML sandbox: iframe chỉ `allow-scripts`, không `allow-same-origin`, không quyền popup/top-navigation/forms/downloads/storage. CSP chặn network, worker, subframe, media, object, base URI và form; script chỉ được chạy bằng nonce riêng cho runtime tin cậy và artifact đã validate. Model không được truy cập window/document/location/navigator hoặc Phaser host để tự điều hướng iframe. Tài liệu nền tảng: [HTML iframe sandbox](https://html.spec.whatwg.org/multipage/iframe-embed-object.html#attr-iframe-sandbox), [Playwright Chromium sandbox](https://playwright.dev/docs/api/class-browsertype#browser-type-launch-option-chromium-sandbox).

Tester dùng Chromium sandbox bật, context/profile tạm mới, service worker bị chặn, route abort mọi network request, không truyền API keys vào browser environment. Không tắt sandbox khi lỗi. Preview chỉ gửi/nhận thông báo có session UUID và kiểm tra cửa sổ gửi; host không nhận lệnh đặc quyền từ code game. HTML đóng script được escape, status/log render dưới dạng text.

**Chưa đủ để triển khai công khai cho người dùng không tin cậy.** Static policy và browser sandbox là các lớp giảm rủi ro, không phải bằng chứng không thể thoát sandbox; chưa có OS container/VM, hard CPU/RAM/network isolation, tenant isolation hoặc kiểm định bảo mật độc lập cho triển khai công khai. Tính năng luôn tắt với `NODE_ENV=production`, và chỉ nhận request từ loopback kèm Host/Origin localhost/127.0.0.1/::1. Không đưa Advanced qua tunnel/reverse proxy hoặc mở cổng ra Internet; proxy có thể làm mất ý nghĩa kiểm tra địa chỉ local. Nếu cần public sau này, phải bổ sung cách ly OS và kiểm định riêng.

## Kiểm thử

```powershell
npm run lint
npm run typecheck
npm test
npm run test:e2e
```

Unit/API dùng mock AI: source hợp lệ, cú pháp/type sai, capability bị cấm, runtime lỗi giả lập, sửa thành công, thất bại sau hai sửa, 429/401/403, budget chung, concurrency, local gate và hồi quy Standard. Có test compiler worker thật. E2E dùng provider mock nhưng compiler, Chromium GameTester, HTTP stream, React và Phaser thật; kiểm tra shooter, paddle, phát hiện/sửa runtime error, quota, Retry và tất cả test Phase 1–2. Không đọc key hoặc gọi Gemini/Groq thật. Có thể chẩn đoán riêng browser sau build bằng `node --import tsx apps/api/test/browser-agent.smoke.ts`.

GameTester giữ các kiểm tra canvas/objects/update, di chuyển player, Space/click, console/page/runtime errors và restart reset điểm. Với yêu cầu bắn đạn, bước Testing còn xác nhận đạn xuất hiện ở mép trước nhân vật, bay theo hướng yêu cầu sau khi nhả nút qua hai khoảng quan sát, gây sát thương khi va chạm và được thu hồi ngoài màn hình. Đạn đứng yên dù đã có `vx/vy`, hoặc chỉ di chuyển khi giữ phím, sẽ thất bại và được chuyển về Repairing trong giới hạn 2 lần hiện có.

`gameplay-requirements.ts` suy ra kiểm tra bắn/hướng từ yêu cầu gốc và mechanics của plan bằng các mẫu ngôn ngữ Việt/Anh giới hạn. Không dựa vào tên game, tên kind, màu hay tọa độ máy bay. `browser-gameplay-checks.ts` điều khiển bàn phím/chuột thật; `gameplay-probe.ts` chỉ được gắn vào tài liệu của Chromium tester để quan sát API và sắp xếp kịch bản. Facade quan sát giữ getter và chuyển tiếp các hàm đến GameAPI thật, nên vẫn áp dụng ngân sách/runtime validation. Preview không có probe, không thay sandbox/CSP hay public contract.

Phần bay được quan sát tự nhiên, không di chuyển hộ viên đạn. Phần cleanup đặt viên đạn đã quan sát ra ngoài mép màn hình; phần sát thương đưa một vật thể thật của game vào đường bắn, giữ nguyên hp rồi chạy update/collision thật. Đây là kịch bản có kiểm soát, không phải bằng chứng AI tự chơi thắng mọi game. Việc chọn mục tiêu còn bảo thủ: game có nhiều vật thể trang trí, vật cản, đạn sống cực ngắn hoặc mục tiêu xuất hiện quá muộn có thể bị từ chối trong thời hạn kiểm tra. Cần mở rộng bộ phân tích yêu cầu/kịch bản khi hỗ trợ cơ chế khác; chưa kiểm chứng toàn bộ boss, điểm số, cân bằng hay điều kiện thắng bằng ngôn ngữ tự nhiên.

E2E bổ sung các chương trình bị sửa lỗi có chủ đích: đạn đứng yên, chỉ bay khi giữ nút, sai hướng, sinh giữa người chơi, thiếu sát thương, thiếu cleanup. Các chương trình này vẫn compile/khởi động được. Bộ kiểm tra cũng phải chấp nhận game bắn ngang và game bắn theo chuột dùng tên vật thể khác, và test HTTP/UI chứng minh lỗi gameplay được sửa trước khi preview. Không thêm AI judge, dịch vụ trả phí hay lần gọi provider để chấm gameplay; giữ cap Planning 450 và Coding/Repairing 2400 token.

Không triển khai Phase 4, Phase 5, database, Docker, authentication, dịch vụ asset trả phí hoặc publishing.

Kiểm tra dependency ngày 2026-11-03: `npm audit --omit=dev` không có cảnh báo. Audit đầy đủ còn 7 mục moderate cùng bắt nguồn từ minimatch trong ESLint/parser ([GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)); npm báo chưa có bản sửa trong các khoảng phiên bản hiện dùng. Không ép override minimatch lên major khác vì có thể làm hỏng API của công cụ lint. ESLint chỉ chạy trên repo với glob cố định, không chạy trên prompt/code AI; pipeline Advanced dùng TypeScript compiler. Cần theo dõi bản cập nhật tooling tương thích Node 22.11.
