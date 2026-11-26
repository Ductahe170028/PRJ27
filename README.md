# AI Game Creator

Gõ một câu mô tả, nhận về một game **bắn quái nhìn từ trên xuống** để chơi ngay trong trình duyệt. Ví dụ: *"Sinh tồn 90 giây trong bệnh viện bỏ hoang, zombie đi chậm nhưng ra liên tục, súng bắn nhanh, có boss cuối to khổng lồ."*

## Cách nó hoạt động

```
lời mô tả  →  AI (Gemini hoặc Groq) chọn từ danh sách có sẵn  →  engine dựng màn  →  bot thử chơi  →  màn chơi
```

1. **AI chỉ chọn, không vẽ.** Nó trả về một bản mô tả ngắn ("brief"): bối cảnh, bản đồ, loại quái, độ khó, súng, máu, mục tiêu, có boss hay không. Nó không bao giờ viết tọa độ hay số của vật lý.
2. **Engine dựng màn** từ brief (cùng brief và cùng số `seed` luôn ra cùng một màn): đặt vật cản, lên lịch quái, tính máu boss.
3. **Một bot "người chơi bình thường" thử chơi** màn đó. Nếu bot thua quá nhiều thì engine giảm số quái cho tới khi chơi được, và báo cho người dùng.
4. **Những gì engine chưa làm được** (bảo vệ căn cứ, nhiều boss, hết đạn...) được liệt kê trong khối "Chưa hỗ trợ / điều chỉnh"; game vẫn chạy.
5. Phaser chỉ **vẽ**: luật chơi nằm trong một mô-đun TypeScript thuần (`packages/contracts/src/shooter/`), nên kết quả giống nhau trên mọi máy.

Có chọn "Demo" trong Settings thì không gọi AI: luôn chạy màn tay "Đấu trường".

> **Bản cũ.** Dự án từng có game platformer / thu thập xu (GameSpec v1) và chế độ "AI viết code" (Advanced). Cả hai đã bị xóa khỏi cây mã; còn nguyên ở tag `legacy-standard-v1`: `git checkout legacy-standard-v1`.

## Yêu cầu và cài đặt (Windows)

Cần Node.js 22 trở lên (kèm npm 10+). Trong thư mục dự án, ở PowerShell:

```powershell
npm install
Copy-Item apps\api\.env.example apps\api\.env
```

Mở `apps\api\.env` bằng trình soạn thảo và điền **ít nhất một** khóa (`GEMINI_API_KEY` hoặc `GROQ_API_KEY`); để trống thì chỉ dùng được "Demo". **Không đưa file `.env` lên git** (đã được bỏ qua sẵn) và không dán khóa vào chat, tài liệu hay mã.

```powershell
npm run dev
```

Mở http://127.0.0.1:5173. `npm run dev` dựng thư viện dùng chung rồi chạy cùng lúc API (cổng 3001), web (cổng 5173) và trình biên dịch theo dõi thay đổi.

## Cách chơi

- **WASD** hoặc phím mũi tên: di chuyển. **Chuột**: ngắm. **Giữ chuột trái**: bắn. **R**: chơi lại.
- Bấm vào khung game một lần để nó nhận phím. Mục tiêu hiện ở đầu ván và trong thẻ "Thông tin màn": sống sót N giây, hạ N quái, hoặc hạ boss.

### Sân chơi các màn viết tay (không gọi AI)

`http://127.0.0.1:5173/?shooter=<tên>`; tên hiện có: `arena`, `pillars`, `wall`, `smoke-win`, `smoke-lose`, `shotgun-pit`, `spitters`, `medic`, `boss-crusher`, `boss-gunner`. Sai tên thì trang liệt kê các tên đúng.

## Biến môi trường

Đọc từ `apps/api/.env` (mẫu: `apps/api/.env.example`). Chỉ khóa là bắt buộc.

| Biến | Ý nghĩa | Mặc định |
|---|---|---|
| `GEMINI_API_KEY`, `GROQ_API_KEY` | Khóa của từng nhà cung cấp (nhà không có khóa hiện "unavailable") | trống |
| `GEMINI_ALLOWED_MODELS`, `GROQ_ALLOWED_MODELS` | Thu hẹp danh mục model (phân cách bằng dấu phẩy); trống = cả danh mục | trống |
| `AI_REQUESTS_PER_MINUTE` | Số yêu cầu AI mỗi phút cho mỗi địa chỉ máy khách (1–60) | 5 |
| `AI_REQUESTS_PER_DAY` | Tổng số yêu cầu AI mỗi ngày cho cả máy chủ (1–1000) | 100 |
| `AI_MAX_CONCURRENT` | Số yêu cầu AI chạy cùng lúc (1–5) | 2 |
| `AI_TIMEOUT_MS` | Thời hạn một lần gọi AI (tối đa 50000) | 45000 |
| `HOST`, `PORT` | Địa chỉ và cổng của API | 127.0.0.1, 3001 |
| `CLIENT_ORIGINS` | Các địa chỉ web được phép gọi API (CORS) | localhost:5173, 127.0.0.1:5173 |
| `TRUST_PROXY` | `loopback` hoặc `off`: có tin `X-Forwarded-For` của Nginx trên cùng máy không (mặc định `loopback` khi `NODE_ENV=production`) | tắt |
| `STANDARD_DIAGNOSTICS`, `STANDARD_DIAGNOSTICS_DIR` | Ghi chẩn đoán từng lần tạo game vào `.local-diagnostics/` (tắt trong production; `0` tắt, `1` bật trong test) | bật khi phát triển |

