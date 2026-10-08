# API còn thiếu cho Health Check

Cập nhật: 2026-09-25, sau phiên 2. Catalog đầy đủ nằm ở `docs/api-map.md`.

**READY FOR TOOL: NO**

Phiên 2 không khép 8 lỗ hổng. `Lead_getList` lần được giữ chỉ có `page`, `limit`. `getStudents.search` lần được giữ là chuỗi rỗng. Dropout và onhold có request theo `studentId` nhưng mảng `data` không bung field con. Không có `Receipt_find`, không có query transfer, không có query đọc allocation. `findStudentById.crmContactId` vẫn chỉ là tên field.

Bộ ghi phiên 2 bỏ các lần gọi sau nếu trùng operation. Một lần gõ số điện thoại sau khi danh sách đã load sẽ không nằm trong file.

Mutation ghi danh / thanh toán đã lưu tên trong api-map. Không gọi lại.

## Checklist

### A. Customer / Lead

| Requirement | Operation | Verified | Missing reason |
|---|---|---|---|
| Search SĐT | `Lead_getList` | YES | Biến `query.phoneNumber`, `query.customerName`, `query.leadStage`. Giá trị không lưu |
| Search Lead ID | `Lead_getById` | YES | Input `id` |
| Mọi Lead của một Customer | `customer.activeLead` | PARTIAL | Có `activeLead.id`. Chưa có list mọi lead của một customer |
| Lead detail | `Lead_getById` | YES | |
| Customer detail | nằm trong `Lead_getById.customer` | PARTIAL | Có `customer.id`, `contact`. Chưa có `Customer_getById` riêng |
| Family member | `Lead_getPhoneNumber.customer.familyMembers` | PARTIAL | Có `id`, `contact`, `relation`. `contact` chưa bung hết |
| Status + stage | `LeadStages_*`, `LeadStatuses_*`, `Lead_getById.status` | PARTIAL | Catalog có. `status` trên lead detail chưa bung thành code L0–L6 trong response keys |
| Centre / BU / Domain / Owner | có id trên `Lead_getById` | PARTIAL | Có id. Chưa thấy field AM/CM |
| createdAt / updatedAt | `createdAt`, `lastModifiedAt` | YES | |
| source / learningMethod | có trên `Lead_getById` | YES | |
| Lead history | `Lead_getHistories` | YES | `action`, `op`, `path`, `from`, `to`, `createdBy`, `createdAt` |
| Đổi owner / BU / status | `Lead_getHistories.path` | PARTIAL | Có lịch sử. Chưa đọc một dòng mẫu để biết path nào là đổi owner |

### B. Order / Product

| Requirement | Operation | Verified | Missing reason |
|---|---|---|---|
| Order của Lead | `Order_get` | YES | Biến `leadId`. Chưa thấy list nhiều order |
| Order detail | `Order_get` | YES | calculation đủ các dòng tiền đã liệt kê |
| OrderItem | `OrderItemContract_findAll.orderItemId` | PARTIAL | Có trên contract. Chưa thấy mảng orderItems trên `Order_get` |
| ProductItem | `Order_get.productItems[].id`, `Fulfillment_find.productItemId` | YES | |
| Product | `productItems[].product`, `Fulfillment_find.product` | YES | |
| ProductGroup | `ProductGroup_findAll` | YES | Catalog. Chưa nối group vào product item của order |
| Còn lại / đã thu / hoàn / rút / phí | `Order_get.calculation` | YES | |

### C. Payment / allocation

| Requirement | Operation | Verified | Missing reason |
|---|---|---|---|
| Payment theo Lead | `Order_get.payments` | YES | |
| Payment list hệ thống | `LeadPayment_getList` | YES | Không thay cho payment của một lead |
| status, payday, amount, confirmType | trên `Order_get.payments` | YES | Chưa map `confirmType` sang nhãn UI |
| Allocation đọc | `Order_get.productItems[].paymentAllocations` | PARTIAL | Có mảng trên product item, kèm các tổng `*Allocation` trong `calculation`. Field con của từng dòng allocation chưa bung |
| Receipt | | NO | `Receipt_find` không xuất hiện trong phiên này |

### D. Enrollment CRM

