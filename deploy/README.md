# GameCreator: Deployment Guide cho Ubuntu 24.04 EC2

Tài liệu này là runbook triển khai GameCreator lên một máy EC2 Ubuntu. Nó được viết từ code trong repository (`package.json`, `.env.example`, `server.ts`, `app.ts`, `docker-sandbox.ts`, `deploy/nginx/gamecreator.conf`, `deploy/sandbox/Dockerfile`...) và từ trạng thái máy mà chủ dự án đã cung cấp. Phần nào không có căn cứ thì được đánh dấu rõ, không đoán.

**Tài liệu này không có nghĩa ứng dụng đã được deploy.** Ở thời điểm viết, chưa có bước nào trong runbook được chạy trên EC2. Mọi dòng "Kết quả mong đợi" là mong đợi theo code, không phải kết quả đã đo.

## 0. Cách đọc tài liệu

### Nhãn trạng thái

| Nhãn | Ý nghĩa |
| --- | --- |
| `[ĐÃ XONG]` | Chủ dự án báo đã có trên EC2. Tài liệu không hướng dẫn làm lại, chỉ cho lệnh kiểm tra |
| `[CHƯA]` | Chưa làm, cần làm theo runbook |
| `[XÁC MINH]` | Không có thông tin. Phải kiểm tra bằng lệnh đã ghi trước khi tiếp tục |
| `[CẦN DOMAIN]` | Chỉ làm được khi đã có tên miền trỏ về Elastic IP |
| `[ADVANCED]` | Chỉ làm khi bật Advanced Mode. Hiện **không** làm |

### Hai giai đoạn

| Giai đoạn | Nội dung | Trạng thái |
| --- | --- | --- |
| **Giai đoạn 1** | Ứng dụng chạy sau Nginx HTTPS + Basic Auth. **Advanced Mode tắt.** Backend không gọi Docker | Mục tiêu hiện tại |
| **Giai đoạn 2** | Bật Advanced Mode (code do AI sinh ra chạy trong Docker sandbox) | **Bị chặn.** Xem mục "Blocker" ở cuối tài liệu |

Docker chỉ phục vụ Sandbox Runner của Advanced. Backend, frontend và Nginx **không** chạy trong Docker.

### Trạng thái hiện tại của EC2

| Hạng mục | Trạng thái |
| --- | --- |
| Ubuntu 24.04.5 LTS, m7i-flex.large (2 vCPU, 8 GB), EBS gp3 20 GB, Elastic IP `13.238.144.236` | `[ĐÃ XONG]` |
| Node.js 22.23.5, npm 10.9.9, Git 2.43.0, PM2 7.1.2, Nginx 1.24.0 | `[ĐÃ XONG]` |
| Docker Engine 29.10.0 (Docker official APT repository), containerd 2.4.2, cgroup v2, `hello-world` chạy được | `[ĐÃ XONG]` |
| Source tại `/home/ubuntu/PRJ27` | `[ĐÃ XONG]` |
| `npm ci`, build, `apps/api/.env`, PM2 app, thư mục `/var/www/gamecreator` | `[XÁC MINH]` (chưa có thông tin) |
| `apache2-utils` (htpasswd), `certbot`, file `/etc/nginx/.htpasswd-gamecreator` | `[XÁC MINH]`, coi như `[CHƯA]` |
| Tên miền, chứng chỉ TLS, site Nginx của GameCreator | `[CHƯA]` / `[CẦN DOMAIN]` (chưa có thông tin về domain) |
| Sandbox image, `sandbox:verify`, test tích hợp sandbox **trên EC2** | `[CHƯA]` |
| Cách cấp quyền Docker cho backend một cách an toàn | `[CHƯA]` (blocker B1, mục F.3) |
| Security Group đúng quy tắc ở mục J | `[XÁC MINH]` |

---

## A. System Requirements

| Thành phần | Yêu cầu | Phân loại | Cơ sở |
| --- | --- | --- | --- |
| Ubuntu | 24.04 LTS (máy hiện tại 24.04.5) | Bắt buộc | Mục tiêu của dự án. Nginx 1.24 là bản của 24.04 |
| CPU / RAM | Tối thiểu 2 vCPU / 2 GB cho Giai đoạn 1. Máy hiện tại 2 vCPU / 8 GB là dư RAM | Bắt buộc | Mặc định trong code được chọn cho 2 vCPU: 1 job, 1 container 1 CPU, 768 MB. **CPU là giới hạn chính**, không phải RAM |
| Ổ đĩa | 20 GB gp3 (hiện có) | Bắt buộc | `node_modules`, build, log, và (Giai đoạn 2) image Docker cùng build cache. Dung lượng image chưa đo trên EC2: đo bằng `docker image ls` / `docker system df` |
| Node.js | `>=22.0.0` (máy có 22.23.5) | Bắt buộc | `engines` trong `package.json` gốc |
| npm | `>=10.0.0` (máy có 10.9.9) | Bắt buộc | `engines` trong `package.json` gốc; dùng `package-lock.json` (lockfileVersion 3) |
| Git | Bất kỳ bản hiện đại (máy có 2.43.0) | Bắt buộc | Clone, cập nhật, rollback |
| Nginx | 1.24.0 | Bắt buộc | Điểm vào công khai duy nhất, Basic Auth, TLS, rate limit |
| PM2 | 7.1.2 | Bắt buộc theo runbook này | Chạy backend, tự khởi động lại, tự chạy sau reboot. Repository **không có** file cấu hình PM2; mẫu nằm ở mục G |
| `apache2-utils` | Bất kỳ | Bắt buộc | Lệnh `htpasswd` để tạo `/etc/nginx/.htpasswd-gamecreator` |
| `certbot` | Bản apt của 24.04 | Bắt buộc khi bật HTTPS (`[CẦN DOMAIN]`) | Chứng chỉ Let's Encrypt |
| `curl`, `openssl`, `ss` | Có sẵn trên Ubuntu Server | Bắt buộc cho kiểm tra | Mục K |
| Docker Engine | 29.10.0 (Docker official repo) | **Chỉ cho Sandbox** `[ADVANCED]` | `docker run` của `DockerSandbox`. Không dùng `docker.io` của Ubuntu |
| `docker-ce-rootless-extras`, `uidmap`, `dbus-user-session` | Cùng repo Docker | **Chỉ nếu chọn Rootless Docker** `[ADVANCED]` | Mục F.3 |
| `pm2-logrotate` | Module PM2 | Tùy chọn | Xoay vòng log PM2 |
| Chromium / Playwright browsers trên host | Không cần | Không cài | Production dùng tester Docker. `ADVANCED_TESTER=local` bị từ chối khi `NODE_ENV=production`. Không chạy `npx playwright install` trên EC2 |

---

## B. Installation Checklist

Các thành phần đã cài, không cài lại. Cột "Lệnh kiểm tra" dùng để xác nhận trạng thái thực tế.

| Thành phần | Phiên bản yêu cầu | Mục đích | Trạng thái | Lệnh kiểm tra |
| --- | --- | --- | --- | --- |
| Ubuntu | 24.04 | Hệ điều hành | `[ĐÃ XONG]` | `lsb_release -ds` |
| Node.js | `>=22` | Chạy backend, build | `[ĐÃ XONG]` | `node -v` |
| npm | `>=10` | Cài dependency, chạy script | `[ĐÃ XONG]` | `npm -v` |
| Git | any | Lấy source | `[ĐÃ XONG]` | `git --version` |
| PM2 | any | Quản lý process backend | `[ĐÃ XONG]` | `pm2 -v` |
| Nginx | 1.24 | Reverse proxy, static, auth | `[ĐÃ XONG]` | `nginx -v` |
| Docker Engine | 29.x (official repo) | Sandbox Runner | `[ĐÃ XONG]` | `docker version`, `apt-cache policy docker-ce \| head -3` |
| containerd | 2.x | Runtime của Docker | `[ĐÃ XONG]` | `containerd --version` |
| cgroup v2 | v2 | Giới hạn RAM/CPU/PID container | `[ĐÃ XONG]` | `stat -fc %T /sys/fs/cgroup` phải in `cgroup2fs` |
| Docker chạy được | | | `[ĐÃ XONG]` (`hello-world`) | `sudo docker run --rm hello-world` |
| Source code | | | `[ĐÃ XONG]` | `git -C /home/ubuntu/PRJ27 status -sb` |
| Không có gói `docker.io` | | Tránh hai Docker song song | `[XÁC MINH]` | `dpkg -l docker.io 2>/dev/null \| grep ^ii \|\| echo "không có docker.io"` |
| `apache2-utils` | any | `htpasswd` | `[XÁC MINH]` | `command -v htpasswd` |
| `certbot` | apt | TLS | `[XÁC MINH]` `[CẦN DOMAIN]` | `command -v certbot` |
| Cài nếu thiếu | | | | `sudo apt-get update && sudo apt-get install -y apache2-utils certbot` |

Kiểm tra PM2 và Node nằm ở đâu (quan trọng khi `pm2 startup` hoặc khi chuyển user ở Giai đoạn 2):

```bash
command -v node pm2
# Nếu đường dẫn nằm trong /home/ubuntu/.nvm/... thì chỉ user ubuntu dùng được Node này.
```

---

## C. Source Code Installation

### C.1 Clone `[ĐÃ XONG]`

Repository gốc (lấy từ `git remote -v` của bản clone cục bộ): `https://github.com/Ductahe170028/PRJ27.git`. Source đã có tại `/home/ubuntu/PRJ27`. Với máy mới:

```bash
git clone https://github.com/Ductahe170028/PRJ27.git /home/ubuntu/PRJ27
```

Nếu repository là private, dùng deploy key SSH hoặc credential helper. **Không** dán token vào URL (token sẽ nằm trong `.git/config` và lịch sử shell).

Kiểm tra trạng thái trước khi làm gì tiếp:

```bash
cd /home/ubuntu/PRJ27
git status --short        # phải rỗng
git log --oneline -3
```

### C.2 Cập nhật source khi có bản mới

