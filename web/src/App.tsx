import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowRight, ArrowUpRight, BookOpen, Check, CheckCheck, ChevronDown, CircleHelp, ClipboardList, Code2, FileText, GraduationCap, Info, Layers3, LoaderCircle, LockKeyhole, RefreshCw, RotateCcw, Search, ShieldCheck, Sparkles, X, AlertTriangle } from 'lucide-react';
import { DEFAULT_NOTE, studentCodeSchema, type Course, type Lesson, type LessonResult, type Meta, type Student, type Submission, type SubmissionDetail } from '../../shared/contracts.js';
import { blockedReason, canReopen, categoryLabel, isPractice, statusLabel } from '../../shared/rules.js';
import { api, ApiError } from './api.js';
import { ReopenDialog, type Selection } from './ReopenDialog.js';

type Filter = 'all' | 'available' | 'redo';
type Flash = { kind: 'success' | 'error' | 'warning'; message: string; requestId?: string };
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Không thể xử lý yêu cầu.';

export function App() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [contextError, setContextError] = useState('');
  const [code, setCode] = useState('26009543');
  const [student, setStudent] = useState<Student | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [enrollmentId, setEnrollmentId] = useState('');
  const [result, setResult] = useState<LessonResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [loadingLessons, setLoadingLessons] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [lessonError, setLessonError] = useState('');
  const [flash, setFlash] = useState<Flash | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [detail, setDetail] = useState<SubmissionDetail | null>(null);
  const [note, setNote] = useState(DEFAULT_NOTE);
  const [preparing, setPreparing] = useState(false);
  const [writing, setWriting] = useState(false);
  const [dialogError, setDialogError] = useState('');
  const [uncertainIds, setUncertainIds] = useState<Set<string>>(new Set());
  const searchController = useRef<AbortController | null>(null);
  const lessonController = useRef<AbortController | null>(null);
  const prepareController = useRef<AbortController | null>(null);
  const confirmLock = useRef(false);
  const course = courses.find(c => c.id === enrollmentId);

  const loadContext = useCallback(async (signal?: AbortSignal) => {
    setContextError('');
    try { setMeta(await api.context(signal)); }
    catch (error) { if (!signal?.aborted) setContextError(errorText(error)); }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void loadContext(controller.signal);
    return () => { controller.abort(); searchController.current?.abort(); lessonController.current?.abort(); prepareController.current?.abort(); };
  }, [loadContext]);

  async function search(event?: FormEvent, demoCode?: string) {
    event?.preventDefault();
    const parsed = studentCodeSchema.safeParse(demoCode ?? code);
    if (!parsed.success) { setSearchError(parsed.error.issues[0]?.message ?? 'Mã không hợp lệ.'); return; }
    if (demoCode) setCode(demoCode);
    searchController.current?.abort(); lessonController.current?.abort(); prepareController.current?.abort();
    const controller = new AbortController(); searchController.current = controller;
    setSearching(true); setLoadingLessons(false); setSearchError(''); setStudent(null); setCourses([]); setEnrollmentId(''); setResult(null); setLessonError(''); setFlash(null); setFilter('all');
    try {
      const data = await api.search(parsed.data, controller.signal);
      if (!controller.signal.aborted) { setStudent(data.student); setCourses(data.courses); }
    } catch (error) { if (!controller.signal.aborted) setSearchError(errorText(error)); }
    finally { if (!controller.signal.aborted) setSearching(false); }
  }
  async function fetchLessons(selected: string, currentStudent = student, keepResult = false) {
    lessonController.current?.abort();
    if (!selected || !currentStudent) { setResult(null); setLoadingLessons(false); return; }
    const controller = new AbortController(); lessonController.current = controller;
    setLoadingLessons(true); setLessonError('');
    if (!keepResult) setResult(null);
    try {
      const data = await api.lessons(currentStudent.studentId, selected, controller.signal);
      if (!controller.signal.aborted) {
        setResult(data);
        setUncertainIds(prev => { const next = new Set(prev); for (const lesson of data.lessons) for (const part of lesson.submissions) if (part.status === 'REDO') next.delete(part.id); return next; });
      }
    } catch (error) { if (!controller.signal.aborted) setLessonError(errorText(error)); }
    finally { if (!controller.signal.aborted) setLoadingLessons(false); }
  }
  function chooseCourse(id: string) { setEnrollmentId(id); setFilter('all'); setFlash(null); void fetchLessons(id); }
  async function openDialog(lesson: Lesson, submission: Submission) {
    if (!student || !course || !meta?.canReopen || !canReopen(submission) || uncertainIds.has(submission.id)) return;
    setSelection({ lesson, submission }); setDetail(null); setNote(DEFAULT_NOTE); setPreparing(true); setDialogError('');
    const controller = new AbortController(); prepareController.current = controller;
    try { const snapshot = await api.prepare(student.studentId, course.id, lesson.id, submission.id, controller.signal); if (!controller.signal.aborted) setDetail(snapshot); }
    catch (error) { if (!controller.signal.aborted) { setDialogError(errorText(error)); if (error instanceof ApiError && error.uncertain) setUncertainIds(prev => new Set(prev).add(submission.id)); } }
    finally { if (!controller.signal.aborted) setPreparing(false); }
  }
  function closeDialog() {
    if (writing) return;
    prepareController.current?.abort(); setSelection(null); setDetail(null); setPreparing(false);
  }
  async function confirm() {
    if (confirmLock.current || !student || !course || !selection || !detail || !note.trim() || !isPractice(detail.category)) return;
    confirmLock.current = true; setWriting(true); setDialogError(''); setFlash(null);
    const selected = selection;
    try {
      const response = await api.reopen({ studentCode: student.studentId, enrollmentId: course.id, studentLessonId: selected.lesson.id, submissionId: detail.id, expectedCategory: detail.category, expectedType: detail.type, expectedSubmittedCount: detail.submittedCount, note: note.trim() });
      setResult(prev => prev ? { ...prev, lessons: prev.lessons.map(l => ({ ...l, submissions: l.submissions.map(s => s.id === response.submission.id ? { ...s, status: response.submission.status, note: note.trim() } : s) })) } : prev);
      setFlash({ kind: 'success', message: `${categoryLabel(selected.submission.category)} · Buổi ${selected.lesson.sessionNumber ?? selected.lesson.displayOrder ?? '—'}: ${response.message}` });
    } catch (error) {
      const uncertain = error instanceof ApiError && error.uncertain;
      if (uncertain) setUncertainIds(prev => new Set(prev).add(selected.submission.id));
      setFlash({ kind: uncertain ? 'warning' : 'error', message: errorText(error), requestId: error instanceof ApiError ? error.requestId : undefined });
    } finally {
      setWriting(false); confirmLock.current = false; setSelection(null); setDetail(null);
      await fetchLessons(course.id, student, true);
    }
  }

  const lessons = result?.lessons ?? [];
  const practice = lessons.flatMap(l => l.submissions.filter(s => isPractice(s.category)));
  const available = practice.filter(canReopen).length;
  const redo = practice.filter(s => s.status === 'REDO').length;
  const visible = lessons.filter(l => filter === 'all' || l.submissions.some(s => filter === 'available' ? canReopen(s) : isPractice(s.category) && s.status === 'REDO'));
  const className = result?.classes.find(c => c.classId === course?.classId)?.className ?? course?.classId;

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="Denise Support"><span className="brand-mark">d<span>•</span></span><span>denise<small>SUPPORT WORKSPACE</small></span></a>
      <div className="workspace-label">CÔNG CỤ HỖ TRỢ</div>
      <div className="nav-item active"><RotateCcw size={19} /><span>Homework Reopen</span><span className="nav-dot" /></div>
      <div className="sidebar-note"><div className="sidebar-note-icon"><ShieldCheck size={21} /></div><strong>Đúng bài. Đúng phần.</strong><p>Mỗi thao tác chỉ mở lại một phần thực hành đã nộp.</p><span>HOMEWORK REOPEN V1 <ArrowUpRight size={13} /></span></div>
      <details className="sidebar-help"><summary><CircleHelp size={17} /> Hướng dẫn sử dụng <ChevronDown size={15} /></summary><p>Tìm đúng mã LMS, chọn khóa và phần thực hành đã nộp. Kiểm tra thông tin, nhập lý do rồi xác nhận. Chỉ thông báo thành công khi đã đọc lại trạng thái REDO.</p></details>
      <div className="profile"><div className="avatar small">TS</div><div><strong>Tech Support</strong><small>{meta?.mode === 'mock' ? 'Không gian demo' : 'Không gian nội bộ'}</small></div><span className="online-dot" /></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb">Support workspace <span>/</span><strong>Homework Reopen</strong></div><div className="topbar-right"><span className={`mode-badge ${meta?.mode === 'real' ? 'real' : ''}`}><span />{meta ? meta.mode === 'mock' ? 'Mock mode' : 'Real API' : 'Đang kết nối'}</span><span className="topbar-version">V1.0</span></div></header>
      <main>
        <div className="page-heading"><div><div className="eyebrow"><span /> DENISE SUPPORT TOOLS</div><h1>Homework Reopen<span>.</span></h1><p>Mở lại phần thực hành, để học viên tiếp tục điều còn dang dở.</p></div><div className="heading-icon"><BookOpen size={28} strokeWidth={1.6} /><RotateCcw size={15} /></div></div>
        <div className="steps" aria-label="Các bước thực hiện">{['Tìm học viên', 'Chọn khóa học', 'Mở lại & xác minh'].map((label, i) => <div key={label} className={`step ${(i === 0 && student) || (i === 1 && course) ? 'done' : ''} ${i === 0 && !student || i === 1 && student && !course || i === 2 && course ? 'current' : ''}`}><span>{(i === 0 && student) || (i === 1 && course) ? <Check size={13} /> : `0${i + 1}`}</span>{label}{i < 2 && <ArrowRight size={16} className="step-arrow" />}</div>)}</div>
        {contextError ? <div className="notice error" role="alert"><AlertTriangle size={18} /><div><strong>Chưa kết nối được workspace</strong><p>{contextError}</p></div><button className="text-button" onClick={() => void loadContext()}>Thử lại</button></div> : <div className="mode-notice"><Info size={16} /><span>{meta?.notice ?? 'Đang kết nối với máy chủ hỗ trợ…'}</span>{meta?.mode === 'mock' && <span className="demo-tag">DEMO</span>}</div>}
        <section className="search-card" aria-labelledby="search-title">
          <div className="section-title"><span className="section-icon"><Search size={18} /></span><div><h2 id="search-title">Tìm học viên</h2><p>Bắt đầu bằng mã học viên trên LMS.</p></div><span className="step-tag">BƯỚC 01</span></div>
          <form onSubmit={event => void search(event)} className="search-form"><div className="search-field"><label htmlFor="student-code">Mã học viên LMS</label><div className="input-with-icon"><GraduationCap size={19} /><input id="student-code" value={code} onChange={event => { setCode(event.target.value); setSearchError(''); }} inputMode="numeric" autoComplete="off" maxLength={20} placeholder="Ví dụ: 26009543" aria-invalid={!!searchError} disabled={searching || !!selection} /></div></div><button className="button primary search-button" disabled={searching || !meta || !!selection}>{searching ? <LoaderCircle size={17} className="spin" /> : <Search size={17} />}{searching ? 'Đang tìm…' : 'Tìm học viên'}<ArrowRight size={17} /></button></form>
          <div className="search-hint"><ShieldCheck size={14} /> Chỉ nhận kết quả trùng chính xác mã học viên.{meta?.mode === 'mock' && <button className="text-button demo-link" disabled={searching || !!selection} onClick={() => void search(undefined, '26009543')}>Thử với học viên demo <ArrowUpRight size={13} /></button>}</div>
          {searchError && <div className="notice error" role="alert"><AlertTriangle size={18} /><p>{searchError}</p></div>}
          {student && <div className="student-context"><div className="student-identity"><div className="avatar">{student.fullName.split(' ').filter(Boolean).slice(-2).map(v => v[0]).join('')}</div><div><div className="identity-label">HỌC VIÊN ĐÃ XÁC ĐỊNH <CheckCheck size={14} /></div><h3>{student.fullName}</h3><span>Mã LMS <strong>{student.studentId}</strong></span></div></div><div className="course-picker"><label htmlFor="course-select">Khóa học Denise <span>{courses.length} khóa học</span></label>{courses.length ? <div className="select-wrap"><BookOpen size={17} /><select id="course-select" value={enrollmentId} onChange={event => chooseCourse(event.target.value)} disabled={!!selection}><option value="">Chọn khóa học và lớp…</option>{courses.map(c => <option value={c.id} key={c.id}>{c.course.name} · {c.classId} · {c.status === 'COMPLETED' ? 'Đã kết thúc' : c.status === 'IN_PROGRESS' ? 'Đang học' : c.status}</option>)}</select><ChevronDown size={16} /></div> : <div className="no-course">Học viên chưa có khóa học Denise để lựa chọn.</div>}</div></div>}
        </section>

        {flash && <div className={`notice ${flash.kind}`} role={flash.kind === 'success' ? 'status' : 'alert'}>{flash.kind === 'success' ? <CheckCheck size={20} /> : <AlertTriangle size={20} />}<div><strong>{flash.kind === 'success' ? 'Đã xác minh kết quả' : flash.kind === 'warning' ? 'Cần kiểm tra kết quả' : 'Thao tác chưa hoàn tất'}</strong><p>{flash.message}</p>{flash.requestId && <small>Mã hỗ trợ: {flash.requestId}</small>}</div><button className="icon-button" aria-label="Đóng thông báo" onClick={() => setFlash(null)}><X size={16} /></button></div>}

        {student && course && <section className="homework-section" aria-labelledby="homework-title">
          <div className="homework-heading"><div><div className="eyebrow">BƯỚC 02 / 03</div><h2 id="homework-title">Bài tập về nhà <span>{lessons.length.toString().padStart(2, '0')}</span></h2><p>{course.course.name}<span className="middot">·</span>{className}</p></div><button className="button secondary refresh-button" disabled={loadingLessons || !!selection} onClick={() => void fetchLessons(course.id, student, true)}><RefreshCw size={16} className={loadingLessons ? 'spin' : ''} />Tải lại</button></div>
          {!meta?.canReopen && <div className="notice warning"><LockKeyhole size={18} /><p>Quyền mở lại trên API thật đang bị khóa. Bạn có thể xem dữ liệu và kiểm tra schema.</p></div>}
          {result && <div className="stats-row"><div><span className="stat-icon"><Layers3 size={20} /></span><span><strong>{lessons.length}</strong><small>Bài tập theo buổi</small></span></div><div><span className="stat-icon amber"><RotateCcw size={20} /></span><span><strong>{available}</strong><small>Phần có thể mở lại</small></span><span className="stat-caption">Đã nộp</span></div><div><span className="stat-icon green"><CheckCheck size={20} /></span><span><strong>{redo}</strong><small>Phần yêu cầu làm lại</small></span></div></div>}
          {result && <div className="list-toolbar"><div className="filter-tabs" role="group" aria-label="Lọc bài tập">{([{ id: 'all', label: 'Tất cả', count: lessons.length }, { id: 'available', label: 'Có thể mở lại', count: available }, { id: 'redo', label: 'Yêu cầu làm lại', count: redo }] as const).map(tab => <button key={tab.id} aria-pressed={filter === tab.id} className={filter === tab.id ? 'selected' : ''} onClick={() => setFilter(tab.id)}>{tab.label}<span>{tab.count}</span></button>)}</div><span className="sort-label"><ArrowDown size={13} /> Theo buổi học</span></div>}
          {lessonError && <div className="notice error" role="alert"><AlertTriangle size={18} /><p>{lessonError}</p><button className="text-button" disabled={loadingLessons} onClick={() => void fetchLessons(course.id, student, true)}>Thử tải lại</button></div>}
          {loadingLessons && !result ? <div className="loading-state" role="status"><LoaderCircle size={25} className="spin" /><strong>Đang tải bài tập và trạng thái…</strong><p>Chỉ lấy bài tập thuộc lớp đã chọn.</p></div> : result && !visible.length ? <div className="empty-state compact"><span className="empty-icon"><ClipboardList size={30} /></span><h3>{lessons.length ? 'Không có bài tập phù hợp bộ lọc' : 'Chưa có bài tập về nhà'}</h3><p>{lessons.length ? 'Chọn “Tất cả” để xem các trạng thái khác.' : 'Khóa học/lớp này chưa có BTVN trong phạm vi Homework Reopen.'}</p>{filter !== 'all' && <button className="button secondary" onClick={() => setFilter('all')}>Xem tất cả bài tập</button>}</div> : <div className="lesson-list" aria-busy={loadingLessons}>{visible.map(lesson => <HomeworkCard key={lesson.id} lesson={lesson} mode={meta?.mode ?? 'mock'} enabled={!!meta?.canReopen && !loadingLessons && !selection} uncertainIds={uncertainIds} onOpen={submission => void openDialog(lesson, submission)} />)}</div>}
          <div className="list-footnote"><ShieldCheck size={14} /><span>Chỉ mở lại phần thực hành đã nộp. Quiz và Checkpoint nằm ngoài phạm vi V1.</span></div>
        </section>}

        {!course && !searching && <section className="empty-state intro"><div className="empty-illustration"><div className="illus-sheet"><div /><div /><span><Check size={15} /> Thực hành <RotateCcw size={14} /></span><div /></div><span className="illus-bubble"><RotateCcw size={24} /></span><span className="illus-spark"><Sparkles size={18} /></span></div><div className="eyebrow">MỘT THAO TÁC, TIẾP TỤC HỌC TẬP</div><h2>{student ? 'Chọn khóa học để xem bài tập' : 'Bắt đầu từ một mã học viên'}</h2><p>{student ? 'Danh sách bài tập sẽ xuất hiện sau khi bạn chọn đúng khóa học và lớp.' : 'Tìm học viên, chọn khóa học và mở lại đúng phần thực hành đã nộp.'}</p><div className="intro-features"><span><ShieldCheck size={16} /> Kiểm tra trước thao tác</span><span><CheckCheck size={16} /> Xác minh sau khi mở</span></div></section>}
        {searching && <div className="loading-state" role="status"><LoaderCircle className="spin" size={24} /><strong>Đang tìm học viên và khóa học Denise…</strong></div>}
        <footer className="page-footer"><span>denise <span>/</span> Support tools</span><span><LockKeyhole size={12} /> Mỗi thao tác đều được kiểm tra và ghi nhận</span></footer>
      </main>
    </div>
    {selection && student && course && <ReopenDialog selection={selection} student={student} course={course} note={note} setNote={setNote} busy={writing} preparing={preparing} error={dialogError} ready={!!detail} mode={meta?.mode ?? 'mock'} onClose={closeDialog} onConfirm={() => void confirm()} />}
  </div>;
}

