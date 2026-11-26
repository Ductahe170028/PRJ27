# GameCreator: Deployment Guide cho Ubuntu 24.04 EC2

Tài liệu này là runbook triển khai GameCreator lên một máy EC2 Ubuntu. Nó được viết từ code trong repository (`package.json`, `.env.example`, `server.ts`, `app.ts`, `deploy/nginx/gamecreator.conf`...) và từ trạng thái máy mà chủ dự án đã cung cấp. Phần nào không có căn cứ thì được đánh dấu rõ, không đoán.

**Tài liệu này không có nghĩa ứng dụng đã được deploy.** Ở thời điểm viết, chưa có bước nào trong runbook được chạy trên EC2. Mọi dòng "Kết quả mong đợi" là mong đợi theo code, không phải kết quả đã đo.

## 0. Cách đọc tài liệu

### Nhãn trạng thái

| Nhãn | Ý nghĩa |
| --- | --- |
| `[ĐÃ XONG]` | Chủ dự án báo đã có trên EC2. Tài liệu không hướng dẫn làm lại, chỉ cho lệnh kiểm tra |
| `[CHƯA]` | Chưa làm, cần làm theo runbook |
| `[XÁC MINH]` | Không có thông tin. Phải kiểm tra bằng lệnh đã ghi trước khi tiếp tục |
| `[CẦN DOMAIN]` | Chỉ làm được khi đã có tên miền trỏ về Elastic IP |

### Phạm vi

Ứng dụng chạy sau Nginx HTTPS + Basic Auth. Backend, frontend và Nginx **không** chạy trong Docker, và backend không chạy code do AI sinh ra: AI chỉ trả một bản mô tả ngắn, engine dựng màn. Chế độ cũ cần Docker (Advanced: AI viết code, sandbox) đã bị xóa khỏi repository và nằm ở tag `legacy-standard-v1`. Vì vậy các mục F, D.3, G.4, K.6, K.7, L.2 và M.2 của bản cũ không còn; số các mục còn lại được giữ nguyên để các tham chiếu chéo vẫn đúng.

### Trạng thái hiện tại của EC2

| Hạng mục | Trạng thái |
| --- | --- |
| Ubuntu 24.04.5 LTS, m7i-flex.large (2 vCPU, 8 GB), EBS gp3 20 GB, Elastic IP `13.238.144.236` | `[ĐÃ XONG]` |
| Node.js 22.23.5, npm 10.9.9, Git 2.43.0, PM2 7.1.2, Nginx 1.24.0 | `[ĐÃ XONG]` |
| Source tại `/home/ubuntu/PRJ27` | `[ĐÃ XONG]` |
| `npm ci`, build, `apps/api/.env`, PM2 app, thư mục `/var/www/gamecreator` | `[XÁC MINH]` (chưa có thông tin) |
| `apache2-utils` (htpasswd), `certbot`, file `/etc/nginx/.htpasswd-gamecreator` | `[XÁC MINH]`, coi như `[CHƯA]` |
| Tên miền, chứng chỉ TLS, site Nginx của GameCreator | `[CHƯA]` / `[CẦN DOMAIN]` (chưa có thông tin về domain) |
| Security Group đúng quy tắc ở mục J | `[XÁC MINH]` |

---

## A. System Requirements

| Thành phần | Yêu cầu | Phân loại | Cơ sở |
| --- | --- | --- | --- |
| Ubuntu | 24.04 LTS (máy hiện tại 24.04.5) | Bắt buộc | Mục tiêu của dự án. Nginx 1.24 là bản của 24.04 |
| CPU / RAM | Tối thiểu 2 vCPU / 2 GB. Máy hiện tại 2 vCPU / 8 GB là dư RAM | Bắt buộc | Mỗi lần tạo game dựng màn trong một worker (tối đa 8 giây, bot chơi thử vài ván) nên **CPU là giới hạn chính**, không phải RAM |
| Ổ đĩa | 20 GB gp3 (hiện có) | Bắt buộc | `node_modules`, build và log |
| Node.js | `>=22.0.0` (máy có 22.23.5) | Bắt buộc | `engines` trong `package.json` gốc |
| npm | `>=10.0.0` (máy có 10.9.9) | Bắt buộc | `engines` trong `package.json` gốc; dùng `package-lock.json` (lockfileVersion 3) |
| Git | Bất kỳ bản hiện đại (máy có 2.43.0) | Bắt buộc | Clone, cập nhật, rollback |
| Nginx | 1.24.0 | Bắt buộc | Điểm vào công khai duy nhất, Basic Auth, TLS, rate limit |
| PM2 | 7.1.2 | Bắt buộc theo runbook này | Chạy backend, tự khởi động lại, tự chạy sau reboot. Repository **không có** file cấu hình PM2; mẫu nằm ở mục G |
| `apache2-utils` | Bất kỳ | Bắt buộc | Lệnh `htpasswd` để tạo `/etc/nginx/.htpasswd-gamecreator` |
| `certbot` | Bản apt của 24.04 (2.9.0) đủ cho chứng chỉ **domain**. Chứng chỉ **IP** cần Certbot ≥ 5.4 (không có trong apt 24.04, xem I.5b) | Bắt buộc khi bật HTTPS (`[CẦN DOMAIN]`) | Chứng chỉ Let's Encrypt |
| `curl`, `openssl`, `ss` | Có sẵn trên Ubuntu Server | Bắt buộc cho kiểm tra | Mục K |
| `pm2-logrotate` | Module PM2 | Tùy chọn | Xoay vòng log PM2 |

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
| Source code | | | `[ĐÃ XONG]` | `git -C /home/ubuntu/PRJ27 status -sb` |
| `apache2-utils` | any | `htpasswd` | `[XÁC MINH]` | `command -v htpasswd` |
| `certbot` | apt 2.9.0 (chứng chỉ domain). Chứng chỉ IP cần ≥ 5.4 (I.5b) | TLS | `[XÁC MINH]` `[CẦN DOMAIN]` | `certbot --version` |
| Cài nếu thiếu | | | | `sudo apt-get update && sudo apt-get install -y apache2-utils certbot` |

Kiểm tra PM2 và Node nằm ở đâu (quan trọng khi `pm2 startup` hoặc khi chuyển user):

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

Không có bước nào trong runbook yêu cầu `sudo npm`, và **không chạy `npm run build` bằng root**: nó tạo `dist/` thuộc root, các lần build sau của `ubuntu` sẽ lỗi quyền.

---

## D. Environment Variables

Backend đọc cấu hình từ biến môi trường. `server.ts` nạp `.env` bằng `import 'dotenv/config'` **theo thư mục làm việc hiện tại** của process, nên với PM2 `cwd` phải là `apps/api` để tìm `apps/api/.env`. `dotenv` **không ghi đè** biến đã có trong môi trường process: các biến đặt trong file ecosystem của PM2 (mục G) luôn thắng `.env`.

