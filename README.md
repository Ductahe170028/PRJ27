# AI Game Creator — Phase 3

**Standard Mode** giữ Phase 2: nhập mô tả tiếng Việt/tiếng Anh, chọn **Gemini/Groq**, chơi game 2D từ **GameSpec v1**. AI chỉ sinh dữ liệu JSON; renderer Phaser của dự án dựng game trong iframe sandbox. Hỗ trợ **platformer** và **top-down collector/dodge**: di chuyển, vật cản, kẻ địch, máu, điểm, nhặt xu, thắng/thua, chơi lại và bàn phím/cảm ứng.

**Advanced AI Mode** thêm AI Code Agent: lập kế hoạch → viết TypeScript → kiểm tra → chạy Chromium → sửa tối đa 2 lần → preview. Code tự triển khai cơ chế mới trên API Phaser giới hạn, không dùng GameSpec hoặc template game có sẵn. Chỉ mở để **thử nghiệm local**; chưa dùng làm dịch vụ công khai. Xem [kiến trúc, API, giới hạn và bảo mật Phase 3](docs/phase3.md).

Demo **Moonlight Run** của Phase 1 được giữ nguyên và chạy không cần key. Demo là lựa chọn mặc định ban đầu; lỗi AI không tự chuyển sang demo hay provider khác. Chỉ lựa chọn provider/model được lưu trong localStorage; game không được lưu khi reload.

Xem [báo cáo Code Audit + Refactor Phase 1–3](docs/audit-phase1-3.md) để biết các lỗi đã sửa, thay đổi module, kết quả hồi quy và rủi ro còn lại trước Phase 4.

## Chạy trên Windows

Cần **Node.js 22+**, **npm 10+**. Vite 6 tương thích Node 22.11. Mở PowerShell tại thư mục dự án:

```powershell
npm install
npx playwright install chromium
npm run dev
```

Mở **http://127.0.0.1:5173**; backend **http://127.0.0.1:3001**. `Ctrl+C` để dừng. Nếu PowerShell chặn `npm.ps1`, dùng `npm.cmd` thay `npm`.

1. Chưa có key: giữ **Demo**, nhập prompt, nhấn **Generate Game** để chơi Moonlight Run.
2. Để dùng AI, cấu hình backend bên dưới rồi khởi động lại.
3. Mở **Settings**, chọn **Gemini** hoặc **Groq**. Ô **Model** mặc định là **Tự động** (model khuyến nghị của backend); có thể chọn model khác trong danh sách. Bảng trạng thái cho biết provider nào đã có key. **Test connection** kiểm tra key/danh sách model bằng metadata API, không sinh nội dung và không xác nhận quota còn lại.
4. Nhập `Tạo game ninja nhặt xu và tránh quái`, nhấn **Generate Game**.
5. Bấm vào preview để điều khiển bằng bàn phím. Điều khiển hiển thị dưới preview; **R** chơi lại. Platformer có nhảy, top-down di chuyển bốn hướng.
6. Chuyển sang provider còn lại (hoặc model khác), nhập prompt khác và tạo game mới.

Để thử Phase 3: chọn **Advanced AI Mode** → chọn Gemini/Groq trong Settings → nhập `Tạo game bắn máy bay, có đạn, kẻ địch xuất hiện liên tục, điểm số và boss` → Generate Game. Theo dõi Planning/Coding/Validating/Testing/Repairing, mở Console/log khi có lỗi. Thử tiếp `Tạo game đỡ bóng phá gạch, thanh đỡ di chuyển ngang, bóng bật vào tường, phá hết gạch để thắng` để so sánh cơ chế. **Retry** bắt đầu lượt mới do bạn chủ động bấm, có tính quota. Advanced dùng bàn phím và chuột; chưa có điều khiển cảm ứng như Standard.

