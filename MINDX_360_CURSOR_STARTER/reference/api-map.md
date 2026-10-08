# API map — verified từ network

Ngày ghi: 2026-09-25. Nguồn: `network/live-capture.jsonl` (138 dòng) và `network/live-capture-2.jsonl` (106 dòng). Phiên 2 chỉ thêm operation mới; lần gọi lại cùng tên bị bộ ghi bỏ. Chỉ tên field và tên biến. Không có token, cookie, mật khẩu, số điện thoại, email, tên khách, số tiền, id bản ghi.

Type lấy từ chữ `query` hoặc `mutation` trong document GraphQL đã gửi. Document lưu trong file jsonl bị cắt ở 1500 ký tự, nên field lồng sâu có thể chưa đủ.

GraphQL đọc dùng POST. Mutation trong bảng dưới **đã xuất hiện trên network** nhưng tool chỉ được gọi operation đánh dấu `read`. Không gọi mutation, không upload file.

## Endpoint

| Hệ thống | Method | URL |
|---|---|---|
| Base | POST | `https://base-api.mindx.edu.vn/` |
| Base gateway | POST | `https://gate-way.mindx.edu.vn/base-api/graphql` |
| CRM | POST | `https://api.mindx.edu.vn/crm` |
| CRM REST | GET | `https://crm.mindx.edu.vn/api/lms-courses` |
| CRM REST | GET | `https://crm.mindx.edu.vn/api/roles` |
| LMS | POST | `https://lms-api.mindx.edu.vn/` |
| File upload | POST | `https://resources.mindx.edu.vn/api/v1/resources` — **WRITE**, không gọi |

Body GraphQL: `{ "operationName", "query", "variables" }`. Response: `{ "data": { ... } }`. Các dòng dưới HTTP 200 trừ upload (201).

Chỉ mục tên biến và response key (không có giá trị): `network/sanitized-samples/ops-index.json`.

---

## Auth / Base

### User_getByFirebaseId

- Hệ thống: Base
- Endpoint: `POST https://base-api.mindx.edu.vn/`
- Type: query
- Input: `id`
- Output: `id`, `email`, `username`, `isActive`, `permissions`, `requiredMfa`, `mfaEnrolledAt`
- Read-only: có
- Màn: `/login`

### loginWithToken

- Type: mutation
- Input: `idToken`
- Output: `loginWithToken`
- Read-only: không. Đăng nhập. Không lưu token.

### GetCustomToken

- Type: mutation
- Document: `users { getCustomToken { customToken } }`
- Read-only: không. Đổi token sang CRM. Không lưu token.
- Màn: `crm-v2.mindx.edu.vn/`

### User_getById (gateway)

- operationName gửi đi: `Query`
- Endpoint: `POST https://gate-way.mindx.edu.vn/base-api/graphql`
- Type: query
- Input: `userGetByIdId`
- Output: `id`, `email`, `givenName`, `firstName`, `lastName`, `isActive`, `permissions`, `roles` (`id`, `name`, `permissions.app`, `permissions.permissions`)
- Read-only: có

---

## CRM — user

### User_getPermission

- Endpoint: `POST https://api.mindx.edu.vn/crm`
- Type: query
- Input: không
- Output: mảng mã quyền. **Chưa lưu từng mã**, nên chưa map quyền xem / sửa / enroll.
- Read-only: có

### User_findOne

- Type: query
- Input: không
- Output đã thấy trên document: `id`, `givenName`, `familyName`, `fullName`, `phoneNo`, `address`, `centreId`, `email`, `businessUnit`, `businessUnitId`, `businessDomainIds`, `roles` (`name`, `permissions`, `centreRequired`, `businessUnitRequired`, `businessDomainRequired`), `businessRoles`, `isActive`, `callExtensionId`, `baseId`, `baseUsername`, `bankAccount`
- Read-only: có

### User_findById

- Type: query
- Input: `userId`
- Output: `id`, `displayName`
- Read-only: có
- Màn: `/leads`

### User_find / User_findPaginate

- Type: query
- `User_findPaginate` input: `input.limit`, `input.page`
- Màn: `/leads`, `/setting/users`
- REST kèm: `GET https://crm.mindx.edu.vn/api/roles`
- Read-only: có

---

## CRM — Lead