Phía web (`apps/web/.env.example`, tùy chọn): `API_PROXY_TARGET` (nơi proxy `/api` tới) và `VITE_API_BASE_URL` (để trống để dùng proxy). Chi tiết nhà cung cấp, model và giới hạn: [docs/providers.md](docs/providers.md).

## Lệnh

| Lệnh | Việc |
|---|---|
| `npm run lint` | ESLint, không cho phép cảnh báo |
| `npm run typecheck` | Kiểm tra kiểu cho mọi gói, test và công cụ |
| `npm run build` | Dựng thư viện dùng chung, API và web |
| `npm test` | Test đơn vị (Vitest): lõi mô phỏng, brief, bộ dựng màn, cổng bot, API, web |
| `npm run test:e2e` | Dựng rồi chạy test trình duyệt (Playwright, Chromium) với máy chủ giả, không gọi AI thật |
| `npm run start:api`, `npm run preview:web` | Chạy bản đã build |

**Hiệu chỉnh** độ khó (không chạy trong `npm test`; PowerShell làm mất cờ khi đi qua `npm run`, nên chạy trực tiếp từ `apps/api`): `npx tsx scripts/calibrate-shooter.ts --set=old|new|all|boss [--seeds=1] [--out=tệp.txt]` (`npm run shooter:calibrate -w @game-creator/api` chạy mặc định). Kết quả đã ghi: [docs/shooter-calibration.md](docs/shooter-calibration.md). Các công cụ khác trong `apps/api/scripts/`: `measure-compile-time.mjs` (thời gian dựng màn qua worker), `measure-boss-reach.ts` (boss có tới được người chơi không), `make-golden-sim*.ts` (tạo lại bản chụp vàng, chỉ khi cố ý đổi mô phỏng).

Test dùng ba **bản chụp vàng** (`apps/api/test/fixtures/shooter/golden-sim*.json`) để chắc rằng mô phỏng không đổi một bit khi sửa code; hai bản đầu không bao giờ được tạo lại.

## Cấu trúc thư mục

```
apps/api/                  Máy chủ Express (cổng 3001)
  src/app.ts               Bốn route và các lớp bảo vệ chung; server.ts khởi động và tắt máy chủ
  src/shooter/             brief (AI trả gì), compile + maps + waves + presets (dựng màn), gate (cổng bot),
                           notices (câu "chưa hỗ trợ"), prompt (lời nhắn cho AI), service (một lần gọi AI → game),
                           isolated-compile + compile-worker (dựng trong worker có thời hạn 8 giây)
  src/providers/           Gemini, Groq, danh mục model, giới hạn tốc độ Groq, chuẩn hóa lỗi
  src/services/            AiGateway (ngân sách, thời hạn, hủy), request-budget, chẩn đoán, redact, worker-run
  src/http/                địa chỉ máy khách, trust proxy, hủy khi khách ngắt kết nối
  scripts/                 hiệu chỉnh và đo đạc (xem trên)
  test/                    test đơn vị và máy chủ giả cho E2E (e2e-server.ts)
apps/web/                  React + Phaser (cổng 5173)
  src/App.tsx              trang chính; lib/use-generate.ts và use-health.ts giữ trạng thái
  src/components/          PromptForm, StatusPanel, NoticesList, PreviewPanel, LevelInfoCard, ProviderSettings...
  src/game/                ShooterScene (đọc phím chuột, vẽ), shooter-draw, runtime (chạy trong iframe)
  src/lib/                 gọi API, văn bản của màn, lựa chọn provider đã lưu
packages/contracts/        Zod + lõi mô phỏng, dùng chung cho api và web (cần build: npm run build:contracts)
  src/shooter/             level (schema), sim và các bước của một nhịp, bot, bot "người thường", fixtures (màn viết tay)
e2e/                       Test trình duyệt
deploy/                    Mẫu Nginx và hướng dẫn triển khai Ubuntu
docs/                      DIRECTION.md (hướng đi), shooter-calibration.md (số liệu), providers.md
```

## Bảo mật và giới hạn

- Game chạy trong `iframe` chỉ có `sandbox="allow-scripts"`, CSP chặn mạng và form; lời mô tả không bao giờ được chèn vào HTML. Giao tiếp với iframe kiểm tra nguồn, origin, mã phiên và schema.
- API giới hạn thân yêu cầu 16 KB, mô tả 2.000 ký tự, đặt `Cache-Control: no-store` và `X-Content-Type-Options: nosniff`, chỉ cho phép các địa chỉ web trong `CLIENT_ORIGINS`, và có ngân sách yêu cầu theo từng địa chỉ máy khách. Chi tiết nằm trong [docs/providers.md](docs/providers.md).
- AI được gọi **một lần**; không thử lại, không đổi nhà cung cấp, không game dự phòng khi lỗi.
- Danh mục model là danh sách tĩnh đã kiểm chứng (`apps/api/src/providers/model-catalog.ts`); khi nhà cung cấp đổi model hoặc gói miễn phí thì cần cập nhật.
- Gemini chỉ được kiểm bằng SDK giả (chưa có khóa để thử thật); Groq đã được thử thật. "Test connection" chỉ kiểm khóa và quyền dùng model, không thay thế một lần tạo game thật.
- Chưa có: lưu/chia sẻ game, tài khoản, chỉnh game bằng lời nhắn, âm thanh, cảm ứng. Hướng đi: [docs/DIRECTION.md](docs/DIRECTION.md). Triển khai lên máy chủ: [deploy/README.md](deploy/README.md).
