# MindX 360 V1 — Implementation Plan

> Tài liệu điều phối chính của dự án. Phải cập nhật sau mỗi đầu việc. Chỉ đánh dấu `[x]` khi code, test và bước kiểm tra của chính đầu việc đó đều đạt.

## 1. Trạng thái tiếp tục công việc

- Cập nhật lần cuối: 2026-10-12 (Asia/Bangkok)

- Giai đoạn hiện tại: Giai đoạn 2 — Contract tìm kiếm và dữ liệu mock (đã hoàn thành)

- Đầu việc đang thực hiện: Không có — đang chờ người dùng nghiệm thu Giai đoạn 2

- Đã hoàn thành gần nhất: `MOCK-08` — `GET /api/v1/search` dùng mock clients

- Phần còn thiếu/chặn: Chưa có Frontend search flow hoặc tích hợp API production; quy tắc chuẩn hóa SĐT và cách truyền `getStudents.search` vẫn cần xác minh ở đầu việc tương ứng

- Bước tiếp theo sau khi được người dùng xác nhận: `UI-01` — Frontend API service gọi `/api/v1/search`

- Trạng thái phiên: toàn bộ `MOCK-01` → `MOCK-08` đã typecheck, build, test và runtime check thành công; bắt buộc dừng chờ nghiệm thu, không tự chuyển sang Giai đoạn 3

## 2. Phạm vi và nguyên tắc bất biến

- Frontend: React + TypeScript.

- Backend: Node.js + Express + TypeScript.

- Không có database riêng; backend là BFF stateless, lấy dữ liệu từ CRM/LMS.

- Production chỉ được đọc dữ liệu nghiệp vụ. Không gọi mutation hoặc API Create/Update/Delete/Send/Approve/Sync/Upload.

- Frontend chỉ gọi API của MindX 360, không gọi trực tiếp CRM/LMS và không giữ token CRM/LMS.

- Không hard-code token, cookie, PII hoặc dữ liệu học viên thật trong source, fixture, snapshot hay log.

- Không tự suy đoán operation, field, quan hệ ID, enum hoặc ý nghĩa nghiệp vụ.

- Chức năng chưa đủ thông tin API vẫn được phát triển bằng mock sau interface đã định nghĩa.

- Triển khai từng đầu việc nhỏ theo thứ tự; chỉ được làm liên tiếp một nhóm khi người dùng đã duyệt rõ phạm vi nhóm. Cập nhật checklist/test và nhật ký sau **mỗi đầu việc**, dừng ở cổng nghiệm thu của nhóm/giai đoạn.

- Chỉ gộp hoặc đổi nội dung đầu việc khi người dùng đồng ý; tự triển khai nhiều bước trong một nhóm đã được duyệt **không đồng nghĩa** được bỏ bước, đổi API hay tự chuyển sang giai đoạn khác.

- Từ sau `INIT-08`, mọi thay đổi giao diện hoặc chức năng tương tác trên web phải kèm địa chỉ và hướng dẫn để người dùng kiểm tra trực tiếp bằng trình duyệt trước khi nghiệm thu.

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

1\. Đối chiếu operation trong `MINDX_360_CURSOR_STARTER/reference/`.

2\. Xác nhận operation là GraphQL `query` hoặc REST `GET` read-only.

3\. Kiểm tra có đủ endpoint, operation name, query document hoàn chỉnh, variables, response shape và auth được phép hay chưa.

4\. Chỉ triển khai client production khi các thông tin cần thiết đã đủ và nhất quán.

5\. Nếu thiếu, giữ mock client và báo chính xác phần người dùng cần cung cấp.

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

### 4.1. Quy tắc dừng bắt buộc khi tích hợp API thật

- Khi một chức năng cần CRM/LMS production API nhưng thiếu API, GraphQL document, variables, response mẫu đã ẩn danh, field hoặc quan hệ dữ liệu, phải báo chính xác từng thông tin còn thiếu để người dùng tìm và bổ sung.

- Không tự suy đoán operation, endpoint, variable, field, response shape, enum hoặc quan hệ; không tự tạo API/field thay thế.

- Dừng phần tích hợp đang thiếu thông tin và chờ người dùng cung cấp. Có thể tiếp tục phần độc lập khác chỉ khi đó là đầu việc đã được người dùng cho phép.

- Không âm thầm dùng mock thay cho API thật rồi đánh dấu đầu việc tích hợp production hoàn thành.

- Chỉ dùng mock khi đầu việc hiện tại cho phép rõ ràng; trạng thái checklist phải thể hiện đó là mock, không phải production integration.

- Chỉ gọi API đọc dữ liệu. Không thực hiện GraphQL mutation hoặc REST Create/Update/Delete/Send/Approve/Sync/Upload lên production.

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

1\. Phạm vi nhỏ của đầu việc đã được triển khai đủ.

2\. Test phù hợp đã được viết hoặc có kiểm tra cấu hình rõ ràng nếu chưa có executable code.

3\. Tất cả test/check liên quan chạy thành công.

4\. Không tạo mutation production, token/PII hoặc field suy đoán.

5\. `Trạng thái tiếp tục công việc` trong file này đã được cập nhật.

6\. Người dùng nhận được cách tự kiểm tra và agent dừng chờ xác nhận.

7\. Nếu đầu việc thay đổi giao diện hoặc luồng tương tác web, phải chạy browser/runtime check phù hợp và hướng dẫn người dùng kiểm tra trực tiếp trước khi nghiệm thu.

## 7. Kế hoạch triển khai theo đầu việc

### Giai đoạn 1 — Khởi tạo project

- [x] `INIT-01` Tạo `package.json` gốc ở chế độ private, khai báo npm workspaces cho `apps/*` và `packages/*`; kiểm tra JSON/workspace config đọc được.

- [x] `INIT-02` Tạo `.gitignore`, `.editorconfig`, `apps/api/.env` và `apps/api/.env.example`; kiểm tra `.env`/secret bị ignore, `.env.example` được phép commit và không có token thật.

