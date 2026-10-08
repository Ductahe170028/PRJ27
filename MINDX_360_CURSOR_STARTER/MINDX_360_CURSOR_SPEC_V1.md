# MINDX 360 — Đặc tả triển khai V1 cho AI trong Cursor

**Loại:** Ứng dụng nội bộ độc lập phục vụ Tech Support  
**Trạng thái:** Đặc tả trước khi code; các quan hệ từ bot là kết quả đọc code, **chưa đối chiếu production**  
**Stack đã chốt:** React + TypeScript (Frontend), Node.js + Express (Backend), **không Database riêng**  
**Hệ thống tích hợp V1:** CRM + LMS  
**Nguyên tắc bất biến:** **READ-ONLY đối với dữ liệu nghiệp vụ production**; không chỉnh sửa source code CRM/LMS, không gọi API tạo/sửa/xóa/gửi/duyệt/đồng bộ dữ liệu.

## 1. Bối cảnh, vấn đề và mục tiêu

Tech Support nhận ticket liên quan đến khách hàng/học viên nhưng thông tin nằm rải trên nhiều màn hình CRM, LMS: Customer → Lead → Order → Product → Payment → Fulfillment/Slot → Student → Enrollment → Course → Class. Một SĐT phụ huynh có thể có nhiều Lead, nhiều Order, nhiều con. Việc lần từng trang và ghép thông tin thủ công gây mất thời gian và dễ nhầm người.

**Mục tiêu:** nhập **một SĐT** để tra cứu toàn bộ Lead và Student có liên quan; mở dần các nhánh theo mô hình cây; xem dữ liệu chi tiết ngay trong app; đi hai chiều giữa các bản ghi CRM và LMS thông qua ID đã xác minh. **V1 ưu tiên việc hiển thị đúng dữ liệu và quan hệ, không tự sửa, không cần AI.**

**Không làm trong V1:** Denise/TMS, tự động sửa lỗi, API mutation nghiệp vụ, nút mở trang CRM/LMS gốc, API recorder, tìm bug bằng AI, cảnh báo phức tạp, hoàn chỉnh bảng chi tiết Payment Allocation (để bổ sung sau). Không đặt mục tiêu sao chép toàn bộ giao diện CRM/LMS.

## 2. Cấu trúc màn hình

### 2.1. Trang chính (desktop, thiết kế 3 vùng)

- **Thanh trên cùng:** logo/tên MindX 360; ô SĐT + nút Tra cứu; trạng thái tải và làm mới dữ liệu; không hiển thị access token.
- **Cột trái — Navigation Tree (khoảng 25–30%):** gốc của SĐT → hai nhánh `CRM` và `LMS`. Mỗi nhánh có thể mở/thu gọn, tải lười khi mở. Hiển thị số lượng Lead/Student. Có thể mở nhiều nhánh cùng lúc.
- **Cột giữa — Detail (khoảng 45–50%):** chi tiết của node được chọn, bố cục tùy loại entity: thông tin chính, bảng con, trạng thái/lịch sử. Giữ lại cột cây khi chọn node khác.
- **Cột phải — Related & Context (khoảng 20–25%):** quan hệ với đối tượng ở hệ thống còn lại; nút `Xem trong cây` để focus vào node liên quan **ngay trong MindX 360**, các field/ID dùng để liên kết và mức độ tin cậy; ghi chú dữ liệu cần đối chiếu. Nếu chưa có liên kết đáng tin, hiển thị “Chưa xác minh liên kết”, không tự đoán.
- **Breadcrumb:** ví dụ `CRM / Lead L-001 / Order O-001 / ProductItem PI-001 / Slot S-001`.
- **Tiện ích:** copy ID; xem Raw JSON đã lọc dữ liệu nhạy cảm nếu được cấp quyền; refresh node đang chọn; phân biệt `Chưa tải` / `Không có dữ liệu` / `Lỗi API` / `Không có quyền`.
- **Responsive:** màn nhỏ có thể chuyển sang 3 tab `Cây dữ liệu`, `Chi tiết`, `Liên kết`; ưu tiên desktop V1.

### 2.2. Sau khi nhập SĐT

