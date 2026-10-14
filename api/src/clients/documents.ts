// Documents copied from Denise_Homework_Reopen_V1_Plan.md. Schema NOT yet verified against a real endpoint.
export const FIND_LMS_STUDENT = `query FindLmsStudentByCode($p: StudentQuery) {
  students(payload: $p) {
    data { id fullName studentId }
    pagination { total }
  }
}`;
export const FIND_COURSES = `query StudentCourse_findAll($in: FindAllInput!) {
  StudentCourse_findAll(findAllInput: $in) {
    id studentUid courseId classId status courseVersionId isDeleted
    course { id name code operationCourses }
  }
}`;
export const FIND_LESSONS = `query StudentLesson_find($p: FindStudentLesson!) {
  StudentLesson_find(findStudentLesson: $p) {
    course { id name }
    classes { classId className }
    lessons {
      id lessonId classId sessionNumber displayOrder availableAt status type
      lesson { id name type }
      submissions { id category type status score note }
    }
  }
}`;
export const FIND_SUBMISSION = `query StudentSubmission_findById($id: String!) {
  StudentSubmission_findById(id: $id) {
    id status category type submittedCount classId lessonId
  }
}`;
export const REQUEST_REDO = `mutation StudentSubmission_requestRedoSubmission($payload: RequestRedoSubmissionInput!) {
  StudentSubmission_requestRedoSubmission(payload: $payload) { id status note }
}`;