### Lead_getList

- Type: query
- Input lần mở list: `query.page`, `query.limit`
- Input lần tìm (phiên 3, 2026-09-25): `query.customerName`, `query.phoneNumber`, `query.page`, `query.limit`, `query.leadStage` (đã thấy giá trị stage `L6`). Giá trị tên và số điện thoại không lưu.
- Output item (document): `id`, `centreId`, `customer` (`id`, `fullName`, `email`, `phoneNumber`, `address`, `education.school`), `status`, `churnReason`, `products` (`productId`, `candidateId`), `ownerId`, `owner` (`id`, `email`, `fullName`), `businessUnitId`, `businessUnit`, `businessDomainId`, `businessDomain`, `productGroupIds`, `productGroups`, `source`, `learningMethod`, `reminders`, `preferredCenterId`, `activeResaleProspect`, `marketingProject`, `isHidePhoneNumber`, `canGetPhoneNumber`, `newlyAssigned`, `createdAt`, `lastModifiedAt`
- Document bị cắt ở `marketingProject`.
- Read-only: có
- Màn: `/leads`

### Lead_getById

- Type: query
- Input: `id`
- Cùng khối lead như list, thêm `registerAt`. Customer dùng fragment `CustomerFields`.
- Response đã bung: `customer.id`, `customer.contact` (`id`, `fullName`, `phoneNumber`, `email`, `dob`, `gender`, `address`, `job`, `education`, `needs`), `customer.familyMembers[]`, `customer.activeLead` (`id`, `ownerId`, `centreId`, `businessUnitId`, `businessDomainId`)
- Fragment `CustomerFields` trong file jsonl bị cắt, nên field con của family member chưa liệt kê hết từ document.
- Read-only: có
- Màn: `/leads`

### Lead_getHistories

- Type: query
- Input: `id`
- Output item: `createdAt`, `createdBy`, `action`, `op`, `path`, `id`, `from`, `to`
- Read-only: có
- Màn: `/leads`

### Catalog trạng thái

| Operation | Type | Input | Output đã thấy |
|---|---|---|---|
| `LeadStages_getTree` | query | | stage tree |
| `LeadStages_getList` | query | `query` | |
| `LeadStatuses_getList` | query | `query` | |
| `LeadStatuses_getAllActive` | query | | |
| `Lead_getLearningMethods` | query | | |
| `LeadConstraintConfig_fetch` | query | `input.search`, `input.limit`, `input.page` | rule config. **Chưa đọc giá trị từng rule** |

### Đi kèm khi mở một lead

| Operation | Type | Input | Việc |
|---|---|---|---|
| `CustomerRegistration_findPaginate` | query | `query.leadId`, `page`, `limit` | đăng ký web của lead |
| `Reminder_findByLead` | query | `leadId` | `id`, `title`, `status`, `dueAt`, `finishedAt` |
| `LeadMessage_getList` | query | `query.leadId`, `page`, `limit` | tin nhắn |
| `Appointment_findPaginate` | query | `payload.leadId`, `page`, `limit` | lịch hẹn |
| `Note_findByCustomer` | query | `id` | ghi chú theo customer |
| `CallHistory_getList` | query | `query.customerId`, `page`, `limit` | lịch sử cuộc gọi |
| `School_find` | query | `input.city` | trường |
| `ConfigSystem_findByKey` | query | `key` | `id`, `value`, `valueType`, `key` |

---

## CRM — Order / fulfillment / contract trên lead

### Order_get

