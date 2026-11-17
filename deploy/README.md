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
| `AI_REQUESTS_PER_MINUTE` | 5 | Bộ đếm theo `request.ip`. Chưa bật `trust proxy`, nên mọi người cùng là `127.0.0.1` và cùng dùng 5 request/phút. |
| `AI_REQUESTS_PER_DAY` | 100 | Trần chi phí của cả máy, reset theo ngày UTC. |
| `AI_MAX_CONCURRENT` | 2 | Tối đa 2 lời gọi provider cùng lúc cho cả máy. |
| `AI_TIMEOUT_MS` | 45000 | Timeout của một lời gọi provider. |

Với vài người bạn, trần phút của backend sẽ chạm trước trần 30 request/phút của Nginx. Có thể tăng `AI_REQUESTS_PER_MINUTE` khi chấp nhận rằng con số đó là trần chung, không phải suất của từng người. Nginx vẫn chặn một IP gửi dồn dập. Chưa có hàng đợi job trong bước này: lời gọi provider đồng thời thứ ba nhận 429 từ backend. `GET /api/health` và `GET /api/ai/providers` không tính vào hạn mức đó.

Không dùng `set_real_ip_from` khi chưa có proxy tin cậy đứng trước Nginx. Không dùng địa chỉ IP để quyết định ai được vào site.

## Advanced Mode

Advanced vẫn tắt khi `NODE_ENV=production`. Điều kiện nằm ở `apps/api/src/app.ts`: cờ chỉ bật khi `ADVANCED_AI_ENABLED` khác `false` và `NODE_ENV` khác `production`. Production phải giữ `NODE_ENV=production`. Không đổi thành `development` để mở tính năng.

Cấu hình proxy không ghi đè `Host` thành localhost và không xóa `Origin`. Hai việc đó không được dùng để làm `advancedAllowed` trả về true. Basic Auth chỉ quyết định ai vào được website. Nó không cách ly code do AI sinh ra. Advanced chỉ được mở sau khi Sandbox Runner ở cấp hệ điều hành được triển khai và kiểm thử đạt, bằng một thay đổi riêng. Bước đó chưa nằm trong file này.

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