Tài liệu này **không đọc** và **không in** bất kỳ file `.env` nào. Danh sách dưới đây lấy từ `apps/api/.env.example`, `apps/web/.env.example` và từ code đọc biến (`server.ts`, `app.ts`, `trust-proxy.ts`, `create-registry.ts`, `run-diagnostics.ts`).

### D.1 Tạo `apps/api/.env` `[XÁC MINH]`

```bash
cd /home/ubuntu/PRJ27
test -f apps/api/.env && echo "đã có, không ghi đè" || cp apps/api/.env.example apps/api/.env
chmod 600 apps/api/.env
nano apps/api/.env        # điền khóa trong trình soạn thảo, không dùng echo hay lệnh có chứa khóa
```

`.env` bị `.gitignore` chặn. Không commit, không gửi qua chat/issue. Không đặt khóa API trong file ecosystem của PM2 và không `export` khóa trong shell.

### D.2 Biến của backend (production)

**Đặt trong file ecosystem của PM2 (mục G)**, vì sai một biến là mất lớp bảo vệ:

| Biến | Giá trị trên EC2 | Mặc định trong code | Giải thích |
| --- | --- | --- | --- |
| `NODE_ENV` | `production` | không đặt | Bật `trust proxy = loopback` mặc định và tắt ghi chẩn đoán lên đĩa. **Không đổi thành `development` để mở tính năng** |
| `HOST` | `127.0.0.1` | `127.0.0.1` | Backend chỉ nghe loopback. Không đặt `0.0.0.0` |
| `PORT` | `3001` | `3001` | Nginx proxy tới `127.0.0.1:3001`. Số nguyên 1–65535, nếu không backend không khởi động |
| `TRUST_PROXY` | `loopback` | production: `loopback`; khác: `off` | Chỉ tin `X-Forwarded-For` khi kết nối TCP đến từ loopback (chính Nginx). Giá trị khác `loopback`/`off` làm backend từ chối khởi động |

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

### D.4 Biến của frontend (lúc build)

| Biến | Giá trị trên EC2 | Giải thích |
| --- | --- | --- |
| `VITE_API_BASE_URL` | **để trống / không đặt** | Biến `VITE_*` được nhúng vào bundle lúc build. Frontend gọi `/api/...` cùng origin. Đặt `http://127.0.0.1:3001` sẽ làm trình duyệt gọi thẳng backend, bỏ qua Nginx (và Basic Auth) |
| `API_PROXY_TARGET` | không cần | Chỉ cho `vite dev`/`vite preview` (proxy `/api`), không có trong bundle production |

Không tạo `apps/web/.env` trên EC2. Nếu đã có file đó, kiểm tra nó không đặt `VITE_API_BASE_URL` (mở file bằng trình soạn thảo, đừng in ra log chung).

### D.5 Biến không được đặt trong production


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
| 2. Backend | `npm run build -w @game-creator/api` → `tsc -p tsconfig.json` (`rootDir src`, `outDir dist`, `module NodeNext`) | `apps/api/dist/`. Entrypoint **`apps/api/dist/server.js`**; worker dựng màn `apps/api/dist/shooter/compile-worker.mjs` |
| 3. Frontend | `npm run build -w @game-creator/web` = `npm run typecheck` → `npm run build:game` → `vite build` | `apps/web/public/runtime/game.js` (bundle IIFE của Phaser, **bị gitignore**), rồi **`apps/web/dist/`**: `index.html`, `assets/`, `runtime/` (copy từ `public/`), `favicon.svg` |

Có thể chạy từng bước riêng: `npm run build:contracts`, `npm run build -w @game-creator/api`, `npm run build -w @game-creator/web`. Phải theo đúng thứ tự trên.

Ghi chú:

- Cảnh báo Rollup về một comment trong `zod` khi build frontend là cảnh báo từ thư viện bên thứ ba, không phải lỗi (exit code 0).
- Không chạy `npm run test:e2e` trên EC2: nó build rồi mở Chromium của host, thứ mà production không cài.

Kiểm tra đầu ra:

```bash
ls apps/api/dist/server.js apps/api/dist/shooter/compile-worker.mjs
ls apps/web/dist/index.html apps/web/dist/runtime/game.js
```

Kiểm tra tùy chọn trước khi deploy `[XÁC MINH]`: `npm test` (vitest, không cần Docker và không cần Chromium). Trên EC2 chưa chạy.

---

## G. Backend Production với PM2

### G.1 Chọn user

**Rủi ro khi chạy backend bằng `ubuntu`.** User `ubuntu` trên AMI Ubuntu của AWS thường có sudo không cần mật khẩu (`[XÁC MINH]` bằng `sudo -l`). Backend là process nhận request từ Internet. Nếu có lỗ hổng thực thi mã trong backend hay trong một dependency của nó, kẻ tấn công chạy lệnh với quyền của `ubuntu`, và vì `sudo` không cần mật khẩu nên chạy được lệnh với quyền **root**. Khi đó họ đọc được `/etc/nginx/.htpasswd-gamecreator`, khóa riêng TLS trong `/etc/letsencrypt`, khóa API, và điều khiển cả máy. Việc chạy backend bằng `ubuntu` cũng cho nó đọc/ghi toàn bộ thư mục home (SSH key, source, lịch sử).

- Khuyến nghị chạy bằng **user riêng không có sudo** (mục G.1b). Giữ `ubuntu` chỉ là phương án tạm, chấp nhận rủi ro nêu trên, nên dùng khi đang thử trong mạng riêng và **chưa mở 80/443 ra Internet**. Backend không chạy code do AI sinh ra và không cần quyền Docker.

### G.1b Tạo user dịch vụ không có sudo `[CHƯA]` (khuyến nghị)

Chưa chạy thử trên EC2. Nguyên tắc: user dịch vụ chỉ **đọc** code và file môi trường, không **ghi**, không có sudo, không đọc được home của `ubuntu`. Mọi lệnh chạy bằng `ubuntu` (quản trị) với `sudo`.

**Bước 0: kiểm tra Node.js và PM2 nằm ở đâu.** Đây là điều kiện tiên quyết:

```bash
readlink -f "$(command -v node)" "$(command -v pm2)"
stat -c '%a %U' /home/ubuntu
```