- Type: query
- Input đã gửi: `leadId`. Document còn nhận `id`.
- Output: `id`, `leadId`, `isCompleted`, `transactionCode`
- `calculation`: `valueAfterDiscount`, `remaining`, `totalPriceBeforeDiscount`, `totalPriceAfterDirectDiscount`, `totalDirectDiscountValue`, `totalPriceAfterCouponDiscount`, `totalCouponDiscountValue`, `totalPayment`, `totalRefund`, `totalWithdrawal`, `totalFee`, `totalUpsaleDiscountValue`
- `payments[]`: `id`, `amount`, `note`, `payday`, `status`, `change`, `confirmType`, `transactionId`, `customerDebitId`, `paymentMethod`, `paymentOption`, `period`, `provider`, `referenceCode`, `center`, `accountHolderName`, `beneficiaryBank`, `transferBank`, `attachments`, `receiveTransactionId`
- `refunds[]`: `id`, `amount`, `refundDay`, `note`, `status`, `confirmDate`
- `withdrawals[]`: `id`, `amount`, `withdrawalDay`, `note`, `status`
- `coupons[]`: `couponDiscountValue`, `promotion` (`code`, `discountType`, `discountValue`, …)
- `productItems[]`: `id`, `product` (`id`, `name`, `code`, `type`, `category`, `price`), `candidate.id`, `amount`, `duration`, `inUse`, `isTransferred`, `upsale`, `downsale`, `package`, `promotion`, `madeAt`
- `productItems[].calculation`: `priceBeforeDiscount`, `priceAfterDirectDiscount`, `directDiscountValue`, `couponDiscountValue`, `priceAfterCouponDiscount`, `transferDiscountValue`, `priceAfterDiscount`, `transferFee`, `totalProductPricePaymentAllocation`, `totalTransferFeePaymentAllocation`, `totalRefundAllocation`, `totalProductPriceWithdrawalAllocation`, `totalTransferFeeWithdrawalAllocation`, `usedAllocation`
- `productItems[].paymentAllocations[]`, `refundAllocations[]`, `withdrawalAllocations[]` có trên response đọc của `Order_get`. Field con bên trong mảng bị cắt vì giới hạn độ sâu lúc ghi, nên chưa thấy `paymentId` trong allocation.
- Read-only: có
- Màn: `/leads`
- `confirmType` có trên payment của order. Chưa chứng minh giá trị nào là “đã xác nhận kế toán”.

### Fulfillment_find

- Type: query
- Input: `input.leadId`
- Output item: `productItemId`, `candidate` (`id`, `fullName`, `edu`, `dob`, `gender`, `geo`), `product` (`id`, `name`, `type`, `selectableCourses`, `single.course.id`), `activated`, `isTransferred`, `enrollments[]` (`id`, `course`, `class`, `status`, `requests`, `note`)
- Read-only: có
- Đây là chỗ nối lead → product item → candidate → enrollment. `isTransferred` là field, chưa thấy API danh sách transfer riêng.

### OrderItemContract_findAll

- Type: query
- Input: `input.leadId`, `input.code`
- Output: `id`, `orderItemId`, `code`, `codeNumber`, `status`, `signingDate`, `sendingCount`, `ownerId`, `businessUnitId`, `participants`, `customerInfo`, `productInfo`, `productUserInfo`, `rejectReasonValue`, `fileUrl`
- Read-only: có
- Màn: `/leads`

### OrderItemContract_countByStatus

- Type: query
- Input: `input.leadId`
- Output: `total`, `new`, `sending`, `sent`, `signed`, `revoked`, `rejected`
- Read-only: có

### LeadPayment_getList

- Type: query
- Input: `query.page`, `query.limit`, `query.sort`
- Màn: `/payments`
- Read-only: có
- List toàn hệ thống. Chi tiết payment theo lead nằm ở `Order_get.payments`, không phải list này.

### Class_find / Course_find

- Type: query
- `Class_find` input: `input.lmsCourse`, `limit`, `page`, `sortBy`
- `Course_find` input: `input.appliedInFlexProducts`
- Màn: `/leads` (mở cùng lúc chọn lớp/khóa trên CRM)
- Read-only: có

---

## LMS

Endpoint: `POST https://lms-api.mindx.edu.vn/`.

### Học viên

