# MindX 360 V1 — Implementation Plan

> Tài liệu điều phối chính của dự án. Phải cập nhật sau mỗi đầu việc. Chỉ đánh dấu `[x]` khi code, test và bước kiểm tra của chính đầu việc đó đều đạt.

## 1. Trạng thái tiếp tục công việc

- Cập nhật lần cuối: 2026-10-08 (Asia/Bangkok)
- Giai đoạn hiện tại: Giai đoạn 1 — Khởi tạo project
- Đầu việc đang thực hiện: `INIT-03` — Khởi tạo package contracts tối thiểu
- Đã hoàn thành gần nhất: `INIT-02` — Thiết lập file nền tảng an toàn cho repository
- Phần còn thiếu/chặn: Chưa scaffold `contracts`, backend và frontend; chưa cài dependency
- Bước tiếp theo sau khi được người dùng xác nhận: `INIT-03` — Khởi tạo package contracts tối thiểu
- Trạng thái phiên: Đang thực hiện `INIT-03`; không được tự chuyển sang `INIT-04`

## 2. Phạm vi và nguyên tắc bất biến

- Frontend: React + TypeScript.
- Backend: Node.js + Express + TypeScript.
- Không có database riêng; backend là BFF stateless, lấy dữ liệu từ CRM/LMS.
- Production chỉ được đọc dữ liệu nghiệp vụ. Không gọi mutation hoặc API Create/Update/Delete/Send/Approve/Sync/Upload.
- Frontend chỉ gọi API của MindX 360, không gọi trực tiếp CRM/LMS và không giữ token CRM/LMS.
- Không hard-code token, cookie, PII hoặc dữ liệu học viên thật trong source, fixture, snapshot hay log.
- Không tự suy đoán operation, field, quan hệ ID, enum hoặc ý nghĩa nghiệp vụ.
- Chức năng chưa đủ thông tin API vẫn được phát triển bằng mock sau interface đã định nghĩa.
- Chỉ triển khai một đầu việc nhỏ tại một thời điểm. Hoàn thành, cập nhật tài liệu, báo kết quả và dừng chờ xác nhận.
- Chỉ điều chỉnh hoặc gộp các đầu việc quá nhỏ khi người dùng đồng ý rõ ràng; không tự gộp hoặc triển khai nhiều đầu việc.
- Không thêm chức năng ngoài đặc tả V1: không AI, dashboard/chart, Denise/TMS, sửa dữ liệu, recorder hoặc Payment Allocation chi tiết khi chưa đủ field.

## 3. Kiến trúc đã chốt

### 3.1. Quy tắc phụ thuộc

```text
React UI
   │ gọi HTTP contract của MindX 360
   ▼
Express routes/controllers
   ▼
Application/domain services
   ▼
Client interfaces
   ▼
Mock clients hoặc CRM/LMS GraphQL clients
```

- `controllers` chuyển HTTP request/response, không chứa business logic.
- `services` chứa use case, pagination, chuẩn hóa, liên kết dữ liệu và orchestration; không import Express.
- Backend `models` chứa mô hình nghiệp vụ thuần TypeScript, không phải ORM model.
- `clients` là ranh giới với CRM/LMS. Mỗi client có interface và implementation mock/GraphQL có thể thay thế khi test.
- `mappers` chỉ được tạo trong module khi cần kiểm tra/chuyển response bên ngoài thành model nội bộ.
- Frontend dùng `types` cho kiểu dữ liệu và `view-models` cho dữ liệu phục vụ hiển thị; không tạo `models` ở frontend.
- `packages/contracts` chỉ chứa DTO/error contract thực sự được chia sẻ giữa frontend và backend. Business model riêng của backend không đưa vào đây.
- Chia theo module nghiệp vụ `crm`, `lms`, `mindx360`; không chia project theo từng màn hình.
- Không dùng tên thư mục `ports` hoặc `adapters`.
- Không tạo trước thư mục rỗng. Chỉ thêm thư mục khi đầu việc hiện tại có file thực sự sử dụng nó.