1. Chuẩn hóa đầu vào SĐT theo quy tắc có thể cấu hình; không tự đoán quan hệ từ số điện thoại.
2. CRM: dùng `Lead_getList` tìm các Lead khớp SĐT và load hết các trang kết quả, không chỉ trang đầu.
3. LMS: dùng `getStudents(search)` tìm các Student theo SĐT phụ huynh (người dùng đã kiểm tra được trường hợp một SĐT có nhiều con), load hết các trang kết quả.
4. Hiển thị `CRM (N Lead)` và `LMS (M Student)` cùng một lúc; chưa cần gọi mọi API chi tiết cho tất cả bản ghi ngay từ đầu.
5. Mỗi node có nút mở rộng (`▸/▾`) và vùng có thể chọn. **Mở rộng** không đồng nghĩa **chuyển trang**.
6. Khi chọn Student hoặc Slot có liên kết sang phía bên kia, `Xem trong cây` tự mở cha của node đích, cuộn đến, đánh dấu và hiển thị detail; không rời app.

## 3. Cấu trúc Tree View đề xuất

```text
SĐT phụ huynh
├── CRM (N Lead)
│   ├── Lead A [status, BU, owner]
│   │   ├── Thông tin Lead
│   │   ├── Customer / thành viên gia đình
│   │   │   ├── Người liên hệ
│   │   │   ├── Thành viên 1 [contactId]
│   │   │   └── Thành viên 2 [contactId]
│   │   ├── Order [orderId]
│   │   │   ├── Tổng quan tiền/giảm giá
│   │   │   ├── Product items
│   │   │   │   ├── Product Item A [productItemId, người học]
│   │   │   │   │   └── Các Slot/Enrollment của item (nếu liên kết được)
│   │   │   │   └── Product Item B
│   │   │   └── Payments [paymentId, amount, status]
│   │   └── Fulfillment [productItemId]
│   │       ├── Slot/Enrollment 1 [course, class, status]
│   │       └── Slot/Enrollment 2
│   └── Lead B ...
└── LMS (M Student)
    ├── Student 1 [LMS _id, mã studentId]
    │   ├── Hồ sơ học viên / Customer liên kết
    │   ├── Product Items / Student Registrations
    │   │   ├── Registration A [leadId, fulfillmentId, productItemId]
    │   │   │   ├── Slot 1 [openStatus, paid, course, class]
    │   │   │   └── Slot 2
    │   │   └── Registration B
    │   ├── Các Class đã/đang tham gia
    │   ├── Active/Inactive trong từng Class
    │   └── Lịch sử Enroll / Withdraw / Transfer (khi API có dữ liệu)
    └── Student 2 ...
```

**Quan trọng:** CRM Order có hai nhánh **ProductItems** và **Payments** độc lập. Không coi mỗi Payment chỉ thuộc một Product. Fulfillment và Product Item liên kết theo khóa, có thể xuất hiện ở hai góc nhìn nhưng phải dùng cùng dữ liệu nguồn, tránh nhân đôi entity. **Class** có trạng thái riêng; trạng thái `Student.status`, `Enrollment/Registration.status`, `ClassStudent.activeInClass`, `Completed/Uncompleted` phải hiển thị tách biệt, không gom thành một trạng thái “Active”.

## 4. Nội dung chi tiết khi chọn từng node

| Node | Detail tối thiểu |
|---|---|
| Lead | Lead ID, Customer, Lead status/stage, BU, centre, owner, ngày tạo/cập nhật, danh sách thành viên, Order liên quan |
| Customer / Family member | ID Customer/contact, quan hệ, tên, thông tin liên hệ phù hợp quyền; Student LMS liên kết nếu xác minh được |
| Order | Order ID, leadId, transactionCode, giá trước/sau giảm, tổng đã thu, còn lại, ProductItems, Payments |
| Product Item | Item ID, tên Product, candidate/productUser, giá theo item, trạng thái kích hoạt nếu API có, Fulfillment liên quan |
| Payment | Payment ID, số tiền, ngày, trạng thái/confirmType nguyên bản; các phân bổ tổng nếu API có; chưa tự diễn giải confirmType hoặc phân bổ chi tiết chưa xác minh |
| Fulfillment/Slot CRM | productItemId, candidate, activated, course, class, enrollment/status/request nếu API trả |
| Student LMS | `_id` nội bộ, mã `studentId` hiển thị, `crmContactId`, customer, trạng thái, các registration và class |
| Registration/Slot LMS | leadId, fulfillmentId, productItemId nếu có, từng slot: `id`, `course`, `class`, `status`, `openStatus`, `paid`, `threshold` |
| Class | Class ID, mã/tên, Course, centre, Running/Finished, lịch/buổi nếu API có; `activeInClass` từ quan hệ Class–Student |
| History | thời gian, loại event, thông tin liên quan theo response thật; không tự suy diễn lịch sử khi API không trả |

