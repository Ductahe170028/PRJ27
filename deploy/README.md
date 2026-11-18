# Triển khai GameCreator sau Nginx

Mẫu này dành cho một nhóm bạn bè dùng thử. Mọi người dùng chung một mật khẩu tại Nginx. Ứng dụng không có trang đăng nhập, không có tài khoản riêng và không có phân quyền trong Express.

File này chỉ là cấu hình và hướng dẫn. Chưa áp dụng lên EC2. Chưa có domain và chứng chỉ thì chưa bật site này trên Internet.

## Cấu hình đã chuẩn bị

`deploy/nginx/gamecreator.conf` là điểm vào công khai duy nhất:

1. Cổng 80 chỉ chuyển sang HTTPS, kèm thư mục trống cho thử thách chứng chỉ. Cổng này không hỏi mật khẩu và không proxy vào Node.
2. Cổng 443 bật TLS và `auth_basic` ở khối `server`. Mọi `location` bên trong kế thừa hai chỉ thị đó. Không có `location` nào tắt xác thực.
3. `location ^~ /api/` chuyển toàn bộ API sang `127.0.0.1:3001`. Không có ngoại lệ cho `/api/games/generate`, `/api/ai/test-connection`, `/api/agent/generate`, `/api/health` hay API khác.
4. Các file tĩnh của frontend, kể cả `/runtime/`, cũng nằm sau mật khẩu.
5. Header `Authorization` và `Proxy-Authorization` bị xóa trước khi tới Node. `Host` luôn là domain trong `server_name` (`$server_name`), không phải giá trị client tự gõ, nên client không làm Node thấy `localhost`. `X-Forwarded-For` chỉ chứa IP TCP thật, không chuyển tiếp giá trị client gửi. `Origin` của trình duyệt được chuyển tiếp, không bị xóa.

`auth_basic` đặt ở `server`, không đặt ở `http`, nên site khác trên cùng máy không bị ảnh hưởng. Nginx không cho một `location` kế thừa `proxy_pass` từ `location` anh em. Vì vậy toàn bộ API nằm trong một khối, thay vì tách từng endpoint rồi quên dòng proxy hoặc quên mật khẩu.

Giới hạn `limit_req_zone` nằm ngoài `server` vì Nginx chỉ chấp nhận zone trong ngữ cảnh `http`. Ubuntu nạp `sites-enabled` bên trong `http`, nên chỉ được symlink file này một lần. Không chép thêm vào `conf.d/`.

## Mật khẩu dùng chung

Trên EC2, sau khi đã cài Nginx:

```bash
sudo apt-get update
sudo apt-get install -y apache2-utils
sudo htpasswd -B -c /etc/nginx/.htpasswd-gamecreator friends
```

Lệnh hỏi mật khẩu hai lần và không ghi mật khẩu vào lịch sử shell. `-B` lưu bcrypt. `-c` chỉ dùng cho lần tạo file đầu tiên vì nó ghi đè file cũ. Username `friends` là tên dùng chung, có thể đổi trước khi chạy lệnh. Chỉ tạo một user.

Nginx trên Ubuntu thường chạy bằng nhóm `www-data`. Kiểm tra dòng `user` trong `/etc/nginx/nginx.conf`, rồi cấp quyền đọc cho đúng nhóm:

```bash
sudo chown root:www-data /etc/nginx/.htpasswd-gamecreator
sudo chmod 640 /etc/nginx/.htpasswd-gamecreator
```

File này nằm ngoài repository. Không sao chép nó vào dự án, không gửi vào git, không dán hash vào issue hoặc log. Đổi mật khẩu bằng `sudo htpasswd -B /etc/nginx/.htpasswd-gamecreator friends` (không có `-c`). Trình duyệt nhớ Basic Auth đến khi realm hoặc mật khẩu đổi; không có nút đăng xuất trong ứng dụng.

## Backend chỉ nghe nội bộ

`apps/api/src/server.ts` lấy `HOST` từ môi trường và mặc định là `127.0.0.1`, cổng mặc định `3001`. `apps/api/.env.example` ghi cùng giá trị. Process production phải được khởi động với:

```bash
NODE_ENV=production HOST=127.0.0.1 PORT=3001 npm run start:api
```

`HOST` phải là đúng `127.0.0.1`. Giá trị `0.0.0.0` hoặc chuỗi rỗng sẽ không còn là mặc định an toàn. Nginx proxy tới đúng địa chỉ loopback đó. Không đặt `VITE_API_BASE_URL` thành `http://127.0.0.1:3001`: trình duyệt sẽ gọi thẳng backend, bỏ qua Nginx. Để biến này rỗng như `apps/web/.env.example`, build bằng `npm run build`, rồi copy `apps/web/dist/` tới `/var/www/gamecreator/`.

Security group của EC2 được mở 80 và 443. Không mở 3001 và không mở 5173. Kiểm tra trên máy:

```bash
ss -ltnp | grep -E ':3001|:443|:80'
```

`3001` phải hiện `127.0.0.1:3001`. Từ một máy khác, kết nối tới cổng 3001 của IP công cộng phải thất bại. Tìm trên máy chủ mọi `proxy_pass` khác trỏ vào `3001`; file này phải là chỗ duy nhất.

## HTTPS, khi đã có domain

Chưa có domain và chứng chỉ thì chưa symlink file vào `sites-enabled`. Basic Auth trên HTTP công khai không phải phương án production: mật khẩu chỉ được mã hóa Base64 trên đường truyền.

Khi đã có domain:

1. Gắn Elastic IP cho instance để địa chỉ không đổi sau khi dừng máy.
2. Tạo bản ghi DNS A của domain tới Elastic IP. Security group cho phép 80 và 443 từ Internet, không cho phép 3001.
3. Sửa `server_name gamecreator.example.com` ở cả hai khối `server`.
4. Xin chứng chỉ thật trước khi bật file Nginx. File mẫu không qua `nginx -t` khi chưa có hai file chứng chỉ, nên lần cấp đầu dùng standalone trong lúc Nginx đang tắt, hoặc dùng xác thực DNS. Không tự ký chứng chỉ để nhét vào cấu hình.

```bash
sudo systemctl stop nginx
sudo apt-get install -y certbot
sudo certbot certonly --standalone -d gamecreator.example.com
```

5. Sửa hai đường dẫn trong khối 443 thành file Certbot vừa cấp:

```nginx
ssl_certificate     /etc/letsencrypt/live/gamecreator.example.com/fullchain.pem;
ssl_certificate_key /etc/letsencrypt/live/gamecreator.example.com/privkey.pem;
```

6. Từ thư mục gốc của source trên máy chủ, copy file vào `sites-available`, symlink một lần vào `sites-enabled`, rồi kiểm tra và bật Nginx. Sau bước cấp chứng chỉ Nginx đang tắt, nên dùng `start`.

```bash
sudo cp deploy/nginx/gamecreator.conf /etc/nginx/sites-available/gamecreator.conf
sudo ln -s /etc/nginx/sites-available/gamecreator.conf /etc/nginx/sites-enabled/gamecreator.conf
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl start nginx
```

Sau khi site đã chạy, chuyển gia hạn sang webroot để khỏi phải tắt Nginx. Thư mục này đã được khối cổng 80 phục vụ và không chứa ứng dụng:

```bash
sudo mkdir -p /var/www/letsencrypt
sudo certbot certonly --webroot -w /var/www/letsencrypt --cert-name gamecreator.example.com -d gamecreator.example.com
```

Timer của Certbot gia hạn file. Thêm `deploy-hook = systemctl reload nginx` trong file renewal tương ứng để Nginx đọc chứng chỉ mới.

7. Kiểm tra trình duyệt: cổng 80 trả 301 và không có `WWW-Authenticate`; cổng 443 trả 401 cho đến khi nhập mật khẩu. `curl -I http://domain/` không được chứa mật khẩu.

`nginx -t` thất bại khi hai file chứng chỉ placeholder chưa tồn tại. Đó là cố ý. Không chuyển Basic Auth sang cổng 80 để né lỗi này.

## Giới hạn request

Mọi người dùng chung một danh tính, nên không có quota theo user và không có user store.

Nginx giới hạn theo địa chỉ TCP thật, `$binary_remote_addr`, không theo header client tự khai:

- `/api/`: trung bình 30 request/phút cho mỗi IP, burst 10, tối đa 8 kết nối đồng thời tới API. Vượt mức thì 429.
- Phần còn lại của website: 120 request/phút cho mỗi IP, burst 40. Mức này làm chậm việc đoán mật khẩu, vì request sai mật khẩu vẫn được tính. Tải một trang bình thường dùng ít request hơn mức burst.
- Giới hạn này chỉ làm chậm, không khóa. Dùng mật khẩu dài ngẫu nhiên, ví dụ `openssl rand -base64 18`, không dùng mật khẩu dễ đoán. Nhiều người sau cùng một NAT chia sẻ cùng một IP và cùng một hạn mức.

Backend giữ hạn mức toàn hệ thống sẵn có, đặt bằng biến môi trường trong `apps/api/.env.example`:

| Biến | Mặc định | Ý nghĩa sau Nginx |
| --- | --- | --- |
| `AI_REQUESTS_PER_MINUTE` | 5 | Bộ đếm theo địa chỉ client thật (xem "Địa chỉ client sau Nginx"). IPv6 gộp theo /64. Nhiều người sau cùng một NAT dùng chung một suất. |
| `AI_REQUESTS_PER_DAY` | 100 | Trần chi phí của cả máy, reset theo ngày UTC. |
| `AI_MAX_CONCURRENT` | 2 | Tối đa 2 lời gọi provider cùng lúc cho cả máy. |
| `AI_TIMEOUT_MS` | 45000 | Timeout của một lời gọi provider. |

Với vài người bạn, trần phút của backend sẽ chạm trước trần 30 request/phút của Nginx. Có thể tăng `AI_REQUESTS_PER_MINUTE` khi chấp nhận rằng suất theo IP không phải suất của từng người: không có user ID, nhiều người có thể chung một IP, nên các trần toàn hệ thống (`AI_REQUESTS_PER_DAY`, `AI_MAX_CONCURRENT`) mới là lớp bảo vệ chi phí thật sự. Lời gọi provider đồng thời thứ ba nhận 429 từ backend. `GET /api/health` và `GET /api/ai/providers` không tính vào hạn mức đó. Body JSON lớn hơn 16 KB bị Nginx (`client_max_body_size 16k`) và Express (`express.json({ limit: '16kb' })`) trả 413.

Bộ đếm theo IP nằm trong bộ nhớ, tự xóa cửa sổ đã hết hạn ở mỗi request và bị chặn ở 1000 địa chỉ (`maxClients`). Khi đầy, địa chỉ mới nhận 429 thay vì làm bộ nhớ tăng. Khởi động lại process thì bộ đếm về 0.

Không dùng địa chỉ IP, `Host` hay `Origin` để quyết định ai được vào site hay được dùng Advanced.

## Địa chỉ client sau Nginx

Nginx ghi đè `X-Forwarded-For` và `X-Real-IP` bằng `$remote_addr` (không bao giờ nối thêm giá trị client gửi). Express chỉ tin header đó khi kết nối TCP đến từ loopback:

| `TRUST_PROXY` | Hành vi |
| --- | --- |
| không đặt | `loopback` khi `NODE_ENV=production`, ngược lại `off` (dev không có proxy) |
| `loopback` | `app.set('trust proxy', 'loopback')`: chỉ Nginx trên máy này được đặt IP client |
| `off` / `false` / `0` | Bỏ qua mọi header chuyển tiếp |
| giá trị khác (`true`, số hop, danh sách mạng, `*`) | Backend từ chối khởi động. Các giá trị này cho phép bên khác tự chọn IP |

Một client gửi `X-Forwarded-For: 1.2.3.4` trực tiếp tới Nginx bị ghi đè, và dù header thừa có tới được Express thì địa chỉ không-loopback ngoài cùng bên phải mới được dùng. `advancedAllowed` không đọc `req.ip`: nó dùng `socket.remoteAddress` cùng kiểm tra `Host`/`Origin`, nên header giả không mở được Advanced.

## Hàng đợi job Advanced