- [x] `INIT-03` Khởi tạo `packages/contracts` tối thiểu với TypeScript strict và package exports; typecheck/build/export smoke test đạt, chưa thêm DTO nghiệp vụ.

- [x] `INIT-04` Khởi tạo `apps/api` với Node.js, TypeScript strict, Vitest và một unit smoke test không phụ thuộc Express; typecheck/build/test đạt.

- [x] `INIT-05` Thêm Express app factory, server entry và `GET /health`; unit/integration tests bằng Vitest/Supertest đạt, chưa tạo module CRM/LMS.

- [x] `INIT-06` Khởi tạo `apps/web` với Vite, React, TypeScript strict và Vitest/jsdom; typecheck/build/environment smoke test đạt, chưa xây App shell hoặc màn hình nghiệp vụ.

- [x] `INIT-07` Thêm App shell responsive với ba vùng Tree/Detail/Related và component smoke test bằng React Testing Library + user-event; typecheck/build/test/runtime check đạt.

- [x] `INIT-08` Thêm root scripts để từ thư mục gốc chạy được `npm run dev` (đồng thời frontend/backend), `npm test`, `npm run build` và `npm run typecheck` mà không cần `--workspace`; toàn bộ baseline và SIGINT teardown đạt.

### Giai đoạn 2 — Contract tìm kiếm và dữ liệu mock

- [x] `MOCK-01` Định nghĩa shared contract cho source state, API error và search response; contract test/typecheck.

- [x] `MOCK-02` Định nghĩa backend models cho CRM Lead summary và LMS Student summary; unit test factory/validation cần thiết.

- [x] `MOCK-03` Tạo fixture ẩn danh `1 phụ huynh – 1 Student`; kiểm tra fixture theo contract.

- [x] `MOCK-04` Tạo fixture `1 phụ huynh – nhiều Student, nhiều Lead`; kiểm tra không dùng giả định phần tử `[0]`.

- [x] `MOCK-05` Tạo fixture Student thiếu liên kết CRM cùng biến thể ID không khớp; kiểm tra mức liên kết không bị nâng sai.

- [x] `MOCK-06` Tạo interface CRM/LMS search client và mock implementation; unit test success/empty/error riêng từng nguồn.

- [x] `MOCK-07` Cài `SearchByPhoneService` chạy hai nguồn độc lập; unit test success, partial, cả hai lỗi và dữ liệu thiếu.

- [x] `MOCK-08` Tạo `GET /api/v1/search` bằng mock clients; integration test validation và response status.

### Giai đoạn 3 — Demo mock cơ bản: Search → Tree → Detail

Mục tiêu: có một giao diện web có thể nhập SĐT mock, thấy đồng thời nhiều Lead/Student, mở các nhánh và xem chi tiết cơ bản. **Demo A** ngay sau khi nghiệm thu giai đoạn này; chưa có dữ liệu CRM/LMS thật, chưa tự liên kết hai hệ thống.

- [ ] `UI-01` Tạo API service gọi `/api/v1/search`; unit test mapping success/partial/error.
- [ ] `UI-02` Tạo SearchBar và validation hiển thị; component test nhập và submit.
- [ ] `UI-03` Hiển thị đồng thời summary `CRM (N Lead)` và `LMS (M Student)`; component test nhiều kết quả và một nguồn lỗi.
- [ ] `UI-04` Định nghĩa Tree types/view-models và hàm project search result thành root nodes; unit test ID namespace và cardinality.
- [ ] `UI-05` Tạo Tree/TreeNode với expand tách biệt selection; component test mở nhiều nhánh và giữ selection.
- [ ] `UI-06` Tạo vùng Detail và breadcrumb cho node mock; component test đổi node không đóng nhánh ngoài ý muốn.
- [ ] `UI-09` Thêm loading/empty/forbidden/unavailable/error/partial states; component test phân biệt từng trạng thái.

**Cổng nghiệm thu:** mở web, thử 3 SĐT mock của Giai đoạn 2, trường hợp nhiều Lead/Student và lỗi từng nguồn; Tree mở/thu gọn độc lập với selection, Detail chuyển node đúng. Ghi rõ đây là **demo mock**, không phải API thật.

### Giai đoạn 4 — Hoàn thiện trải nghiệm mock và kiểm tra luồng

Mục tiêu: hoàn thành Related panel với mức tin cậy rõ ràng, điều hướng trong cây bằng các quan hệ **mock có bằng chứng giả lập được gắn nhãn**, cache/refresh, raw JSON đã lọc và kiểm thử xuyên suốt. **Demo A+** thể hiện đầy đủ cấu trúc giao diện; không được nâng quan hệ dựa vào cùng SĐT/tên thành `verified-id`.

- [ ] `UI-07` Tạo Related panel với nhãn confidence; component test `verified-id`, `code-mapped`, `possible`.
- [ ] `UI-08` Cài `Xem trong cây` cho `verified-id`; component test tự mở cha, focus và không tự nhảy với link yếu.
- [ ] `UI-10` Thêm cache RAM theo entity ID, refresh node và reset khi đổi SĐT; unit/component test vòng đời cache.
- [ ] `UI-11` Thêm JSON viewer đã lọc; unit test redaction field nhạy cảm.
- [ ] `UI-12` Chạy acceptance flow mock cho ba fixture; tất cả test frontend/backend liên quan phải đạt.

**Cổng nghiệm thu:** kiểm tra Related panel, hành vi tự focus chỉ với link có mức tin cậy phù hợp, đổi SĐT reset cache và dữ liệu nhạy cảm bị lọc. Tất cả dữ liệu và bằng chứng ở bước này đều là mock.

### Giai đoạn 5 — Security gate bắt buộc trước dữ liệu thật

Mục tiêu: chốt mô hình truy cập được phép và bảo vệ BFF trước khi bật bất cứ production CRM/LMS client nào. **Không được vượt gate này chỉ để demo nhanh.** Nếu chưa có phê duyệt cho auth/token hoặc quyền xem, dừng tại đây và vẫn có thể demo mock.