**Tùy chọn chi tiết:** chia nội dung ở cột giữa thành tab nhỏ `Tổng quan`, `Danh sách liên quan`, `Lịch sử`, `JSON`; không cần tab nếu node ít trường.

## 5. Bản đồ ID CRM ↔ LMS (kết quả bot đọc code, chưa kiểm chứng production)

| Quan hệ | Khóa theo báo cáo bot | Ghi chú triển khai |
|---|---|---|
| Lead → Customer | `Lead.customer.id = Customer.id` | CRM có thể có nhiều Lead cùng Customer |
| Customer → Student | `Lead.customer.id = LMS student.customer._id` | Kiểm tra một hồ sơ thật trước khi coi là quan hệ xác thực |
| Family member → Student | `Customer.familyMembers[].id = LMS student._id = student.crmContactId` | Điểm mấu chốt theo bot; không được nhầm với mã hiển thị `student.studentId` |
| Lead → Order | `Order.leadId = Lead.id` | Bot nói thường 1 Lead/1 Order, nhưng không được hard-code số lượng nếu API thực tế trả nhiều hoặc có dữ liệu legacy |
| Order → Fulfillment LMS | `Order.transactionCode = LMS Fulfillment._id = student.productItems[].fulfillmentId` | Có thể thiếu khi sự kiện CRM không truyền transactionCode |
| Order Product Item → LMS Registration | `Order.productItems[].id` ↔ LMS `studentRegistrationId` / `student.productItems[].productItemId` | Xác minh chính xác chỗ chứa item ID trước khi dùng làm liên kết chính |
| Product Item → Student | `productItems[].productUser` (cũ: `candidate`) = LMS Student ID | Không dùng `Lead.products[].candidateId` để khẳng định đã enroll |
| LMS Registration → Lead | `studentRegistrations[].leadId = Lead.id` | Đường đi ngược đáng ưu tiên |
| LMS Registration → Fulfillment | `studentRegistrations[].fulfillmentId` | Nối về transactionCode/Fulfillment khi có dữ liệu |
| Slot → Course/Class | `enrollmentSlots[].courseId`, `classId`; LMS `enrollmentSlots[].course`, `.class` | Chỉ dùng field thực sự được query trả; mapping có thể khác legacy |
| Product config → Course | `Product.productUnits[].courseId` | `productUnits.slot` là **số lượng slot**, không phải slot ID |
| Mã Student | `student.studentId` | Là **mã học viên** để hiển thị/tìm, KHÔNG phải `_id` |

Các liên kết này đến từ báo cáo đọc code của MindX Tech Bot. Catalog Network cũ chỉ xác minh sự tồn tại field, chưa chứng minh mọi phép bằng nhau. Cần test **read-only trên một case thật** trước khi đánh dấu quan hệ là `VERIFIED_LIVE`.

### 5.1. Chiến lược nối dữ liệu an toàn

- **Mức A / `verified-id`:** ID liên kết đã được đối chiếu từ cả hai response và xác nhận tương đương; cho phép tự nhảy chéo.
- **Mức B / `code-mapped`:** bot xác nhận qua code nhưng chưa chứng minh trên case thật; hiển thị liên quan với nhãn `Cần đối chiếu`.
- **Mức C / `possible`:** chỉ trùng SĐT/tên/email; hiển thị như **gợi ý**, không tự nối Product/Slot/Student.
- **Không có match:** hiện “Chưa tìm thấy liên kết xác thực”, vẫn cho Tech xem dữ liệu hai bên độc lập.
- **Không lấy `Lead.products[].candidateId` làm Student enrolled**, vì đó có thể chỉ là người quan tâm.
- **Hồ sơ LMS tạo trực tiếp hoặc qua Transfer** có thể thiếu `crmContactId/customer`; không tự gắn nhầm anh/chị/em dùng chung SĐT.
- **Thành viên gia đình bị tạo trùng tên:** luôn phân biệt bằng ID, không tự hợp nhất.
- **Đổi gói:** có trường hợp archived giữ CRM ID trong `_id`, dòng mới giữ trong `productItemId`: khi lookup phải hỗ trợ cả hai nguồn theo quy tắc đối chiếu cụ thể, không ghi đè ID gốc.
- **Đổi người học trên Order:** có thể sinh lại slot với ID mới; không nối slot mới với enroll cũ chỉ vì trùng Product.
- **Upsell/transfer item:** có thể nằm ở Lead khác (`legacyUpsell.fromLeadId`) hoặc khách khác. Gắn đúng Lead nguồn/đích, không mặc định một Student chỉ có một Lead.
- **`Fulfillment_find` CRM có thể dựa trên dữ liệu CRM v1 cũ** khác LMS: đánh dấu nguồn mỗi status, không âm thầm ưu tiên một trạng thái rồi coi là đúng.