Hàng đợi nằm trong bộ nhớ, không dùng Redis hay dịch vụ ngoài. Một game Advanced chiếm một chỗ từ lúc nhận request đến lúc xong, gồm cả sinh code, kiểm tra và Playwright.

| Biến | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `GAME_JOB_CONCURRENCY` | 1 | Số game chạy cùng lúc (1–2). t3.small chỉ nên để 1. |
| `GAME_JOB_MAX_QUEUE` | 2 | Số game được chờ (0–10). 0 nghĩa là máy bận thì 429 ngay. |
| `GAME_JOB_TIMEOUT_MS` | 240000 | Thời gian chạy tối đa của một game, sau đó bị hủy. |
| `GAME_JOB_MAX_WAIT_MS` | 60000 | Thời gian chờ tối đa trong hàng. |
| `GAME_JOB_MAX_PER_IP` | 2 | Chạy + chờ tối đa cho một địa chỉ client. |

`GAME_JOB_TIMEOUT_MS + GAME_JOB_MAX_WAIT_MS` không được vượt 300000 vì trình duyệt dừng chờ sau 330 giây và `proxy_read_timeout` là 300 giây. Giá trị sai làm backend không khởi động.

- Hàng đầy hoặc backend đang tắt: `POST /api/agent/generate` trả JSON 429 (kèm `Retry-After`) hoặc 503 **trước khi** bắt đầu stream.
- Đang chờ: stream NDJSON mở ngay và nhận sự kiện `status` (giai đoạn `Planning`, thông báo "Đang chờ đến lượt: vị trí N"). Không thêm kiểu sự kiện mới, nên hợp đồng NDJSON và frontend không đổi.
- Client ngắt kết nối khi đang chờ hoặc đang chạy: chỗ được trả và Playwright/container bị dừng.
- Hết hạn chạy: sự kiện `failed` với mã `timeout`. Chờ quá lâu: `failed` mã `rate_limit`. Tắt máy: `failed` mã `shutting_down`.
- **Job đang chờ và đang chạy mất khi process khởi động lại.** Client thấy stream kết thúc và phải gửi lại. Không có lưu trữ bền vững.
- Khi `SIGTERM`/`SIGINT`: ngừng nhận job, hủy job đang chờ, cho job đang chạy 2 giây, hủy phần còn lại, dừng container, rồi đóng HTTP. Cưỡng chế thoát sau 8 giây.

## Sandbox Runner (Docker)

Code do AI sinh ra chỉ được chạy trong một container dùng một lần, không bao giờ trên máy chủ. `AgentOrchestrator` mặc định không có tester: nếu không cấu hình, Advanced báo không khả dụng thay vì chạy Chromium trên host.

### Cách ly

Mỗi job chạy `docker run` với các cờ do `apps/api/src/sandbox/docker-args.ts` tạo ra (có test kiểm tra từng cờ): `--rm --init --pull=never --network=none --user=10001:10001 --cap-drop=ALL --security-opt=no-new-privileges --read-only --memory=768m --memory-swap=768m --cpus=1 --pids-limit=256 --ulimit nofile=1024:1024 --ulimit core=0 --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m --shm-size=128m --log-driver=none` và đúng ba biến môi trường không bí mật. Không có `-v`, `--mount`, `--env-file`, `docker.sock`, `--privileged`, `--cap-add`. Dữ liệu job đi qua stdin, kết quả qua stdout (tối đa 16 KB, bị cắt và container bị kill nếu vượt). Backend không truyền biến môi trường của mình cho tiến trình `docker`. `spawn` luôn dùng mảng đối số, `shell: false`.

Seccomp mặc định của Docker và `--cap-drop=ALL` được giữ nguyên. Chromium trong container chạy với `--no-sandbox` (`chromiumSandbox: false`), vì sandbox của Chromium cần user namespace mà các cờ trên chặn. Ranh giới cách ly khi đó là container. Đây là đánh đổi có chủ ý: một lỗi thoát renderer của Chromium sẽ rơi vào container không quyền, không mạng, không mount, không bí mật.

### Chính sách khi lỗi