```bash
cd /home/ubuntu/PRJ27
git rev-parse --short HEAD > ~/gamecreator.prev-rev   # ghi lại bản đang chạy để rollback (mục L)
git fetch origin
git status -sb                                        # xem đang lệch bao nhiêu commit
git pull --ff-only                                    # dừng nếu không phải fast-forward
```

Sau khi pull, phải `npm ci` và build lại (mục C.3, E). Nếu `git status` không sạch trước khi pull, dừng lại và xem file nào bị sửa trên máy chủ. Không ghi đè bằng `git reset --hard` khi chưa biết đó là gì.

### C.3 Cài dependencies bằng `npm ci`

```bash
cd /home/ubuntu/PRJ27      # luôn ở thư mục GỐC
node -v && npm -v          # >=22 và >=10
npm ci
```

Vì sao tại thư mục gốc:

- `package.json` gốc khai báo `"workspaces": ["apps/*", "packages/*"]`: `apps/api`, `apps/web`, `packages/contracts`. Chỉ có **một** `package-lock.json` ở gốc và một `node_modules` ở gốc. Chạy `npm ci` trong `apps/api` hay `apps/web` sẽ không đúng.
- `@game-creator/contracts` là workspace nội bộ. `npm ci` liên kết nó vào `node_modules/@game-creator/`. Package này xuất ra `dist/` (xem `exports` trong `packages/contracts/package.json`), nên **phải build contracts trước** khi API hoặc web chạy/typecheck. Script `npm run build` ở gốc đã làm đúng thứ tự.
- `npm ci` xóa `node_modules` rồi cài đúng theo lockfile và **báo lỗi** nếu `package.json` và lockfile lệch nhau. Không dùng `npm install` trên máy chủ (nó có thể sửa lockfile). Nếu `npm ci` lỗi vì lệch lockfile, dừng lại và sửa ở máy phát triển, không tạo lockfile mới trên EC2.
- Không dùng `--omit=dev`: bước build cần `typescript`, `vite`, `@vitejs/plugin-react`... Riêng `typescript` còn là dependency chạy thật của backend.
- `npm ci` không tải trình duyệt Playwright (package `playwright` không có postinstall tải browser). Production không cần.

Không có bước nào trong runbook yêu cầu `sudo npm`, và **không chạy `npm run build` bằng root**: nó tạo `dist/` thuộc root, các lần build sau của `ubuntu` sẽ lỗi quyền.

---

## D. Environment Variables

Backend đọc cấu hình từ biến môi trường. `server.ts` nạp `.env` bằng `import 'dotenv/config'` **theo thư mục làm việc hiện tại** của process, nên với PM2 `cwd` phải là `apps/api` để tìm `apps/api/.env`. `dotenv` **không ghi đè** biến đã có trong môi trường process: các biến đặt trong file ecosystem của PM2 (mục G) luôn thắng `.env`.

Tài liệu này **không đọc** và **không in** bất kỳ file `.env` nào. Danh sách dưới đây lấy từ `apps/api/.env.example`, `apps/web/.env.example` và từ code đọc biến (`server.ts`, `app.ts`, `create-agent.ts`, `docker-args.ts`, `trust-proxy.ts`, `create-registry.ts`).

### D.1 Tạo `apps/api/.env` `[XÁC MINH]`

```bash
cd /home/ubuntu/PRJ27
test -f apps/api/.env && echo "đã có, không ghi đè" || cp apps/api/.env.example apps/api/.env
chmod 600 apps/api/.env
nano apps/api/.env        # điền khóa trong trình soạn thảo, không dùng echo hay lệnh có chứa khóa
```

`.env` bị `.gitignore` chặn. Không commit, không gửi qua chat/issue. Không đặt khóa API trong file ecosystem của PM2 và không `export` khóa trong shell.

### D.2 Biến cho Giai đoạn 1 (Advanced tắt)

**Đặt trong file ecosystem của PM2 (mục G)**, vì sai một biến là mất lớp bảo vệ:

| Biến | Giá trị trên EC2 | Mặc định trong code | Giải thích |
| --- | --- | --- | --- |
| `NODE_ENV` | `production` | không đặt | Tắt Advanced, bật `trust proxy = loopback` mặc định, tắt ghi diagnostics, cấm `ADVANCED_TESTER=local`. **Không đổi thành `development` để mở tính năng** |
| `HOST` | `127.0.0.1` | `127.0.0.1` | Backend chỉ nghe loopback. Không đặt `0.0.0.0` |
| `PORT` | `3001` | `3001` | Nginx proxy tới `127.0.0.1:3001`. Số nguyên 1–65535, nếu không backend không khởi động |
| `TRUST_PROXY` | `loopback` | production: `loopback`; khác: `off` | Chỉ tin `X-Forwarded-For` khi kết nối TCP đến từ loopback (chính Nginx). Giá trị khác `loopback`/`off` làm backend từ chối khởi động |
| `ADVANCED_AI_ENABLED` | `false` | `true` (nhưng bị `NODE_ENV=production` chặn) | Đặt `false` rõ ràng để có hai điều kiện cùng tắt Advanced |

**AI Provider**, đặt trong `apps/api/.env` (bí mật):

| Biến | Bắt buộc? | Giải thích |
| --- | --- | --- |
| `GROQ_API_KEY` | Cần ít nhất một khóa để dùng AI thật | Provider không có khóa hiển thị là không khả dụng. Chỉ còn provider demo nếu không có khóa nào |
| `GEMINI_API_KEY` | như trên | |
| `GROQ_ALLOWED_MODELS` | Tùy chọn | Thu hẹp catalog (cách nhau bằng dấu phẩy, không wildcard). Để trống = dùng cả catalog. ID lạ làm provider không khả dụng. Giá trị hợp lệ có trong `.env.example` |
| `GEMINI_ALLOWED_MODELS` | Tùy chọn | như trên |

**Giới hạn chi phí và tải** (tùy chọn, đặt trong `apps/api/.env`; giá trị ngoài khoảng cho phép làm backend không khởi động):

| Biến | Mặc định | Khoảng hợp lệ | Ghi chú cho EC2 hiện tại |
| --- | --- | --- | --- |
| `AI_REQUESTS_PER_MINUTE` | 5 | 1–60 | Theo IP client thật (IPv6 gộp /64). Nhiều người sau cùng một NAT dùng chung. Giữ mặc định cho tới khi có nhu cầu thật |
| `AI_REQUESTS_PER_DAY` | 100 | 1–1000 | Trần chi phí của cả máy, reset theo ngày UTC. Đây là chốt chặn chi phí chính |
| `AI_MAX_CONCURRENT` | 2 | 1–5 | Lời gọi provider đồng thời của cả máy |
| `AI_TIMEOUT_MS` | 45000 | 1–50000 | Timeout một lời gọi provider |
| `CLIENT_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | danh sách | Chỉ ảnh hưởng header CORS. Trình duyệt gọi cùng origin qua Nginx nên **không cần** đổi. Có thể đặt `https://<domain>`; không phải điều kiện hoạt động |

Các hạn mức này nằm trong bộ nhớ một process: khởi động lại là về 0, và chỉ đúng khi chạy **một** instance (PM2 `instances: 1`).

### D.3 Biến cho Advanced `[ADVANCED]` (chưa dùng)

Không đặt các biến này cho tới khi bật Advanced. Mặc định đã an toàn cho 2 vCPU. Với m7i-flex.large (8 GB) giữ nguyên mặc định cho tới khi đo thực tế: CPU mới là giới hạn.

| Biến | Mặc định | Khoảng | Giải thích |
| --- | --- | --- | --- |
| `GAME_JOB_CONCURRENCY` | 1 | 1–2 | Số game chạy cùng lúc |
| `GAME_JOB_MAX_QUEUE` | 2 | 0–10 | Số game được chờ. 0 = bận thì 429 ngay |
| `GAME_JOB_TIMEOUT_MS` | 240000 | 30000–300000 | Thời gian chạy tối đa một game |
| `GAME_JOB_MAX_WAIT_MS` | 60000 | 5000–300000 | Thời gian chờ tối đa trong hàng. **`TIMEOUT + MAX_WAIT` không được vượt 300000**, nếu không backend không khởi động (trình duyệt dừng chờ sau 330 s, `proxy_read_timeout` là 300 s) |
| `GAME_JOB_MAX_PER_IP` | 2 | 1–5 | Chạy + chờ tối đa của một IP |
| `ADVANCED_TESTER` | `docker` | `docker`/`local` | `local` chạy Chromium trực tiếp trên host, **bị cấm khi `NODE_ENV=production`** |
| `SANDBOX_IMAGE` | `gamecreator-sandbox:pw1.60.0` | | Phải có tag hoặc digest cụ thể, `:latest` bị từ chối |
| `SANDBOX_CONCURRENCY` | 1 | 1–2 | Số container cùng lúc |
| `SANDBOX_MEMORY_MB` | 768 | 256–1536 | RAM (và swap, `--memory-swap` bằng `--memory`) mỗi container |
| `SANDBOX_CPUS` | 1 | 0.25–2 | CPU mỗi container. Máy có 2 vCPU: đừng đặt 2 |
| `SANDBOX_PIDS` | 256 | 32–1024 | Số process tối đa |
| `SANDBOX_TMP_MB` / `SANDBOX_SHM_MB` | 64 / 128 | 8–512 / 16–512 | `/tmp` và `/dev/shm` (tmpfs, `noexec` cho `/tmp`) |
| `SANDBOX_TIMEOUT_MS` | 45000 | 5000–120000 | Thời gian tối đa một container |
| `SANDBOX_RECHECK_MS` | 300000 | 30000–3600000 | Chu kỳ tự kiểm tra cách ly. Khi chưa sẵn sàng, kiểm tra lại sau tối đa 60 s (khi có request hỏi trạng thái) |
| `SANDBOX_DOCKER_BIN` | `docker` | | Đường dẫn Docker CLI. Không có trong `.env.example` nhưng code đọc (`docker-args.ts`) |

