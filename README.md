# AI Game Creator — Phase 2

Nhập mô tả tiếng Việt/tiếng Anh, chọn **Gemini/Groq**, chơi game 2D từ **GameSpec v1**. AI chỉ sinh JSON; renderer Phaser của dự án dựng game trong iframe sandbox. Hỗ trợ **platformer** và **top-down collector/dodge**: di chuyển, vật cản, kẻ địch, máu, điểm, nhặt xu, thắng/thua, chơi lại và bàn phím/cảm ứng.

Demo **Moonlight Run** của Phase 1 được giữ nguyên và chạy không cần key. Demo là lựa chọn mặc định ban đầu; lỗi AI không tự chuyển sang demo hay provider khác. Chỉ lựa chọn provider/model được lưu trong localStorage; game không được lưu khi reload.

## Chạy trên Windows

Cần **Node.js 22+**, **npm 10+**. Vite 6 tương thích Node 22.11. Mở PowerShell tại thư mục dự án:

```powershell
npm install
npm run dev
```

Mở **http://127.0.0.1:5173**; backend **http://127.0.0.1:3001**. `Ctrl+C` để dừng. Nếu PowerShell chặn `npm.ps1`, dùng `npm.cmd` thay `npm`.

1. Chưa có key: giữ **Demo**, nhập prompt, nhấn **Generate Game** để chơi Moonlight Run.
2. Để dùng AI, cấu hình backend bên dưới rồi khởi động lại.
3. Mở **Settings**, chọn **Gemini** và model. **Test connection** chủ động kiểm tra key/quyền truy cập bằng metadata API, không sinh nội dung và không xác nhận quota còn lại.
4. Nhập `Tạo game ninja nhặt xu và tránh quái`, nhấn **Generate Game**.
5. Bấm vào preview để điều khiển bằng bàn phím. Điều khiển hiển thị dưới preview; **R** chơi lại. Platformer có nhảy, top-down di chuyển bốn hướng.
6. Chọn **Groq** trong Settings, nhập prompt khác và tạo game mới.

## API key và model

**`apps/api/.env` đã được tạo trong workspace**, để trống key/allowlist để bạn bổ sung; file bị `.gitignore` loại trừ. Khi clone mới, nếu chưa có file:

```powershell
if (-not (Test-Path apps/api/.env)) {
  Copy-Item apps/api/.env.example apps/api/.env
}
```

Điền trong **backend**, không đưa key vào `apps/web`, biến `VITE_*`, localStorage hoặc URL:

```dotenv
GEMINI_API_KEY=
GEMINI_ALLOWED_MODELS=
GEMINI_FREE_TIER_CONFIRMED=false
GROQ_API_KEY=
GROQ_ALLOWED_MODELS=
GROQ_FREE_TIER_CONFIRMED=false
```

Catalog hỗ trợ các model sau; **catalog không tự bật model cho tài khoản**:

| Provider | Model ID | Output |
| --- | --- | --- |
| Gemini | `gemini-2.5-flash-lite` | Structured JSON schema |
| Gemini | `gemini-2.5-flash` | Structured JSON schema |
| Groq | `openai/gpt-oss-20b` | Strict JSON schema |
| Groq | `llama-3.3-70b-versatile` | JSON mode + Zod |