- Nếu cả hai nằm ngoài `/home/ubuntu` (ví dụ dưới `/usr/bin`, `/usr/local/bin`, `/usr/lib/node_modules`) thì mọi user chạy được: tiếp tục.
- Nếu nằm dưới `/home/ubuntu` (ví dụ `/home/ubuntu/.nvm/...`) thì user dịch vụ **không** chạy được. Đây là **blocker B8**: chưa có phương án đã kiểm chứng trong tài liệu này (cần cài Node/PM2 ở vị trí dùng chung hoặc cài riêng cho user dịch vụ; chưa chọn). **Không** giải quyết bằng cách mở quyền thư mục `/home/ubuntu`, thêm user dịch vụ vào nhóm của `ubuntu` hoặc vào nhóm `sudo`.

**Bước 1: tạo user.** Tài khoản thường (không phải `--system`), shell `nologin`, không mật khẩu (nên bị khóa), không nhóm đặc quyền:

```bash
sudo useradd --create-home --shell /usr/sbin/nologin gamecreator
id gamecreator                      # chỉ nhóm gamecreator; không có sudo
sudo -l -U gamecreator              # mong đợi: "is not allowed to run sudo"
```


**Bước 2: đặt bản build ở nơi root sở hữu, user dịch vụ chỉ đọc.** Build ở `/home/ubuntu/PRJ27` như mục E (bằng `ubuntu`), rồi sao chép sang `/opt/gamecreator/app`. Không để user dịch vụ chạy trực tiếp trong `/home/ubuntu/PRJ27`:

```bash
cd /home/ubuntu/PRJ27
sudo mkdir -p /opt/gamecreator/app
sudo find /opt/gamecreator/app -mindepth 1 -delete
tar --exclude=.git --exclude=.local-diagnostics --exclude=test-results \
    --exclude=apps/api/.env --exclude=apps/web/.env -cf - . \
  | sudo tar -C /opt/gamecreator/app --no-same-owner -xf -
sudo chown -R root:root /opt/gamecreator
sudo chmod -R go-w /opt/gamecreator
git rev-parse --short HEAD | sudo tee /opt/gamecreator/REVISION >/dev/null
du -sh /opt/gamecreator/app ; df -h /
```

`tar` giữ nguyên symlink workspace trong `node_modules`, nên `@game-creator/contracts` vẫn trỏ đúng trong cây mới. Các tệp `.env` bị loại khỏi bản sao có chủ đích. Cây sao chép gồm cả `node_modules` đầy đủ, nên xem kích thước ở dòng `du`/`df` (ổ đĩa 20 GB).

**Bước 3: file môi trường, user dịch vụ chỉ đọc.** Đặt file ở `/etc/gamecreator`, chủ sở hữu root, nhóm `gamecreator`, quyền 640. Backend đọc được nhưng không sửa được và các user khác không đọc được:

```bash
sudo install -d -o root -g gamecreator -m 750 /etc/gamecreator
sudo install -o root -g gamecreator -m 640 /home/ubuntu/PRJ27/apps/api/.env /etc/gamecreator/api.env
sudo ln -sfn /etc/gamecreator/api.env /opt/gamecreator/app/apps/api/.env
sudo -u gamecreator test -r /etc/gamecreator/api.env && echo "đọc được (đúng)"
sudo -u gamecreator test -w /etc/gamecreator/api.env && echo "GHI ĐƯỢC (sai)" || echo "không ghi được (đúng)"
```

`dotenv` đọc `.env` theo thư mục làm việc (mục D), nên ecosystem dùng `cwd` là `apps/api` trong `/opt` và `.env` ở đó là symlink tới file này (`dotenv` đọc qua symlink bình thường). Sửa giá trị: `sudo nano /etc/gamecreator/api.env` (`ubuntu` không đọc trực tiếp được thư mục `/etc/gamecreator`; đó là chủ ý). Đừng giữ hai bản `.env` lệch nhau: sau khi chép xong, bản trong `/home/ubuntu/PRJ27/apps/api/.env` chỉ còn là bản sao, hãy xóa hoặc coi `/etc/gamecreator/api.env` là bản duy nhất. Lệnh `find ... -delete` ở bước 2 xóa cả symlink này mỗi lần cập nhật, nên **tạo lại symlink sau mỗi lần sao chép** (xem bên dưới).

**Bước 4: file ecosystem do root sở hữu.** Tạo mẫu ở G.2, rồi:

```bash
sudo install -o root -g root -m 644 /home/ubuntu/gamecreator.ecosystem.config.cjs /etc/gamecreator/ecosystem.config.cjs
sudo sed -i "s#/home/ubuntu/PRJ27/apps/api#/opt/gamecreator/app/apps/api#" /etc/gamecreator/ecosystem.config.cjs
grep -n "cwd" /etc/gamecreator/ecosystem.config.cjs      # phải là /opt/gamecreator/app/apps/api
```

**Bước 5: chạy bằng user dịch vụ.** `sudo -u ... -H` chạy lệnh trực tiếp, không cần shell đăng nhập:

```bash
sudo -u gamecreator -H pm2 start /etc/gamecreator/ecosystem.config.cjs
sudo -u gamecreator -H pm2 status
sudo -u gamecreator -H pm2 save
```

Nếu trước đó backend đã chạy dưới PM2 của `ubuntu`, dừng nó trước (`pm2 delete gamecreator-api`, `pm2 save`, và `pm2 unstartup` nếu đã bật) để hai process không tranh cổng 3001.

**Bước 6: tự chạy sau reboot** bằng user dịch vụ. PM2 in ra một lệnh `sudo` cần chạy nguyên văn:

```bash
pm2 startup systemd -u gamecreator --hp /home/gamecreator
# chạy dòng "sudo env PATH=... pm2 startup ..." mà lệnh trên in ra
sudo -u gamecreator -H pm2 save
systemctl status pm2-gamecreator --no-pager
```

**Bước 7: xác nhận không có quyền quản trị.** `[XÁC MINH]` kết quả trên máy thật. Các lệnh dưới đây chỉ kiểm tra **quyền truy cập** (`test -r`, `stat`), không in nội dung file. Chạy sau khi các file bí mật đã được tạo: `.htpasswd` ở mục I.3, chứng chỉ ở mục I.5. File chưa tồn tại cũng làm `test -r` thất bại, nên phải tách hai trường hợp:

```bash
ps -eo user:20,pid,cmd | grep '[d]ist/server.js'                  # user phải là gamecreator, không phải root/ubuntu
sudo -u gamecreator -H sh -c 'sudo -n true' 2>&1 | head -1         # phải bị từ chối
# Kiểm tra một file: tồn tại (root đọc được) và user dịch vụ không đọc được.
check() { f="$1"; sudo test -e "$f" || { echo "CHƯA TỒN TẠI, chưa kiểm được: $f"; return; }
  sudo -u gamecreator test -r "$f" && echo "ĐỌC ĐƯỢC (sai): $f" || echo "không đọc được (đúng): $f"; }
check /etc/nginx/.htpasswd-gamecreator
check "/etc/letsencrypt/live/$DOMAIN/privkey.pem"                 # khóa riêng TLS; cần $DOMAIN như mục I.5
# Khóa riêng SSH: liệt kê file private key thật (không phải .pub hay authorized_keys) rồi kiểm từng file.
sudo find /home/ubuntu/.ssh /root/.ssh /etc/ssh -type f \
  \( -name 'id_*' -o -name '*_key' -o -name '*.pem' \) ! -name '*.pub' 2>/dev/null \
  | while read -r k; do check "$k"; done
```

