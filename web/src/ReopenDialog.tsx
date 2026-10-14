import { useEffect, useRef } from 'react';
import { AlertTriangle, ArrowUpRight, Check, FileText, LoaderCircle, RotateCcw, X } from 'lucide-react';
import { DEFAULT_NOTE, FILE_WARNING, type Course, type Lesson, type Student, type Submission } from '../../shared/contracts.js';
import { categoryLabel } from '../../shared/rules.js';

export interface Selection { lesson: Lesson; submission: Submission }
export function ReopenDialog({ selection, student, course, note, setNote, busy, preparing, error, ready, mode, onClose, onConfirm }: {
  selection: Selection; student: Student; course: Course; note: string; setNote: (value: string) => void;
  busy: boolean; preparing: boolean; error: string; ready: boolean; mode: 'mock' | 'real'; onClose: () => void; onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const el = dialog.current!;
    el.showModal();
    cancelButton.current?.focus();
    return () => { el.close(); };
  }, []);
  const { lesson, submission } = selection;
  const fileLike = mode === 'real' || submission.type !== 'SCRATCH';
  return <dialog ref={dialog} className="reopen-dialog" aria-labelledby="dialog-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }} onClick={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div className="dialog-top"><span className="dialog-symbol"><RotateCcw size={24} /></span><button className="icon-button" aria-label="Đóng xác nhận" disabled={busy} onClick={onClose}><X size={20} /></button></div>
    <div className="eyebrow">XÁC NHẬN THAO TÁC</div>
    <h2 id="dialog-title">Mở lại phần thực hành?</h2>
    <p className="muted">Học viên sẽ nhận yêu cầu làm lại phần được chọn.</p>
    <dl className="confirm-details">
      <div><dt>Học viên</dt><dd>{student.fullName} <span className="muted">· {student.studentId}</span></dd></div>
      <div><dt>Khóa học</dt><dd>{course.course.name}<small>{course.classId}</small></dd></div>
      <div><dt>Bài tập</dt><dd>Buổi {lesson.sessionNumber ?? lesson.displayOrder ?? '—'} · {lesson.lesson.name}</dd></div>
      <div><dt>Phần mở lại</dt><dd><span className="part-chip">{categoryLabel(submission.category)}</span><span className="status status-submitted">Đã nộp</span></dd></div>
    </dl>
    {fileLike && <div className="notice warning"><FileText size={18} /><div><strong>{mode === 'real' ? 'Lưu ý bài có tệp đính kèm' : 'Lưu ý khi nộp file'}</strong><p>{FILE_WARNING}</p></div></div>}
    <label className="note-label" htmlFor="reopen-note">Lý do mở lại <span>*</span></label>
    <textarea id="reopen-note" value={note} onChange={event => setNote(event.target.value)} maxLength={1000} rows={3} disabled={busy} placeholder={DEFAULT_NOTE} aria-describedby="note-hint" />
    <div className="note-caption"><span id="note-hint">Học viên và giáo viên có thể nhìn thấy lý do này.</span><span>{note.length}/1000</span></div>
    {preparing && <div className="inline-status"><LoaderCircle size={16} className="spin" /> Đang kiểm tra lại bài nộp…</div>}
    {error && <div className="notice error" role="alert"><AlertTriangle size={18} /><p>{error}</p></div>}
    {ready && !error && <div className="inline-status verified"><Check size={16} /> Đã kiểm tra đúng phần thực hành và trạng thái.</div>}
    <div className="dialog-footer"><button ref={cancelButton} className="button secondary" disabled={busy} onClick={onClose}>Hủy</button><button className="button primary" disabled={!ready || preparing || busy || !note.trim() || !!error} onClick={onConfirm}>{busy ? <><LoaderCircle size={17} className="spin" /> Đang mở và xác minh…</> : <><RotateCcw size={17} /> Xác nhận mở lại <ArrowUpRight size={16} /></>}</button></div>
  </dialog>;
}