### 3.2. Cấu trúc mục tiêu tối thiểu

Cấu trúc này là đích hướng tới, không phải danh sách phải tạo ngay:

```text
apps/
  api/src/
    modules/
      crm/{controllers,services,models,clients,routes,mappers?}
      lms/{controllers,services,models,clients,routes,mappers?}
      mindx360/{controllers,services,models,routes}
    shared/{errors,middleware,security,cache?}
    app.ts
    server.ts
  web/src/
    modules/
      crm/{components,services,types,view-models?}
      lms/{components,services,types,view-models?}
      mindx360/{components,hooks,services,types,view-models}
    shared/{components,services,utils}
    app/
packages/
  contracts/src/
docs/
```

Thư mục có dấu `?` chỉ được tạo khi phát sinh nhu cầu thật.

### 3.3. API nội bộ dự kiến

Các route là API của MindX 360, không phải tên API CRM/LMS:

```text
GET /api/v1/search?phone=...
GET /api/v1/crm/leads/:id
GET /api/v1/crm/leads/:id/order
GET /api/v1/crm/leads/:id/fulfillments
GET /api/v1/lms/students/:id
GET /api/v1/lms/students/:id/registrations
GET /api/v1/lms/students/:id/classes
GET /api/v1/links?sourceType=...&sourceId=...
```

Chỉ tạo route khi đến đúng đầu việc; danh sách có thể thu gọn nếu một route không còn cần thiết.

## 4. Quy trình kiểm tra API theo chức năng

Không khảo sát toàn bộ API trước khi code. Trước đầu việc tích hợp thật của từng chức năng:

1. Đối chiếu operation trong `MINDX_360_CURSOR_STARTER/reference/`.
2. Xác nhận operation là GraphQL `query` hoặc REST `GET` read-only.
3. Kiểm tra có đủ endpoint, operation name, query document hoàn chỉnh, variables, response shape và auth được phép hay chưa.
4. Chỉ triển khai client production khi các thông tin cần thiết đã đủ và nhất quán.
5. Nếu thiếu, giữ mock client và báo chính xác phần người dùng cần cung cấp.

Mẫu yêu cầu bổ sung:

```text
- Chức năng đang làm:
- Hệ thống/operation:
- Đã xác minh:
- Còn thiếu:
  - query document hoàn chỉnh / biến và kiểu biến
  - response mẫu đã ẩn danh / field lồng cần dùng
  - quy tắc nghiệp vụ hoặc enum
  - cơ chế auth/quyền truy cập được phép
  - một case read-only để đối chiếu ID
- Vì sao cần:
- Phần vẫn có thể tiếp tục bằng mock:
```

Backend không có generic GraphQL proxy. GraphQL client chỉ expose method read đã được allowlist. Test an toàn phải chứng minh document mutation bị từ chối.

## 5. Mô hình dữ liệu và liên kết

- Entity ID nội bộ có namespace, ví dụ `crm:lead:{id}` và `lms:student:{id}`, để không va chạm ID.
- Entity được cache một lần theo ID; Tree chỉ là projection, không nhân đôi dữ liệu nghiệp vụ.
- Trạng thái mỗi nguồn phân biệt `idle`, `loading`, `success`, `empty`, `forbidden`, `unavailable`, `error`, `partial`.
- CRM lỗi không được che dữ liệu LMS và ngược lại.
- Enum/status chưa hiểu được giữ nguyên giá trị gốc, không tự đổi sang nhãn nghiệp vụ.
- Raw JSON chỉ hiển thị dữ liệu đã allowlist/redact.

Mức tin cậy liên kết:

- `verified-id`: đã đối chiếu hai response trên case được phép; có thể tự động focus trong Tree.
- `code-mapped`: có căn cứ từ code/tài liệu nhưng chưa đối chiếu live; hiển thị `Cần đối chiếu`.
- `possible`: chỉ giống tên/SĐT/email; không tạo liên kết tự động.