`authorized_keys` chỉ chứa khóa **công khai** nên không dùng làm bằng chứng. Nếu `find` không in file nào, ghi nhận "không có private key để kiểm" thay vì kết luận là an toàn. `find` có thể in cảnh báo "Permission denied" cho thư mục không vào được; các dòng đó không phải kết quả.

**Cập nhật khi dùng user riêng.** Sau `git pull`, `npm ci`, `npm run build` (mục L.1), chạy lại bước 2, tạo lại symlink `.env` (bước 3) rồi restart bằng user dịch vụ:

```bash
sudo ln -sfn /etc/gamecreator/api.env /opt/gamecreator/app/apps/api/.env
sudo -u gamecreator -H pm2 restart gamecreator-api
```

**Hai daemon PM2 tách biệt, đừng trộn.** PM2 lưu trạng thái theo từng user (`~/.pm2` của user đó) và mỗi user có một daemon riêng. `pm2` gõ trần nói chuyện với daemon của user đang đăng nhập (`ubuntu`); `sudo -u gamecreator -H pm2 ...` nói chuyện với daemon của `gamecreator`. Restart nhầm daemon sẽ khởi động lại (hoặc báo không có) process của user kia, trong khi backend thật không đổi. Quy ước trong toàn bộ tài liệu:

- **User dịch vụ `gamecreator` (G.1b):** mọi lệnh là `sudo -u gamecreator -H pm2 ...`. Log ở `/home/gamecreator/.pm2/logs/`. Unit systemd là `pm2-gamecreator`.
- **Vẫn dùng `ubuntu` (chỉ khi chưa mở Internet, xem G.1):** mọi lệnh là `pm2 ...` trần. Log ở `/home/ubuntu/.pm2/logs/`. Unit là `pm2-ubuntu`.

Các mục G.5, K.1, K.8, K.10, K.11, L.1, L.3, L.5, L.7 viết lệnh trần của `ubuntu` và ghi chú lệnh tương ứng của `gamecreator`. Chọn một và dùng nhất quán.

**Phạm vi bảo vệ (không phải tuyệt đối).** Nếu backend bị chiếm quyền, kẻ tấn công vẫn có quyền của `gamecreator`: đọc `/etc/gamecreator/api.env` (khóa API; do đó nên dùng khóa có hạn mức chi phí), đọc code trong `/opt/gamecreator`, mở kết nối ra ngoài, và dùng lỗ hổng leo thang đặc quyền cục bộ nếu có. Họ **không** có sudo, không ghi đè được code/ecosystem/`.env`, và (nếu kiểm tra bước 7 đạt) không đọc được SSH key, `.htpasswd` và khóa TLS. Đây là cải thiện lớn so với `ubuntu` nhưng chưa được kiểm chứng trên EC2; điều kiện tiên quyết là blocker B8.

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
    max_memory_restart: '1G',               // TẠM THỜI: chưa đo trên EC2 8 GB, không phải mức tối ưu
    env: {
      NODE_ENV: 'production',
      HOST: '127.0.0.1',
      PORT: '3001',
      TRUST_PROXY: 'loopback',
    },
  }],
};
EOF
```

File này không chứa bí mật. Khóa API nằm trong `apps/api/.env` (mục D.1).

**Về `max_memory_restart: '1G'`:** đây là giá trị **tạm thời** (`pm2 monit`/`pm2 describe` dưới đây chạy bằng đúng user đang chạy backend, xem G.1b), đặt như một chốt chặn chống rò rỉ bộ nhớ. Nó **chưa được đo trên EC2 8 GB RAM** và không được coi là mức tối ưu: chưa có số đo RSS của backend dưới tải thật. Khi RSS vượt ngưỡng, PM2 khởi động lại backend, làm đứt request đang chạy và mất hàng đợi (mục G.6). Cách hiệu chỉnh: sau khi chạy với tải thật nhiều ngày, theo dõi `pm2 monit` hoặc `pm2 describe gamecreator-api` (mức bộ nhớ), rồi đặt ngưỡng cao hơn mức dùng bình thường.

Mẫu này viết cho user `ubuntu` (đường dẫn `/home/ubuntu/...`). Nếu dùng user dịch vụ riêng (mục G.1b, khuyến nghị) thì đường dẫn, quyền file và lệnh `pm2` khác, theo G.1b.

### G.3 Khởi động và chạy sau reboot

```bash
cd /home/ubuntu/PRJ27
pm2 start /home/ubuntu/gamecreator.ecosystem.config.cjs
pm2 status
pm2 logs gamecreator-api --lines 30 --nostream
```

Log khởi động mong đợi: `[api] http://127.0.0.1:3001 ...`. Nếu thấy lỗi `PORT`/`AI_*`/`TRUST_PROXY phải là...`, đó là kiểm tra biến môi trường.

Tự chạy sau reboot (PM2 in ra một lệnh `sudo` cần chạy nguyên văn):

```bash
pm2 startup systemd -u ubuntu --hp /home/ubuntu
# chạy dòng "sudo env PATH=... pm2 startup ..." mà lệnh trên in ra
pm2 save
systemctl status pm2-ubuntu --no-pager
```

Nếu Node cài qua nvm, lệnh `pm2 startup` in ra đường dẫn Node tương ứng; dùng đúng dòng đó. Kiểm chứng bằng reboot thật (mục K.8).

### G.5 Vận hành hằng ngày

Các lệnh dưới đây dùng daemon của `ubuntu` (`pm2` trần). Dùng user `gamecreator` thì thêm `sudo -u gamecreator -H` trước mỗi lệnh (xem "Hai daemon PM2 tách biệt" ở G.1b):

```bash
pm2 restart gamecreator-api            # fork mode: có gián đoạn ngắn (reload cũng vậy)
pm2 restart gamecreator-api --update-env   # khi đổi env trong ecosystem
pm2 stop gamecreator-api
pm2 logs gamecreator-api               # log trực tiếp (Ctrl+C để thoát)
pm2 flush gamecreator-api              # xóa log PM2
pm2 monit
```

