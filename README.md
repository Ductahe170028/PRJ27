# Denise Homework Reopen V1

Ứng dụng Tech Support mở lại **một submission thực hành đang `SUBMITTED`**. React + TypeScript + Vite ở `web/`; Express + TypeScript ở `api/`; hợp đồng dữ liệu và quy tắc dùng chung ở `shared/`. Đặc tả gốc: [Denise_Homework_Reopen_V1_Plan.md](Denise_Homework_Reopen_V1_Plan.md).

## Chạy cục bộ

Cần Node.js **22.11 trở lên** và npm. Chạy từ thư mục gốc:

```powershell
npm ci
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
npm run dev
```

Mở **http://127.0.0.1:5173**. API chạy tại `127.0.0.1:4000`; Vite chuyển tiếp `/api` tới backend. Mặc định `API_MODE=mock`, không cần credential. Dùng đúng URL `127.0.0.1` để khớp `WEB_ORIGIN`; nếu đổi URL/port, cập nhật biến này.

Nhập `26009543` → **Tìm học viên** → chọn khóa Scratch và lớp `HN-SCR-2408` → chọn đúng phần **Mở lại** → kiểm tra thông tin/lý do → xác nhận. Buổi 8 chứng minh vẫn mở được Task 1 khi Task 2 chưa nộp; buổi 9 có hai phần đã nộp và chỉ phần được chọn thay đổi. Bài nộp file có cảnh báo đính kèm lại file.

Mock lưu trong RAM, khởi động lại backend sẽ phục hồi dữ liệu. Quiz có trạng thái để Tech xem nhưng không có nút mở; Checkpoint và bài thuộc lớp khác bị lọc ở backend. Khóa đã kết thúc vẫn có thể chọn.

| Mã demo | Tình huống |
| --- | --- |
| `26009543` | Luồng đầy đủ; kết quả tìm gần đúng đứng trước kết quả chính xác; ba ghi danh gồm khóa đã kết thúc |
| `26000001` | Chưa có tài khoản Denise |
| `26000002` | Không có khóa học |
| `26000003` | Hai học viên trùng mã, không tự chọn |
| `26000004` | Có khóa nhưng chưa có BTVN |
| `26000005` | Kết quả LMS phân trang chưa đầy đủ, chặn tra cứu |
| `99999999` | Không tìm thấy học viên |

## Build và kiểm thử

```powershell
npm run typecheck
npm test
npm run test:e2e
npm run build
```

`npm test` gồm nghiệp vụ, HTTP endpoints, GraphQL transport và trạng thái giao diện. Mọi API nguồn trong tests được mock/stub; **không gửi request tới LMS/Denise thật**.

E2E dùng Microsoft Edge đã cài (`channel: msedge`), backend mock riêng tại `4100` và Vite tại `5174`. Backend E2E không đọc `.env`, không khởi tạo real client; tests không dùng lại server đang chạy. Nếu máy chưa có Edge, cài Edge hoặc đổi `channel` trong `playwright.config.ts` theo trình duyệt Playwright được cài trên máy. E2E kiểm tra mở lại, cảnh báo file, hủy xác nhận, lỗi/empty state, mobile và kết quả ghi chưa xác định.

Sau build, có thể chạy frontend và API từ một cổng:

```powershell
$env:WEB_ORIGIN = 'http://127.0.0.1:4000'
npm start
```

Mở **http://127.0.0.1:4000**. `npm start` phục vụ `web/dist` và backend đã biên dịch. Khi quay về dev, bỏ override này bằng `Remove-Item Env:WEB_ORIGIN` hoặc sửa `.env` tương ứng. Không đưa `.env` vào Git.

## API của ứng dụng

| Method | Endpoint | Vai trò |
| --- | --- | --- |
| GET | `/api/health` | Kiểm tra server; không trả dữ liệu học viên |
| GET | `/api/context` | Chế độ, người thao tác và quyền mở lại |
| GET | `/api/students/:studentCode` | So khớp chính xác LMS `studentId`; danh sách khóa Denise |
| GET | `/api/students/:studentCode/courses/:enrollmentId/lessons` | BTVN đúng lớp, bỏ Checkpoint, sắp theo buổi |
| GET | `/api/students/:studentCode/courses/:enrollmentId/lessons/:studentLessonId/submissions/:submissionId` | Đọc lại và kiểm tra trước khi xác nhận |
| POST | `/api/reopen` | Một mutation yêu cầu làm lại; đọc kiểm chứng `REDO` |

POST nhận `studentCode`, `enrollmentId`, `studentLessonId`, `submissionId`, `expectedCategory`, `expectedType`, `expectedSubmittedCount`, `note`. Backend tự truy vấn lại student → courses → lessons → submission và đối chiếu; không tin các ID hay status do frontend cung cấp. Ghi danh đã xóa, lớp sai, bài Checkpoint, Quiz, trạng thái khác `SUBMITTED`, dữ liệu thay đổi hoặc thiếu quyền đều bị chặn. Không có GraphQL proxy tùy ý.

