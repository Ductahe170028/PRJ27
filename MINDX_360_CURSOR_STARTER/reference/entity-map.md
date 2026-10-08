# Entity map — chỉ quan hệ đã thấy trên cùng một object

Ngày: 2026-09-25. Không suy foreign key từ tên nếu response hoặc document GraphQL chưa trả field đó.

## CRM, trên lead detail

```
Lead_getById
  id
  centreId
  ownerId
  businessUnitId
  businessDomainId
  preferredCenterId
  customer.id
  customer.contact.id
  customer.familyMembers[].id
  customer.familyMembers[].relation
  customer.familyMembers[].contact
  customer.activeLead.id
  products[].productId
  products[].candidateId

Order_get (biến leadId)
  id
  leadId
  payments[].id
  payments[].confirmType
  payments[].customerDebitId
  productItems[].id
  productItems[].product.id
  refunds[].id
  withdrawals[].id

Fulfillment_find (biến leadId)
  productItemId
  candidate.id
  product.id
  product.single.course.id
  isTransferred
  enrollments[].id
  enrollments[].course
  enrollments[].class
  enrollments[].status

OrderItemContract_findAll (biến leadId)
  id
  orderItemId
  ownerId
  businessUnitId

CallHistory_getList
  biến query.customerId

Note_findByCustomer
  biến id
```

## LMS, trên học viên / lớp

```
findStudentById
  id
  crmContactId
  studentId
  totalEnrolledSlot

studentRegistrations (biến studentId)
  id
  studentId
  leadId
  fulfillmentId
  enrollmentSlots[].id
  enrollmentSlots[].class
  enrollmentSlots[].course
  enrollmentSlots[].openStatus
  enrollmentSlots[].paid
  enrollmentSlots[].learningMediumId

getStudent / getStudents
  id
  customer._id
  studyClasses[].id
  productItems

FindClassStudent (biến classId)
  classId
  studentId
  learningMediumId

GetEnrollmentRequests
  id
  student.id
  student.customer
  course.id
  class.id
  centre.id
  type
  status
```

## Cạnh đã chứng minh

```
Lead.id
  ← Order_get.leadId
  ← Fulfillment_find.leadId
  ← OrderItemContract_findAll.leadId
  ← studentRegistrations.leadId

Fulfillment.productItemId
  ← Order_addPayment.paymentAllocations[].productItemId
    (chỉ thấy trên mutation ghi, không có query đọc allocation)

studentRegistrations.fulfillmentId
studentRegistrations.leadId

findStudentById.crmContactId
```

`crmContactId` có trên học viên LMS. Chưa thấy response nào đặt nó cạnh `customer.id` của CRM trong cùng một object, nên chưa khẳng định hai id bằng nhau.

`enrollments[].course` và `enrollments[].class` trên fulfillment có tên field. Chưa bung thành `course.id` / `class.id` trong response lần này.

## Chưa chứng minh

- Search CRM theo số điện thoại trả về đúng một customer
- `customer.id` CRM = `customer._id` LMS = `crmContactId`
- Query đọc allocation (allocated / remaining theo product item). Shape allocation chỉ thấy trên mutation `Order_addPayment`
- API đọc riêng cho transfer. Chỉ thấy field `isTransferred`
- Mã quyền nào cho phép xem lead / enroll
- `payments[].confirmType` ứng với trạng thái “Đã xác nhận” trên UI