- Docker không chạy, không có image, hoặc `docker run` trả 125/126/127: job trả `tester_unavailable` (503). **Không có phương án chạy trên host.** Advanced tự báo `enabled: false` trong `/api/agent/config` và `POST /api/agent/generate` trả 503 trước khi stream.
- Khi khởi động, backend dọn container còn sót (nhãn `gamecreator.sandbox=1`) rồi chạy **kiểm tra cách ly** từ bên trong container (`probe-main.js`): không phải root, `CapEff`/`CapBnd` bằng 0, `NoNewPrivs=1`, có seccomp, root chỉ đọc, `/tmp` đúng dung lượng, không có giao diện mạng ngoài loopback, không kết nối ra ngoài, không phân giải DNS, không có docker.sock, không đọc được đường dẫn Host, không có biến môi trường giống bí mật, giới hạn RAM/process/CPU đúng cấu hình, không có mount lạ. Chỉ khi tất cả đạt, Advanced mới sẵn sàng; kiểm tra lặp lại mỗi `SANDBOX_RECHECK_MS`.
- Container chạy quá `SANDBOX_TIMEOUT_MS`, bị OOM, hoặc in quá nhiều: game nhận lỗi có thể sửa ("Sandbox dừng game vì…") và vòng sửa chạy như cũ. Đây là lỗi của game, không phải của hệ thống.
- Kết quả từ container được coi là không tin cậy: chỉ chấp nhận đúng hình dạng JSON (tối đa 10 lỗi, mỗi lỗi 500 ký tự).

### Biến môi trường

| Biến | Mặc định | Ghi chú |
| --- | --- | --- |
| `ADVANCED_TESTER` | `docker` | `local` chạy Chromium trên máy này, chỉ để phát triển, bị từ chối khi `NODE_ENV=production`. |
| `SANDBOX_IMAGE` | `gamecreator-sandbox:pw1.60.0` | Phải có tag hoặc digest cụ thể. `:latest` bị từ chối. |
| `SANDBOX_CONCURRENCY` | 1 | Số container cùng lúc (1–2). |
| `SANDBOX_MEMORY_MB` | 768 | RAM (và swap) cho mỗi container. |
| `SANDBOX_CPUS` | 1 | CPU cho mỗi container. |
| `SANDBOX_PIDS` | 256 | Số process tối đa. |
| `SANDBOX_TMP_MB` / `SANDBOX_SHM_MB` | 64 / 128 | `/tmp` và `/dev/shm`. |
| `SANDBOX_TIMEOUT_MS` | 45000 | Thời gian tối đa cho một container (trình duyệt trong đó có hạn 25 giây). |
| `SANDBOX_RECHECK_MS` | 300000 | Chu kỳ kiểm tra cách ly lại. |
| `SANDBOX_DOCKER_BIN` | `docker` | Đường dẫn tới Docker CLI. |

Với t3.small (2 vCPU, 2 GB): 1 job, 1 container, 768 MB, 1 CPU, hàng đợi 2. Phần còn lại dành cho hệ điều hành, Docker, Nginx và Node. Không tăng `SANDBOX_CONCURRENCY` lên 2 nếu chưa đo RAM thực tế.

### Cài Docker trên Ubuntu 24.04 và build image

```bash
# Docker Engine theo hướng dẫn chính thức: https://docs.docker.com/engine/install/ubuntu/
sudo apt-get update && sudo apt-get install -y docker.io
sudo systemctl enable --now docker
# KHÔNG thêm user chạy backend vào nhóm `docker`: nhóm đó tương đương root trên host.
# Chạy backend bằng một user riêng, và cho phép user đó chạy đúng docker qua sudoers hoặc rootless Docker (xem "Rủi ro còn lại").

npm ci && npm run sandbox:build        # build + docker build -f deploy/sandbox/Dockerfile -t gamecreator-sandbox:pw1.60.0 .
docker image inspect gamecreator-sandbox:pw1.60.0 --format '{{.Id}}'   # ghi lại, hoặc dùng digest cho SANDBOX_IMAGE
npm run sandbox:verify                  # kiểm tra cách ly thật; thoát 0 chỉ khi mọi mục đạt
```

Image dựa trên `mcr.microsoft.com/playwright:v1.60.0-noble` (tag cố định, không `latest`). Backend dùng `--pull=never`: không bao giờ tự tải image.