Lý do bắt buộc, 1–1.000 ký tự sau khi trim, có thể được học viên/giáo viên nhìn thấy. Backend không tải Scratch state hoặc tệp. Mutation duy nhất là `StudentSubmission_requestRedoSubmission`; không reset, không sửa status thật bằng API khác.

## Kết nối API đọc thật

Các document và variables được sao chép từ plan trong `api/src/clients/documents.ts`. **Chưa xác minh schema/endpoint thật**; ứng dụng không ngầm coi các mô tả trong plan là đã được thử.

1. Cung cấp endpoint HTTPS của LMS/Denise và credential được cấp phép cho môi trường/dữ liệu cho phép.
2. Điền `LMS_GRAPHQL_URL`, `DENISE_GRAPHQL_URL` cùng `*_AUTH_HEADER` và `*_AUTH_VALUE` trong `.env`. Giá trị auth là **toàn bộ giá trị header** theo định dạng công ty xác minh; không tự thêm `Bearer`.
3. Chọn chế độ cá nhân localhost hoặc gateway nội bộ như bên dưới.
4. Đặt `API_MODE=real`, giữ `REAL_MUTATIONS_ENABLED=false`; kiểm tra các API đọc và ID với dữ liệu được phép.

### Chế độ cá nhân localhost: đọc thật trên UI

Khi đã có endpoint/token trong `.env`, cấu hình:

```dotenv
API_MODE=real
LOCAL_PERSONAL_MODE=true
HOST=127.0.0.1
PORT=4000
WEB_ORIGIN=http://127.0.0.1:5173
APP_ENV=development
TRUSTED_PROXY_AUTH=false
REAL_MUTATIONS_ENABLED=false
REAL_WRITE_APPROVAL=
APPROVED_TEST_LMS_IDS=
APPROVED_TEST_COURSE_IDS=
```

Giữ nguyên `LMS_GRAPHQL_URL`, `DENISE_GRAPHQL_URL`, `LMS_AUTH_VALUE`, `DENISE_AUTH_VALUE` đã điền. Ví dụ, nếu upstream yêu cầu Bearer thì các giá trị auth phải có đầy đủ tiền tố `Bearer `; backend không tự thêm tiền tố và không gửi token ra frontend. Không đặt token vào biến `VITE_*`.

Chạy `npm run dev`, mở **http://127.0.0.1:5173** → nhập mã học viên thật được phép tra cứu → chọn khóa/lớp → xem danh sách BTVN. Không cần Postman, gateway hoặc header role. `/api/context` trả người thao tác `local-personal`; nút **Mở lại** bị khóa. Mỗi request tới API dữ liệu phải có kết nối loopback, Host là `127.0.0.1` và nguồn yêu cầu phù hợp; không tin `X-Forwarded-For` để bỏ qua giới hạn này.

`LOCAL_PERSONAL_MODE` mặc định `false`. Khi bật, backend **từ chối khởi động** nếu `HOST` khác chính xác `127.0.0.1` hoặc `APP_ENV` khác `development`. Đổi `.env` xong cần dừng và chạy lại `npm run dev` vì watcher không theo dõi thay đổi cấu hình `.env`.

Chế độ cá nhân chỉ cho phép đọc API thật: các điều kiện bảo vệ mutation cũ được giữ nguyên, gồm môi trường `test`/`staging` và xác thực gateway. Do local mode bắt buộc `development`, bật riêng cờ ghi cũng không mở khóa mutation. Các allowlist là bộ lọc tùy chọn cho **ghi**, không giới hạn dữ liệu API đọc.

### Chế độ gateway nội bộ

Đặt `LOCAL_PERSONAL_MODE=false` và `TRUSTED_PROXY_AUTH=true` sau khi gateway đã được cấu hình. Backend kiểm tra role `homework-support` qua `x-tech-id`/`x-tech-roles` (đổi tên/role bằng `.env` khi cần). **Gateway phải loại bỏ header danh tính từ client rồi chèn danh tính đã xác thực; backend chỉ được truy cập từ gateway**. Đây là giao diện kết nối xác thực, chưa phải tích hợp SSO công ty đã xác minh. Khi cả local mode và gateway đều tắt, real mode từ chối mọi API dữ liệu.

Token nguồn chỉ nằm ở backend; frontend không nhận token, không dùng localStorage. HTTP lỗi, auth, GraphQL `errors` kể cả HTTP 200, JSON/schema lỗi và timeout đều được xử lý; không phản chiếu nguyên văn nội dung lỗi upstream. Endpoint không theo redirect để tránh chuyển credential sang nơi khác. `WEB_ORIGIN` cần khớp URL giao diện/gateway để kiểm tra nguồn POST.

### Những điểm cần xác minh với API thật