- [ ] `SEC-01` Chốt mô hình truy cập vào BFF và phạm vi sử dụng outbound `MINDX_API_TOKEN` với cơ chế được công ty cho phép; ghi rõ phần còn thiếu, không suy đoán auth.
- [ ] `SEC-02` Cài server-only config/token provider đọc `MINDX_API_TOKEN`, fail fast khi thiếu ở production và redaction tuyệt đối; unit test missing token, token hợp lệ và không lộ token trong lỗi/log.
- [ ] `SEC-03` Cài middleware bảo vệ API MindX 360 theo mô hình đã được duyệt; integration test unauthenticated, forbidden và authorized, không gửi outbound token xuống frontend.
- [ ] `SEC-04` Thiết lập baseline trước production gồm CORS allowlist, security headers, body/request limits và log redaction; integration/security tests phải đạt trước khi bật CRM/LMS client thật.

**Cổng nghiệm thu:** tất cả kiểm thử bảo mật đạt; không lộ token/PII trên FE, network hoặc log; đảm bảo chỉ người dùng được phép mới truy cập được dữ liệu thật.

### Giai đoạn 6 — Demo tra cứu thật từ cả CRM và LMS

Mục tiêu: thay lần lượt mock search clients bằng query-only clients được phê duyệt cho **cả hai nguồn**, giữ nguyên endpoint `/api/v1/search`, pagination và trạng thái lỗi độc lập. Bổ sung timeout/abort trước khi cho gọi production. **Demo B:** nhập một SĐT trong phạm vi được phép và hiển thị song song các Lead/Student thật; chưa tuyên bố đã nối đúng Lead với Student.

- [ ] `HARD-01` Thêm timeout, abort và chuẩn hóa upstream error; unit/integration test.
- [ ] `CRM-01` Kiểm tra tài liệu/auth riêng cho `Lead_getList`; nếu thiếu, ghi yêu cầu bổ sung và giữ mock.
- [ ] `CRM-02` Cài query-only CRM transport, allowlist và mutation guard; test query được phép/mutation bị chặn/token không vào log.
- [ ] `CRM-03` Cài `Lead_getList` với pagination; client test operation/variables, nhiều trang, empty, forbidden, timeout và malformed response.
- [ ] `CRM-04` Nối CRM search client thật vào search service qua cấu hình; integration test không gọi network thật.
- [ ] `LMS-01` Dựa trên hành vi UI đã được người dùng xác minh (một SĐT phụ huynh có thể trả nhiều Student), kiểm tra cách truyền `getStudents.search`, auth và query document ở API; nếu thiếu giữ mock và báo yêu cầu cụ thể.
- [ ] `LMS-02` Cài query-only LMS transport, allowlist và mutation guard; test an toàn tương tự CRM.
- [ ] `LMS-03` Cài `getStudents` với pagination; test nhiều Student chung SĐT, empty, forbidden, timeout và malformed response.
- [ ] `LMS-04` Nối LMS search client thật vào search service; integration test lỗi LMS không che CRM.

**Cổng nghiệm thu:** kiểm tra read-only query allowlist, timeout, phân trang, 0/nhiều kết quả và một nguồn lỗi mà nguồn kia vẫn hiển thị; thử dữ liệu thật chỉ khi có quyền, tránh đưa PII vào ảnh/bản demo công khai.

### Giai đoạn 7 — Demo chi tiết Lead/Order và Student/Enrollment/Class

Mục tiêu: từ kết quả tìm kiếm thật, click để xem thông tin CRM Lead → Order/Product/Payment cơ bản và LMS Student → Registration/Enrollment → Course/Class (gồm trạng thái activeInClass khi API đủ). Giữ lazy loading và không suy đoán payment allocation hay enum. **Demo C:** thấy được các chi tiết quan trọng trên cùng một giao diện, dù chưa có liên kết tự động giữa hai hệ thống.

- [ ] `CRM-05` Kiểm tra tài liệu và cài `Lead_getById`; mapper/unit test family member thiếu field và unknown status.
- [ ] `CRM-06` Tạo route/detail UI Lead bằng lazy loading; controller và component test.
- [ ] `CRM-07` Kiểm tra tài liệu và cài `Order_get`; test calculation, nhiều product items/payments và field thiếu.
- [ ] `CRM-08` Tạo route/detail UI Order/Product Item/Payment; test không gán một Payment cho một Product.
- [ ] `LMS-05` Kiểm tra tài liệu và cài `getStudent`/`findStudentById`; test phân biệt `_id`, `studentId`, `crmContactId`.
- [ ] `LMS-06` Tạo route/detail UI Student bằng lazy loading; controller và component test.
- [ ] `LMS-07` Kiểm tra tài liệu và cài `studentRegistrations`; test nhiều registration/slot, missing ID và enum chưa biết.
- [ ] `LMS-08` Tạo route/detail UI Registration/Slot; component test tách các loại status.
- [ ] `LMS-09` Kiểm tra tài liệu và cài `studentStudyClasses`/`GetClassById`; pagination và mapper tests.
- [ ] `LMS-10` Kiểm tra tài liệu và cài `FindClassStudent`; test `activeInClass` độc lập với Student/Registration status.
- [ ] `LMS-11` Tạo route/detail UI Class; integration/component test.

**Cổng nghiệm thu:** drill-down CRM và LMS hoạt động với nhiều hồ sơ; API query, field và ID đã được đối chiếu; khác biệt `lmsStudentId`/`studentCode`, trạng thái enrollment/activeInClass hiển thị đúng; nếu thiếu API cụ thể, báo blocker và không giả trạng thái hoàn thành.

### Giai đoạn 8 — CRM ↔ LMS: liên kết có bằng chứng, demo trọng tâm cho sếp