| Operation | Type | Input | Output chính |
|---|---|---|---|
| `getStudents` | query | `search`, `pageIndex`, `itemsPerPage`, `orderBy` | `id`, `fullName`, `phoneNumber`, `status`, `customer._id`, `productItems`, `studyClasses` |
| `getStudent` | query | `id` | cùng hồ sơ, `studyClasses.id`, `studyClasses.name`, `studyClasses.status` |
| `findStudentById` | query | `id` | thêm `crmContactId`, `totalEnrolledSlot`, `enrollmentNeededStatus`, `candidateTypes`, `studentId` |
| `studentRegistrations` | query | `payload.studentId` | `leadId`, `fulfillmentId`, `status`, `activated`, `price`, `enrollmentPolicy`, `enrollmentSlots[]` (`id`, `paid`, `threshold`, `class`, `course`, `status`, `openStatus`, `learningMediumId`, `actionType`) |
| `studentStudyClasses` | query | `studentId`, `pageIndex`, `itemsPerPage` | lớp của học viên: `id`, `name`, `status`, `slots`, `centre`, `course` |
| `FindStudentEnrollmentActivities` | query | `payload.studentId_eq`, khoảng `createdAt`, `type_eq`, phân trang | hoạt động ghi danh |
| `FindAllDropoutRequest` | query | `studentId_equals` | yêu cầu dropout. Item con chưa bung |
| `getOnholdRequests` | query | `filter.studentId_equals` | onhold. Item con chưa bung |
| `FindStudentProfileById` | query | `id` | response lần này chỉ thấy root |
| `findCallHistory` | query | `payload.filter.customerId_equals` | cuộc gọi LMS |
| `FindByStudentId` | query | `payload.studentId` | chưa tách item trong bản index |
| `FindOneRewardPoint` | query | `payload.productUserId_eq` | điểm |
| `FindPaginateRewardTransaction` | query | `payload.filter.productUserId_eq` | giao dịch điểm |

`getStudents.search` có tên biến search. Chưa chứng minh giá trị gửi đi là số điện thoại.

`studentRegistrations.leadId` và `fulfillmentId` là cầu LMS ↔ CRM đã thấy trên cùng một object.

`enrollmentSlots[].openStatus` và `paid` là slot mở/đóng và đã trả, mức field. Chưa đọc bộ giá trị enum.

### Lớp

| Operation | Type | Input | Output chính |
|---|---|---|---|
| `GetClasses` | query | `search`, `centres`, `courses`, `courseLines`, phân trang | danh sách lớp |
| `GetClassById` | query | `id` | một lớp |
| `GetClassHistoriesById` | query | `id`, phân trang | lịch sử lớp |
| `FindClassStudent` | query | `classId` | `studentId`, `classId`, `activeInClass`, `completed`, `learningMediumId`, `student` |
| `GetEnrollmentRequests` | query | `search`, `class`, `cancelled`, phân trang | `id`, `student`, `course`, `class`, `centre`, `type`, `status`, `createdAt` |
| `classSlotSummaries` | query | khoảng `startTime`, `classStatus_in` | `id`, `class`, `slotId`, `date`, `startTime`, `endTime`, `hasTeachers` |
| `FindMakeupAttenDanceByClassId` | query | `payload.classMakeupId` | điểm danh makeup |
| `studentMakeups` | query | `payload.makeupClassId_equals` | makeup của lớp |
| `findStudentHomeworkByClass` | query | `classId` | bài tập |
| `findStudentCheckpointPagination` | query | `classId_in` | checkpoint |
| `findStudentFinalScorePagination` | query | `classId_in`, `sessionId_in` | điểm cuối |
| `FindStudentSubmissionByClass` | query | `payload.classId` | `students`, `lessons`, `submissions` |
| `GetClassPosts` | query | `payload.classId` | bài đăng lớp |
| `FindCourseVersionByClass` | query | `classId` | version khóa của lớp |
| `FindRequestTeacher` | query | `filter.search_textSearch`, `filter.center_in` | yêu cầu giáo viên. Màn `/admin/request-teacher` |

### Dashboard LMS (đếm, không phải detail ticket)

`GetUserPermissionsAndMenuItems`, `getCourseLines`, `getCentres`, `officeHoursCount_multi`, `classesCount_multi`, `classSlotSummariesCount_multi`, `EnrollmentRequestsCount`, `CountUnreadConversations`, `GetClassesOverviewSummary`, `GetStudentsTasksSummary`.

`GetUserPermissionsAndMenuItems` trả `permissions`, `isAdmin`, menu. **Chưa lưu từng mã quyền.**

---

## Phiên 2 — operation mới