Lưu ý quan trọng về hai script kiểm tra sandbox (mục F): `sandbox:verify` chỉ đọc `process.env` của shell (không nạp `.env`), còn `test:sandbox` dùng **cấu hình mặc định** (`readSandboxConfig({})`) và gọi `docker` trên `PATH`. Biến trong `.env` không ảnh hưởng chúng. Nếu muốn kiểm tra giá trị khác mặc định với `sandbox:verify`, đặt biến ngay trước lệnh: `SANDBOX_IMAGE=... npm run sandbox:verify`.

### D.4 Biến của frontend (lúc build)

| Biến | Giá trị trên EC2 | Giải thích |
| --- | --- | --- |
| `VITE_API_BASE_URL` | **để trống / không đặt** | Biến `VITE_*` được nhúng vào bundle lúc build. Frontend gọi `/api/...` cùng origin. Đặt `http://127.0.0.1:3001` sẽ làm trình duyệt gọi thẳng backend, bỏ qua Nginx (và Basic Auth) |
| `API_PROXY_TARGET` | không cần | Chỉ cho `vite dev`/`vite preview` (proxy `/api`), không có trong bundle production |

Không tạo `apps/web/.env` trên EC2. Nếu đã có file đó, kiểm tra nó không đặt `VITE_API_BASE_URL` (mở file bằng trình soạn thảo, đừng in ra log chung).

### D.5 Biến không được đặt trong production

- `ADVANCED_DIAGNOSTICS`: dev-only. Với `NODE_ENV=production` diagnostics đã tự tắt (`run-diagnostics.ts`). Không bật vì nó ghi prompt/code vào `.local-diagnostics/`.
- `ADVANCED_TESTER=local`: bị từ chối ở production.

---

## E. Build

Tất cả chạy từ `/home/ubuntu/PRJ27`, bằng user thường (không `sudo`), sau `npm ci`.

```bash
npm run build
```

`npm run build` (script gốc) chạy lần lượt, dừng ở lỗi đầu tiên:

| Bước | Lệnh thật | Output |
| --- | --- | --- |
| 1. Contracts | `npm run build:contracts` → `tsc -p tsconfig.json` trong `packages/contracts` | `packages/contracts/dist/` (JS + `.d.ts`) |
| 2. Backend | `npm run build -w @game-creator/api` → `tsc -p tsconfig.json` (`rootDir src`, `outDir dist`, `module NodeNext`) | `apps/api/dist/`. Entrypoint **`apps/api/dist/server.js`**; runner sandbox trong `apps/api/dist/sandbox/`; worker validator `apps/api/dist/agent/validator-worker.mjs` |
| 3. Frontend | `npm run build -w @game-creator/web` = `npm run typecheck` → `npm run build:game` → `vite build` | `apps/web/public/runtime/game.js` và `advanced.js` (2 bundle IIFE, **bị gitignore**), rồi **`apps/web/dist/`**: `index.html`, `assets/`, `runtime/` (copy từ `public/`), `favicon.svg` |

Có thể chạy từng bước riêng: `npm run build:contracts`, `npm run build -w @game-creator/api`, `npm run build -w @game-creator/web`. Phải theo đúng thứ tự trên.

Ghi chú:

- Cảnh báo Rollup về một comment trong `zod` khi build frontend là cảnh báo từ thư viện bên thứ ba, không phải lỗi (exit code 0).
- `apps/web/dist/runtime/advanced.js` là script chạy game trong iframe preview và cũng được copy vào image sandbox. Nó có trong build kể cả khi Advanced tắt.
- **Sandbox image** `[ADVANCED]`: `npm run sandbox:build` = `npm run build` + `docker build -f deploy/sandbox/Dockerfile -t gamecreator-sandbox:pw1.60.0 .`. Context Docker bị giới hạn bằng allow-list trong `.dockerignore` (chỉ `contracts/dist`, `api/dist`, `advanced.js`; không có source, `.env`, test). Xem mục F.
- Không chạy `npm run test:e2e` trên EC2: nó build rồi mở Chromium của host, thứ mà production không cài.

Kiểm tra đầu ra:

```bash
ls apps/api/dist/server.js apps/api/dist/sandbox/runner-main.js
ls apps/web/dist/index.html apps/web/dist/runtime/game.js apps/web/dist/runtime/advanced.js
```

Kiểm tra tùy chọn trước khi deploy `[XÁC MINH]`: `npm test` (vitest, không cần Docker và không cần Chromium vì test tester dùng mock Playwright; các test cần Docker bị bỏ qua nếu không đặt `SANDBOX_INTEGRATION=1`). Kết quả trên Windows máy phát triển: 570 pass, 25 skip. Trên EC2 chưa chạy.

---

## F. Sandbox Deployment `[ADVANCED]`

**Mục này không cần làm để chạy Giai đoạn 1.** Với `NODE_ENV=production`, `app.ts` không tạo sandbox, queue hay DockerSandbox, và `server.ts` ghi log `[advanced] tắt ... không có sandbox nào được khởi tạo`. Nhưng bạn nên chạy mục này **trước** khi cân nhắc Giai đoạn 2, vì kết quả trên Docker Desktop (Windows) không thay thế được kiểm thử trên Ubuntu thật.

### F.1 Thiết kế sandbox (tóm tắt, từ code)

Mỗi job chạy một `docker run` với cờ do `apps/api/src/sandbox/docker-args.ts` (hàm `buildRunArgs`) tạo ra:

`--rm --init --pull=never --network=none --user=10001:10001 --cap-drop=ALL --security-opt=no-new-privileges --read-only --memory=768m --memory-swap=768m --cpus=1 --pids-limit=256 --ulimit nofile=1024:1024 --ulimit core=0 --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m --shm-size=128m --log-driver=none` cùng nhãn `gamecreator.sandbox=1` và ba biến môi trường không bí mật.

- Không có `-v`, `--mount`, `--env-file`, `docker.sock`, `--privileged`, `--cap-add`. Dữ liệu job qua stdin, kết quả qua stdout (tối đa 16 KB).
- `--pull=never`: backend không tự tải image. Image phải có sẵn **trong đúng daemon mà backend dùng**.
- Backend gọi Docker CLI bằng `spawn` mảng đối số, `shell: false`, chỉ truyền cho CLI các biến `PATH, HOME, DOCKER_HOST, DOCKER_CONFIG, DOCKER_CONTEXT, DOCKER_TLS_VERIFY, DOCKER_CERT_PATH, XDG_RUNTIME_DIR` (và vài biến Windows). Khóa API của backend không đến được CLI.
- Backend chỉ dùng bốn lệnh con: `run`, `kill <tên>`, `rm -f`, `ps -aq --filter label=gamecreator.sandbox=1`.
- Chromium trong container chạy `chromiumSandbox: false` (`GC_CHROMIUM_SANDBOX=0`), vì sandbox của Chromium cần user namespace mà các cờ trên chặn. Ranh giới cách ly là container. Đây là đánh đổi có chủ ý.
- Tự kiểm tra cách ly: khi khởi động và định kỳ, `probe-main.js` chạy trong container và `evaluateProbe` so với cấu hình: không root, `CapEff/CapBnd` = 0, `NoNewPrivs=1`, có seccomp, root chỉ đọc, `/tmp` đúng cỡ, không có giao diện mạng ngoài loopback, không ra Internet/DNS, không `docker.sock`, không thấy đường dẫn host, không có biến môi trường giống bí mật, **RAM / pids / CPU đúng cấu hình**, không có mount lạ. Lỗi một mục thì Advanced báo không khả dụng.
- Chính sách lỗi: Docker không chạy / thiếu image / `docker run` trả 125–127 thì job lỗi `tester_unavailable` (503). **Không có fallback chạy trên host.**

### F.2 Kiểm tra Docker trên EC2 `[CHƯA]`

```bash
docker version                      # nếu "permission denied": user hiện tại không thuộc nhóm docker (xem F.3)
sudo docker version
sudo docker info --format 'cgroup={{.CgroupVersion}} driver={{.CgroupDriver}} security={{.SecurityOptions}}'
```

Kỳ vọng: `cgroup=2`, `seccomp` có trong `security`. Xem cảnh báo cuối `sudo docker info` (ví dụ thiếu giới hạn memory/swap): có cảnh báo thì chưa được coi là đạt cho tới khi hiểu rõ.

```bash
id -nG                              # ubuntu có trong nhóm docker không?  [XÁC MINH]
sudo -l                             # ubuntu có sudo NOPASSWD:ALL không?   [XÁC MINH]
ss -ltnp | grep -E ':2375|:2376' || echo "không có Docker TCP API"
ls -l /var/run/docker.sock          # mong đợi: srw-rw---- root docker
```

### F.3 Quyền Docker cho backend: phân tích (BLOCKER)

**Backend là process nhận request từ Internet và (khi Advanced bật) chạy code do AI sinh ra.** Ai điều khiển được Docker daemon rootful thì có quyền root trên host (ví dụ `docker run -v /:/host --privileged ...`). Vì vậy quyền Docker của backend phải được đánh giá, không cấp tùy tiện.

| Phương án | Quyền thực tế mà backend có | Tương thích với runner hiện tại | Kết luận |
| --- | --- | --- | --- |
| **1. Thêm user backend vào nhóm `docker`** | Tương đương root (socket cho phép mọi tham số) | Chạy được | **Không dùng** cho backend |
| **2. `sudoers` cho phép `docker *`** | Tương đương root (cùng lý do: tham số tùy ý). Ngoài ra runner không gọi `sudo`, cần bọc thêm | Cần wrapper | **Không dùng** |
| **3. `sudoers` + script bọc whitelist** (đặt qua `SANDBOX_DOCKER_BIN`) | Giới hạn được **nếu** script kiểm tra đúng và đủ mọi đối số (chặn `-v`, `--privileged`, `--cap-add`, `--network`, `--pid`, `--device`, `--security-opt`, tên image...) | Runner chỉ dùng 4 lệnh con (kể trên), nhưng sudo xóa môi trường và script phải chuyển stdin/exit code đúng | **Chưa có.** Cần code mới + review bảo mật + test. Không có trong repo, chưa kiểm chứng |
| **4. Rootless Docker cho một user riêng không có sudo** | Chiếm quyền Docker chỉ cho ra quyền của user đó, không ra root | Tương thích **theo đọc code**: `CLI_ENV` chuyển `DOCKER_HOST`, `DOCKER_CONTEXT`, `DOCKER_CONFIG`, `XDG_RUNTIME_DIR`, `HOME`, `PATH`; cùng 4 lệnh con. **Chưa chạy thử** | **Ứng viên khả dĩ nhất. Chưa kiểm chứng.** Xem điều kiện bên dưới |