Mục tiêu: định nghĩa evidence/confidence, kiểm chứng các ID phù hợp, giải quyết liên kết qua `studentRegistrations.leadId` và các quan hệ Customer/family member **nếu đã xác minh**, rồi tích hợp Related panel và chức năng "Xem trong cây" hai chiều. **Demo D — mốc có thể gửi sếp dùng thử:** từ Lead/Order hoặc Student xem được thực thể liên quan trên hệ thống kia mà không rời MindX 360. Liên kết `fulfillmentId` được để riêng ở Giai đoạn 9 vì phụ thuộc Fulfillment thật.

- [ ] `LINK-01` Định nghĩa backend link model, evidence và confidence; unit test quy tắc hạ mức khi thiếu bằng chứng.
- [ ] `LINK-02` Tạo registry mapping với trạng thái ban đầu từ tài liệu; không đánh dấu `verified-id` nếu chưa có case live.
- [ ] `LINK-03` Cài liên kết ngược từ `studentRegistrations.leadId`; unit test match, mismatch và duplicate lead.
- [ ] `LINK-05` Kiểm chứng `crmContactId`/customer/family member trên case read-only được phép; lưu kết luận kỹ thuật không chứa PII.
- [ ] `LINK-06` Cài `ResolveCrossSystemLinksService`; unit test anh/chị/em chung SĐT, legacy, thiếu ID và trùng tên.
- [ ] `LINK-07` Tạo `/api/v1/links` hoặc nhúng links vào detail nếu đơn giản hơn; integration test.
- [ ] `LINK-08` Nối Related panel và focus hai chiều với dữ liệu tích hợp; component test.

**Cổng nghiệm thu:** ít nhất một quan hệ CRM ↔ LMS đã được đối chiếu bằng ID trên case read-only được phép để demo liên kết thật. Nếu chưa có bằng chứng, chỉ hiển thị `code-mapped`/`possible` và tiếp tục demo tổng hợp; không tự nhận đã đạt Demo D.

### Giai đoạn 9 — Mở rộng tra cứu chuyên sâu và hoàn tất acceptance nghiệp vụ

Mục tiêu: bổ sung CRM Fulfillment/Slot và liên kết `fulfillmentId` khi khóa đối ứng đã xác thực, kiểm tra histories/enrollment activities nếu response đủ, hoàn tất CRM/LMS/link acceptance. Không vì thiếu API phụ mà làm mất tính năng demo cốt lõi đã chạy ổn định.

- [ ] `CRM-09` Kiểm tra tài liệu và cài `Fulfillment_find`; test nối bằng `productItemId`, status nguồn và missing enrollment.
- [ ] `CRM-10` Tạo route/detail UI Fulfillment; integration/component test.
- [ ] `CRM-11` Chỉ khi đủ document, tích hợp `Lead_getHistories`; nếu chưa đủ giữ mock/TODO có mô tả chính xác.
- [ ] `CRM-12` Chạy toàn bộ CRM acceptance tests; không triển khai allocation detail/confirmType diễn giải nếu chưa xác minh.
- [ ] `LMS-12` Chỉ khi response đủ, tích hợp enrollment activities; không suy diễn dropout/onhold/transfer/attendance.
- [ ] `LMS-13` Chạy toàn bộ LMS acceptance tests.
- [ ] `LINK-04` Cài liên kết qua `fulfillmentId` chỉ sau khi khóa đối ứng được xác minh; nếu thiếu báo chính xác response cần có.
- [ ] `LINK-09` Chạy acceptance tests liên kết và xác nhận không có auto-link dựa riêng trên tên/SĐT/email.

**Cổng nghiệm thu:** các luồng được triển khai có đủ integration/component tests. Nếu `Lead_getHistories`, enrollment activities hoặc `fulfillmentId` chưa đủ tài liệu, ghi rõ blocker/TODO, không tự điền giá trị hoặc tick hoàn thành giả; giữ nguyên các demo trước.

### Giai đoạn 10 — Hardening, tài liệu vận hành và nghiệm thu V1

Mục tiêu: chỉ tối ưu cache khi có số liệu, rà soát auth, hạ tầng, responsive, smoke tests, README và kiểm thử an toàn toàn bộ. **Bản V1 hoàn thiện** khi các hạng mục bắt buộc đã được nghiệm thu; các phần thiếu API phải được ghi rõ là giới hạn, không che giấu bằng mock.

- [ ] `HARD-02` Thêm cache RAM ngắn hạn nếu đo đạc cho thấy cần; test TTL/refresh, không cache token hoặc lỗi nhạy cảm.
- [ ] `HARD-03` Rà soát nâng cao auth/token sau khi có hành vi production được phép: expiry, rotation/revocation và audit redaction; bổ sung test cần thiết.
- [ ] `HARD-04` Rà soát hardening theo môi trường triển khai thực tế như reverse proxy, CSP và policy vận hành; không lặp lại baseline đã hoàn thành ở `SEC-04`.
- [ ] `HARD-05` Hoàn thiện responsive ba vùng/ba tab; component test hành vi quan trọng.
- [ ] `HARD-06` Thêm browser smoke tests tối thiểu nếu cần cho Search → Tree → Detail → Related.
- [ ] `HARD-07` Viết README chạy mock/local, cấu hình endpoint/auth và danh sách API còn thiếu.
- [ ] `HARD-08` Chạy full test/typecheck/build và kiểm tra source/network không có business mutation.
- [ ] `HARD-09` Nghiệm thu toàn bộ tiêu chí V1 với dữ liệu ẩn danh hoặc case read-only được phép.

**Cổng nghiệm thu:** full typecheck/build/test, xác minh không có business mutation, dữ liệu nhạy cảm được kiểm soát, responsive đủ dùng và README nêu rõ tính năng thật/mock/TODO.

### Các mốc demo và quy tắc triển khai theo giai đoạn