## 6. API có trong bộ PRJ27 (network capture ngày 25/09/2026)

**Nguồn kỹ thuật:** `docs/api-map.md`, `docs/entity-map.md`, `docs/missing-apis.md` trong bộ PRJ27. Các file chỉ lưu tên operation, tên input/output và một phần GraphQL document (có document bị cắt ở 1.500 ký tự). **Không được tự bịa selection set hoặc nhận nhầm tên operation thành endpoint REST.**

**CRM GraphQL:** `POST https://api.mindx.edu.vn/crm`  
**LMS GraphQL:** `POST https://lms-api.mindx.edu.vn/`  
GraphQL POST body dạng `{ operationName, query, variables }`.

### CRM (chỉ Query)

| Operation | Mục đích / Input được ghi lại |
|---|---|
| `Lead_getList` | Tìm Lead, `query.phoneNumber`, `page`, `limit`; cần pagination |
| `Lead_getById` | Chi tiết Lead, `id`; bao gồm `customer.familyMembers` |
| `Lead_getHistories` | Lịch sử Lead, `id` |
| `Order_get` | Chi tiết Order, input `leadId` (document còn chấp nhận `id`); `payments`, `productItems`, `calculation`, `transactionCode` |
| `Fulfillment_find` | Fulfillment/Enrollment CRM, `input.leadId` |
| `Course_find`, `Class_find` | Tra cứu Course/Class khi cần đối chiếu |

Bot còn nêu `Customer_getById`, `Order_getByLeadId`, `Enrollment_find` là các tên/đường truy cập trong source. **Chưa có trong catalog query đã lưu với hình dạng GraphQL đầy đủ**; không tự gọi cho đến khi tìm được request read-only thực tế hoặc tên operation frontend hiện hành. `Order_get(leadId)` và `Fulfillment_find(input.leadId)` đã được Network chứng minh.

### LMS (chỉ Query)

| Operation | Mục đích / Input được ghi lại |
|---|---|
| `getStudents` | Tìm Student theo `search`, `pageIndex`, `itemsPerPage`, `orderBy` |
| `getStudent`, `findStudentById` | Hồ sơ Student, input `id`; có `crmContactId`, `studentId` |
| `studentRegistrations` | Slot/enrollment theo `payload.studentId`; trả `leadId`, `fulfillmentId`, `enrollmentSlots` |
| `studentStudyClasses` | Danh sách lớp theo `studentId`, có pagination |
| `GetClassById`, `GetClasses` | Chi tiết/danh sách Class |
| `FindClassStudent` | Quan hệ một Student với Class, input `classId`, có `activeInClass` |
| `FindStudentEnrollmentActivities` | Lịch sử ghi danh, theo `payload.studentId_eq`, thời gian và pagination |
| `GetEnrollmentRequests` | Yêu cầu ghi danh và trạng thái, search/class/filter |

**Chưa xử lý trong vòng đầu:** bung field của `paymentAllocations[]`, diễn giải `confirmType`, enum Slot, điểm danh buổi chính. Hiển thị phần hiện có đúng như dữ liệu API và gắn nhãn phần chưa đủ.

**Không được gọi mutation nghiệp vụ**, ví dụ `Enrollment_sendRequest`, `Enrollment_cancelRequest`, `Enrollment_updateProductEnrollmentItem`, `Order_addPayment`, `Order_deletePayment`, `UpdateEnrollmentRequestStatus`, `UpdateSlotAttendance`, bất kể tài khoản có quyền gì.

## 7. Kiến trúc ứng dụng (không Database)

```text
React + TypeScript (Vite hoặc scaffold tương đương)
      │  các API của ỨNG DỤNG MỚI, không phải CRM/LMS
      ▼
Node.js + Express (BFF / API Aggregator, stateless)
      ├── CRM GraphQL Query Client
      └── LMS GraphQL Query Client
           (dùng xác thực được công ty cho phép)
```

### Frontend