### Cập nhật Playwright

Phiên bản Playwright ở bốn nơi phải trùng nhau; `apps/api/test/deploy-config.test.ts` kiểm tra và test sẽ đỏ nếu lệch:

1. `package-lock.json` (và `apps/api/package.json`, `package.json` gốc cho `@playwright/test`).
2. `ARG PLAYWRIGHT_VERSION` trong `deploy/sandbox/Dockerfile` (và tag `FROM`).
3. `SANDBOX_PLAYWRIGHT_VERSION` trong `apps/api/src/sandbox/docker-args.ts` (kéo theo tên image mặc định).
4. `SANDBOX_IMAGE` trong `.env` và `apps/api/.env.example`.

Quy trình: nâng Playwright, `npm install`, sửa các chỗ trên, `npm run sandbox:build`, `npm run sandbox:verify`, `SANDBOX_INTEGRATION=1 npm run test:sandbox`, rồi đổi `SANDBOX_IMAGE` và khởi động lại backend. Giữ image cũ cho đến khi image mới đạt kiểm tra để quay lui được.

### Kiểm thử

- `npm test` chạy các test không cần Docker (bao gồm cờ Docker, giao thức, xử lý timeout/kill/giới hạn output bằng Docker CLI giả).
- `SANDBOX_INTEGRATION=1 npm run test:sandbox` (PowerShell: `$env:SANDBOX_INTEGRATION='1'`) cần daemon Docker và image đã build. Test tấn công từ bên trong container (fork bomb, hết RAM, vòng lặp vô hạn, tràn output, mạng, docker.sock, đường dẫn Host, ghi ra root, `/tmp` không chạy được file, ký tự shell trong code game), chạy Playwright thật trong container (game chuẩn, lỗi JS, game treo, timeout, hủy, song song) và kiểm tra container được dọn. Có một "negative control": container chạy thiếu cờ cứng hóa phải bị kiểm tra cách ly phát hiện.
- Kết quả trên Docker Desktop (Windows/macOS) chạy Linux trong máy ảo. Chúng **không** thay thế việc chạy lại trên Ubuntu 24.04 thật.

## Advanced Mode

Advanced vẫn tắt khi `NODE_ENV=production`. Điều kiện nằm ở `apps/api/src/app.ts`: cờ chỉ bật khi `ADVANCED_AI_ENABLED` khác `false` và `NODE_ENV` khác `production`. Production phải giữ `NODE_ENV=production`. Không đổi thành `development` để mở tính năng.

Việc có Sandbox Runner **không** tự bật Advanced trên production. Cổng đó (`advancedAllowed`) vẫn chỉ cho loopback + `Host`/`Origin` localhost và không đổi. Basic Auth chỉ quyết định ai vào được website; nó không cách ly code do AI sinh ra. Chỉ mở Advanced trên production bằng một thay đổi riêng, sau khi hoàn tất checklist bên dưới trên chính EC2.

## Checklist bắt buộc trên Ubuntu 24.04 (EC2) trước khi mở Advanced

Chưa thực hiện. Cần làm trên instance thật (không dùng kết quả Docker Desktop):