| Mốc | Sau giai đoạn | Có thể trình bày | Chưa được tuyên bố |
|---|---|---|---|
| Demo A | 3 | Nhập SĐT mock, nhiều Lead/Student, Tree và Detail | Dữ liệu CRM/LMS thật |
| Demo A+ | 4 | Related/Focus trên dữ liệu mock, trạng thái và các tương tác | Liên kết ID production đã xác minh |
| Demo B | 6 | Tra cứu CRM và LMS thật song song, có quyền truy cập | CRM ↔ LMS đã ghép đúng thực thể |
| Demo C | 7 | Xem chi tiết Lead/Order, Student/Enrollment/Class thật | Tất cả quan hệ cross-system đã xác minh |
| Demo D | 8 | Điều hướng CRM ↔ LMS dựa trên ID đã kiểm chứng — **mốc chính để demo sếp** | Fulfillment/Slot chuyên sâu hay toàn bộ V1 đã xong |
| V1 | 10 | Bản ổn định, tests và tài liệu đầy đủ | Các API chưa xác minh đã được tích hợp |

**Nguyên tắc nghiệm thu:** Mỗi giai đoạn có một kết quả chạy được và kiểm tra được; được phép demo sớm ngay khi đạt mốc, không phải chờ hết plan. Trong phạm vi một nhóm đầu việc đã được người dùng duyệt rõ ràng, agent có thể làm tuần tự, tự kiểm tra và cập nhật checklist sau mỗi đầu việc, nhưng phải dừng ở cuối nhóm/giai đoạn chờ nghiệm thu. Không tự kéo tiếp sang giai đoạn sau, không thay đổi scope hoặc bỏ qua blockers. Chỉ tick `[x]` nếu code/test/check của đầu việc thực sự đạt.

**Ghi chú phạm vi:** Lộ trình này **không cắt chức năng** của bản plan ngày 2026-10-12; chỉ sắp lại thứ tự và cổng demo. Các hạng mục phụ thuộc dữ liệu chưa đủ được giữ nguyên và dừng theo quy tắc Mục 4.1. Trước mỗi demo có dữ liệu thật phải xác nhận quyền truy cập/đối tượng nhận demo và tránh lộ PII.

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

### 2026-10-08 — `INIT-03`

- Đã tạo npm workspace package `@mindx-360/contracts` với public entry point tại `src/index.ts`.

- Đã cấu hình TypeScript strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, declaration output và ESM `NodeNext`.

- Đã cấu hình `main`, `types` và `exports` trỏ tới build output để frontend/backend có thể import chung qua package root.

- Đã cài TypeScript cục bộ cho workspace; root `package-lock.json` được tạo/cập nhật bởi npm.

- `npm test --workspace @mindx-360/contracts`: typecheck đạt, build đạt, package exports smoke test đạt (`1/1`).

- `npm install` audit: không phát hiện vulnerability.

- Entry point hiện cố ý rỗng; chưa thêm DTO CRM/LMS, backend, frontend hoặc `INIT-04`.

- Kế hoạch đã được điều chỉnh: security gate được đưa lên trước production integrations; ghi nhận UI LMS có thể trả nhiều Student theo SĐT nhưng tham số API vẫn chờ `LMS-01`; việc gộp đầu việc cần người dùng đồng ý trước.

### 2026-10-08 — `INIT-04`

- Đã tạo workspace `@mindx-360/api` với scripts `dev`, `build`, `typecheck` và `test`.

- Đã cấu hình TypeScript strict cho source/test và cấu hình build riêng chỉ emit `src` thành ESM declaration output.

- Đã cấu hình Vitest chạy trong môi trường Node và thêm một unit smoke test TypeScript tối thiểu.

- Đã liên kết dependency `@mindx-360/contracts@0.0.0` từ npm workspace nội bộ; chưa import DTO vì package contracts chưa có DTO nghiệp vụ.

- Đã cài dev dependencies tối thiểu: TypeScript, Vitest, `tsx` và Node.js type definitions; npm audit không phát hiện vulnerability.

- `npm run typecheck --workspace @mindx-360/api`: đạt.

- `npm run build --workspace @mindx-360/api`: đạt.

- `npm test --workspace @mindx-360/api`: đạt (`1` test file, `1/1` test).

- Đã giữ nguyên `apps/api/.env`; chưa đọc token, cài Express, tạo route/module nghiệp vụ hoặc kết nối hệ thống ngoài.

### 2026-10-08 — `INIT-05`

- Đã cài Express cho runtime và Supertest cùng type definitions cho integration test; npm audit không phát hiện vulnerability.

- Đã tạo `app.ts` với `createApp()` và `server.ts` để tách app khỏi network listener, giúp kiểm thử không cần mở cổng thật.

- Đã thêm `GET /health`, trả HTTP `200`, JSON content type và body `{ "status": "ok" }`.

- Health endpoint là kiểm tra vận hành tại lớp framework, không chứa business logic và chưa tạo module/controller nghiệp vụ.

- Đã cập nhật scripts: `dev` chạy `src/server.ts`, `start` chạy build output; giữ nguyên `build`, `typecheck`, `test`.

- `npm run typecheck --workspace @mindx-360/api`: đạt.

- `npm run build --workspace @mindx-360/api`: đạt.

- `npm test --workspace @mindx-360/api`: đạt (`2` test files, `2/2` tests gồm unit smoke và health integration).

- Kiểm tra source không tham chiếu `MINDX_API_TOKEN`, CRM hoặc LMS: đạt; không đọc `.env` và không gọi API bên ngoài.

- Đã bổ sung Mục 4.1: thiếu thông tin API thật phải báo chính xác và dừng; không suy đoán, không âm thầm thay bằng mock, chỉ dùng query/read-only.

- Chưa triển khai `INIT-06`.

### 2026-10-08 — `INIT-06`

- Đã tạo workspace `@mindx-360/web` với Vite, React và TypeScript strict; scripts gồm `dev`, `build`, `typecheck`, `test`.

- Đã tạo browser bootstrap tối thiểu tại `src/main.tsx` và `index.html`; chưa tạo `App` component, UI shell hoặc màn hình nghiệp vụ.

- Đã cấu hình Vite React plugin và Vitest với môi trường jsdom; environment smoke test xác nhận DOM hoạt động.