Máy hiện tại: user `ubuntu` thường có sudo không cần mật khẩu trên AMI Ubuntu của AWS (`[XÁC MINH]` bằng `sudo -l`). Nếu đúng, **chạy backend bằng `ubuntu` đã tương đương root** dù không thuộc nhóm `docker`. Vì vậy ở Giai đoạn 2 backend phải chạy bằng một user riêng không có sudo.

**Điều kiện và rủi ro của Rootless Docker** (theo tài liệu Docker "Rootless mode" và "Troubleshooting"/"Tips", đối chiếu lại đúng phiên bản khi làm):

1. Cài `docker-ce-rootless-extras`, `uidmap`, `dbus-user-session` (cùng Docker official repo). `/etc/subuid` và `/etc/subgid` phải có ít nhất 65536 id cho user.
2. Ubuntu 24.04 chặn user namespace không đặc quyền bằng AppArmor. Với gói deb `docker-ce-rootless-extras`, profile AppArmor cho `rootlesskit` đã đi kèm. Nếu cài bằng script `get.docker.com/rootless` thì phải tự tạo profile.
3. **Giới hạn tài nguyên chỉ hoạt động với cgroup v2 + systemd**, và theo mặc định chỉ hai controller `memory` và `pids` được ủy quyền cho user thường. `--cpus` cần ủy quyền thêm `cpu` qua `/etc/systemd/system/user@.service.d/delegate.conf` (`Delegate=cpu cpuset io memory pids`) rồi `sudo systemctl daemon-reload`. Nếu thiếu, cờ bị bỏ qua và `sandbox:verify` sẽ **fail** ở mục "Giới hạn CPU không đúng cấu hình".
4. AppArmor profile mặc định của container không được hỗ trợ trong rootless; seccomp vẫn có (`docker info` hiển thị `seccomp`, `rootless`, `cgroupns`). Đây là một lớp cách ly ít hơn rootful, cần chấp nhận có ý thức.
5. Daemon rootless chạy bằng `systemctl --user` của user đó, cần `sudo loginctl enable-linger <user>` để tự chạy sau reboot. Chạy rootless như service hệ thống không được hỗ trợ.
6. Kho image của rootless **tách riêng** với rootful. Image phải build bằng chính daemon rootless (`DOCKER_HOST` trỏ vào socket của nó), nếu không `--pull=never` sẽ báo thiếu image.
7. Process PM2 khởi động từ systemd hệ thống không có `XDG_RUNTIME_DIR`/`DOCKER_HOST` tự động. Phải đặt trong `env` của ecosystem (mục G.4).
8. Sandbox dùng `--network=none` nên không phụ thuộc network driver của rootless. Việc **build** image cần Internet (kéo `mcr.microsoft.com/playwright`, `npm install`).

**Kết luận: blocker B1.** Chưa có giải pháp quyền Docker đã kiểm chứng. Không bật Advanced cho tới khi một phương án được chạy và đạt cả `sandbox:verify` lẫn test tích hợp **bằng đúng daemon và đúng user mà backend sẽ dùng**.

### F.4 Build image

Image dựa trên `mcr.microsoft.com/playwright:v1.60.0-noble` (tag cố định). Phiên bản Playwright phải trùng ở bốn nơi (xem mục M.2).

Thử nghiệm nghiệm thu một lần, do người vận hành chạy tại terminal (không phải cấp quyền cho backend). Dùng **rootful daemon** bằng `sudo`. Tách `build` (user thường) khỏi `docker build` (sudo) để `dist/` không bị thuộc root:

```bash
cd /home/ubuntu/PRJ27
npm run build                                                  # user thường
sudo docker build -f deploy/sandbox/Dockerfile -t gamecreator-sandbox:pw1.60.0 .
```

Hai dòng trên tương đương `npm run sandbox:build` (script gốc: `npm run build && docker build -f deploy/sandbox/Dockerfile -t gamecreator-sandbox:pw1.60.0 .`). Nếu user hiện tại đã dùng được `docker` không cần sudo thì chạy thẳng `npm run sandbox:build`. Build cần Internet ra `mcr.microsoft.com` và npm registry.

### F.5 Đặt tag cố định và kiểm tra image

Tag `gamecreator-sandbox:pw1.60.0` gắn với **phiên bản Playwright**, không gắn với code runner; build lại sẽ ghi đè tag. Vì runner trong image chứa `apps/api/dist` tại thời điểm build, nên thêm một tag bất biến theo commit:

```bash
REV=$(git rev-parse --short HEAD)
sudo docker tag gamecreator-sandbox:pw1.60.0 gamecreator-sandbox:pw1.60.0-$REV
sudo docker image inspect gamecreator-sandbox:pw1.60.0-$REV \
  --format 'id={{.Id}} user={{.Config.User}} entrypoint={{.Config.Entrypoint}} labels={{.Config.Labels}}'
sudo docker image ls gamecreator-sandbox
```

Kỳ vọng: `user=10001:10001`, `entrypoint=[node /opt/gc/apps/api/dist/sandbox/runner-main.js]`, nhãn `playwright.version:1.60.0`. Ghi lại dung lượng image. Khi bật Advanced, đặt `SANDBOX_IMAGE=gamecreator-sandbox:pw1.60.0-<rev>` (regex trong `readSandboxConfig` chấp nhận tag dạng này). Digest `@sha256:` chỉ dùng được với image có RepoDigest từ registry, image build cục bộ thì dùng tag theo commit.

Lưu ý: `test:sandbox` luôn dùng tên mặc định `gamecreator-sandbox:pw1.60.0`, nên **giữ cả hai tag**.

### F.6 `sandbox:verify`

Chạy runner thật và so sánh cách ly với cấu hình. Thoát 0 chỉ khi mọi mục đạt:

```bash
# rootful qua sudo, không dùng npm dưới sudo để tránh file/cache thuộc root:
sudo env PATH="$PATH" "$(command -v node)" apps/api/dist/sandbox/verify-main.js
# nếu user hiện tại dùng được docker không cần sudo:
npm run sandbox:verify
```

Kết quả mong đợi (đã thấy trên Docker Desktop, **chưa thấy trên EC2**): `[sandbox] OK: container isolation matches the configuration.` Báo cáo JSON: `uid 10001`, `capEff/capBnd` toàn 0, `noNewPrivs 1`, `seccomp 2`, `rootWritable false`, `tmpBytes 67108864`, `externalAddresses []`, `networkReachable false`, `dnsResolves false`, `dockerSocketPresent false`, `hostPathsReadable []`, `secretEnvNames []`, `memoryMaxBytes 805306368`, `pidsMax 256`, `cpuQuota 100000/100000`, `unexpectedMounts []`.

Nếu `FAILED`: đọc từng dòng lỗi. Mỗi dòng ứng với một điều kiện của `evaluateProbe`. Không sửa ngưỡng để cho qua.

### F.7 Test tích hợp sandbox

```bash
sudo env SANDBOX_INTEGRATION=1 PATH="$PATH" "$(command -v node)" node_modules/vitest/vitest.mjs run apps/api/test/sandbox-integration.test.ts
# hoặc, nếu user dùng được docker không cần sudo:
SANDBOX_INTEGRATION=1 npm run test:sandbox
```

25 test: tự kiểm tra cách ly và negative control (container thiếu cờ hardening phải bị phát hiện), không root/setuid, không mạng/DNS/metadata, không `docker.sock`/FS host/env host, root chỉ đọc, `/tmp` tmpfs `noexec`, fork bomb, hết RAM, vòng lặp vô hạn (timeout), giới hạn CPU, tràn output, hủy job, dọn container cũ, ký tự shell trong dữ liệu job, và Playwright thật trong container (game chuẩn, lỗi JS, game treo, timeout, hủy, song song, `concurrency=1`, fail-closed khi thiếu `docker`/thiếu image). Mất khoảng 90 giây trên Docker Desktop.

Ghi chú:

- Chạy `vitest` dưới `sudo` có thể tạo `node_modules/.vite` thuộc root; nếu `npm test` sau đó báo `EACCES`, chạy `sudo chown -R "$USER": node_modules/.vite`. `[XÁC MINH]`
- Đã quan sát kiểm tra game có flake (khoảng 2/76 lần trên Docker Desktop: "vượt ngân sách vòng lặp/CPU mỗi frame", "đạn không xuất hiện"). Nếu một test Playwright thất bại, **ghi lại tên test và lỗi, chạy lại một lần để phân loại flake**, không bỏ qua test và không nới điều kiện.
- Kết quả bằng rootful daemon **không** chứng minh phương án rootless. Nếu chọn rootless, lặp lại F.4 đến F.7 bằng daemon và user rootless.

### F.8 Kiểm tra giới hạn tài nguyên

- `sandbox:verify` đã so `memory.max`, `pids.max`, `cpu.max` đo **bên trong** container với cấu hình. Đó là bằng chứng chính.
- Test fork bomb / OOM / CPU / output flood chứng minh giới hạn có tác dụng.
- Trong lúc test chạy, ở terminal khác: `sudo docker stats --no-stream` và `free -m`. Máy phải còn RAM trống và không dùng swap liên tục.

### F.9 Kiểm tra dọn dẹp

```bash
sudo docker ps -a --filter label=gamecreator.sandbox=1     # phải rỗng sau khi test xong
sudo docker ps -a                                          # chỉ còn container không liên quan (nếu có)
sudo docker system df
```

### F.10 Bảng nghiệm thu Sandbox trên EC2