Các phép bằng ID giữa CRM và LMS hiện chưa được mặc định là `verified-id`.

## 6. Chiến lược kiểm thử và Definition of Done

Công cụ dự kiến:

- Vitest cho unit test ở frontend/backend và coverage.
- React Testing Library + `user-event` cho component test.
- Supertest cho integration test Express.
- MSW cho HTTP/GraphQL mock ở ranh giới mạng.
- Playwright chỉ thêm ở giai đoạn hoàn thiện nếu các luồng chính cần browser smoke test; không thêm sớm.

Mỗi đầu việc chỉ được `[x]` khi:

1. Phạm vi nhỏ của đầu việc đã được triển khai đủ.
2. Test phù hợp đã được viết hoặc có kiểm tra cấu hình rõ ràng nếu chưa có executable code.
3. Tất cả test/check liên quan chạy thành công.
4. Không tạo mutation production, token/PII hoặc field suy đoán.
5. `Trạng thái tiếp tục công việc` trong file này đã được cập nhật.
6. Người dùng nhận được cách tự kiểm tra và agent dừng chờ xác nhận.

## 7. Kế hoạch triển khai theo đầu việc

### Giai đoạn 1 — Khởi tạo project

- [x] `INIT-01` Tạo `package.json` gốc ở chế độ private, khai báo npm workspaces cho `apps/*` và `packages/*`; kiểm tra JSON/workspace config đọc được.
- [x] `INIT-02` Tạo `.gitignore`, `.editorconfig`, `apps/api/.env` và `apps/api/.env.example`; kiểm tra `.env`/secret bị ignore, `.env.example` được phép commit và không có token thật.
- [ ] `INIT-03` Khởi tạo `packages/contracts` tối thiểu với TypeScript; thêm type export smoke test, chưa thêm DTO nghiệp vụ.
- [ ] `INIT-04` Khởi tạo `apps/api` với TypeScript/Vitest và một unit smoke test không phụ thuộc Express.
- [ ] `INIT-05` Thêm Express app factory và `GET /health`; integration test bằng Supertest, chưa tạo module CRM/LMS.
- [ ] `INIT-06` Khởi tạo `apps/web` với React + TypeScript và Vitest/jsdom; chưa xây màn hình nghiệp vụ.
- [ ] `INIT-07` Thêm App shell tối thiểu và component smoke test bằng React Testing Library.
- [ ] `INIT-08` Thêm root scripts chạy typecheck/test cho toàn workspace; xác nhận toàn bộ baseline chạy thành công.

### Giai đoạn 2 — Contract tìm kiếm và dữ liệu mock

- [ ] `MOCK-01` Định nghĩa shared contract cho source state, API error và search response; contract test/typecheck.
- [ ] `MOCK-02` Định nghĩa backend models cho CRM Lead summary và LMS Student summary; unit test factory/validation cần thiết.
- [ ] `MOCK-03` Tạo fixture ẩn danh `1 phụ huynh – 1 Student`; kiểm tra fixture theo contract.
- [ ] `MOCK-04` Tạo fixture `1 phụ huynh – nhiều Student, nhiều Lead`; kiểm tra không dùng giả định phần tử `[0]`.
- [ ] `MOCK-05` Tạo fixture Student thiếu liên kết CRM cùng biến thể ID không khớp; kiểm tra mức liên kết không bị nâng sai.
- [ ] `MOCK-06` Tạo interface CRM/LMS search client và mock implementation; unit test success/empty/error riêng từng nguồn.
- [ ] `MOCK-07` Cài `SearchByPhoneService` chạy hai nguồn độc lập; unit test success, partial, cả hai lỗi và dữ liệu thiếu.
- [ ] `MOCK-08` Tạo `GET /api/v1/search` bằng mock clients; integration test validation và response status.

### Giai đoạn 3 — Giao diện MindX 360 bằng mock