- Đã liên kết `@mindx-360/contracts@0.0.0` từ npm workspace; chưa tạo/import DTO nghiệp vụ.

- Đã cố định jsdom `26.1.0` ở workspace root để Vitest 4 tương thích Node.js `22.11.0`; dependency tree cuối dùng Vitest `4.1.11` và audit không phát hiện vulnerability.

- `npm run typecheck --workspace @mindx-360/web`: đạt.

- `npm run build --workspace @mindx-360/web`: đạt (Vite production build).

- `npm test --workspace @mindx-360/web`: đạt (`1` test file, `1/1` jsdom environment test).

- Đã cập nhật `INIT-08`: root phải chạy được `npm run dev` cho đồng thời FE/BE cùng `npm test`, `npm run build`, `npm run typecheck` mà không cần `--workspace`.

- Chưa tạo module CRM/LMS/MindX360, API service, kết nối Backend hoặc `INIT-07`.

### 2026-10-08 — `INIT-07`

- Đã cài React Testing Library, `user-event` và jest-dom; npm audit không phát hiện vulnerability.

- Đã tạo `App` trong lớp `src/app`, giữ riêng khỏi các module nghiệp vụ sẽ được thêm sau.

- App Shell có header MindX 360, nhãn V1 read-only và ba region placeholder: `Cây dữ liệu`, `Chi tiết`, `Liên kết`.

- Đã viết CSS code-native, không dùng UI library; desktop hiển thị ba cột, màn hình trung bình chuyển Related xuống dưới và màn hình nhỏ xếp một cột.

- Đã thêm skip link và semantic region labels để hỗ trợ bàn phím/screen reader.

- Đã cấu hình test setup với jest-dom/cleanup và component test dùng React Testing Library + `user-event` để kiểm tra title, read-only status, ba region và keyboard focus.

- `npm run typecheck --workspace @mindx-360/web`: đạt.

- `npm run build --workspace @mindx-360/web`: đạt.

- `npm test --workspace @mindx-360/web`: đạt (`2` test files, `2/2` tests gồm environment và component test).

- Vite dev runtime check tại `http://127.0.0.1:5173/`: trang và transformed React entry đều trả HTTP `200`; tiến trình kiểm tra đã được tắt sau khi xác nhận.

- Chưa tạo SearchBar, Tree logic, API service, mock nghiệp vụ, CRM/LMS module hoặc `INIT-08`.

### 2026-10-08 — `INIT-08`

- Đã thêm root scripts `dev`, `build`, `typecheck`, `test`; người dùng không cần truyền `--workspace` khi đứng tại repository root.

- `dev` build contracts trước, sau đó dùng concurrently chạy API và Web song song với prefix riêng, kill-others và SIGINT teardown.

- `build` chạy tuần tự contracts → API → Web để bảo đảm shared package có output trước consumer.

- `typecheck` kiểm tra/build contracts trước khi kiểm tra API và Web.

- `test` chạy tuần tự toàn bộ contracts, API và Web test suites.

- Đã ghim concurrently `9.2.1` để tương thích Node.js `22.11.0` và override `shell-quote` `1.11.0` để dùng bản đã vá; npm audit cuối: `0 vulnerabilities`.

- Root `npm run typecheck`: đạt cho cả ba workspaces.

- Root `npm run build`: đạt cho contracts, Backend và Vite Frontend.

- Root `npm test`: đạt tổng cộng `5/5` tests (`1` contracts, `2` API, `2` Web).

- Root `npm run dev`: Frontend `http://localhost:5173/` trả HTTP `200`; Backend `http://localhost:3000/health` trả HTTP `200` với `{ "status": "ok" }`.

- Đã kiểm tra concurrently gửi SIGINT cho cả hai child processes và giải phóng cổng `3000`/`5173`; người dùng có thể dừng root dev bằng `Ctrl+C`.

- Đã bổ sung Definition of Done: mọi thay đổi web có giao diện/luồng tương tác phải kèm runtime/browser check và hướng dẫn kiểm tra trực tiếp trước nghiệm thu.

- Không thay đổi nghiệp vụ, không tạo module CRM/LMS, không đọc token và không tích hợp API thật; chưa bắt đầu Giai đoạn 2.

### 2026-10-08 — `MOCK-01`

- Đã thêm shared contracts thuần TypeScript trong `@mindx-360/contracts`: `ApiError`, `SourceState\<TData>` và `SearchResponse\<TCrmItem, TLmsItem>` cùng các type hỗ trợ tối thiểu.

- `SourceState\<TData>` là discriminated union, bao phủ đủ `idle`, `loading`, `success`, `empty`, `partial`, `forbidden`, `unavailable`, `error`; chỉ trạng thái phù hợp mới mang `data` và/hoặc `error`.

- `SearchResponse` phân tách rõ `sources.crm` và `sources.lms`, dùng source state đã settled và hỗ trợ kết quả tổng hợp `success`, `empty`, `partial`, `error`; lỗi một nguồn không che dữ liệu nguồn còn lại.

- `ApiError` thống nhất `code`, thông báo an toàn, khả năng retry và nguồn lỗi tùy chọn; contract không chứa upstream body, credential hoặc dữ liệu nhạy cảm.

- Đã thêm type tests cho toàn bộ trạng thái hợp lệ, tính đầy đủ của status union và các trường hợp không hợp lệ như `success` thiếu `data` hoặc response còn source `loading`.

- Root `npm run typecheck`: đạt cho contracts, API và Web; type tests của contracts đạt.

- Root `npm run build`: đạt cho contracts, API và Web; package declarations/exports được sinh thành công.

- Root `npm test`: đạt tổng cộng `5/5` runtime tests (`1` contracts, `2` API, `2` Web); contract type tests được chạy trong script typecheck của workspace.

- Không định nghĩa Lead/Student DTO hoặc model chi tiết, không tạo mock data, route, UI, module nghiệp vụ và không gọi API bên ngoài.