Advanced mặc định bật ở local nếu `ADVANCED_AI_ENABLED` không phải `false`, luôn tắt khi `NODE_ENV=production`. Có thể thêm `ADVANCED_AI_ENABLED=false` vào `apps/api/.env` để tắt. Không cần key mới, không thêm key ở frontend. Nếu báo `tester_unavailable`, chạy `npx playwright install chromium` và kiểm tra đã build runtime bằng `npm run build` hoặc `npm run dev` tại root. Không dùng `--no-sandbox` để bỏ qua lỗi Chromium.

## API key và model

**`apps/api/.env` đã có trong workspace**. Mỗi provider chỉ cần API key: điền `GEMINI_API_KEY` và/hoặc `GROQ_API_KEY`, khởi động lại backend. Không cần nhập model hay cờ xác nhận. **`apps/web/.env` cũng đã có**, cấu hình proxy `/api` tới `http://127.0.0.1:3001`; `VITE_API_BASE_URL` để rỗng có chủ đích để dùng proxy này. Cả hai file bị `.gitignore` loại trừ. Khi clone mới, nếu chưa có file backend:

```powershell
if (-not (Test-Path apps/api/.env)) {
  Copy-Item apps/api/.env.example apps/api/.env
}
```

Điền trong **backend**, không đưa key vào `apps/web`, biến `VITE_*`, localStorage hoặc URL:

```dotenv
GEMINI_API_KEY=
GROQ_API_KEY=
# Tùy chọn, thường để trống:
GEMINI_ALLOWED_MODELS=
GROQ_ALLOWED_MODELS=
```