- [ ] `UI-01` Tạo API service gọi `/api/v1/search`; unit test mapping success/partial/error.
- [ ] `UI-02` Tạo SearchBar và validation hiển thị; component test nhập và submit.
- [ ] `UI-03` Hiển thị đồng thời summary `CRM (N Lead)` và `LMS (M Student)`; component test nhiều kết quả và một nguồn lỗi.
- [ ] `UI-04` Định nghĩa Tree types/view-models và hàm project search result thành root nodes; unit test ID namespace và cardinality.
- [ ] `UI-05` Tạo Tree/TreeNode với expand tách biệt selection; component test mở nhiều nhánh và giữ selection.
- [ ] `UI-06` Tạo vùng Detail và breadcrumb cho node mock; component test đổi node không đóng nhánh ngoài ý muốn.
- [ ] `UI-07` Tạo Related panel với nhãn confidence; component test `verified-id`, `code-mapped`, `possible`.
- [ ] `UI-08` Cài `Xem trong cây` cho `verified-id`; component test tự mở cha, focus và không tự nhảy với link yếu.
- [ ] `UI-09` Thêm loading/empty/forbidden/unavailable/error/partial states; component test phân biệt từng trạng thái.
- [ ] `UI-10` Thêm cache RAM theo entity ID, refresh node và reset khi đổi SĐT; unit/component test vòng đời cache.
- [ ] `UI-11` Thêm JSON viewer đã lọc; unit test redaction field nhạy cảm.
- [ ] `UI-12` Chạy acceptance flow mock cho ba fixture; tất cả test frontend/backend liên quan phải đạt.

### Giai đoạn 4 — Xác thực và bảo vệ Backend trước production

Giai đoạn này là security gate bắt buộc trước khi bật bất kỳ CRM/LMS production client nào. Các luồng mock không bị chặn bởi giai đoạn này.

- [ ] `SEC-01` Chốt mô hình truy cập vào BFF và phạm vi sử dụng outbound `MINDX_API_TOKEN` với cơ chế được công ty cho phép; ghi rõ phần còn thiếu, không suy đoán auth.
- [ ] `SEC-02` Cài server-only config/token provider đọc `MINDX_API_TOKEN`, fail fast khi thiếu ở production và redaction tuyệt đối; unit test missing token, token hợp lệ và không lộ token trong lỗi/log.
- [ ] `SEC-03` Cài middleware bảo vệ API MindX 360 theo mô hình đã được duyệt; integration test unauthenticated, forbidden và authorized, không gửi outbound token xuống frontend.
- [ ] `SEC-04` Thiết lập baseline trước production gồm CORS allowlist, security headers, body/request limits và log redaction; integration/security tests phải đạt trước khi bật CRM/LMS client thật.

### Giai đoạn 5 — Tích hợp CRM read-only theo chức năng

- [ ] `CRM-01` Kiểm tra tài liệu/auth riêng cho `Lead_getList`; nếu thiếu, ghi yêu cầu bổ sung và giữ mock.
- [ ] `CRM-02` Cài query-only CRM transport, allowlist và mutation guard; test query được phép/mutation bị chặn/token không vào log.
- [ ] `CRM-03` Cài `Lead_getList` với pagination; client test operation/variables, nhiều trang, empty, forbidden, timeout và malformed response.
- [ ] `CRM-04` Nối CRM search client thật vào search service qua cấu hình; integration test không gọi network thật.
- [ ] `CRM-05` Kiểm tra tài liệu và cài `Lead_getById`; mapper/unit test family member thiếu field và unknown status.
- [ ] `CRM-06` Tạo route/detail UI Lead bằng lazy loading; controller và component test.
- [ ] `CRM-07` Kiểm tra tài liệu và cài `Order_get`; test calculation, nhiều product items/payments và field thiếu.
- [ ] `CRM-08` Tạo route/detail UI Order/Product Item/Payment; test không gán một Payment cho một Product.
- [ ] `CRM-09` Kiểm tra tài liệu và cài `Fulfillment_find`; test nối bằng `productItemId`, status nguồn và missing enrollment.
- [ ] `CRM-10` Tạo route/detail UI Fulfillment; integration/component test.
- [ ] `CRM-11` Chỉ khi đủ document, tích hợp `Lead_getHistories`; nếu chưa đủ giữ mock/TODO có mô tả chính xác.
- [ ] `CRM-12` Chạy toàn bộ CRM acceptance tests; không triển khai allocation detail/confirmType diễn giải nếu chưa xác minh.