- Handoff: dừng tại `MOCK-01`; chỉ bắt đầu `MOCK-02` sau khi người dùng nghiệm thu và xác nhận rõ ràng.

### 2026-10-12 — `MOCK-02`

- Đã đọc lại toàn bộ `MINDX_360_CURSOR_SPEC_V1.md`, các contracts của `MOCK-01` và ba tài liệu API hiện có trong `reference/` trước khi chốt field.

- Đã thêm model thuần TypeScript `CrmLeadSummary` trong module CRM với các field tối thiểu đã có căn cứ từ `Lead_getList`: `crmLeadId`, `crmCustomerId`, `customerName`, raw `status`, `businessUnitId`, `ownerName`.

- CRM chưa có mã Lead hiển thị riêng được tài liệu xác nhận, vì vậy model không tự tạo `leadCode`; `crmLeadId` là định danh Lead duy nhất ở summary.

- Đã thêm model thuần TypeScript `LmsStudentSummary` trong module LMS với `lmsStudentId`, `studentCode`, `fullName`, raw `status`, `lmsCustomerId`. `studentCode` là mã hiển thị từ field API `studentId` và nullable vì field này chỉ được xác nhận ở `findStudentById`, chưa có trong selection đã ghi của `getStudents`.

- `crmCustomerId` và `lmsCustomerId` được giữ riêng; model không giả định hai ID bằng nhau và không tạo liên kết CRM ↔ LMS chưa xác minh.

- Hai factory yêu cầu primary ID là chuỗi không rỗng, giữ raw status không diễn giải enum, chuyển field tùy chọn bị thiếu/null thành `null` rõ ràng và từ chối giá trị sai kiểu/rỗng.

- Unit tests bao phủ dữ liệu đầy đủ, dữ liệu tùy chọn bị thiếu, primary ID thiếu/rỗng, field tùy chọn sai kiểu, phân biệt LMS internal ID với mã hiển thị và nhiều Lead/Student trong một kết quả.

- Root `npm run typecheck`: đạt cho contracts, API và Web.

- Root `npm run build`: đạt cho contracts, API và Web; declaration của hai model được sinh thành công.

- Root `npm test`: đạt tổng cộng `17/17` runtime tests (`1` contracts, `14` API, `2` Web), ngoài contract type tests.

- Không tạo fixture/mock data dùng lại, API client, API route, giao diện hoặc kết nối hệ thống ngoài.

- Handoff: dừng tại `MOCK-02`; chỉ bắt đầu `MOCK-03` sau khi người dùng nghiệm thu và xác nhận rõ ràng.

### 2026-10-12 — `MOCK-03`

- Đã thêm fixture `oneParentOneStudentFixture` trong module `mindx360`, mô phỏng một lần tìm bằng cùng SĐT giả `0000000000` trả về đúng một CRM Lead và một LMS Student.

- Fixture tạo dữ liệu qua `createCrmLeadSummary` và `createLmsStudentSummary`, sau đó được kiểm tra tĩnh bằng `SearchResponse\<CrmLeadSummary, LmsStudentSummary>` từ shared contracts.

- Mọi tên, mã và ID đều có nhãn `mock`/`giả lập`; không sử dụng dữ liệu khách hàng thật hoặc gọi API bên ngoài.

- CRM Customer ID và LMS Customer ID được đặt khác nhau, fixture không có trường `links`; việc cùng xuất hiện trong một kết quả tìm theo SĐT không được coi là bằng chứng liên kết CRM ↔ LMS.

- Unit tests kiểm tra cùng một search input có kết quả ở cả hai nguồn, overall/source status, đúng `1` Lead và `1` Student, factory validation, phân biệt LMS internal ID với mã hiển thị, contract compatibility và không có liên kết suy diễn.

- Root `npm run typecheck`: đạt cho contracts, API và Web.

- Root `npm run build`: đạt cho contracts, API và Web.

- Root `npm test`: đạt tổng cộng `22/22` runtime tests (`1` contracts, `19` API, `2` Web), ngoài contract type tests.

- Không triển khai fixture nhiều kết quả của `MOCK-04`, API client, service, route hoặc giao diện.

- Handoff: dừng tại `MOCK-03`; chỉ bắt đầu `MOCK-04` sau khi người dùng nghiệm thu và xác nhận rõ ràng.

### 2026-10-12 — `MOCK-04`

- Đã tách `PhoneSearchFixture` thành type fixture dùng chung khi Giai đoạn 2 bắt đầu có nhiều case mock.

- Đã thêm fixture `manyLeadsManyStudentsFixture` cho SĐT giả `0000000004`, trả đủ `2` CRM Lead và `2` LMS Student trong cùng một `SearchResponse` thành công.

- Hai Lead dùng chung CRM Customer ID và hai Student dùng chung LMS Customer ID để mô phỏng dữ liệu trong từng hệ thống; CRM ID và LMS ID vẫn có namespace khác nhau và không được coi là liên kết chéo.

- Unit tests duyệt/validate toàn bộ phần tử, kiểm tra cardinality, ID không trùng và danh sách ID đầy đủ; không dùng phần tử `[0]` làm đại diện cho toàn bộ kết quả.

- `npm run typecheck --workspace @mindx-360/api`: đạt.

- `npm test --workspace @mindx-360/api`: đạt `22/22` tests.

- Không tạo API client, service, route hoặc giao diện trong đầu việc này.

- Handoff nội bộ: `MOCK-04` hoàn thành; tiếp tục `MOCK-05` theo phạm vi `MOCK-04` → `MOCK-08` đã được người dùng duyệt.

### 2026-10-12 — `MOCK-05`

- Đã thêm fixture `missingOrMismatchedLinksFixture` cho SĐT giả `0000000005`, gồm một CRM Lead và hai LMS Student.

- Student thứ nhất không có LMS Customer ID; Student thứ hai có suffix ID giống case CRM nhưng giữ namespace `lms:` khác với `crm:`.

- Fixture không khai báo `links`; test kiểm tra không ID LMS nào bằng CRM Customer ID và không nâng suffix giống nhau thành liên kết xác thực.