Log PM2 nằm ở `~/.pm2/logs/` **của user đang chạy backend**: `/home/ubuntu/.pm2/logs/gamecreator-api-{out,error}.log` khi chạy bằng `ubuntu`, `/home/gamecreator/.pm2/logs/` khi chạy bằng `gamecreator` (G.1b). `~` phụ thuộc user của shell, nên đừng dùng `~/.pm2` khi đang đăng nhập bằng user khác. Tùy chọn: `pm2 install pm2-logrotate` (chạy bằng đúng user đang chạy backend) để tránh log phình.

### G.6 Graceful shutdown

`server.ts` bắt `SIGINT` và `SIGTERM` (PM2 gửi `SIGINT` rồi `SIGKILL` sau `kill_timeout`): đóng HTTP và `closeIdleConnections()`, cưỡng chế thoát với mã 1 sau 8 giây. Một lần tạo game đang chạy bị cắt khi khởi động lại; client phải gửi lại.

Kiểm chứng (bằng đúng daemon của user đang chạy backend): `pm2 restart gamecreator-api` rồi `pm2 logs` không thấy `SIGKILL`/timeout; `pm2 status` quay lại `online`.

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

Kiểm tra tính toàn vẹn: `/var/www/gamecreator/index.html`, `assets/*.js`, `runtime/game.js` phải tồn tại. Thiếu `runtime/*` thì preview game không chạy.

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
7. **Thời gian chờ**: `proxy_read_timeout 90s` và `proxy_send_timeout 90s`. Một lần tạo game chờ AI tối đa 50 giây, cộng thời gian chờ quota của Groq và dựng màn; trình duyệt bỏ cuộc sau 60 giây.
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
3. Security Group: **đóng 80 và 443** cho tới khi có domain và chứng chỉ, và **kiểm tra rule SSH 22 chỉ cho IP quản trị** (cảnh báo ở mục J).
4. Thử backend qua loopback: `curl -s http://127.0.0.1:3001/api/health`.
5. Tùy chọn, xem giao diện mà không mở Internet `[CHƯA]`: trên EC2 chạy tạm `npm run preview:web` (`vite preview` nghe `127.0.0.1:5173`, proxy `/api` tới `127.0.0.1:3001`), từ máy bạn mở đường hầm SSH `ssh -L 5173:127.0.0.1:5173 ubuntu@13.238.144.236` rồi vào `http://localhost:5173`. Đây **không phải** production: tắt ngay sau khi thử (Ctrl+C), cổng 5173 không được mở trong Security Group.

**Domain là phương án khuyến nghị** (mục I.5). Let's Encrypt hiện **có** cấp chứng chỉ cho địa chỉ IP, nhưng đó là chứng chỉ ngắn hạn và quy trình riêng. Quy trình mục I.5 (domain) **không** dùng được cho IP. Xem I.5b để biết khác biệt, yêu cầu và lý do tài liệu này chưa có lệnh cấp chứng chỉ IP. Nếu chưa mua domain, một dịch vụ DNS ký tự đại diện của bên thứ ba (ví dụ `13-238-144-236.sslip.io` trỏ về IP đó) là một **tên miền**, nên dùng được quy trình chứng chỉ domain ở I.5 `[XÁC MINH]`: dịch vụ ngoài, chia sẻ giới hạn tần suất cấp chứng chỉ, chưa được thử trong dự án này.

### I.5 Giai đoạn B: đã có domain và TLS `[CẦN DOMAIN]`

Điều kiện: bản ghi DNS A của domain trỏ tới `13.238.144.236`; Security Group cho phép 80 và 443 từ Internet, **chỉ sau khi** đã kiểm tra rule SSH 22 theo cảnh báo ở mục J.

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

`certbot reconfigure` có từ Certbot 2.3; bản apt của Ubuntu 24.04 mới hơn nhưng `[XÁC MINH]`. Nếu lệnh không có, cấp lại bằng `sudo certbot certonly --webroot -w /var/www/letsencrypt --cert-name "$DOMAIN" -d "$DOMAIN" --deploy-hook "systemctl reload nginx"`.

**Hai việc phải kiểm tra riêng, vì `--dry-run` không làm cả hai.**