Đã đối chiếu ID/capability với [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing), [Gemini structured output](https://ai.google.dev/gemini-api/docs/structured-output), [Groq structured outputs](https://console.groq.com/docs/structured-outputs), [Groq rate limits](https://console.groq.com/docs/rate-limits). Quota, quyền truy cập và giá có thể thay đổi theo model/tài khoản.

Trước khi bật provider, kiểm tra Google AI Studio hoặc Groq Console rằng tài khoản/project đang dùng free tier và model được dùng miễn phí. Sau đó điền allowlist, ví dụ `GEMINI_ALLOWED_MODELS=gemini-2.5-flash-lite` hoặc `GROQ_ALLOWED_MODELS=openai/gpt-oss-20b`, và đặt `*_FREE_TIER_CONFIRMED=true` tương ứng. Nhiều model phân cách bằng dấu phẩy, không wildcard. Provider chưa dùng có thể để trống.

Cờ xác nhận là **xác nhận của người vận hành**, không phải phép kiểm tra billing tự động. Ứng dụng không thể bảo đảm tài khoản đã bật billing sẽ không bị tính phí; nó không thay đổi billing, không chọn model ngoài allowlist, không nâng model và không tự fallback. Metadata API không chứng minh free tier hay khả năng generate khi quota đã hết. Chưa có credentials thật nên vẫn cần kiểm thử live sau khi bạn điền `.env`.

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
| `GET /api/ai/providers` | — | `{providers:[{id,name,available,reason,models:[{id,name,capabilities}]}]}` |
| `POST /api/ai/test-connection` | `{providerId,modelId}` | `{status:"connected",providerId,modelId,message}` |
| `POST /api/games/generate` | `{prompt,providerId,modelId}` | `201 {data:{id,title,prompt,provider,modelId,capabilities,createdAt,game}}` |

Ví dụ AI generation:

```json
{"prompt":"Tạo game ninja nhặt xu và tránh quái","providerId":"gemini","modelId":"gemini-2.5-flash-lite"}
```

Demo nhận `{prompt,providerId:"demo",modelId:"platformer-v1"}`. Request chỉ có `{prompt}` vẫn chạy demo, response giữ schema Phase 1 không có `modelId`/`capabilities`. Chọn AI nhưng thiếu model sẽ lỗi, không chuyển sang demo.

Lỗi dạng `{error:{code,message,retryAfterSeconds?,issues?}}`. Mã AI: `missing_key` (503), `invalid_provider`/`invalid_model` (400), `configuration_required` (503), `rate_limit` (429, có `Retry-After`), `timeout` (504), `provider_error` (502), `invalid_game_spec` (422). Lỗi prompt/JSON/body giữ mã Phase 1. `issues` chỉ chứa field path, không trả raw output provider. Không log prompt, key hoặc SDK response. Client disconnect sẽ hủy request đang chạy.

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

Prompt 1–2000 ký tự sau trim; HTTP body 16 KB; output 4096 token và GameSpec 32 KB UTF-8. Game 960×540, tối đa 14 platforms, 12 obstacles, 8 enemies, 24 collectibles. Tọa độ, tốc độ, kích thước, máu, màu, enum đều có giới hạn. Zod strict loại field lạ; kiểm tra spawn, patrol, mục tiêu điểm và tầm nhảy platformer. Không có field code/URL/script/style. Schema provider ràng buộc cấu trúc; Zod kiểm tra đầy đủ bounds và quan hệ sau parse. Chỉ có thể bỏ fence của một khối markdown JSON duy nhất; dữ liệu sai trả 422, không chạy code.

Frontend timeout HTTP 60 giây và khởi tạo iframe 15 giây. Đổi `API_PROXY_TARGET` trong `apps/web/.env` khi đổi cổng backend (mặc định `http://127.0.0.1:3001`); `VITE_API_BASE_URL` mặc định rỗng để dùng proxy `/api`. Biến `VITE_*` công khai trong browser bundle, không chứa secret.

## Build và kiểm thử

```powershell
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Unit/API tests kiểm tra registry, allowlist, thiếu key, JSON/schema, generation mock, SDK adapter mock, lỗi/quota/timeout/cancel và ngân sách. E2E build và chạy Chromium với frontend thật cùng **Express test server inject mock providers** ở `apps/api/test/e2e-server.ts`. Entrypoint production không có chế độ mock. Test không đọc `.env` và không gửi API request đến Gemini/Groq, không tốn quota. Mock chỉ thay đầu ra provider, vẫn qua service, Zod, HTTP, frontend và Phaser thật.

E2E kiểm tra regression demo, Settings/persistence, không gọi ẩn, đổi provider, hai renderer, nhảy/đáp nền tảng, va chạm, máu/điểm, thắng/thua/chơi lại, quota, unavailable, sandbox và mobile demo. Kiểm tra chuyển động bằng pixel canvas sau bàn phím, không có test backdoor trong runtime. Screenshot/trace trong `test-results/`. Dừng server đang chiếm cổng 3001/5173 trước E2E.

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
- Hai thể loại dùng bộ quy tắc/renderer giới hạn, không arbitrary game code. Chất lượng màn chơi phụ thuộc AI. Bounds/reachability cơ bản không chứng minh mọi màn chơi đều hoàn thành được; dữ liệu không đạt kiểm tra trả lỗi để người dùng sửa prompt/thử lại chủ động.
- Chưa kiểm thử live Gemini/Groq do bạn sẽ bổ sung credentials/model sau. Quota/model availability do tài khoản quyết định; Test connection không thay thế một lần generate thật.
- Chưa làm Phase 3 tự sửa code, lưu/quản lý project, database, tài khoản/auth, Docker, billing/thanh toán hoặc publishing/hosting.