- TypeScript strict; component tree generic với `NodeId`, `NodeType`, `parentId`, `hasChildren`, `loaded`, `loading`, `error`, `children`.
- Phân chia component: `SearchBar`, `EntityTree`, `EntityTreeNode`, `EntityDetail`, `RelatedPanel`, `Breadcrumb`, `LoadState`, `ErrorPanel`, `JsonViewer`.
- Không lưu mật khẩu/token/hồ sơ học viên vào localStorage; không ghi dữ liệu nhạy cảm ra console hoặc telemetry.
- Lazy loading, cache trong RAM theo entity ID trong phiên; refresh từng node; làm sạch state khi tra số khác.
- Hỗ trợ nhiều Lead, nhiều Order và nhiều Student, không chỉ `[0]`.

### Backend

- Thư mục `clients/crmGraphqlClient`, `clients/lmsGraphqlClient` tách biệt.
- Thư mục `adapters` chuẩn hóa response CRM/LMS thành DTO riêng của app, giữ `source` và `rawId`; không sửa/ghi ngược dữ liệu.
- Thư mục `services` gồm `searchByPhone`, `getCrmLeadDetail`, `getCrmOrderDetail`, `getLmsStudentDetail`, `getLmsRegistrationDetail`, `resolveCrossSystemLinks`.
- Các API **nội bộ do app tự tạo** (tên route đề xuất, không phải API MindX):
  - `GET /api/search?phone=...`
  - `GET /api/crm/leads/:id`
  - `GET /api/crm/leads/:id/order`
  - `GET /api/crm/leads/:id/fulfillments`
  - `GET /api/lms/students/:id`
  - `GET /api/lms/students/:id/registrations`
  - `GET /api/lms/students/:id/classes`
  - `GET /api/links?sourceType=...&sourceId=...`
- BFF tự phân trang/giới hạn số request, có timeout, xử lý lỗi từng bên độc lập (CRM lỗi không che mất LMS), cache ngắn trong RAM nếu phù hợp.
- Không DB, không cron nền, không ghi dữ liệu nghiệp vụ production.

### Auth / an toàn

- Tài khoản hiện tại có quyền API không có nghĩa là app được phép dùng token để chia sẻ dữ liệu cho người khác. V1 là bản local/prototype cá nhân đã được cấp phép.
- Chỉ sử dụng cơ chế xác thực được công ty chấp thuận. Không hardcode JWT/Bearer token trong code hay `.env` đưa lên Git; không lưu token trong log hoặc HAR được commit.
- Thiết kế `AuthProvider` / `TokenProvider` dạng interface; có `mock` và `authorized-session` để thay thế khi xác minh auth thật. Token chỉ được giữ ngắn hạn, xử lý phía server được bảo vệ; không truyền token sang client không cần thiết.
- CORS, VPN/network policy và quyền GraphQL cần được kiểm tra thực tế. Nếu thiếu cơ chế xác thực hợp lệ, làm mock UI trước, không tìm cách vượt quyền.
- Dữ liệu test phải ẩn danh; không đưa dữ liệu cá nhân của học viên vào dịch vụ AI, repo công khai hoặc log.

## 8. Chiến lược tải dữ liệu và hiển thị

1. `search`: chạy song song CRM Lead search và LMS Student search, trả hai danh sách độc lập + lỗi riêng.
2. Chọn `Lead`: lấy Lead detail; chọn `Order`: gọi `Order_get`; chọn `Fulfillment`: gọi `Fulfillment_find`.
3. Chọn `Student`: lấy detail và Student Registrations; chọn `Class`: gọi `GetClassById` và `FindClassStudent` khi cần.
4. Mỗi response chuẩn hóa thành DTO; bổ sung cạnh liên kết khi có căn cứ; cột phải cho nút focus sang entity có trong Tree hoặc nạp nó vào tree.
5. Với dữ liệu không có quan hệ cha–con rõ, trình bày ở cột Detail/Related, không tạo nhánh giả trong tree.
6. Với `No result` / `Forbidden` / `API unavailable` / `Partial data` dùng trạng thái khác nhau; không được coi API lỗi là “học viên không tồn tại”.

## 9. Các bước triển khai cho Cursor (làm tuần tự, không nhảy cóc)

### P0 — Đọc/kiểm tra nguồn API

- Trước khi code, đọc 3 tài liệu PRJ27: `api-map.md`, `entity-map.md`, `missing-apis.md` nếu chúng có trong workspace. Nếu chưa được đưa vào workspace, hỏi người dùng cấp tài liệu; không tự giả định GraphQL selection set.
- Tổng hợp **bảng API đủ dữ liệu / thiếu query hoàn chỉnh / chờ test liên kết**.
- Không truy cập service production cho đến khi có xác thực hợp lệ và được phép.