Lấy key miễn phí tại [Google AI Studio](https://aistudio.google.com/apikey) và [GroqCloud Console](https://console.groq.com/keys). Backend có **catalog model đã kiểm chứng có free tier**; model đầu tiên là mặc định (**Tự động** trong Settings). Frontend chỉ hiển thị danh sách do backend trả về, không có model ID cố định. Request ở chế độ Tự động không gửi `modelId`; backend chọn model mặc định và response ghi model thực tế đã dùng.

| Provider | Model ID | Output | Ghi chú |
| --- | --- | --- | --- |
| Gemini | `gemini-3.5-flash-lite` | Structured JSON schema | Mặc định; `thinkingLevel: minimal` |
| Gemini | `gemini-3.6-flash` | Structured JSON schema | `thinkingLevel: minimal` |
| Gemini | `gemini-3.8-flash` | Structured JSON schema | `thinkingLevel: low` (model không hỗ trợ minimal) |
| Groq | `openai/gpt-oss-20b` | Strict JSON schema | Mặc định; `reasoning_effort: low` |
| Groq | `openai/gpt-oss-120b` | Strict JSON schema | `reasoning_effort: low`; chậm hơn, tốn token hơn |

Đối chiếu ngày 2026-11-03 với [Gemini models](https://ai.google.dev/gemini-api/docs/models), [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing), [Gemini rate limits](https://ai.google.dev/gemini-api/docs/rate-limits), [Gemini structured output](https://ai.google.dev/gemini-api/docs/structured-output), [Groq rate limits](https://console.groq.com/docs/rate-limits), [Groq deprecations](https://console.groq.com/docs/deprecations), [Groq structured outputs](https://console.groq.com/docs/structured-outputs). Đã loại khỏi catalog: `gemini-2.5-*` (chỉ còn cho project đã dùng trước đó, sắp bị chuyển hướng) và `llama-3.3-70b-versatile` (Groq ngừng ở free/developer tier từ 2026-08-16). Model đã lưu trong trình duyệt nhưng không còn trong catalog sẽ hiện cảnh báo và chặn Generate cho đến khi bạn chọn model khác, không tự đổi ngầm.

`*_ALLOWED_MODELS` (phân cách dấu phẩy, không wildcard) chỉ **thu hẹp** catalog, ví dụ `GROQ_ALLOWED_MODELS=openai/gpt-oss-20b`; để trống nghĩa là toàn bộ catalog. ID không có trong catalog (model trả phí, model đã ngừng, gõ sai) làm provider **unavailable** với lý do `invalid_model`, không được gửi lên provider. `GEMINI_FREE_TIER_CONFIRMED`/`GROQ_FREE_TIER_CONFIRMED` cũ không còn tác dụng, có thể xóa.

Ứng dụng không bật billing, không tự nâng model hoặc đổi provider khi lỗi, và không biết tài khoản của bạn đang ở gói nào. Free tier chỉ miễn phí khi project/tài khoản **chưa bật billing**; nếu đã bật, provider có thể tính phí theo bảng giá. Quota free hiện tại của Groq cho hai model gpt-oss: 30 request/phút, 1.000 request/ngày, 8.000 token/phút, 200.000 token/ngày. Đo thực tế một lần generate với `gpt-oss-20b`: khoảng 1.950 token prompt + 400–450 token output (≈2.400 token), nên tối đa khoảng 3 game/phút. `gpt-oss-120b` dùng khoảng 1.950 + 950–1.200 token. Test connection Groq dùng **List models** và kiểm tra ID trong kết quả; Gemini dùng **Get model**. Metadata không xác nhận quota sinh nội dung còn lại.

Sau khi sửa `.env`, **khởi động lại backend** và nhấn **Tải lại cấu hình** trong Settings. Thiếu key/cấu hình model sai khiến provider unavailable, không crash server. Không ghi đè `.env` chứa key bằng file example.

## Chạy hai terminal

Chạy `npm install` và `npm run build:contracts` từ thư mục gốc trước, sau đó:

```powershell
# Terminal 1
npm run dev:api
```

```powershell
# Terminal 2
npm run dev:web
```

`npm run dev` chạy watcher cho API, frontend, contracts và bundle game. Nếu chạy riêng và sửa contracts, build lại contracts. Sửa renderer thì nhấn Generate Game để nạp runtime mới.

## Cấu trúc và phần thay đổi

```text
apps/api/
  .env, .env.example               Key/model local và mẫu không secret
  src/
    app.ts, server.ts              Routes, env, lỗi, shutdown
    providers/
      ai-provider.ts              AIProvider / AIRequest
      gemini-provider.ts          SDK chính thức @google/genai
      groq-provider.ts            SDK chính thức groq-sdk
      provider-registry.ts        Resolve allowlist, metadata mỗi request
      create-registry.ts          Lắp provider từ env
      model-catalog.ts            Model hỗ trợ và output capabilities
      errors.ts                   Lỗi chuẩn hóa, không lộ payload SDK
      game-provider.ts            Giữ interface demo Phase 1
      demo-game-provider.ts       Giữ Moonlight Run Phase 1
    services/
      game-generation-service.ts  Gọi AI, timeout, parse/validate, metadata
      system-prompt.ts            Quy tắc game và schema provider
      normalize-game-spec.ts      Kẹp số nguyên theo các giới hạn đã có
      repair-game-placement.ts    Sửa tọa độ xu/địch, giữ số lượng và mục tiêu
      game-geometry.ts            Kiểm tra đường đi, va chạm và vùng tuần tra
      request-budget.ts           Rate/concurrency/daily limit trong RAM
      game-service.ts             Giữ service demo Phase 1
  test/                           Unit/API/SDK mocks và E2E mock server
apps/web/src/
  App.tsx                         Prompt, loading/error, selection, preview
  components/ProviderSettings.tsx Provider/model, config, test connection
  components/GamePreview.tsx      Iframe và handshake
  lib/api.ts                      HTTP client và validation
  lib/preview-document.ts         HTML cố định, CSP, điều khiển
  game/
    runtime.ts                    Bundle độc lập, chọn renderer
    GameSpecScene.ts              Hai thể loại GameSpec v1
    PlatformerScene.ts            Giữ renderer Phase 1
packages/contracts/src/
  index.ts                        Request/response và protocol iframe
  ai.ts                           Metadata và selection schemas
  game-spec.ts                    Zod strict, bounds và JSON schema v1
e2e/creator.spec.ts                Regression Phase 1
e2e/ai.spec.ts                     Settings, provider switching, gameplay
```

Npm workspaces, TypeScript strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. Frontend không import SDK hoặc key. Thêm provider bằng cách implement `AIProvider`, khai báo catalog và đăng ký ở `create-registry.ts`; không cần sửa pipeline generation/renderer nếu vẫn trả GameSpec v1. Chưa có storage layer/database.

## API

| Endpoint | Input | Output |
| --- | --- | --- |
| `GET /api/health` | — | `{status:"ok",service:"ai-game-creator-api",mode:"multi-provider"}` |
| `GET /api/ai/providers` | — | `{providers:[{id,name,available,reason,defaultModelId,models:[{id,name,capabilities}]}]}` |
| `POST /api/ai/test-connection` | `{providerId,modelId?}` | `{status:"connected",providerId,modelId,message}` |
| `POST /api/games/generate` | `{prompt,providerId,modelId?}` | `201 {data:{id,title,prompt,provider,modelId,capabilities,createdAt,game}}` |

Ví dụ AI generation:

```json
{"prompt":"Tạo game ninja nhặt xu và tránh quái","providerId":"groq"}
```

Demo nhận `{prompt,providerId:"demo",modelId:"platformer-v1"}`. Request chỉ có `{prompt}` vẫn chạy demo, response giữ schema Phase 1 không có `modelId`/`capabilities`. Với Gemini/Groq, `modelId` là tùy chọn: bỏ trống (hoặc `"auto"`) dùng `defaultModelId`, còn ID cụ thể phải nằm trong allowlist. Mỗi request tự resolve provider/model, không có trạng thái toàn cục. Response game luôn ghi model thực tế đã dùng.

Lỗi dạng `{error:{code,message,retryAfterSeconds?,issues?}}`. Mã AI: `missing_key` (503), `invalid_provider`/`invalid_model` (400), `rate_limit` (429, có `Retry-After`; lấy từ header hoặc `retryDelay` của Gemini, mặc định 60 giây; HTTP 413 "vượt token/phút" của Groq cũng trả mã này), `timeout` (504), `provider_error` (502; gồm key sai/bị chặn và provider quá tải), `invalid_game_spec` (422). UI hiển thị thông báo, thời gian chờ gợi ý và mã lỗi. Lỗi prompt/JSON/body giữ mã Phase 1. `issues` chỉ chứa field path, không trả raw output provider. Không log prompt, key hoặc SDK response. Client disconnect sẽ hủy request đang chạy.

## Giới hạn và môi trường

| Backend variable | Mặc định | Giới hạn |
| --- | --- | --- |
| `HOST`, `PORT` | `127.0.0.1`, `3001` | Bind local |
| `CLIENT_ORIGINS` | localhost và 127.0.0.1:5173 | CORS, phân cách dấu phẩy |
| `AI_REQUESTS_PER_MINUTE` | `5` | 1–60, theo IP, cửa sổ 60 giây |
| `AI_REQUESTS_PER_DAY` | `100` | 1–1000, tổng backend, reset ngày UTC |
| `AI_MAX_CONCURRENT` | `2` | 1–5, tổng backend |
| `AI_TIMEOUT_MS` | `45000` | 1–50000 ms; SDK cũng có timeout 45 giây |

Test connection và generation dùng chung ngân sách. Request bị từ chối vì cấu hình không tốn ngân sách gọi provider; request đã gọi vẫn tính dù lỗi. Bộ đếm reset khi restart, không phải quota phân tán nhiều server. Không tự retry, không gọi AI lần hai để sửa dữ liệu; Gemini một attempt, Groq `maxRetries:0`. Mở Settings chỉ đọc cấu hình backend, không gọi upstream.

Prompt 1–2000 ký tự sau trim; HTTP body 16 KB; output tối đa 4096 token (Groq) / 8192 token (Gemini, tính cả token suy nghĩ) và GameSpec 32 KB UTF-8. System prompt mô tả giới hạn từng field ở dạng gọn, sinh tự động từ schema Zod để không lệch với validation. Game 960×540, tối đa 14 platforms, 12 obstacles, 8 enemies, 24 collectibles. Tọa độ, tốc độ, kích thước, máu, màu, enum đều có giới hạn. Zod strict loại field lạ; kiểm tra spawn, patrol, mục tiêu điểm và tầm nhảy platformer. Không có field code/URL/script/style. Schema provider ràng buộc cấu trúc; Zod kiểm tra đầy đủ bounds và quan hệ sau parse. Chuẩn hóa số nguyên giữ hành vi cũ: kẹp các trường không hoạt động (jump/gravity của top-down, mục tiêu thắng không dùng), radius tuần tra về 0–160 và kích thước platform/obstacle về giới hạn schema. Không gọi AI lại để sửa. Chỉ bỏ fence của một khối markdown JSON duy nhất; không chạy code.

**Sửa vị trí không xóa vật thể:** sau kiểm tra cấu trúc, backend chỉ đổi `x/y` của xu/kẻ địch cần sửa, tối đa 160px từ vị trí gốc, theo thứ tự xác định. Giữ nguyên số lượng, thứ tự, giá trị từng xu, thuộc tính địch sau chuẩn hóa số, điều kiện thắng và thời hạn. Không giảm mục tiêu điểm, kéo dài thời gian hay bỏ xu để game vượt validation. Prompt yêu cầu AI tôn trọng số lượng/mục tiêu được mô tả; bước sửa bảo toàn dữ liệu đã nhận, không tự suy diễn lại yêu cầu ngôn ngữ tự nhiên.

Kiểm tra đường đi dùng kích thước thật của nhân vật và xu 20×20, đường tuần tra đầy đủ của địch, vùng xuất phát và vật cản. Top-down tìm đường trên lưới 16px; platformer mô phỏng cung nhảy với trọng lực/tốc độ hiện có, kiểm tra va chạm trên toàn đoạn di chuyển và đường quay về để tránh kẹt sau khi nhặt một xu. Chỉ chấp nhận đường thu thập tránh được toàn bộ vùng tuần tra, không cần mất máu hoặc chờ đúng pha địch. Game có giới hạn thời gian phải có lộ trình hoàn thành trong hạn; không có hạn khi `timeLimitSeconds=0`. Lỗi không sửa được trả **422 `invalid_game_spec`**, chỉ rõ xu/địch hoặc điều kiện không đạt, không trả game một phần và không gọi AI lần hai.

Đây là kiểm tra bảo thủ cho renderer cố định: có giới hạn 350 điểm đứng và 350.000 bước mô phỏng cho mỗi lần lập đường đi. Có thể từ chối màn chơi thực tế chơi được nhưng cần thao tác chính xác, canh địch, hoặc nằm ngoài phạm vi tìm kiếm. Khi chưa xác nhận được đường an toàn, backend báo lỗi thay vì tự làm dễ mục tiêu.

Frontend timeout HTTP 60 giây và khởi tạo iframe 15 giây. Đổi `API_PROXY_TARGET` trong `apps/web/.env` khi đổi cổng backend (mặc định `http://127.0.0.1:3001`); `VITE_API_BASE_URL` mặc định rỗng để dùng proxy `/api`. Biến `VITE_*` công khai trong browser bundle, không chứa secret.

## Build và kiểm thử

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Unit/API tests kiểm tra registry, allowlist, thiếu key, JSON/schema, generation mock, SDK adapter mock, lỗi/quota/timeout/cancel và ngân sách. `game-placement.test.ts` kiểm tra bảo toàn số lượng/mục tiêu, sửa tọa độ, vùng tuần tra, tường kín, hành lang hẹp, thời hạn và lỗi không sửa được. E2E build và chạy Chromium với frontend thật cùng **Express test server inject mock providers** ở `apps/api/test/e2e-server.ts`. Entrypoint production không có chế độ mock. Test không đọc `.env` và không gửi API request đến Gemini/Groq, không tốn quota. Mock chỉ thay đầu ra provider, vẫn qua service, Zod, HTTP, frontend và Phaser thật.

E2E kiểm tra regression demo, Settings/persistence, model Tự động/chọn tay cho cả hai provider, model đã lưu bị gỡ khỏi catalog, request không có model ID, không gọi ẩn, lỗi HTTP không có body, đổi provider, hai renderer, nhảy/đáp nền tảng, va chạm, máu/điểm, thắng/thua/chơi lại, quota, unavailable, sandbox và mobile demo. Kiểm tra chuyển động bằng pixel canvas sau bàn phím, không có test backdoor trong runtime. Screenshot/trace trong `test-results/`. E2E dùng cổng riêng **3101/5174**, không dừng app dev ở 3001/5173.

Chạy bản build bằng hai terminal:

```powershell
npm run start:api
```

```powershell
npm run preview:web
```

Mở http://127.0.0.1:5173. Build xuất `packages/contracts/dist`, `apps/api/dist`, `apps/web/dist`; Phaser bundle từ npm vào `runtime/game.js`, không tải CDN. `vite preview` dùng kiểm tra local, chưa cấu hình hosting production.

## Cách ly và giới hạn hiện tại

- Iframe chỉ có `sandbox="allow-scripts"`, không `allow-same-origin`; CSP chỉ cho trusted runtime có nonce, chặn kết nối mạng và form. Prompt/GameSpec không nội suy vào HTML. Không dùng `eval`, `new Function`, `dangerouslySetInnerHTML` cho nội dung AI.
- Handshake kiểm tra source window, origin, session ID và schema. Parent dùng `postMessage` target `*` vì iframe có opaque origin; runtime gửi đúng origin parent. GameSpec kiểm tra ở server, frontend và runtime.
- Hai thể loại dùng bộ quy tắc/renderer giới hạn, không arbitrary game code. Chất lượng và việc hiểu mô tả phụ thuộc AI. Bộ kiểm tra đường đi bảo thủ nêu trên dành cho renderer hiện tại; không thay thế kiểm thử gameplay cho mọi cấu hình vật lý/frame rate. Dữ liệu không đạt kiểm tra trả lỗi để người dùng sửa prompt/thử lại chủ động.
- Gemini chưa được kiểm thử live (chưa có key); adapter chỉ được kiểm bằng SDK mock. Groq đã được kiểm thử live với cả hai model. Quota/model availability do tài khoản quyết định; Test connection không thay thế một lần generate thật.
- Model AI có thể đặt sai hình học (xu trong vật cản, xu lơ lửng). Backend ưu tiên sửa vị trí trong giới hạn an toàn, giữ đủ vật thể và mục tiêu; không sửa được thì trả 422. Generate lại là thao tác chủ động và tính một request quota mới.
- Catalog model là danh sách tĩnh đã kiểm chứng; khi Google/Groq đổi model hoặc free tier, cần cập nhật `apps/api/src/providers/model-catalog.ts`.
- Các mô tả GameSpec, chuẩn hóa hình học và giới hạn thể loại ở trên áp dụng cho Standard Mode. Advanced dùng pipeline và giới hạn riêng trong [Phase 3](docs/phase3.md).
- Advanced trên Groq có log token thực tế, chờ rate limit và chia request quá lớn. Xem [báo cáo tối ưu Groq Free và cách đo lại](docs/groq-free-phase3.md).
- Advanced kiểm tra thêm hành vi bắn đạn trong Chromium: vị trí phóng, tự bay sau khi nhả nút, sát thương và cleanup ngoài màn hình. Lỗi được đưa về sửa tối đa 2 lần; xem [kiểm thử và giới hạn gameplay](docs/phase3.md#kiểm-thử).
- Kết quả kiểm tra và lượt Groq thật sau cải thiện cơ chế bắn: [báo cáo gameplay Phase 3](docs/phase3-gameplay.md).
- Chưa làm Phase 4 chỉnh sửa game bằng prompt, Phase 5 lưu/chia sẻ, database, tài khoản/auth, Docker, billing/thanh toán hoặc publishing/hosting.