### Giai đoạn 6 — Tích hợp LMS read-only theo chức năng

- [ ] `LMS-01` Dựa trên hành vi UI đã được người dùng xác minh (một SĐT phụ huynh có thể trả nhiều Student), kiểm tra cách truyền `getStudents.search`, auth và query document ở API; nếu thiếu giữ mock và báo yêu cầu cụ thể.
- [ ] `LMS-02` Cài query-only LMS transport, allowlist và mutation guard; test an toàn tương tự CRM.
- [ ] `LMS-03` Cài `getStudents` với pagination; test nhiều Student chung SĐT, empty, forbidden, timeout và malformed response.
- [ ] `LMS-04` Nối LMS search client thật vào search service; integration test lỗi LMS không che CRM.
- [ ] `LMS-05` Kiểm tra tài liệu và cài `getStudent`/`findStudentById`; test phân biệt `_id`, `studentId`, `crmContactId`.
- [ ] `LMS-06` Tạo route/detail UI Student bằng lazy loading; controller và component test.
- [ ] `LMS-07` Kiểm tra tài liệu và cài `studentRegistrations`; test nhiều registration/slot, missing ID và enum chưa biết.
- [ ] `LMS-08` Tạo route/detail UI Registration/Slot; component test tách các loại status.
- [ ] `LMS-09` Kiểm tra tài liệu và cài `studentStudyClasses`/`GetClassById`; pagination và mapper tests.
- [ ] `LMS-10` Kiểm tra tài liệu và cài `FindClassStudent`; test `activeInClass` độc lập với Student/Registration status.
- [ ] `LMS-11` Tạo route/detail UI Class; integration/component test.
- [ ] `LMS-12` Chỉ khi response đủ, tích hợp enrollment activities; không suy diễn dropout/onhold/transfer/attendance.
- [ ] `LMS-13` Chạy toàn bộ LMS acceptance tests.

### Giai đoạn 7 — Liên kết CRM ↔ LMS

- [ ] `LINK-01` Định nghĩa backend link model, evidence và confidence; unit test quy tắc hạ mức khi thiếu bằng chứng.
- [ ] `LINK-02` Tạo registry mapping với trạng thái ban đầu từ tài liệu; không đánh dấu `verified-id` nếu chưa có case live.
- [ ] `LINK-03` Cài liên kết ngược từ `studentRegistrations.leadId`; unit test match, mismatch và duplicate lead.
- [ ] `LINK-04` Cài liên kết qua `fulfillmentId` chỉ sau khi khóa đối ứng được xác minh; nếu thiếu báo chính xác response cần có.
- [ ] `LINK-05` Kiểm chứng `crmContactId`/customer/family member trên case read-only được phép; lưu kết luận kỹ thuật không chứa PII.
- [ ] `LINK-06` Cài `ResolveCrossSystemLinksService`; unit test anh/chị/em chung SĐT, legacy, thiếu ID và trùng tên.
- [ ] `LINK-07` Tạo `/api/v1/links` hoặc nhúng links vào detail nếu đơn giản hơn; integration test.
- [ ] `LINK-08` Nối Related panel và focus hai chiều với dữ liệu tích hợp; component test.
- [ ] `LINK-09` Chạy acceptance tests liên kết và xác nhận không có auto-link dựa riêng trên tên/SĐT/email.

### Giai đoạn 8 — Hoàn thiện V1