function HomeworkCard({ lesson, mode, enabled, uncertainIds, onOpen }: { lesson: Lesson; mode: 'mock' | 'real'; enabled: boolean; uncertainIds: Set<string>; onOpen: (submission: Submission) => void }) {
  const session = lesson.sessionNumber ?? lesson.displayOrder;
  const parts = lesson.submissions.filter(s => isPractice(s.category));
  const quizzes = lesson.submissions.filter(s => s.category === 'QUIZ');
  return <article className="homework-card"><div className="lesson-header"><div className="session-block"><small>BUỔI</small><strong>{session === null || session === undefined ? '—' : String(session).padStart(2, '0')}</strong></div><div className="lesson-title"><h3>{lesson.lesson.name}</h3><span>{parts.length} phần thực hành{quizzes.length > 0 && ` · ${quizzes.length} trắc nghiệm`}</span></div><span className={`lesson-state ${lesson.status === 'COMPLETED' ? 'completed' : ''}`}>{lesson.status === 'COMPLETED' ? <CheckCheck size={13} /> : <span className="tiny-dot" />}{lesson.status === 'COMPLETED' ? 'Bài đã hoàn thành' : lesson.status === 'IN_PROGRESS' ? 'Bài đang làm' : 'Trạng thái khác'}</span></div>
    <div className="submission-list">{lesson.submissions.map(submission => {
      const practice = isPractice(submission.category);
      const available = canReopen(submission);
      const uncertain = uncertainIds.has(submission.id);
      const typeLabel = submission.category === 'QUIZ' ? 'Câu hỏi trắc nghiệm' : mode === 'mock' && submission.type === 'SCRATCH' ? 'Dự án Scratch' : mode === 'mock' && submission.type === 'FILE_UPLOAD' ? 'Bài nộp file' : 'Phần thực hành';
      const reason = uncertain ? 'Kết quả chưa xác định. Cần kiểm tra trên Denise.' : !enabled && available ? 'Thao tác đang bị khóa hoặc dữ liệu đang được tải lại.' : blockedReason(submission);
      return <div className={`submission-row ${submission.category === 'QUIZ' ? 'quiz-row' : ''}`} key={submission.id}><span className="submission-icon">{submission.category === 'QUIZ' ? <ClipboardList size={17} /> : submission.type === 'FILE_UPLOAD' ? <FileText size={17} /> : <Code2 size={17} />}</span><div className="submission-name"><strong>{categoryLabel(submission.category)}</strong><small>{typeLabel}</small></div><span className={`status status-${submission.status.toLowerCase().replaceAll('_', '-')}`}>{submission.status === 'SUBMITTED' ? <span className="tiny-dot" /> : submission.status === 'REDO' ? <RotateCcw size={12} /> : submission.status === 'MARKED' ? <Check size={12} /> : null}{statusLabel(submission.status)}</span><div className="submission-action">{practice ? <button className={`button ${available && enabled && !uncertain ? 'reopen-button' : 'locked-button'}`} disabled={!available || !enabled || uncertain} title={reason || 'Mở lại phần thực hành này'} aria-label={`${available ? 'Mở lại' : 'Không khả dụng'} ${categoryLabel(submission.category)} · Buổi ${session ?? '—'}`} onClick={() => onOpen(submission)}>{available && !uncertain ? <RotateCcw size={14} /> : <LockKeyhole size={13} />}{uncertain ? 'Cần kiểm tra' : available ? 'Mở lại' : 'Không khả dụng'}{available && !uncertain && <ArrowUpRight size={13} />}</button> : <span className="quiz-scope">Không hỗ trợ mở lại</span>}</div></div>;
    })}</div>
  </article>;
}