| Requirement | Operation | Verified | Missing reason |
|---|---|---|---|
| Enrollment trên lead | `Fulfillment_find.enrollments` | YES | `id`, `course`, `class`, `status`, `requests` |
| productItemId | `Fulfillment_find.productItemId` | YES | |
| Chọn course/class | `Course_find`, `Class_find` | YES | Query đọc. Mutation `Enrollment_updateProductEnrollmentItem` đã thấy, không gọi |
| Gửi / hủy request | `Enrollment_sendRequest`, `Enrollment_cancelRequest` | WRITE only | Đã lưu shape. Không có query đọc request CRM riêng ngoài `enrollments[].requests` chưa bung |
| Slot mở/đóng trên CRM | | NO | Slot `openStatus` thấy bên LMS `studentRegistrations` |

### E. Permission

| Requirement | Operation | Verified | Missing reason |
|---|---|---|---|
| User hiện tại | `User_findOne` | YES | centre, BU, domain, roles |
| Danh sách mã quyền | `User_getPermission`, LMS `GetUserPermissionsAndMenuItems` | PARTIAL | Có API. Chưa lưu từng mã |
| Role catalog | `GET /api/roles` | PARTIAL | Chưa tách permission trong role |
| BU được phép | `BusinessUnit_findAll` | PARTIAL | `BusinessUnit_findWithPermission` không thấy lại trong phiên này |
| Quy tắc xem lead | | NO | Không đủ dữ liệu. Không kết luận permission |

### F. Contract / refund

| Requirement | Operation | Verified | Missing reason |
|---|---|---|---|
| Contract của Lead | `OrderItemContract_findAll` | YES | `leadId`, `orderItemId`, `status` |
| Đếm trạng thái ký | `OrderItemContract_countByStatus` | YES | `new`, `sending`, `sent`, `signed`, `revoked`, `rejected` |
| Refund theo order | `Order_get.refunds` | YES | |
| Withdrawal theo order | `Order_get.withdrawals` | YES | Khác dropout LMS |
| Receipt | | NO | Không có trong phiên này |

### LMS

| Requirement | Operation | Verified | Missing reason |
|---|---|---|---|
| Student | `getStudents`, `getStudent`, `findStudentById` | YES | |
| Search học viên | `getStudents.search` | PARTIAL | Có biến. Chưa chứng minh search bằng SĐT |
| Course | `getCourses`, `getCourse` | YES | |
| Class | `GetClasses`, `GetClassById`, `studentStudyClasses` | YES | |
| Slot | `classSlotSummaries`, `studentRegistrations.enrollmentSlots` | YES | Có `openStatus`, `paid`. Chưa có bảng enum |
| Attendance | `FindMakeupAttenDanceByClassId` | PARTIAL | Makeup attendance. Điểm danh buổi chính chưa tách field |
| Enrollment request | `GetEnrollmentRequests` | YES | `student`, `course`, `class`, `type`, `status` |
| Dropout | `FindAllDropoutRequest` | PARTIAL | Có theo `studentId`. Item chưa bung |
| Onhold | `getOnholdRequests` | PARTIAL | Có theo `studentId`. Item chưa bung |
| Transfer | `Fulfillment_find.isTransferred` | NO | Chỉ có field. Không thấy query danh sách transfer |
| Cầu CRM ↔ LMS | `studentRegistrations.leadId`, `fulfillmentId`, `findStudentById.crmContactId` | PARTIAL | Có field. Chưa chứng minh bằng nhau với `customer.id` CRM |

## Health check cases

| Case | Đủ API đọc? | Thiếu |
|---|---|---|
| 1 Duplicate lead theo SĐT | PARTIAL | CRM `Lead_getList` đã có `phoneNumber`. LMS `getStudents.search` có tên biến, giá trị bị che nên chưa chứng minh là số điện thoại |
| 2 Không enroll | PARTIAL | Có fulfillment, productItem, profile candidate, slot LMS. Thiếu allocation đọc và enum slot |
| 3 Thanh toán nhưng không mở slot | PARTIAL | Có payment, `paymentAllocations` trên product item, và `openStatus`. Chưa bung dòng allocation, chưa rõ `confirmType` |
| 4 Sai tên CRM/LMS | PARTIAL | Có customer CRM và student LMS. Chưa chứng minh `crmContactId` |
| 5 Ticket lớp | PARTIAL | Có lớp, học viên trong lớp, slot, homework, checkpoint. Điểm danh buổi chính chưa rõ operation |
| 6 Transfer | NO | Không có query transfer |
| 7 Withdraw / enroll lại | PARTIAL | Có dropout, onhold, withdrawal trên order, enrollment activities. Chưa bung item dropout/onhold |
| 8 Lead permission | NO | Có id BU hai phía. Không có rule. Không được đoán |

## Mẫu response

`network/sanitized-samples/ops-index.json` là chỉ mục tên biến và response key, không có giá trị. Không lưu body JSON thô.