| Operation | Type | Dùng | Màn | Biến | Output |
|---|---|---|---|---|---|
| `BankAccount_findOne` | query | read | `/leads` | `input.associatedId`, `associatedSubject`, `tenant`, `status` | `bankCode`, `bankName`, `bankShortName`, `bankAccountName`, `bankAccountNumber`, `metadata`, `paymentGateway` |
| `FindByMakeupClassId` | query | read | `/admin/classes` | `makeupClassId` | `findByMakeupClassId.data[]` (item chưa bung) |
| `findOneClassSurvey` | query | read | `/admin/classes` | `classId`, `sessionId`, `surveyId`, `target` | `responses`, `status`, `survey.title` |
| `GetClassRoles` | query | read | `/admin/classes` | `search`, `isActive`, phân trang | `id`, `name`, `shortName`, `isActive` |
| `UpdateSlotAttendance` | mutation | WRITE | `/admin/classes` | `classId`, `slotId`, `classSiteId`, `studentAttendance[].status`, `studentAttendance[].student` | `classes.updateSlotAttendance` |

`BankAccount_findOne` đọc tài khoản ngân hàng gắn với payment (`associatedSubject: PAYMENT`). Không phải API allocation.

`UpdateSlotAttendance` đã chạy HTTP 200. Không gọi lại.

## Mutation đã thấy — lưu để biết, không gọi

Các request này đã chạy và HTTP 200 trong phiên 2026-09-25. Tool health check không được gọi lại.

| Operation | Hệ thống | Input (tên biến) |
|---|---|---|
| `loginWithToken` | Base | `idToken` |
| `GetCustomToken` | Base | |
| `Enrollment_sendRequest` | CRM | `input.leadId`, `input.productItemId`, `input.enrollmentItemId`, `input.type` |
| `Enrollment_cancelRequest` | CRM | `input.leadId`, `input.productItemId`, `input.enrollmentItemId` |
| `Enrollment_updateProductEnrollmentItem` | CRM | `leadId`, `productItemId`, `enrollmentItemId`, `courseId`, `classId` |
| `Order_addPayment` | CRM | `input.leadId`, `input.payment` (`amount`, `attachments`, `note`, `payday`, `paymentMethod`), `input.paymentAllocations[]` (`productItemId`, `amount`, `purpose`) |
| `Order_deletePayment` | CRM | `input.leadId`, `input.paymentId` |
| `UpdateEnrollmentRequestStatus` | LMS | `payload.id`, `payload.newStatus`, `payload.learningMediumId`, `payload.reason`, `payload.enrollmentOperation` (`scope`, `classSession`) |
| `FindInfoInRoleById` | LMS | document khai báo mutation. Input `payload.id`. Selection là đọc role. Vẫn không gọi từ tool. |
| `POST /api/v1/resources` | resources | upload file, HTTP 201 |

`Order_addPayment.paymentAllocations` là chỗ allocation gắn payment vào `productItemId`. Đó là shape của mutation ghi, không phải API đọc allocation.

---

## Đã thấy ở vòng trước, không xuất hiện lại ngày 2026-09-25

`LeadContract_find`, `OrderItemContract_summarizeSignStatus`, `Receipt_find`, `Refund_find`, `BusinessUnit_findWithPermission`.

Refund và withdrawal theo order lần này nằm trong `Order_get.refunds` và `Order_get.withdrawals`.

---

## Catalog đủ 134 operation có tên

`read` = document là query hoặc REST GET. `WRITE` = mutation hoặc upload. Không gọi WRITE.