| Hạng mục | Trạng thái |
| --- | --- |
| `docker info` (cgroup v2, seccomp, không cảnh báo giới hạn) | `[CHƯA]` |
| Build image | `[CHƯA]` |
| `sandbox:verify` thoát 0 | `[CHƯA]` |
| `test:sandbox` 25/25 | `[CHƯA]` |
| Không còn container `gamecreator.sandbox=1` | `[CHƯA]` |
| Phương án quyền Docker cho backend đã chọn và kiểm chứng | `[CHƯA]` (blocker B1) |
| Kiểm thử đường backend → queue → sandbox (mục K.7) | `[CHƯA]` |

**Chỉ khi toàn bộ bảng trên là đạt (kèm kết quả ghi lại) mới được nói sandbox đã được kiểm thử trên Ubuntu EC2.** Ngay cả khi đó, đây vẫn là cách ly bằng container dùng chung kernel (mục M.3).

---

## G. Backend Production với PM2

### G.1 Chọn user

- **Giai đoạn 1 (Advanced tắt):** chạy bằng user `ubuntu` đã có sẵn Node/PM2 và source. Backend không gọi Docker và không chạy code do AI sinh ra, nên không cần quyền Docker. Rủi ro còn lại: nếu `ubuntu` có sudo không mật khẩu, một lỗ hổng RCE trong backend sẽ thành root. Cách giảm rủi ro: user riêng không có sudo. Khuyến nghị nhưng không bắt buộc ở Giai đoạn 1; **bắt buộc** ở Giai đoạn 2 (mục F.3).
- **Giai đoạn 2:** user riêng không có sudo, không thuộc nhóm `docker`, với quyền Docker theo phương án đã kiểm chứng. Cần xem lại vị trí source/Node (Node cài bằng nvm trong `/home/ubuntu` thì user khác không dùng được) và quyền đọc `apps/api/dist`, `node_modules`.

### G.2 Tạo file ecosystem (ngoài repository) `[CHƯA]`

Repository không chứa cấu hình PM2. File bên dưới là mẫu **chưa chạy thử trên EC2**. Đặt ngoài repo để `git pull` không xung đột:

```bash
cat > /home/ubuntu/gamecreator.ecosystem.config.cjs <<'EOF'
module.exports = {
  apps: [{
    name: 'gamecreator-api',
    cwd: '/home/ubuntu/PRJ27/apps/api',     // dotenv đọc apps/api/.env theo cwd
    script: 'dist/server.js',
    exec_mode: 'fork',
    instances: 1,                           // hạn mức, hàng đợi nằm trong bộ nhớ: chỉ 1 instance
    autorestart: true,
    kill_timeout: 10000,                    // > 8 s: server.ts cưỡng chế thoát sau 8 s
    max_memory_restart: '1G',               // chốt chặn, chưa hiệu chỉnh theo đo đạc
    env: {
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: '3001',
      TRUST_PROXY: 'loopback',
      ADVANCED_AI_ENABLED: 'false',
    },
  }],
};
EOF
```

File này không chứa bí mật. Khóa API nằm trong `apps/api/.env` (mục D.1).

### G.3 Khởi động và chạy sau reboot

```bash
cd /home/ubuntu/PRJ27
pm2 start /home/ubuntu/gamecreator.ecosystem.config.cjs
pm2 status
pm2 logs gamecreator-api --lines 30 --nostream
```

Log khởi động mong đợi: `[api] http://127.0.0.1:3001 ...` và `[advanced] tắt (NODE_ENV=production hoặc ADVANCED_AI_ENABLED=false): ...`. Nếu thấy lỗi `PORT`/`AI_*`/`TRUST_PROXY phải là...`, đó là kiểm tra biến môi trường.

Tự chạy sau reboot (PM2 in ra một lệnh `sudo` cần chạy nguyên văn):

```bash
pm2 startup systemd -u ubuntu --hp /home/ubuntu
# chạy dòng "sudo env PATH=... pm2 startup ..." mà lệnh trên in ra
pm2 save
systemctl status pm2-ubuntu --no-pager
```

Nếu Node cài qua nvm, lệnh `pm2 startup` in ra đường dẫn Node tương ứng; dùng đúng dòng đó. Kiểm chứng bằng reboot thật (mục K.8).

### G.4 Cho Giai đoạn 2 với Rootless Docker `[ADVANCED]` `[CHƯA]`

Process PM2 do systemd hệ thống khởi động không có `XDG_RUNTIME_DIR` và `DOCKER_HOST`. Nếu dùng rootless, thêm vào `env` của ecosystem (thay `<UID>` bằng `id -u` của user dịch vụ): `DOCKER_HOST: 'unix:///run/user/<UID>/docker.sock'`, `XDG_RUNTIME_DIR: '/run/user/<UID>'`, cùng các biến `SANDBOX_*`/`GAME_JOB_*` (mục D.3). Hai biến này nằm trong danh sách CLI được phép (`docker-sandbox.ts`). Daemon rootless phải chạy trước. Nếu backend khởi động trước daemon, sandbox báo chưa sẵn sàng và kiểm tra lại sau tối đa 60 s; nếu vẫn chưa, `pm2 restart gamecreator-api`. `[XÁC MINH]`

### G.5 Vận hành hằng ngày

```bash
pm2 restart gamecreator-api            # fork mode: có gián đoạn ngắn (reload cũng vậy)
pm2 restart gamecreator-api --update-env   # khi đổi env trong ecosystem
pm2 stop gamecreator-api
pm2 logs gamecreator-api               # log trực tiếp (Ctrl+C để thoát)
pm2 flush gamecreator-api              # xóa log PM2
pm2 monit
```

Log PM2 nằm ở `~/.pm2/logs/gamecreator-api-{out,error}.log`. Tùy chọn: `pm2 install pm2-logrotate` để tránh log phình.

### G.6 Graceful shutdown

`server.ts` bắt `SIGINT` và `SIGTERM` (PM2 gửi `SIGINT` rồi `SIGKILL` sau `kill_timeout`): dừng nhận job, hủy job đang chờ, cho job đang chạy 2 giây, hủy phần còn lại và dừng container, rồi đóng HTTP và `closeIdleConnections()`. Cưỡng chế thoát với mã 1 sau 8 giây. Hàng đợi nằm trong bộ nhớ nên **job đang chờ hoặc đang chạy mất khi khởi động lại**, client thấy stream kết thúc và phải gửi lại.

Kiểm chứng: `pm2 restart gamecreator-api` rồi `pm2 logs` không thấy `SIGKILL`/timeout; `pm2 status` quay lại `online`.

### G.7 Không để backend nghe `0.0.0.0`

```bash
ss -ltnp | grep 3001       # phải thấy 127.0.0.1:3001, không phải 0.0.0.0:3001 hay *:3001
```

---

## H. Frontend Production

Frontend là file tĩnh do Nginx phục vụ. **Không** chạy `vite` dev server hay `vite preview` trong production, và **không** để trình duyệt gọi thẳng cổng 3001: frontend dùng `/api/...` cùng origin (`VITE_API_BASE_URL` để trống), Nginx proxy `/api/` tới backend.

```bash
cd /home/ubuntu/PRJ27
npm run build                                   # xem mục E; không đặt VITE_API_BASE_URL

sudo mkdir -p /var/www/gamecreator
# giữ bản trước để rollback nhanh
sudo rm -rf /var/www/gamecreator.prev
sudo cp -a /var/www/gamecreator /var/www/gamecreator.prev
# thay nội dung
sudo find /var/www/gamecreator -mindepth 1 -delete
sudo cp -a apps/web/dist/. /var/www/gamecreator/
sudo chown -R root:root /var/www/gamecreator
sudo find /var/www/gamecreator -type d -exec chmod 755 {} +
sudo find /var/www/gamecreator -type f -exec chmod 644 {} +
ls -l /var/www/gamecreator /var/www/gamecreator/runtime
```

Quyền: root sở hữu, thư mục 755, file 644. Nginx (user `www-data`, xem `grep -E '^user' /etc/nginx/nginx.conf`) chỉ cần đọc. Không đặt file bí mật hay `.env` ở đây. Cấu hình Nginx đã chặn mọi đường dẫn bắt đầu bằng dấu chấm (`location ~ /\.`).

Kiểm tra tính toàn vẹn: `/var/www/gamecreator/index.html`, `assets/*.js`, `runtime/game.js` và `runtime/advanced.js` phải tồn tại. Thiếu `runtime/*` thì preview game không chạy.

---

## I. Nginx

Nginx 1.24.0 đã cài `[ĐÃ XONG]`. File mẫu `deploy/nginx/gamecreator.conf` là điểm vào công khai duy nhất. Không cài lại Nginx.

### I.1 Các thành phần của cấu hình (từ file mẫu)

1. **Cổng 80**: chỉ `301` sang HTTPS và thư mục `/var/www/letsencrypt` cho thử thách ACME. Không hỏi mật khẩu, không proxy vào Node, nên mật khẩu không bao giờ đi qua HTTP.
2. **Cổng 443**: TLS 1.2/1.3 và `auth_basic` ở khối `server`; mọi `location` kế thừa. Không có `location` nào tắt xác thực.
3. **Reverse proxy**: `location ^~ /api/` → `http://127.0.0.1:3001`. Một khối duy nhất cho mọi API.
4. **File tĩnh**: `root /var/www/gamecreator`, `try_files $uri $uri/ /index.html`, kể cả `/runtime/` đều sau mật khẩu.
5. **Header chuyển tiếp**: `Host $server_name` (không phải Host client gõ), `Origin $http_origin`, `X-Real-IP` và `X-Forwarded-For` = `$remote_addr`, `X-Forwarded-Proto $scheme`; **xóa** `Authorization`, `Proxy-Authorization`, `X-Forwarded-Host`, `Forwarded`.
6. **Rate limit**: `/api/` 30 request/phút mỗi IP, burst 10, tối đa 8 kết nối đồng thời; phần còn lại của site 120 request/phút, burst 40; vượt mức trả `429`. Request sai mật khẩu vẫn được tính. `limit_req` chạy trước kiểm tra mật khẩu nên request không có mật khẩu tới `/api/` cũng bị tính vào hạn mức.
7. **Streaming**: `proxy_buffering off`, `proxy_read_timeout 300s`, `proxy_send_timeout 300s` cho NDJSON.
8. **Giới hạn body**: `client_max_body_size 16k` (Express cũng giới hạn 16 KB; vượt thì 413).
9. **Log**: `/var/log/nginx/gamecreator.access.log`, `/var/log/nginx/gamecreator.error.log`. Nginx không ghi header `Authorization` vào log.