### P1 — Xây UI bằng dữ liệu giả

- Scaffold FE React TS + BE Express TS trong workspace/project mới; không động các repo CRM/LMS của công ty.
- Tạo 3 case giả lập ẩn danh: `1 phụ huynh – 1 Student`, `1 phụ huynh – 2 Student, nhiều Lead`, `1 Student thiếu liên kết CRM`.
- Xây Search → CRM/LMS Tree → Detail → Related → focus chéo; loading/error/empty state. Chỉ dùng dữ liệu giả ở giai đoạn này.

### P2 — Tích hợp query CRM

- `Lead_getList`, `Lead_getById`, `Order_get`, `Fulfillment_find` với đúng request được cung cấp.
- Đảm bảo một SĐT có nhiều Lead; mỗi Lead có thông tin family members/Order/Product/Payment/Slot.
- Không triển khai Payment Allocation chi tiết nếu chưa có selection set thật.

### P3 — Tích hợp query LMS

- `getStudents`, `findStudentById`/`getStudent`, `studentRegistrations`, `studentStudyClasses`, `GetClassById`, `FindClassStudent`.
- Phân biệt mã `studentId` với `_id`; hiển thị nhiều anh chị em đúng cách.

### P4 — Nối hai chiều CRM ↔ LMS

- Xác minh trên một case read-only các khóa từ Mục 5; đánh dấu mức tin cậy cho từng mapping.
- Cài `resolveCrossSystemLinks`; chọn Slot có Student → focus Student; chọn Student → tìm Lead/Order/Product/Slot có quan hệ đã xác minh.
- Với legacy hoặc thiếu ID, nêu rõ mức độ chắc chắn, không tự match sai.

### P5 — Hoàn thiện và kiểm thử

- Phân trang, cache, refresh node, JSON viewer an toàn, xử lý token hết hạn, lỗi API/permission.
- Test case người dùng thật nhưng chỉ đọc dữ liệu được phép, không lưu lại PII trong fixture/repo.
- README: cách chạy local, cách cấu hình endpoint/auth hợp lệ, sơ đồ source và danh sách những API còn thiếu.

## 10. Tiêu chí nghiệm thu V1

- Nhập SĐT có nhiều Lead và nhiều con: Tree hiển thị đúng **tất cả kết quả phân trang**, không gộp hai Student cùng SĐT.
- Click Lead/Order/Product/Fulfillment: detail đổi đúng entity, các nhánh trước không bị đóng/mất lựa chọn ngoài ý muốn.
- Click Student: có profile, registrations, class và `activeInClass` theo dữ liệu lấy được; phân biệt các loại status.
- Liên kết CRM ↔ LMS hoạt động với ID đã xác minh. Với quan hệ chưa chắc chắn: có nhãn `Cần đối chiếu`; không tự link nhầm.
- Không xuất hiện lời kết luận kiểu “không có học viên” khi LMS API bị lỗi; trạng thái lỗi rõ ràng.
- Trong source và network của MindX 360 không có request business mutation, không có thao tác sửa production.
- Không hardcode token/PII trong repo; ứng dụng có thể chạy mock mà không cần tài khoản thật.
- Có README và cấu trúc code để sau này bổ sung Denise/TMS hoặc rule cảnh báo nhưng **không phải làm những chức năng đó trong V1**.

## 11. Chỉ dẫn bắt đầu dành cho Cursor AI

**Hãy coi văn bản này là yêu cầu sản phẩm. Trước tiên hãy kiểm tra workspace, đề xuất cấu trúc project và danh sách API còn thiếu để tích hợp đúng; sau đó triển khai từng giai đoạn P1 → P5.**

- Không tự viết ra GraphQL query chưa được cung cấp và bảo là đã xác minh.
- Chỗ chưa rõ hãy dùng mock/adapter interface + TODO cụ thể thay vì giả lập kết quả production.
- Ưu tiên giao diện thực dụng, sáng sủa, Tree View rõ ràng; không thêm dashboard/chart hay AI ngoài yêu cầu.
- Luôn giữ tool READ-ONLY; tuyệt đối không tự gọi mutation nhằm kiểm thử hoặc sửa dữ liệu.
- Nếu gặp điểm nghiệp vụ hoặc field mâu thuẫn giữa bot và capture, trình bày mâu thuẫn và tạm để chế độ chưa xác minh thay vì đoán.