- [ ] `HARD-01` Thêm timeout, abort và chuẩn hóa upstream error; unit/integration test.
- [ ] `HARD-02` Thêm cache RAM ngắn hạn nếu đo đạc cho thấy cần; test TTL/refresh, không cache token hoặc lỗi nhạy cảm.
- [ ] `HARD-03` Rà soát nâng cao auth/token sau khi có hành vi production được phép: expiry, rotation/revocation và audit redaction; bổ sung test cần thiết.
- [ ] `HARD-04` Rà soát hardening theo môi trường triển khai thực tế như reverse proxy, CSP và policy vận hành; không lặp lại baseline đã hoàn thành ở `SEC-04`.
- [ ] `HARD-05` Hoàn thiện responsive ba vùng/ba tab; component test hành vi quan trọng.
- [ ] `HARD-06` Thêm browser smoke tests tối thiểu nếu cần cho Search → Tree → Detail → Related.
- [ ] `HARD-07` Viết README chạy mock/local, cấu hình endpoint/auth và danh sách API còn thiếu.
- [ ] `HARD-08` Chạy full test/typecheck/build và kiểm tra source/network không có business mutation.
- [ ] `HARD-09` Nghiệm thu toàn bộ tiêu chí V1 với dữ liệu ẩn danh hoặc case read-only được phép.

## 8. Những phần API hiện biết là chưa đủ

Danh sách này là cảnh báo, không phải yêu cầu phải xử lý hết trước khi bắt đầu:

- GraphQL document hoàn chỉnh cho các operation cần tích hợp có thể chưa có vì capture bị cắt.
- Người dùng đã xác minh trên giao diện LMS rằng tìm bằng SĐT phụ huynh có thể trả về nhiều Student. Điều này xác nhận hành vi/cardinality của UI, nhưng cách truyền tham số `getStudents.search` qua API vẫn phải xác minh tại `LMS-01`.
- Chưa chốt cơ chế auth/token được phép cho ứng dụng mới.
- Chưa có permission codes/rules để diễn giải quyền xem.
- Các phép bằng ID CRM ↔ LMS chưa được kiểm chứng live.
- Allocation item fields, `confirmType` mapping và slot enum chưa đủ.
- Không có query transfer riêng; dropout/onhold còn thiếu field con; attendance chính và Receipt chưa rõ.
- `Order_get` đã xác minh theo `leadId`, nhưng chưa có API chứng minh danh sách nhiều Order cho một Lead.

Chỉ xử lý từng điểm khi đầu việc chức năng tương ứng bắt đầu.

## 9. Nhật ký hoàn thành

### 2026-10-08 — `INIT-01`

- Đã tạo root `package.json` với `private: true`.
- Đã khai báo đúng hai workspace pattern: `apps/*` và `packages/*`.
- Kiểm tra bằng Node assertion: đạt.
- Kiểm tra npm đọc manifest bằng `npm pkg get name version private workspaces --json`: đạt.
- Không cài dependency, không tạo frontend/backend và không gọi API bên ngoài.

### 2026-10-08 — `INIT-02`

- Đã tạo `.gitignore` cho dependencies, build/test output, local environment, secret files, logs và editor/OS artifacts.
- Đã tạo `.editorconfig` dùng UTF-8, LF, final newline, space và indent 2; Markdown được giữ trailing whitespace khi cần.
- Đã tạo `apps/api/.env` với `MINDX_API_TOKEN=` để người dùng tự điền và `apps/api/.env.example` với placeholder không nhạy cảm.
- Đã ghi rõ token dùng chung cho CRM/LMS/TMS/Denise; V1 chỉ dùng cho truy vấn read-only CRM/LMS.
- Kiểm tra Git bằng repository tạm: `apps/api/.env` bị ignore, `apps/api/.env.example` vẫn trackable — đạt.
- Kiểm tra nội dung bằng Node assertion: biến môi trường đúng tên, `.env` chưa có giá trị token và EditorConfig hợp lệ — đạt.
- Chưa triển khai logic đọc token, auth, API client, frontend/backend scaffold hoặc `INIT-03`.