### I.2 Header bảo mật: hiện trạng

File mẫu chỉ có `Strict-Transport-Security: max-age=31536000` (cùng `server_tokens off`). Backend thêm `X-Content-Type-Options: nosniff` và `Cache-Control: no-store` cho phản hồi API, **không** cho file tĩnh. **Chưa có** `X-Content-Type-Options`, `X-Frame-Options`/`frame-ancestors`, `Referrer-Policy`, `Content-Security-Policy` cho trang tĩnh. Đây là khoảng trống đã biết, chưa xử lý trong lần viết này. Riêng CSP cần thiết kế và thử riêng vì ứng dụng nhúng game trong iframe sandbox (`srcdoc`) và nạp `runtime/*.js`; thêm CSP sai sẽ làm hỏng preview.

### I.3 Chuẩn bị chung `[XÁC MINH]`

```bash
command -v htpasswd || sudo apt-get install -y apache2-utils
grep -E '^user' /etc/nginx/nginx.conf            # thường: user www-data;
sudo mkdir -p /var/www/gamecreator /var/www/letsencrypt
```

Tạo mật khẩu dùng chung `[CHƯA]` (nằm ngoài repository, lệnh tự hỏi mật khẩu hai lần, không ghi vào lịch sử shell). `-B` dùng bcrypt. `-c` chỉ lần đầu vì ghi đè file cũ:

```bash
sudo htpasswd -B -c /etc/nginx/.htpasswd-gamecreator friends
sudo chown root:www-data /etc/nginx/.htpasswd-gamecreator
sudo chmod 640 /etc/nginx/.htpasswd-gamecreator
ls -l /etc/nginx/.htpasswd-gamecreator
```

Username `friends` là tên dùng chung (có thể đổi trước khi chạy). Chỉ tạo một user. Mật khẩu nên dài và ngẫu nhiên (`openssl rand -base64 18`). Đổi mật khẩu: `sudo htpasswd -B /etc/nginx/.htpasswd-gamecreator friends` (không `-c`). Không copy file này vào dự án, không dán hash vào issue/log.

### I.4 Giai đoạn A: chưa có domain `[CHƯA]`

**Không bật site GameCreator và không mở Basic Auth qua HTTP công khai.** Basic Auth chỉ là Base64, mật khẩu đi rõ trên HTTP. File mẫu cố ý không qua `nginx -t` khi chưa có chứng chỉ: đừng chuyển `auth_basic` sang cổng 80 hay tạo chứng chỉ tự ký để né.

Việc làm được ở giai đoạn này:

1. Backend + PM2 (mục G), build frontend và copy vào `/var/www/gamecreator` (mục H).
2. Bỏ site mặc định của Nginx để cổng 80 không phục vụ trang chào của Nginx: `sudo rm -f /etc/nginx/sites-enabled/default && sudo nginx -t && sudo systemctl reload nginx`.
3. Security Group: **đóng 80 và 443** cho tới khi có domain và chứng chỉ (mục J).
4. Thử backend qua loopback: `curl -s http://127.0.0.1:3001/api/health`.
5. Tùy chọn, xem giao diện mà không mở Internet `[CHƯA]`: trên EC2 chạy tạm `npm run preview:web` (`vite preview` nghe `127.0.0.1:5173`, proxy `/api` tới `127.0.0.1:3001`), từ máy bạn mở đường hầm SSH `ssh -L 5173:127.0.0.1:5173 ubuntu@13.238.144.236` rồi vào `http://localhost:5173`. Đây **không phải** production: tắt ngay sau khi thử (Ctrl+C), cổng 5173 không được mở trong Security Group.

Có Elastic IP `13.238.144.236` nhưng **IP trần không đủ để cấp chứng chỉ theo hướng dẫn này**. Không có căn cứ trong repo về việc Let's Encrypt cấp chứng chỉ cho IP; cần domain. Nếu chưa mua domain, một dịch vụ DNS ký tự đại diện của bên thứ ba (ví dụ `13-238-144-236.sslip.io` trỏ về IP đó) có thể dùng để thử `[XÁC MINH]`: dịch vụ ngoài, chia sẻ giới hạn tần suất cấp chứng chỉ, chưa được thử trong dự án này.

### I.5 Giai đoạn B: đã có domain và TLS `[CẦN DOMAIN]`

Điều kiện: bản ghi DNS A của domain trỏ tới `13.238.144.236`; Security Group cho phép 80 và 443 từ Internet.

```bash
export DOMAIN=ten-mien-cua-ban.example      # thay bằng domain thật
dig +short "$DOMAIN"                        # phải ra 13.238.144.236 (nếu có dig; hoặc dùng getent hosts)
```

**1. Xin chứng chỉ trước khi bật site.** File mẫu cần hai file chứng chỉ mới qua `nginx -t`, nên lần cấp đầu dùng `standalone` khi Nginx đang dừng (certbot tự mở cổng 80):

```bash
sudo systemctl stop nginx
sudo certbot certonly --standalone -d "$DOMAIN"
```

**2. Cài cấu hình bằng bản sao đã sửa** (không sửa file trong repo):

```bash
cd /home/ubuntu/PRJ27
sudo cp deploy/nginx/gamecreator.conf /etc/nginx/sites-available/gamecreator.conf
sudo sed -i \
  -e "s#/etc/nginx/ssl/gamecreator/fullchain.pem#/etc/letsencrypt/live/$DOMAIN/fullchain.pem#" \
  -e "s#/etc/nginx/ssl/gamecreator/privkey.pem#/etc/letsencrypt/live/$DOMAIN/privkey.pem#" \
  -e "s#gamecreator.example.com#$DOMAIN#g" \
  /etc/nginx/sites-available/gamecreator.conf
grep -nE 'server_name|ssl_certificate' /etc/nginx/sites-available/gamecreator.conf
sudo ln -sf /etc/nginx/sites-available/gamecreator.conf /etc/nginx/sites-enabled/gamecreator.conf
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl start nginx
```

Chỉ symlink **một lần** vào `sites-enabled` và không copy thêm vào `conf.d/` (zone `limit_req_zone` khai báo trong file này, nằm ngoài `server`, sẽ bị khai báo hai lần). Nếu `nginx -t` báo `address family not supported`, comment các dòng `listen [::]:...`.

**3. Chuyển gia hạn sang webroot** để không phải dừng Nginx. Thư mục `/var/www/letsencrypt` đã được khối cổng 80 phục vụ:

```bash
sudo certbot reconfigure --cert-name "$DOMAIN" --authenticator webroot \
  --webroot-path /var/www/letsencrypt --deploy-hook "systemctl reload nginx"
sudo certbot renew --dry-run
systemctl list-timers | grep certbot
```

`certbot reconfigure` có từ Certbot 2.3; bản apt của Ubuntu 24.04 mới hơn nhưng `[XÁC MINH]`. Nếu lệnh không có, cấp lại bằng `sudo certbot certonly --webroot -w /var/www/letsencrypt --cert-name "$DOMAIN" -d "$DOMAIN" --deploy-hook "systemctl reload nginx"`. Chỉ coi là xong khi `--dry-run` thành công.

**4. Sau mỗi `git pull` có đổi `deploy/nginx/gamecreator.conf`**, copy lại và chạy lại `sed` ở bước 2 (bản trong `/etc/nginx` là bản sao đã sửa, không tự cập nhật).

### I.6 Kiểm tra, reload, restart

```bash
sudo nginx -t                         # luôn chạy trước khi reload
sudo systemctl reload nginx           # không ngắt kết nối đang có
sudo systemctl restart nginx          # chỉ khi cần (đổi module, treo)
sudo tail -n 50 /var/log/nginx/gamecreator.error.log
```

Kiểm tra API qua Nginx (mục K).

---

## J. Networking và AWS

Tài liệu **không** thay đổi cấu hình AWS. Kiểm tra Security Group của instance (Elastic IP hiện tại: `13.238.144.236`) bằng AWS Console.

| Cổng | Rule inbound | Ghi chú |
| --- | --- | --- |
| 22 (SSH) | **Chỉ IP quản trị** (`/32`), không `0.0.0.0/0` | |
| 80 (HTTP) | Mở khi có domain: chuyển hướng 301 và ACME | Chưa có domain thì đóng |
| 443 (HTTPS) | Mở khi có domain và chứng chỉ | Điểm vào ứng dụng |
| 3001 (backend) | **Không mở** | Backend nghe `127.0.0.1` |
| 5173 (Vite) | **Không mở** | Không chạy Vite trong production |
| 2375/2376 (Docker API) | **Không mở** | Daemon chỉ dùng Unix socket; kiểm tra `ss -ltnp` |

Khuyến nghị khác (không bắt buộc cho runbook, `[XÁC MINH]`): yêu cầu IMDSv2 cho instance. Sandbox dùng `--network=none` nên container không tới được metadata, nhưng bản thân backend/host vẫn tới được.

Outbound cần: Internet cho `git`, npm registry, `apt`, Docker/MCR (build image), Let's Encrypt, và API của Groq/Gemini (backend gọi). Không giới hạn outbound ở Security Group nếu chưa kiểm tra đủ các đích đó.

Khi **Stop/Start** instance, Elastic IP được giữ nguyên (public DNS mặc định đổi). Domain trỏ vào Elastic IP nên không phải cập nhật DNS.

---

## K. Verification

Chạy sau khi triển khai Giai đoạn 1. Dùng `curl -u friends` để curl tự hỏi mật khẩu (không đưa mật khẩu vào dòng lệnh). `DOMAIN` là domain thật. Không chạy các bài thử rate limit liên tiếp: bạn sẽ bị chặn IP của chính mình tới khi hết cửa sổ (khoảng một phút).

### K.1 Backend