- URL, auth headers, thời hạn token và quyền của tài khoản API; gateway/SSO khi dùng chế độ gateway.
- Schema của năm operations và enum thực tế cho submission `type`. **`SCRATCH`/`FILE_UPLOAD` chỉ là enum fixture mock**; real mode chưa suy luận định dạng bài, nên hiển thị cảnh báo tệp một cách thận trọng trong xác nhận.
- LMS `id` → `studentServiceId` → `studentUid`; `StudentLesson_find.studentId` có thực sự nhận Base user ID không.
- `StudentSubmission.lessonId` có trỏ tới `StudentLesson.lessonId` (ID bài học gốc) như adapter đang kiểm tra không. Nếu khác, cần sửa adapter sau khi xác minh; không bỏ qua kiểm tra ownership.
- Field phân trang của `StudentQuery`: hiện chỉ gửi variables trong plan (`itemsPerPage: 5`). Khi `total > data.length`, chặn để tránh bỏ sót học viên trùng mã; không bịa tham số trang.
- Hành vi web học viên sau `REDO`, khả năng giữ nội dung Scratch/file và ảnh hưởng tới `StudentLesson.status`. Tool chỉ khẳng định submission chuyển `REDO`, không khẳng định toàn bộ lesson chuyển `IN_PROGRESS`.

## Mutation thật: mặc định khóa

**Chưa chạy mutation thật.** Chỉ cấu hình cho dữ liệu thử nghiệm sau khi chủ dự án cung cấp đối tượng test, xác nhận quyền và chủ động cho phép. Các điều kiện bắt buộc đồng thời:

```dotenv
API_MODE=real
LOCAL_PERSONAL_MODE=false
TRUSTED_PROXY_AUTH=true
APP_ENV=test
REAL_MUTATIONS_ENABLED=true
REAL_WRITE_APPROVAL=APPROVED_TEST_DATA_ONLY
APPROVED_TEST_LMS_IDS=
APPROVED_TEST_COURSE_IDS=
```

Chỉ `APP_ENV=test` hoặc `staging` cho phép ghi; `development` và `production` luôn bị khóa. Chế độ cá nhân không dùng được với `test`/`staging`, nên không thể dùng nó để bỏ qua các bảo vệ này.

Hai allowlist được xét **độc lập**:

| Biến | Để trống | Có ID, phân cách bằng dấu phẩy |
| --- | --- | --- |
| `APPROVED_TEST_LMS_IDS` | Không giới hạn học viên theo danh sách này | Chỉ ghi cho LMS `Student.id` được khai báo, không phải mã `studentId` |
| `APPROVED_TEST_COURSE_IDS` | Không giới hạn khóa học theo danh sách này | Chỉ ghi cho Denise `courseId` được khai báo, không phải ID ghi danh |

Ví dụ, chỉ điền danh sách LMS sẽ giới hạn học viên nhưng không giới hạn khóa theo allowlist; chỉ điền danh sách course sẽ giới hạn khóa nhưng không giới hạn học viên theo allowlist. Danh sách trống **không bỏ qua** cờ ghi, giá trị approval, môi trường, quyền, kiểm tra ownership, trạng thái `SUBMITTED`, lý do bắt buộc, audit hoặc xác minh `REDO`. Các allowlist không chặn API đọc.

Chỉ bật ghi sau khi chủ dự án xác nhận đối tượng test và quyền thao tác. Cấu hình phải đi kèm endpoint môi trường test được xác minh; chương trình không thể tự suy ra một URL có phải production hay không. Không trỏ tới production để thử ghi.

## Xác minh, audit và kết quả chưa xác định

Mỗi thao tác gọi mutation **một lần**, sau đó luôn đọc lại submission, kể cả khi mutation timeout/trả lỗi GraphQL. Chỉ báo thành công khi ID, lớp, bài, category/type khớp và status là `REDO`. Nếu đọc lại xác minh được sau lỗi phản hồi, trả thành công kèm thông báo giải thích; nếu không, trả `uncertain: true`, khóa thao tác gửi lại và đề nghị kiểm tra trên Denise. Frontend tải lại danh sách sau mỗi lần ghi.

Khóa đồng thời và khóa thao tác chưa xác định lưu trong RAM; **chạy một backend instance** cho V1. Khóa kết quả chưa xác định có thể được giải quyết bằng đọc xác nhận `REDO`; nếu vẫn `SUBMITTED`, không tự mở khóa để retry. Khi server khởi động lại, các khóa RAM mất: Tech cần xác minh kết quả trên Denise trước khi thử ghi tiếp. Không có cơ chế transaction/CAS từ schema được cung cấp; thay đổi upstream xảy ra sau lần đọc cuối vẫn phải do Denise kiểm soát quyền/trạng thái trong mutation.

Audit JSON lines ra stdout: `at`, `actorId`, `requestId`, `submissionId`, `action`, `result`, `code` nếu có. Có bản ghi bắt đầu và kết quả verified/blocked/uncertain; không log token, full name, mã LMS, lý do hay nội dung bài. Triển khai nội bộ cần đưa stdout vào hệ thống log có quyền truy cập và lưu giữ phù hợp. Không có database riêng.