| Operation | Type | Dùng | Màn | Host | Biến |
|---|---|---|---|---|---|
| User_getByFirebaseId | query | read | /login | base-api.mindx.edu.vn | id |
| loginWithToken | mutation | WRITE | /login | base-api.mindx.edu.vn | idToken |
| GetCustomToken | mutation | WRITE | / | base-api.mindx.edu.vn | |
| User_getPermission | query | read | / | api.mindx.edu.vn | |
| User_findOne | query | read | / | api.mindx.edu.vn | |
| Query | query | read | / | gate-way.mindx.edu.vn | userGetByIdId |
| GetUserPermissionsAndMenuItems | query | read | /admin/dashboard | lms-api.mindx.edu.vn | userId |
| FindInfoInRoleById | mutation | WRITE | /admin/dashboard | lms-api.mindx.edu.vn | payload.id |
| Notification_findPaginate | query | read | / | api.mindx.edu.vn | query.page, query.limit, query.read |
| getCourseLines | query | read | /admin/dashboard | lms-api.mindx.edu.vn | |
| officeHoursCount_multi | query | read | /admin/dashboard | lms-api.mindx.edu.vn | payload_0, payload_1 |
| getCentres | query | read | /admin/dashboard | lms-api.mindx.edu.vn | pageIndex, itemsPerPage |
| classesCount_multi | query | read | /admin/dashboard | lms-api.mindx.edu.vn | payload_0, payload_1 |
| CountUnreadConversations | query | read | /admin/dashboard | lms-api.mindx.edu.vn | payload.memberId |
| classSlotSummariesCount_multi | query | read | /admin/dashboard | lms-api.mindx.edu.vn | payload_0, payload_1 |
| classSlotSummaries | query | read | /admin/dashboard | lms-api.mindx.edu.vn | payload.startTime_gte, payload.classStatus_in |
| EnrollmentRequestsCount | query | read | /admin/dashboard | lms-api.mindx.edu.vn | payload.status_eq |
| SalesmanAvailability_declarationHorizon | query | read | /leads | api.mindx.edu.vn | |
| BusinessUnit_findById | query | read | /leads | api.mindx.edu.vn | id |
| SalesmanAvailability_find | query | read | /leads | api.mindx.edu.vn | query.periodStart, query.periodEnd |
| OutgoingPhoneNumber_findPaginate | query | read | /leads | api.mindx.edu.vn | query |
| Customer_getListAgeRange | query | read | /leads | api.mindx.edu.vn | |
| CallVendor_find | query | read | /leads | api.mindx.edu.vn | |
| LeadStatuses_getList | query | read | /leads | api.mindx.edu.vn | query |
| MarketingProject_getAll | query | read | /leads | api.mindx.edu.vn | payload.isActive |
| City_find | query | read | /leads | api.mindx.edu.vn | input.country |
| Centre_find | query | read | /leads | api.mindx.edu.vn | query |
| Lead_getLearningMethods | query | read | /leads | api.mindx.edu.vn | |
| LeadConstraintConfig_fetch | query | read | /leads | api.mindx.edu.vn | input.search, input.page |
| Job_find | query | read | /leads | api.mindx.edu.vn | |
| BusinessDomain_getAll | query | read | /leads | api.mindx.edu.vn | query.status |
| UtmConfig_getAll | query | read | /leads | api.mindx.edu.vn | |
| ProductGroup_findAll | query | read | /leads | api.mindx.edu.vn | |
| Partner_getList | query | read | /leads | api.mindx.edu.vn | query.limit |
| ChannelGroup_find | query | read | /leads | api.mindx.edu.vn | |
| LeadStages_getList | query | read | /leads | api.mindx.edu.vn | query |
| LeadStages_getTree | query | read | /leads | api.mindx.edu.vn | |
| Country_find | query | read | /leads | api.mindx.edu.vn | input |
| Lead_getList | query | read | /leads | api.mindx.edu.vn | query.page, query.limit |
| BusinessUnit_findAll | query | read | /leads | api.mindx.edu.vn | query |
| ChurnReason_findPaginate | query | read | /leads | api.mindx.edu.vn | input |
| CustomerNeed_getList | query | read | /leads | api.mindx.edu.vn | query.limit |
| MarketingContent_getMarketingContentType | query | read | /leads | api.mindx.edu.vn | |
| LeadStatuses_getAllActive | query | read | /leads | api.mindx.edu.vn | |
| Call_getAccessToken | query | read | /leads | api.mindx.edu.vn | trả accessToken, không lưu |
| OutgoingPhoneNumber_getPhoneNumbers | query | read | /leads | api.mindx.edu.vn | vendorIds |
| MarketingContent_find | query | read | /leads | api.mindx.edu.vn | query |
| Lead_getById | query | read | /leads | api.mindx.edu.vn | id |
| Lead_getHistories | query | read | /leads | api.mindx.edu.vn | id |
| CustomerRegistration_findPaginate | query | read | /leads | api.mindx.edu.vn | query.leadId |
| MarketingContent_findById | query | read | /leads | api.mindx.edu.vn | id |
| User_findById | query | read | /leads | api.mindx.edu.vn | userId |
| City_findOne | query | read | /leads | api.mindx.edu.vn | input.code |
| School_find | query | read | /leads | api.mindx.edu.vn | input.city |
| Fulfillment_find | query | read | /leads | api.mindx.edu.vn | input.leadId |
| Order_get | query | read | /leads | api.mindx.edu.vn | leadId |
| OrderItemContract_findAll | query | read | /leads | api.mindx.edu.vn | input.leadId, input.code |
| OrderItemContract_countByStatus | query | read | /leads | api.mindx.edu.vn | input.leadId |
| User_find | query | read | /leads | api.mindx.edu.vn | |
| Reminder_findByLead | query | read | /leads | api.mindx.edu.vn | leadId |
| LeadMessage_getList | query | read | /leads | api.mindx.edu.vn | query.leadId |
| Appointment_findPaginate | query | read | /leads | api.mindx.edu.vn | payload.leadId |
| CallHistory_getList | query | read | /leads | api.mindx.edu.vn | query.customerId |
| Note_findByCustomer | query | read | /leads | api.mindx.edu.vn | id |
| Enrollment_sendRequest | mutation | WRITE | /leads | api.mindx.edu.vn | leadId, productItemId, enrollmentItemId, type |
| findOperationMethods | query | read | /admin/classes | lms-api.mindx.edu.vn | payload.pagination |
| getCourses | query | read | /admin/classes | lms-api.mindx.edu.vn | search, pageIndex |
| getRoles | query | read | /admin/classes | lms-api.mindx.edu.vn | isActive, pageIndex |
| GetTeachers | query | read | /admin/classes | lms-api.mindx.edu.vn | search, pageIndex |
| GetClassesOverviewSummary | query | read | /admin/classes | lms-api.mindx.edu.vn | from, to |
| GetClasses | query | read | /admin/classes | lms-api.mindx.edu.vn | search, centres, courses |
| getUsers | query | read | /admin/classes | lms-api.mindx.edu.vn | search, roles |
| GetClassById | query | read | /admin/classes | lms-api.mindx.edu.vn | id |
| getCourse | query | read | /admin/classes | lms-api.mindx.edu.vn | id |
| findOneCourseLine | query | read | /admin/classes | lms-api.mindx.edu.vn | id |
| FindStudentSubmissionByClass | query | read | /admin/classes | lms-api.mindx.edu.vn | payload.classId |
| GetEnrollmentRequests | query | read | /admin/classes | lms-api.mindx.edu.vn | class, cancelled |
| FindLearningMediums | query | read | /admin/classes | lms-api.mindx.edu.vn | pageIndex |
| FindClassStudent | query | read | /admin/classes | lms-api.mindx.edu.vn | classId |
| ConfigSystem_findByKey | query | read | /leads | api.mindx.edu.vn | key |
| POST /api/v1/resources | REST | WRITE | /leads | resources.mindx.edu.vn | upload |
| Order_addPayment | mutation | WRITE | /leads | api.mindx.edu.vn | leadId, payment, paymentAllocations |
| Enrollment_cancelRequest | mutation | WRITE | /leads | api.mindx.edu.vn | leadId, productItemId, enrollmentItemId |
| UpdateEnrollmentRequestStatus | mutation | WRITE | /admin/classes | lms-api.mindx.edu.vn | id, newStatus, enrollmentOperation |
| Class_find | query | read | /leads | api.mindx.edu.vn | input.lmsCourse |
| Course_find | query | read | /leads | api.mindx.edu.vn | input.appliedInFlexProducts |
| Enrollment_updateProductEnrollmentItem | mutation | WRITE | /leads | api.mindx.edu.vn | leadId, productItemId, courseId, classId |
| FindCourseVersionByClass | query | read | /admin/classes | lms-api.mindx.edu.vn | classId |
| GetClassPosts | query | read | /admin/classes | lms-api.mindx.edu.vn | payload.classId |
| findStudentHomeworkByClass | query | read | /admin/classes | lms-api.mindx.edu.vn | classId |
| findStudentFinalScorePagination | query | read | /admin/classes | lms-api.mindx.edu.vn | classId_in, sessionId_in |
| findStudentCheckpointPagination | query | read | /admin/classes | lms-api.mindx.edu.vn | classId_in |
| GetBulkMessages | query | read | /admin/classes | lms-api.mindx.edu.vn | class |
| FindMakeupAttenDanceByClassId | query | read | /admin/classes | lms-api.mindx.edu.vn | payload.classMakeupId |
| GetEmailTemplates | query | read | /admin/classes | lms-api.mindx.edu.vn | payload.systemCode_eq |
| studentMakeups | query | read | /admin/classes | lms-api.mindx.edu.vn | payload.makeupClassId_equals |
| FindAllWithClass | query | read | /admin/classes | lms-api.mindx.edu.vn | payload.classId, payload.sessionId |
| GetClassHistoriesById | query | read | /admin/classes | lms-api.mindx.edu.vn | id |
| CountStudentsByFilter | query | read | /admin/students | lms-api.mindx.edu.vn | search, status |
| getStudents | query | read | /admin/students | lms-api.mindx.edu.vn | search |
| studentRegistrations | query | read | /admin/students | lms-api.mindx.edu.vn | payload.studentId |
| LoadConversationMessages | query | read | /admin/students | lms-api.mindx.edu.vn | studentId |
| getUser | query | read | /admin/students | lms-api.mindx.edu.vn | id |
| GetAccessToken | query | read | /admin/students | lms-api.mindx.edu.vn | trả accessToken, không lưu |
| findStudentById | query | read | /admin/students | lms-api.mindx.edu.vn | id |
| FindStudentUpdateVipHistory | query | read | /admin/students | lms-api.mindx.edu.vn | payload.studentId |
| getStudent | query | read | /admin/students | lms-api.mindx.edu.vn | id |
| studentStudyClasses | query | read | /admin/students | lms-api.mindx.edu.vn | studentId |
| FindAllDropoutRequest | query | read | /admin/students | lms-api.mindx.edu.vn | studentId_equals |
| FindStudentProfileById | query | read | /admin/students | lms-api.mindx.edu.vn | id |
| Query | query | read | /admin/students | lms-api.mindx.edu.vn | pageIndex. Selection: findAllLearningMedium |
| Order_deletePayment | mutation | WRITE | /leads | api.mindx.edu.vn | leadId, paymentId |
| GetStudentsTasksSummary | query | read | /admin/students | lms-api.mindx.edu.vn | from, to, onholdStatusIn |
| getOnholdRequests | query | read | /admin/students | lms-api.mindx.edu.vn | filter.studentId_equals |
| FindPaginate | query | read | /admin/students | lms-api.mindx.edu.vn | search, pageIndex, isActive |
| FindByStudentId | query | read | /admin/students | lms-api.mindx.edu.vn | payload.studentId |
| findCallHistory | query | read | /admin/students | lms-api.mindx.edu.vn | customerId_equals |
| FindOneRewardPoint | query | read | /admin/students | lms-api.mindx.edu.vn | productUserId_eq |
| FindPaginateRewardTransaction | query | read | /admin/students | lms-api.mindx.edu.vn | productUserId_eq |
| FindStudentEnrollmentActivities | query | read | /admin/students | lms-api.mindx.edu.vn | studentId_eq, type_eq |
| findAllByCriteria | query | read | /admin/students | lms-api.mindx.edu.vn | payload.refId, payload.action |
| FindRequestTeacher | query | read | /admin/request-teacher | lms-api.mindx.edu.vn | filter.center_in |
| LeadPayment_getList | query | read | /payments | api.mindx.edu.vn | query.page, query.sort |
| GET /api/lms-courses | REST | read | /products | crm.mindx.edu.vn | |
| CourseLineV2_find | query | read | /products | api.mindx.edu.vn | input.isActive |
| ProductLines_findPagination | query | read | /products | api.mindx.edu.vn | input.pagination, input.filter |
| Courses_find | query | read | /products | api.mindx.edu.vn | input |
| Product_find | query | read | /products | api.mindx.edu.vn | query.page, query.limit |
| ProductTopic_find | query | read | /products | api.mindx.edu.vn | input |
| ContractTemplateConfig_getAll | query | read | /products | api.mindx.edu.vn | query.page, query.limit |
| ProductGroup_findPaginate | query | read | /product-groups | api.mindx.edu.vn | query.page, query.limit |
| Promotion_find | query | read | /promotions | api.mindx.edu.vn | query.page, query.limit |
| GET /api/roles | REST | read | /setting/users | crm.mindx.edu.vn | |
| User_findPaginate | query | read | /setting/users | api.mindx.edu.vn | input.page, input.limit |