```bash
pm2 status                                       # gamecreator-api: online
curl -s http://127.0.0.1:3001/api/health         # {"status":"ok","service":"ai-game-creator-api","mode":"multi-provider"}
ss -ltnp | grep 3001                             # 127.0.0.1:3001
curl -s http://127.0.0.1:3001/api/agent/config   # "enabled":false  (Advanced tắt)
pm2 logs gamecreator-api --lines 20 --nostream   # có dòng "[advanced] tắt ..."
```

### K.2 Nginx và Basic Auth `[CẦN DOMAIN]`

```bash
sudo nginx -t
curl -sI "http://$DOMAIN/"                       # 301, Location https://..., KHÔNG có WWW-Authenticate
curl -sI "https://$DOMAIN/"                      # 401 + WWW-Authenticate: Basic realm="GameCreator"
for p in / /index.html /runtime/advanced.js /api/health /nope; do
  printf '%s ' "$p"; curl -s -o /dev/null -w '%{http_code}\n' "https://$DOMAIN$p"
done                                             # tất cả 401
for p in /api/games/generate /api/ai/test-connection /api/agent/generate; do
  printf 'POST %s ' "$p"; curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' -d '{}' "https://$DOMAIN$p"
done                                             # tất cả 401
curl -s -o /dev/null -w '%{http_code}\n' -u friends:sai-mat-khau "https://$DOMAIN/"   # 401
```

### K.3 Frontend và API có mật khẩu

```bash
curl -s -u friends -o /dev/null -w '%{http_code}\n' "https://$DOMAIN/"                       # 200
curl -s -u friends "https://$DOMAIN/api/health"                                              # JSON health
curl -s -u friends -o /dev/null -w '%{http_code}\n' "https://$DOMAIN/runtime/game.js"        # 200
curl -s -u friends "https://$DOMAIN/api/ai/providers"                                        # danh sách provider
```

Mở `https://$DOMAIN/` bằng trình duyệt, nhập mật khẩu, tạo một game demo. Trong tab Network, mọi request đi tới `https://$DOMAIN/api/...` (không có request tới cổng 3001).

### K.4 Rate limit

```bash
# Site: sai/không mật khẩu vẫn bị đếm. Mong đợi: khoảng 41 lần 401 rồi 429.
for i in $(seq 1 60); do curl -s -o /dev/null -w '%{http_code} ' "https://$DOMAIN/"; done; echo
sleep 70
# API: mong đợi khoảng 11 lần 401 rồi 429.
for i in $(seq 1 15); do curl -s -o /dev/null -w '%{http_code} ' "https://$DOMAIN/api/health"; done; echo
# Body lớn hơn 16 KB: mong đợi 413 (client_max_body_size 16k)
head -c 20000 /dev/zero | tr '\0' 'a' | curl -s -u friends -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' --data-binary @- "https://$DOMAIN/api/games/generate"
```

Số 41 và 11 là burst + 1 theo cấu hình (`burst=40`, `burst=10`); `[XÁC MINH]` con số chính xác trên EC2.

### K.5 Header tới backend (chống giả mạo) `[XÁC MINH]`

Backend không log IP client. Quan sát header thật sự đến backend bằng `tcpdump` trên loopback (HTTP thuần giữa Nginx và Node). Cửa sổ 1:

```bash
sudo tcpdump -i lo -A -s0 -l 'tcp port 3001' | grep -iE '^(host|x-forwarded-for|x-real-ip|x-forwarded-host|forwarded|authorization|proxy-authorization):'
```

Cửa sổ 2 (từ máy khác, IP của bạn khác `1.2.3.4`):

```bash
curl -s -u friends -H 'X-Forwarded-For: 1.2.3.4' -H 'X-Real-IP: 1.2.3.4' -H 'Host: localhost' -H 'Forwarded: for=1.2.3.4' "https://$DOMAIN/api/health"
```

Mong đợi ở cửa sổ 1: `Host` là domain thật (không phải `localhost`); `X-Forwarded-For` và `X-Real-IP` là IP thật của bạn (không phải `1.2.3.4`); **không** có `Authorization`, `Proxy-Authorization`, `Forwarded`, `X-Forwarded-Host`. Nếu `tcpdump` chưa có: `sudo apt-get install -y tcpdump`.

### K.6 Advanced phải tắt

```bash
curl -s -u friends "https://$DOMAIN/api/agent/config"          # "enabled":false
curl -s -u friends -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' \
  -H 'Host: localhost' -H 'Origin: http://localhost' -d '{"providerId":"groq","modelId":"openai/gpt-oss-20b","prompt":"test"}' \
  "https://$DOMAIN/api/agent/generate"                          # 403
```

### K.7 Docker, Sandbox, Playwright `[ADVANCED]`

Chỉ khi chuẩn bị bật Advanced. Mục F.2–F.9 là kiểm tra Docker, sandbox, Playwright-trong-container. Để kiểm thử đường **backend → hàng đợi → sandbox** mà không đổi gate production, chạy tạm một backend thứ hai ở **chế độ không production**, loopback, cổng khác, và gọi từ chính EC2 (Host `127.0.0.1:3002` thỏa `advancedAllowed`). Dùng khóa Groq thật nên tốn quota. `[CHƯA]`, chưa chạy thử:

```bash
cd /home/ubuntu/PRJ27/apps/api
NODE_ENV=development ADVANCED_AI_ENABLED=true ADVANCED_DIAGNOSTICS=0 HOST=127.0.0.1 PORT=3002 node dist/server.js
# ADVANCED_DIAGNOSTICS=0 để không ghi prompt/code vào .local-diagnostics
```

Ở terminal khác:

```bash
curl -s http://127.0.0.1:3002/api/agent/config     # "enabled":true khi sandbox sẵn sàng
curl -sN -H 'Content-Type: application/json' \
  -d '{"providerId":"groq","modelId":"openai/gpt-oss-20b","prompt":"một game bắn máy bay đơn giản"}' \
  http://127.0.0.1:3002/api/agent/generate        # luồng NDJSON
```

Sau đó Ctrl+C backend tạm và kiểm tra `docker ps -a --filter label=gamecreator.sandbox=1` rỗng. Backend tạm phải chạy bằng đúng user và daemon Docker sẽ dùng thật.

### K.8 PM2 và reboot

```bash
sudo reboot
# đăng nhập lại sau ~1-2 phút
pm2 status                                       # gamecreator-api: online (không cần chạy lại lệnh thủ công)
systemctl is-active nginx docker pm2-ubuntu
curl -s http://127.0.0.1:3001/api/health
```

### K.9 Security Group từ bên ngoài

Từ máy **không** phải EC2 và không nằm trong dải SSH: `nc -vz -w 5 13.238.144.236 3001` (và 5173, 2375, 2376) phải timeout/refused. 22 chỉ vào được từ IP quản trị. 80 trả `301`; 443 trả `401`.

### K.10 Log

```bash
sudo tail -n 20 /var/log/nginx/gamecreator.access.log
sudo tail -n 20 /var/log/nginx/gamecreator.error.log
pm2 logs gamecreator-api --lines 50 --nostream
sudo grep -ciE 'authorization|gsk_|AIza|password' /var/log/nginx/gamecreator.*.log ~/.pm2/logs/gamecreator-api-*.log   # mong đợi 0
```

### K.11 Tài nguyên

```bash
free -m ; swapon --show ; df -h / ; uptime
pm2 monit                                        # q để thoát
sudo docker system df                            # [ADVANCED]
```

---

## L. Maintenance và Troubleshooting

### L.1 Cập nhật và build lại (Giai đoạn 1)

```bash
cd /home/ubuntu/PRJ27
git rev-parse --short HEAD > ~/gamecreator.prev-rev
git pull --ff-only
npm ci
npm run build
# copy frontend (mục H), nếu deploy/nginx/gamecreator.conf đổi thì copy lại + sed (mục I.5)
pm2 restart gamecreator-api
sudo nginx -t && sudo systemctl reload nginx
curl -s http://127.0.0.1:3001/api/health
```

### L.2 Rebuild Sandbox image `[ADVANCED]`

Image chứa `apps/api/dist` và `advanced.js` tại thời điểm build, và runner trong image chạy `PlaywrightGameTester`. **Mỗi khi pull code đổi `apps/api/src/agent`, `apps/api/src/sandbox`, `packages/contracts` hoặc runtime web, phải build lại image**, nếu không phía host và phía container lệch nhau.

```bash
docker tag gamecreator-sandbox:pw1.60.0 gamecreator-sandbox:pw1.60.0-prev   # giữ bản cũ (dùng sudo nếu cần)
npm run sandbox:build                                                        # hoặc 2 lệnh ở F.4
# chạy lại F.6 (sandbox:verify), F.7 (test:sandbox), F.9
# nếu hỏng: docker tag gamecreator-sandbox:pw1.60.0-prev gamecreator-sandbox:pw1.60.0
```

Dọn image/cache cũ khi ổ đĩa đầy: `docker image prune`, `docker builder prune` (xem `docker system df` trước; đừng xóa image đang dùng).

### L.3 Rollback

```bash
cd /home/ubuntu/PRJ27
PREV=$(cat ~/gamecreator.prev-rev)
git checkout "$PREV"            # nhận trạng thái "detached HEAD"; quay lại nhánh: git checkout main
npm ci && npm run build
# frontend: khôi phục nhanh từ bản trước
sudo rm -rf /var/www/gamecreator.bad && sudo mv /var/www/gamecreator /var/www/gamecreator.bad && sudo cp -a /var/www/gamecreator.prev /var/www/gamecreator
pm2 restart gamecreator-api
```

Khôi phục `/var/www/gamecreator.prev` chỉ lùi được **một** bản. Muốn lùi xa hơn thì build lại từ commit cũ rồi copy lại (mục H). Với Advanced thì khôi phục cả image (L.2). Không dùng `git reset --hard` trên máy chủ nếu chưa biết bản nào đang chạy.

### L.4 Kiểm tra RAM/CPU và container sót