1. `docker version`, `docker info --format '{{.SecurityOptions}}'` có `seccomp`; xác nhận cgroup v2 (`stat -fc %T /sys/fs/cgroup` trả `cgroup2fs`) và `docker info` không cảnh báo thiếu giới hạn memory/swap. Nếu Docker in cảnh báo "Your kernel does not support swap limit capabilities", `--memory-swap` không có tác dụng; cần bật swap accounting rồi chạy lại test OOM.
2. `npm ci && npm run sandbox:build && npm run sandbox:verify` thoát 0.
3. `SANDBOX_INTEGRATION=1 npm run test:sandbox` đạt toàn bộ, đặc biệt các test fork bomb, OOM, CPU, timeout, mạng, tràn output, dọn container.
4. Kiểm tra RAM khi một job chạy: `docker stats --no-stream` trong lúc chạy game thật; tổng RAM máy còn trống (`free -m`) và không dùng swap liên tục.
5. Backend chạy bằng user không thuộc nhóm `docker` (xem mục dưới) và `ss -ltnp` thấy `127.0.0.1:3001`.
6. Từ máy khác: cổng 3001 và 5173 không kết nối được; 80 trả 301; 443 trả 401 khi không có mật khẩu cho `/`, `/runtime/advanced.js`, `/api/games/generate`, `/api/ai/test-connection`, `/api/agent/generate`.
7. Kiểm tra giả mạo qua Nginx thật: `curl -u friends:… -H 'X-Forwarded-For: 1.2.3.4' -H 'X-Real-IP: 1.2.3.4' https://domain/api/health` rồi xem log API/Nginx: IP ghi nhận phải là IP thật của bạn. Gọi `-H 'Host: localhost'` và `-H 'Origin: http://localhost'` tới `/api/agent/generate` phải nhận 403 hoặc 404, không bao giờ chạy Advanced.
8. Nhiều request đồng thời tới `/api/agent/generate` (khi đã mở thử có kiểm soát): 1 chạy, tối đa `GAME_JOB_MAX_QUEUE` chờ, còn lại 429; `docker ps` không còn container `gc-sbx-*` sau khi xong; `sudo systemctl restart` backend giữa chừng không để lại container (`docker ps -a --filter label=gamecreator.sandbox=1`).
9. `SIGTERM` backend khi đang chạy job: stream kết thúc bằng `failed/shutting_down`, container biến mất trong vài giây.
10. Xác nhận log API và log Nginx không chứa mật khẩu, `Authorization`, khóa API hay mã game.

## Rủi ro còn lại

- Container dùng chung kernel với host. Một lỗ hổng kernel hoặc runtime container vẫn có thể thoát ra. Giữ Ubuntu và Docker được cập nhật bảo mật.
- Backend phải điều khiển Docker. Nhóm `docker` tương đương root: nếu backend bị chiếm quyền, kẻ tấn công điều khiển được host. Nên dùng Docker rootless hoặc một user riêng với quyền hẹp hơn. Chưa làm trong bước này.
- Chromium chạy với `--no-sandbox` trong container (xem trên).
- Hàng đợi, hạn mức IP và tin cậy proxy nằm trong bộ nhớ của một process: khởi động lại là mất, và không dùng được cho nhiều instance.
- Kiểm tra game bằng Playwright phụ thuộc thời gian; trong khoảng 76 lần chạy một game mẫu đúng trên Docker Desktop, 2 lần bị báo lỗi (một lần "vượt ngân sách vòng lặp/CPU mỗi frame", một lần "đạn không xuất hiện"), cả hai ở mức CPU 1.5 hoặc khi chạy liên tiếp, không ở mức 1 CPU mặc định trong các lần đo tuần tự. Chưa đo cùng game bằng Chromium chạy trực tiếp nên chưa biết đây có sẵn từ trước hay do container. Mỗi lần như vậy tiêu một lượt sửa của AI.
- Mật khẩu dùng chung. Không có định danh từng người, không thu hồi riêng lẻ.

## Việc làm trên AWS

Chưa thực hiện các bước sau:

1. Cài `apache2-utils`, tạo `/etc/nginx/.htpasswd-gamecreator`, chmod 640.
2. Build ứng dụng trên máy chủ hoặc copy `apps/web/dist/` và bản build API lên máy.
3. Chạy API bằng PM2 với `NODE_ENV=production`, `HOST=127.0.0.1`, `PORT=3001`.
4. Trỏ DNS, xin chứng chỉ, sửa `server_name` và đường dẫn chứng chỉ.
5. Tắt site mặc định của Nginx, symlink riêng file này, `nginx -t`, reload.
6. Security group: 22 giới hạn theo IP quản trị, 80 và 443 mở, 3001 đóng.
7. Xác nhận `ss` thấy `127.0.0.1:3001`, và từ bên ngoài không kết nối được cổng đó.
8. Gọi không mật khẩu vào `/`, `/api/games/generate`, `/api/ai/test-connection`, `/api/agent/generate` và nhận 401. Gọi có mật khẩu thì tới được ứng dụng. Log Nginx và log API không chứa mật khẩu hoặc header `Authorization`.