- Fixture tiếp tục dùng `SearchResponse` của `MOCK-01` và factory/model của `MOCK-02`; dữ liệu hoàn toàn giả lập.

- `npm run typecheck --workspace @mindx-360/api`: đạt.

- `npm test --workspace @mindx-360/api`: đạt `24/24` tests.

- Không tạo link resolver, API client, service, route hoặc giao diện trong đầu việc này.

- Handoff nội bộ: `MOCK-05` hoàn thành; tiếp tục `MOCK-06` theo phạm vi đã được người dùng duyệt.

### 2026-10-12 — `MOCK-06`

- Đã thêm `CrmSearchClient` và `LmsSearchClient` làm interface biên theo từng module; mỗi client nhận SĐT và trả `SearchSourceState` đã settled của model tương ứng.

- Đã thêm `MockCrmSearchClient` và `MockLmsSearchClient`, nhận scenario map qua constructor, không phụ thuộc Express và không có code network/token.

- Mock client trả nguyên danh sách đã cấu hình, giữ trạng thái lỗi riêng từng nguồn và trả `empty` cho SĐT không được cấu hình.

- Unit tests riêng cho CRM/LMS bao phủ success, empty và error/forbidden/unavailable; toàn bộ dữ liệu test là giả lập.

- `npm run typecheck --workspace @mindx-360/api`: đạt.

- `npm test --workspace @mindx-360/api`: đạt `30/30` tests.

- Không tạo service orchestration, route hoặc gọi API production trong đầu việc này.

- Handoff nội bộ: `MOCK-06` hoàn thành; tiếp tục `MOCK-07` theo phạm vi đã được người dùng duyệt.

### 2026-10-12 — `MOCK-07`

- Đã thêm `SearchByPhoneService` trong module `mindx360`, chỉ phụ thuộc `CrmSearchClient` và `LmsSearchClient`, không phụ thuộc Express hay implementation cụ thể.

- Service gọi hai nguồn đồng thời và cô lập lỗi: CRM lỗi vẫn giữ LMS, LMS lỗi vẫn giữ CRM; exception bất ngờ được đổi thành lỗi `UNKNOWN` an toàn, không lộ message upstream.

- Quy tắc tổng hợp đã test: cả hai empty → `empty`; có dữ liệu và không lỗi → `success`; một nguồn lỗi hoặc source partial → `partial`; cả hai nguồn lỗi → `error`.

- Unit tests bao phủ nhiều kết quả, empty, lỗi từng phía, cả hai lỗi, một nguồn empty, source partial và client rejection bất ngờ.

- `npm run typecheck --workspace @mindx-360/api`: đạt.

- `npm test --workspace @mindx-360/api`: đạt `38/38` tests.

- Không thêm Express controller/route hoặc gọi API production trong đầu việc này.

- Handoff nội bộ: `MOCK-07` hoàn thành; tiếp tục `MOCK-08` theo phạm vi đã được người dùng duyệt.

### 2026-10-12 — Sắp xếp lại roadmap sau MOCK-08 (chỉnh kế hoạch, chưa triển khai code)

- Giữ nguyên toàn bộ checklist INIT-01…INIT-08, MOCK-01…MOCK-08 và trạng thái hiện tại (MOCK-08 vẫn đang thực hiện tại thời điểm xuất bản này).
- Không xóa hoặc đánh dấu hoàn thành thêm đầu việc; giữ nguyên 59 đầu việc cũ sau MOCK-08 với ID và nội dung gốc, chỉ phân bổ lại Giai đoạn 3–10.
- Đặt mốc Demo A/A+ bằng mock, Demo B bằng hai nguồn thật, Demo C chi tiết thật và Demo D liên kết CRM ↔ LMS đã có bằng chứng, để có thể trình sếp trước khi hoàn tất V1.
- Giữ SEC-01…SEC-04 trước mọi production client và HARD-01 trước hoạt động query production; phần Fulfillment và liên kết fulfillmentId chuyển sau mốc Demo D.
- Chốt lại quy tắc cho phép Cursor chạy tuần tự trong **nhóm được người dùng duyệt**, nhưng bắt buộc chạy test, ghi nhật ký từng bước và dừng ở cổng nghiệm thu.
- Kế hoạch tái cấu trúc này đã được người dùng chọn làm tài liệu điều phối hiện hành; không đồng bộ ngược sang `docs/IMPLEMENTATION_PLAN.md` đã được người dùng xóa.

### 2026-10-12 — `MOCK-08`

- Đã thêm default mock scenario registry cho một kết quả, nhiều kết quả, thiếu/không khớp liên kết, empty, CRM error, LMS error và cả hai nguồn error.
- Đã thêm controller và route `GET /api/v1/search?phone=...`; HTTP validation nằm ở controller, orchestration và business status nằm trong `SearchByPhoneService`.
- Validation chỉ yêu cầu đúng một query parameter `phone` dạng chuỗi không rỗng sau khi trim; chưa áp đặt regex hoặc chuẩn hóa SĐT khi nghiệp vụ chưa chốt.
- `createApp` mặc định inject mock CRM/LMS clients; không đọc token, không có production transport và không gọi API bên ngoài.
- Integration tests bao phủ missing/blank/repeated phone, một kết quả, nhiều kết quả, empty, lỗi CRM, lỗi LMS và cả hai nguồn lỗi.
- Root `npm run typecheck`, `npm run build` và `npm test`: đạt; tổng cộng `50/50` runtime tests, ngoài contract type tests.
- Runtime check đạt cho `/health`, nhiều kết quả (`2` Lead/`2` Student), empty, lỗi một nguồn và cả hai nguồn lỗi; tiến trình kiểm tra đã dừng và cổng `3000` đã được giải phóng.
- Handoff: Giai đoạn 2 (`MOCK-01` → `MOCK-08`) hoàn thành; dừng chờ người dùng nghiệm thu, không tự chuyển sang Giai đoạn 3.