```bash
free -m ; uptime ; top -bn1 | head -15
ps -eo pid,user,%mem,%cpu,cmd --sort=-%mem | head
sudo docker ps -a --filter label=gamecreator.sandbox=1     # phải rỗng khi không có job
sudo docker rm -f $(sudo docker ps -aq --filter label=gamecreator.sandbox=1) 2>/dev/null
```

Lệnh `docker rm -f` cuối chỉ dọn container có nhãn của sandbox. Backend cũng tự dọn container sót khi khởi động (Advanced bật).

### L.5 Out Of Memory

```bash
sudo dmesg -T | grep -iE 'out of memory|killed process' | tail
sudo journalctl -k --since "1 hour ago" | grep -iE 'oom|killed process' | tail
pm2 status ; pm2 logs gamecreator-api --lines 100 --nostream
```

- Một container sandbox bị OOM-killed (`SANDBOX_MEMORY_MB`) làm game đó nhận lỗi "Sandbox dừng game vì...", không phải lỗi hệ thống.
- Backend bị kernel OOM-kill thì PM2 khởi động lại nó (`autorestart`); kiểm tra `max_memory_restart` và RAM thật bằng `free -m`.
- Chưa đo RAM thực tế của một job Advanced trên EC2. Đo bằng `docker stats --no-stream` trong lúc chạy trước khi tăng `GAME_JOB_CONCURRENCY`/`SANDBOX_CONCURRENCY`.

### L.6 Stop/Start EC2

Stop rồi Start: Elastic IP giữ nguyên; `nginx`, `docker` tự khởi động (systemd); backend tự chạy lại nếu `pm2 startup` + `pm2 save` đã làm (mục G.3). Sau Start chạy lại K.1, K.2, K.8. Container sandbox không còn sau reboot (có `--rm`); backend dọn phần sót khi khởi động.

### L.7 Lỗi thường gặp

| Triệu chứng | Nguyên nhân thường gặp | Cách xử lý |
| --- | --- | --- |
| `nginx -t`: không tìm thấy file chứng chỉ | Chưa cấp chứng chỉ hoặc chưa sửa đường dẫn trong bản sao | Mục I.5. Không tạo chứng chỉ giả |
| `nginx -t`: `address family not supported` | IPv6 tắt | Comment các dòng `listen [::]:...` |
| `502 Bad Gateway` ở `/api/` | Backend chưa chạy hoặc không nghe `127.0.0.1:3001` | `pm2 status`, `ss -ltnp \| grep 3001`, `pm2 logs` |
| `401` mãi dù mật khẩu đúng | File htpasswd sai quyền hoặc sai nhóm | `ls -l /etc/nginx/.htpasswd-gamecreator` (root:www-data, 640) |
| `429` khi duyệt bình thường | Vượt `limit_req` hoặc `AI_REQUESTS_PER_MINUTE` | Chờ ~1 phút; nhiều người sau cùng một NAT dùng chung hạn mức |
| Backend không khởi động, lỗi `... phải là số nguyên từ ... đến ...` | Giá trị biến `AI_*`/`GAME_JOB_*`/`SANDBOX_*` ngoài khoảng | Sửa theo bảng ở mục D |
| Backend báo `Cổng 3001 đang được sử dụng` | Một process khác (hoặc backend tạm ở K.7) đang giữ cổng | `ss -ltnp \| grep 3001` |
| `permission denied` khi chạy `docker` | User không thuộc nhóm `docker` (đúng thiết kế) | Mục F.3, F.4. Không thêm backend vào nhóm `docker` |
| `sandbox:verify` báo "Giới hạn CPU không đúng cấu hình" | Controller `cpu` không được ủy quyền (rootless) hoặc cgroup v1 | Mục F.3 điểm 3 |
| Sandbox báo thiếu image | Image build ở daemon khác (rootful vs rootless) hoặc tag khác `SANDBOX_IMAGE` | `docker image ls gamecreator-sandbox` bằng đúng daemon |
| Trang trắng hoặc preview game không chạy | Thiếu `runtime/*.js` trong `/var/www/gamecreator` | Build lại (mục E) và copy lại (mục H) |

---

## M. Phụ lục

### M.1 Địa chỉ client sau Nginx và hàng đợi job

Nginx ghi đè `X-Forwarded-For` và `X-Real-IP` bằng `$remote_addr`; Express chỉ tin header đó khi TCP peer là loopback (`TRUST_PROXY=loopback`). `advancedAllowed` không đọc `req.ip`: nó dùng `socket.remoteAddress` cùng kiểm tra `Host`/`Origin`, nên header giả không mở được Advanced. Không dùng IP/Host/Origin để quyết định ai được vào site.

Hàng đợi job Advanced nằm trong bộ nhớ (không Redis). Hàng đầy hoặc backend đang tắt: `POST /api/agent/generate` trả 429 (kèm `Retry-After`) hoặc 503 **trước khi** stream. Đang chờ: stream NDJSON mở ngay và nhận sự kiện `status` ("Đang chờ đến lượt: vị trí N..."); hợp đồng NDJSON không đổi. Hết hạn chạy: `failed/timeout`; chờ quá lâu: `failed/rate_limit`; tắt máy: `failed/shutting_down`. Job đang chờ và đang chạy **mất khi khởi động lại**.

### M.2 Cập nhật Playwright

Phiên bản Playwright phải trùng ở bốn nơi; `apps/api/test/deploy-config.test.ts` kiểm tra và test đỏ nếu lệch:

1. `package-lock.json` (và `apps/api/package.json`, `package.json` gốc cho `@playwright/test`).
2. `ARG PLAYWRIGHT_VERSION` (và tag `FROM`) trong `deploy/sandbox/Dockerfile`.
3. `SANDBOX_PLAYWRIGHT_VERSION` trong `apps/api/src/sandbox/docker-args.ts`.
4. `SANDBOX_IMAGE` trong `.env` và `.env.example`. Tên image trong script `sandbox:build` (`package.json` gốc) cũng chứa phiên bản.

Quy trình (ở máy phát triển, rồi deploy): nâng Playwright, `npm install`, sửa các chỗ trên, `npm test`, `npm run sandbox:build`, `npm run sandbox:verify`, `SANDBOX_INTEGRATION=1 npm run test:sandbox`, commit, rồi trên EC2 làm theo mục L.1–L.2 và đặt `SANDBOX_IMAGE` mới. Giữ image cũ cho tới khi image mới đạt kiểm tra.

### M.3 Rủi ro còn lại

- Container dùng chung kernel với host: lỗ hổng kernel hoặc runtime container vẫn có thể thoát ra. Giữ Ubuntu và Docker được cập nhật bảo mật.
- Quyền Docker của backend chưa giải quyết xong (blocker B1).
- Chromium chạy `--no-sandbox` trong container (đánh đổi có chủ ý, mục F.1).
- Hạn mức IP, hàng đợi và tin cậy proxy nằm trong bộ nhớ một process: mất khi khởi động lại, không dùng nhiều instance.
- Kiểm tra game bằng Playwright phụ thuộc thời gian (khoảng 2/76 lần báo lỗi trên Docker Desktop). Chưa đo baseline với Chromium chạy trực tiếp.
- Mật khẩu dùng chung, không định danh từng người, không thu hồi riêng lẻ. Trình duyệt nhớ Basic Auth tới khi realm hoặc mật khẩu đổi; ứng dụng không có nút đăng xuất.
- `Origin` của trình duyệt được chuyển tiếp nguyên vẹn (theo thiết kế).
- Thiếu header bảo mật cho trang tĩnh ngoài HSTS (mục I.2).
- Basic Auth chỉ kiểm soát ai vào được website. Nó **không** cách ly code do AI sinh ra.

---

## Blocker trước Production và Advanced

| # | Blocker | Ảnh hưởng | Cần làm |
| --- | --- | --- | --- |
| B1 | Chưa có giải pháp quyền Docker cho backend đã kiểm chứng | Chặn Giai đoạn 2 | Chọn và chạy thử Rootless Docker (hoặc wrapper có review) bằng đúng user và daemon; đạt F.6 và F.7 |
| B2 | Sandbox chưa được kiểm thử trên Ubuntu EC2 | Chặn Giai đoạn 2 | Mục F.2–F.10 |
| B3 | **Advanced bị khóa ở production bởi code.** `app.ts` tắt khi `NODE_ENV=production`; `advancedAllowed` (`routes.ts`) chỉ cho loopback với `Host`/`Origin` là localhost; qua Nginx thì `Host` là domain nên luôn bị từ chối | Dù sandbox đạt, **không thể dùng Advanced qua domain nếu không có một thay đổi code riêng** | Ngoài phạm vi tài liệu này. Không đổi `NODE_ENV` hay `Host` để vượt qua |
| B4 | Chưa có domain/chứng chỉ (theo thông tin hiện có) | Chặn bật site Nginx và mở 80/443 | Mục I.5 |
| B5 | Chưa có `htpasswd`, ecosystem PM2 chưa được tạo/chạy thử | Chặn Giai đoạn 1 | Mục I.3, G |
| B6 | Header bảo mật cho trang tĩnh còn thiếu | Rủi ro, không chặn | Thiết kế và thử riêng (mục I.2) |

## Thứ tự lệnh cần làm tiếp (Giai đoạn 1)

1. Xác minh trạng thái hiện có: mục B (các lệnh kiểm tra), `git -C /home/ubuntu/PRJ27 status -sb`, `id -nG`, `sudo -l`.
2. `cd /home/ubuntu/PRJ27 && npm ci && npm run build` (mục C.3, E).
3. Tạo `apps/api/.env` (mục D.1) và file ecosystem (mục G.2).
4. `pm2 start ...`, `pm2 save`, `pm2 startup` (mục G.3); kiểm tra K.1.
5. Copy frontend vào `/var/www/gamecreator` (mục H).
6. `apache2-utils` + `htpasswd` (mục I.3).
7. Có domain: DNS → Security Group mở 80/443 → certbot → cài Nginx (mục I.5) → K.2 đến K.6.
8. Reboot thử (K.8) và kiểm tra Security Group từ bên ngoài (K.9).
9. Chỉ sau đó cân nhắc Giai đoạn 2: B1, B2, B3.