- **Quá trình gia hạn:** `certbot renew --dry-run` kiểm tra việc xin chứng chỉ từ máy chủ staging (thành công, không ghi đè chứng chỉ thật). Theo tài liệu Certbot, `--dry-run` **mặc định không chạy deploy-hook** (chỉ chạy pre-hook và post-hook). Một `--dry-run` thành công **không** chứng minh Nginx được reload sau khi gia hạn.
- **Nginx reload sau gia hạn:** cờ `--run-deploy-hooks` (có từ Certbot 2.6.0, PR certbot #9355) chạy deploy-hook khi dry-run thành công, và chạy với **chứng chỉ đang dùng**, không phải chứng chỉ thử. Kiểm tra bản đang dùng có cờ này không: `sudo certbot --help renew | grep -q run-deploy-hooks && echo "có" || echo "không có"`. Nếu có, chạy:

```bash
sudo certbot renew --dry-run --run-deploy-hooks
sudo grep -i reload /var/log/nginx/error.log | tail
sudo systemctl status nginx --no-pager | head -5
```

`systemctl reload nginx` không in gì khi thành công, nên bằng chứng là Nginx vẫn `active` và log không có lỗi mới sau lệnh. Nếu bản Certbot không có cờ này, **không** chạy `systemctl reload nginx` bằng tay rồi coi là đã kiểm tra hook: hook chỉ được kiểm chứng ở lần gia hạn thật đầu tiên. Theo dõi lần đó (certbot log ở `/var/log/letsencrypt/letsencrypt.log` và log Nginx) trước khi coi bước gia hạn là xong.

**4. Sau mỗi `git pull` có đổi `deploy/nginx/gamecreator.conf`**, copy lại và chạy lại `sed` ở bước 2 (bản trong `/etc/nginx` là bản sao đã sửa, không tự cập nhật).

### I.5b Chứng chỉ domain và chứng chỉ IP `[CẦN DOMAIN]`

Nguồn đã đối chiếu (kiểm tra lúc viết tài liệu): bài "6-day and IP Address Certificates are Generally Available" (Let's Encrypt, 15/01/2026), bài "Six-Day and IP Address Certificates Available in Certbot" (Let's Encrypt, 11/03/2026; cùng nội dung ở EFF), `CHANGELOG.md` của Certbot, và trang gói `certbot` của Ubuntu `noble`. Đây là thông tin có thể thay đổi: đối chiếu lại nguồn trước khi thực hiện.

| | Chứng chỉ **domain** (khuyến nghị) | Chứng chỉ **IP** (Elastic IP `13.238.144.236`) |
| --- | --- | --- |
| Let's Encrypt | Chứng chỉ thông thường, hiện 90 ngày (Let's Encrypt đã công bố sẽ giảm dần về 45 ngày trong vài năm tới) | Chỉ cấp theo profile `shortlived`, hiệu lực **160 giờ** (hơn 6 ngày). Có sẵn cho mọi người từ 15/01/2026 |
| Cách xác thực | HTTP-01, DNS-01... | Chỉ `http-01` hoặc `tls-alpn-01`. **Không** dùng DNS-01 |
| Certbot cần | Bản apt của Ubuntu 24.04 (**2.9.0**) đủ, theo mục I.5 | `--preferred-profile shortlived` (Certbot ≥ 4.0). Cờ `--ip-address` có từ 5.3 cho `standalone`/`manual`; **webroot hỗ trợ IP từ Certbot 5.4** (5.4.0, 10/03/2026). Plugin `nginx`/`apache` chưa hỗ trợ IP |
| Ubuntu 24.04 APT | Đủ | **Không đủ.** Gói `certbot` của `noble` là 2.9.0 (universe), thấp hơn 5.4 nên không có quy trình cấp IP bằng webroot. Không cấp được bằng gói apt này |
| Cài vào Nginx | Sửa hai đường dẫn chứng chỉ (mục I.5) | Certbot chỉ **cấp**, chưa **cài** vào web server: phải tự sửa cấu hình Nginx đọc `/etc/letsencrypt/live/<tên>/fullchain.pem` và `privkey.pem`, và đặt `--deploy-hook` để Nginx nạp lại sau mỗi lần gia hạn |
| Gia hạn | Timer của Certbot (mục I.5, bước 3) | Bắt buộc phải **tự động hoàn toàn** (Let's Encrypt chỉ khuyến nghị chứng chỉ ngắn hạn cho người đã tự động hóa gia hạn). Theo changelog Certbot, `certbot renew` kiểm tra ARI và với Let's Encrypt thường gia hạn ở khoảng 2/3 vòng đời chứng chỉ, nghĩa là cách vài ngày một lần với chứng chỉ 160 giờ |

**Khuyến nghị: dùng domain** (thông thường hoặc tên miền DNS ký tự đại diện của bên thứ ba như đã nêu ở I.4) với quy trình I.5. Quy trình này dùng được Certbot 2.9.0 từ apt, chứng chỉ sống lâu hơn và không phụ thuộc vào tính năng mới.

**Nếu muốn dùng trực tiếp Elastic IP**, các điều kiện sau phải đạt **trước khi** tin vào HTTPS trên IP:

1. Certbot ≥ 5.4 cài theo tài liệu cài đặt chính thức của Certbot (không phải gói apt 24.04). Phương thức cài cụ thể **chưa được chọn và chưa được xác minh** trên EC2 này.
2. Cấp thử bằng máy chủ staging của Let's Encrypt (`--staging`) trước khi cấp chứng chỉ thật, theo hướng dẫn của Let's Encrypt/EFF.
3. Cấu hình Nginx hiện tại viết cho domain: `server_name` là domain và `proxy_set_header Host $server_name`. Dùng IP cần một thay đổi cấu hình có review và thử riêng. Cách thay `server_name` bằng IP bằng `sed` ở mục I.5 **chưa được thử**.
4. Cổng 80 phải mở công khai để Let's Encrypt kiểm tra HTTP-01 (khối cổng 80 đã phục vụ `/var/www/letsencrypt`).
5. Gia hạn tự động phải được **chứng minh** bằng: `certbot renew --dry-run` thành công, `--deploy-hook` làm Nginx nạp chứng chỉ mới, và quan sát ít nhất một lần gia hạn thật sau khi cấp (chứng chỉ chỉ sống hơn 6 ngày, nên một lần gia hạn hỏng làm HTTPS hỏng trong vài ngày).

**Tài liệu này không có lệnh cấp chứng chỉ IP**, vì quy trình gia hạn tự động trên EC2 này chưa được xác minh (điều kiện 1 và 5 chưa có). Nếu không có domain mà vẫn cần HTTPS trên IP, đây là blocker B7 và phải xử lý như một thay đổi riêng, không làm theo trí nhớ hay theo ví dụ trên mạng.

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

> **CẢNH BÁO: kiểm tra SSH 22 TRƯỚC KHI mở website ra Internet.** Cổng 22 phải chỉ cho phép IP quản trị (`/32`). Kiểm tra bằng AWS Console, tab *Inbound rules* của **mọi** Security Group đang gắn vào instance (rule của các nhóm gắn vào cùng instance được cộng dồn, nên một rule `0.0.0.0/0` hoặc `::/0` ở nhóm phụ hoặc nhóm `launch-wizard` cũ vẫn mở SSH cho cả Internet). Rồi từ một máy **không** nằm trong IP quản trị chạy `nc -vz -w 5 13.238.144.236 22`: kết quả phải là timeout hoặc bị từ chối. Chỉ mở 80/443 sau khi bước này đạt. Nên có đường truy cập dự phòng khi IP quản trị đổi (ví dụ AWS Systems Manager Session Manager, `[XÁC MINH]` có được cấu hình hay chưa), vì thu hẹp SSH theo IP có thể tự khóa mình. Tài liệu không thay đổi rule nào.

| Cổng | Rule inbound | Ghi chú |
| --- | --- | --- |
| 22 (SSH) | **Chỉ IP quản trị** (`/32`), không `0.0.0.0/0` | |
| 80 (HTTP) | Mở khi có domain: chuyển hướng 301 và ACME | Chưa có domain thì đóng |
| 443 (HTTPS) | Mở khi có domain và chứng chỉ | Điểm vào ứng dụng |
| 3001 (backend) | **Không mở** | Backend nghe `127.0.0.1` |
| 5173 (Vite) | **Không mở** | Không chạy Vite trong production |

Khuyến nghị khác (không bắt buộc cho runbook, `[XÁC MINH]`): yêu cầu IMDSv2 cho instance.

Outbound cần: Internet cho `git`, npm registry, `apt`, Let's Encrypt, và API của Groq/Gemini (backend gọi). Không giới hạn outbound ở Security Group nếu chưa kiểm tra đủ các đích đó.

Khi **Stop/Start** instance, Elastic IP được giữ nguyên (public DNS mặc định đổi). Domain trỏ vào Elastic IP nên không phải cập nhật DNS.

---

## K. Verification

Chạy sau khi triển khai. Dùng `curl -u friends` để curl tự hỏi mật khẩu (không đưa mật khẩu vào dòng lệnh). `DOMAIN` là domain thật. Không chạy các bài thử rate limit liên tiếp: bạn sẽ bị chặn IP của chính mình tới khi hết cửa sổ (khoảng một phút).

### K.1 Backend

```bash
# pm2 trần = daemon của ubuntu. Dùng user gamecreator thì thay bằng: sudo -u gamecreator -H pm2 ...
pm2 status                                       # gamecreator-api: online
curl -s http://127.0.0.1:3001/api/health         # {"status":"ok","service":"ai-game-creator-api","mode":"multi-provider"}
ss -ltnp | grep 3001                             # 127.0.0.1:3001
curl -s http://127.0.0.1:3001/api/health    # {"status":"ok","service":"ai-game-creator-api","mode":"multi-provider"}
pm2 logs gamecreator-api --lines 20 --nostream   # có dòng "[api] http://127.0.0.1:3001 ..."
```

### K.2 Nginx và Basic Auth `[CẦN DOMAIN]`

```bash
sudo nginx -t
curl -sI "http://$DOMAIN/"                       # 301, Location https://..., KHÔNG có WWW-Authenticate
curl -sI "https://$DOMAIN/"                      # 401 + WWW-Authenticate: Basic realm="GameCreator"
for p in / /index.html /runtime/game.js /api/health /nope; do
  printf '%s ' "$p"; curl -s -o /dev/null -w '%{http_code}\n' "https://$DOMAIN$p"
done                                             # tất cả 401
for p in /api/shooter/generate /api/ai/test-connection; do
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

### K.8 PM2 và reboot

```bash
sudo reboot
# đăng nhập lại sau ~1-2 phút. pm2 trần = daemon của ubuntu.
pm2 status                                       # gamecreator-api: online (không cần chạy lại lệnh thủ công)
systemctl is-active nginx pm2-ubuntu
curl -s http://127.0.0.1:3001/api/health
```

Dùng user `gamecreator`: `sudo -u gamecreator -H pm2 status` và `systemctl is-active nginx pm2-gamecreator`. Hai lệnh này kiểm tra daemon khác với hai lệnh ở trên; chỉ chạy bộ lệnh của user đang chạy backend.

### K.9 Security Group từ bên ngoài

Từ máy **không** phải EC2 và không nằm trong dải SSH: `nc -vz -w 5 13.238.144.236 3001` (và 5173, 2375, 2376) phải timeout/refused. 22 chỉ vào được từ IP quản trị. 80 trả `301`; 443 trả `401`.

### K.10 Log

```bash
sudo tail -n 20 /var/log/nginx/gamecreator.access.log
sudo tail -n 20 /var/log/nginx/gamecreator.error.log
# pm2 trần = daemon của ubuntu. Dùng gamecreator thì: sudo -u gamecreator -H pm2 logs gamecreator-api --lines 50 --nostream
pm2 logs gamecreator-api --lines 50 --nostream
# Đường dẫn log theo user đang chạy backend (xem G.5). ~/.pm2 là của user shell, dễ trỏ nhầm.
PM2_LOGS=/home/ubuntu/.pm2/logs                      # /home/gamecreator/.pm2/logs khi chạy bằng gamecreator
sudo grep -ciE 'authorization|gsk_|AIza|password' /var/log/nginx/gamecreator.*.log "$PM2_LOGS"/gamecreator-api-*.log   # mong đợi 0
```

### K.11 Tài nguyên

```bash
free -m ; swapon --show ; df -h / ; uptime
pm2 monit                                        # q để thoát. gamecreator: sudo -u gamecreator -H pm2 monit
```

---

## L. Maintenance và Troubleshooting

### L.1 Cập nhật và build lại

Phần `git`/`npm` luôn chạy trong bản làm việc `/home/ubuntu/PRJ27` bằng `ubuntu`. **Restart thì theo user đang chạy backend** (xem "Hai daemon PM2 tách biệt" ở G.1b): `pm2` trần là daemon của `ubuntu`.

```bash
cd /home/ubuntu/PRJ27
git rev-parse --short HEAD > ~/gamecreator.prev-rev
git pull --ff-only
npm ci
npm run build
# copy frontend (mục H), nếu deploy/nginx/gamecreator.conf đổi thì copy lại + sed (mục I.5)
pm2 restart gamecreator-api                      # daemon của ubuntu
sudo nginx -t && sudo systemctl reload nginx
curl -s http://127.0.0.1:3001/api/health
```

**Dùng user dịch vụ `gamecreator`:** `pm2 restart` ở trên nói chuyện với daemon của `ubuntu`, không đụng process thật. Thay dòng đó bằng các bước ở mục "Cập nhật khi dùng user riêng" của G.1b, chạy sau `npm run build`:

```bash
cd /home/ubuntu/PRJ27
sudo find /opt/gamecreator/app -mindepth 1 -delete          # xóa cả symlink .env, tạo lại ở dòng dưới
tar --exclude=.git --exclude=.local-diagnostics --exclude=test-results \
    --exclude=apps/api/.env --exclude=apps/web/.env -cf - . \
  | sudo tar -C /opt/gamecreator/app --no-same-owner -xf -
sudo chown -R root:root /opt/gamecreator
sudo chmod -R go-w /opt/gamecreator
git rev-parse --short HEAD | sudo tee /opt/gamecreator/REVISION >/dev/null
sudo ln -sfn /etc/gamecreator/api.env /opt/gamecreator/app/apps/api/.env
sudo -u gamecreator -H pm2 restart gamecreator-api           # daemon của gamecreator
```

Backend của `gamecreator` chạy từ `/opt/gamecreator/app`, nên thiếu bước sao chép này thì nó tiếp tục chạy bản cũ.

### L.3 Rollback

`pm2 restart` trần nói chuyện với daemon của `ubuntu`. Dùng `gamecreator` thì thay bằng `sudo -u gamecreator -H pm2 restart gamecreator-api` và **sao chép lại `/opt/gamecreator/app`** (các lệnh `tar`/`chown`/`ln` ở L.1), vì process của `gamecreator` chạy từ đó chứ không chạy từ `/home/ubuntu/PRJ27`:

```bash
cd /home/ubuntu/PRJ27
PREV=$(cat ~/gamecreator.prev-rev)
git checkout "$PREV"            # nhận trạng thái "detached HEAD"; quay lại nhánh: git checkout main
npm ci && npm run build
# frontend: khôi phục nhanh từ bản trước
sudo rm -rf /var/www/gamecreator.bad && sudo mv /var/www/gamecreator /var/www/gamecreator.bad && sudo cp -a /var/www/gamecreator.prev /var/www/gamecreator
pm2 restart gamecreator-api     # daemon của ubuntu. gamecreator: xem đoạn trên
```

Khôi phục `/var/www/gamecreator.prev` chỉ lùi được **một** bản. Muốn lùi xa hơn thì build lại từ commit cũ rồi copy lại (mục H). Không dùng `git reset --hard` trên máy chủ nếu chưa biết bản nào đang chạy.

### L.4 Kiểm tra RAM/CPU

```bash
free -m ; uptime ; top -bn1 | head -15
ps -eo pid,user,%mem,%cpu,cmd --sort=-%mem | head
```

### L.5 Out Of Memory

```bash
sudo dmesg -T | grep -iE 'out of memory|killed process' | tail
sudo journalctl -k --since "1 hour ago" | grep -iE 'oom|killed process' | tail
pm2 status ; pm2 logs gamecreator-api --lines 100 --nostream   # daemon của ubuntu. gamecreator: sudo -u gamecreator -H pm2 ...
```

- Backend bị kernel OOM-kill thì PM2 khởi động lại nó (`autorestart`); kiểm tra `max_memory_restart` và RAM thật bằng `free -m`.

### L.6 Stop/Start EC2

Stop rồi Start: Elastic IP giữ nguyên; `nginx` tự khởi động (systemd); backend tự chạy lại nếu `pm2 startup` + `pm2 save` đã làm (mục G.3). Sau Start chạy lại K.1, K.2, K.8.

### L.7 Lỗi thường gặp

| Triệu chứng | Nguyên nhân thường gặp | Cách xử lý |
| --- | --- | --- |
| `nginx -t`: không tìm thấy file chứng chỉ | Chưa cấp chứng chỉ hoặc chưa sửa đường dẫn trong bản sao | Mục I.5. Không tạo chứng chỉ giả |
| `nginx -t`: `address family not supported` | IPv6 tắt | Comment các dòng `listen [::]:...` |
| `502 Bad Gateway` ở `/api/` | Backend chưa chạy hoặc không nghe `127.0.0.1:3001` | `pm2 status` (daemon của `ubuntu`; `gamecreator`: `sudo -u gamecreator -H pm2 status`), `ss -ltnp \| grep 3001`, `pm2 logs` |
| `401` mãi dù mật khẩu đúng | File htpasswd sai quyền hoặc sai nhóm | `ls -l /etc/nginx/.htpasswd-gamecreator` (root:www-data, 640) |
| `429` khi duyệt bình thường | Vượt `limit_req` hoặc `AI_REQUESTS_PER_MINUTE` | Chờ ~1 phút; nhiều người sau cùng một NAT dùng chung hạn mức |
| Backend không khởi động, lỗi `... phải là số nguyên từ ... đến ...` | Giá trị biến `AI_*` ngoài khoảng | Sửa theo bảng ở mục D |
| Backend báo `Cổng 3001 đang được sử dụng` | Một process khác đang giữ cổng | `ss -ltnp \| grep 3001` |
| Trang trắng hoặc preview game không chạy | Thiếu `runtime/*.js` trong `/var/www/gamecreator` | Build lại (mục E) và copy lại (mục H) |

---

## M. Phụ lục

### M.1 Địa chỉ client sau Nginx

Nginx ghi đè `X-Forwarded-For` và `X-Real-IP` bằng `$remote_addr`; Express chỉ tin header đó khi TCP peer là loopback (`TRUST_PROXY=loopback`). Không dùng IP/Host/Origin để quyết định ai được vào site: việc đó là của Basic Auth.


### M.3 Rủi ro còn lại

- Hạn mức IP và tin cậy proxy nằm trong bộ nhớ một process: mất khi khởi động lại, không dùng nhiều instance.
- Mật khẩu dùng chung, không định danh từng người, không thu hồi riêng lẻ. Trình duyệt nhớ Basic Auth tới khi realm hoặc mật khẩu đổi; ứng dụng không có nút đăng xuất.
- `Origin` của trình duyệt được chuyển tiếp nguyên vẹn (theo thiết kế).
- Thiếu header bảo mật cho trang tĩnh ngoài HSTS (mục I.2).

---

## Blocker trước Production

| # | Blocker | Ảnh hưởng | Cần làm |
| --- | --- | --- | --- |
| B4 | Chưa có domain/chứng chỉ (theo thông tin hiện có) | Chặn bật site Nginx và mở 80/443 | Có domain: mục I.5 (khuyến nghị). Không có domain: B7 |
| B5 | Chưa có `htpasswd`, ecosystem PM2 chưa được tạo/chạy thử | Chặn việc chạy backend | Mục I.3, G |
| B6 | Header bảo mật cho trang tĩnh còn thiếu | Rủi ro, không chặn | Thiết kế và thử riêng (mục I.2) |
| B7 | **Chứng chỉ IP:** cần Certbot ≥ 5.4 (apt 24.04 chỉ có 2.9.0) và quy trình gia hạn tự động cho chứng chỉ 160 giờ chưa được xác minh trên EC2. Tài liệu không có lệnh cấp chứng chỉ IP | Chặn HTTPS trực tiếp trên Elastic IP (chỉ áp dụng nếu không dùng domain) | Dùng domain (I.5), hoặc xử lý I.5b như một thay đổi riêng có kiểm chứng gia hạn |
| B8 | **User dịch vụ không sudo:** chưa biết Node/PM2 cài ở đâu. Nếu nằm dưới `/home/ubuntu` (nvm) thì user `gamecreator` không chạy được và chưa có phương án đã kiểm chứng. G.1b chưa chạy thử | Chặn việc chạy backend bằng user riêng (khuyến nghị). Nếu chưa xong, chỉ chạy bằng `ubuntu` khi **chưa** mở Internet | `readlink -f "$(command -v node)" "$(command -v pm2)"` (G.1b bước 0), rồi chọn và kiểm chứng cách cài |
| B9 | **Security Group SSH 22** chưa được xác minh chỉ cho IP quản trị | Chặn mở 80/443 ra Internet | Cảnh báo ở mục J; kiểm tra trên AWS Console, không do tài liệu này thay đổi |

## Thứ tự lệnh cần làm tiếp

1. Xác minh trạng thái hiện có: mục B (các lệnh kiểm tra), `git -C /home/ubuntu/PRJ27 status -sb`, `id -nG`, `sudo -l`.
2. `cd /home/ubuntu/PRJ27 && npm ci && npm run build` (mục C.3, E).
3. Tạo `apps/api/.env` (mục D.1) và file ecosystem (mục G.2).
4. Khuyến nghị: tạo user dịch vụ không sudo và chạy PM2 bằng user đó (mục G.1b, cần giải quyết B8 trước); nếu chưa, chỉ dùng `ubuntu` khi chưa mở Internet. `pm2 start ...`, `pm2 save`, `pm2 startup` (mục G.3 hoặc G.1b); kiểm tra K.1.
5. Copy frontend vào `/var/www/gamecreator` (mục H).
6. `apache2-utils` + `htpasswd` (mục I.3).
7. Kiểm tra Security Group: SSH 22 chỉ cho IP quản trị (cảnh báo ở mục J). Có domain: DNS → Security Group mở 80/443 → certbot → cài Nginx (mục I.5) → K.2 đến K.5.
8. Reboot thử (K.8) và kiểm tra Security Group từ bên ngoài (K.9).
