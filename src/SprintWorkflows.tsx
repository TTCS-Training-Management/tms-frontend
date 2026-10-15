import { useCallback, useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import './SprintWorkflows.css'

type ModuleKey = 'attendance' | 'materials' | 'assignments' | 'grades' | 'billing' | 'surveys' | 'reports'
type Permission = 'R' | 'W' | 'F'
type User = { id: number; full_name: string; email: string; roles: string[] }
type Api = <T>(path: string, options?: RequestInit) => Promise<T>
type Props = { module: ModuleKey; permission: Permission; user: User; request: Api; notify: (message: string, tone?: 'success' | 'error') => void }
type Row = Record<string, any>
type TrainingClass = { id: number; name: string; program_id: number; status: string }
type Assignment = { id: number; class_id: number; subject_id: number; lesson_id?: number; title: string; description: string; due_at: string; max_score: number; state: string; late_policy: string; attachments: Row[]; submission?: Row | null }
type AttendanceSummary = { class_id: number; class_name: string; threshold_percent: number; lessons: Row[]; items: Row[] }
type BillingPlan = { id: number; student_id: number; student_name: string; student_code: string; class_id: number; class_name: string; tuition_amount: number; discount_amount: number; amount_due: number; received: number; remaining: number; installments: Row[] }

const apiBase = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000'
const dateInput = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const localDateTime = (d: Date) => `${dateInput(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
const json = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) })
const money = (value: number) => `${Number(value || 0).toLocaleString('vi-VN')} ₫`
const displayDate = (value?: string) => value ? new Date(value).toLocaleString('vi-VN') : '—'

function Panel({ title, children, action }: { title?: string; children: ReactNode; action?: ReactNode }) {
  return <section className="wf-panel">{(title || action) && <header><h2>{title}</h2>{action}</header>}{children}</section>
}
function Input({ label, children }: { label: string; children: ReactNode }) {
  return <label className="wf-field"><span>{label}</span>{children}</label>
}
function Grid({ children }: { children: ReactNode }) { return <div className="wf-grid">{children}</div> }
function Empty({ text = 'Chưa có dữ liệu.' }: { text?: string }) { return <p className="wf-empty">{text}</p> }
function RefreshButton({ loading, onClick, notify, hasData }: { loading: boolean; onClick: () => void | Promise<void>; notify?: Props['notify']; hasData?: boolean }) {
  const [internalLoading, setInternalLoading] = useState(false)
  const isSpinning = loading || internalLoading

  async function handleClick() {
    if (isSpinning) return
    setInternalLoading(true)
    const start = Date.now()
    try {
      await Promise.resolve(onClick())
      const elapsed = Date.now() - start
      if (elapsed < 1000) await new Promise((r) => setTimeout(r, 1000 - elapsed))
      if (notify) {
        if (hasData === false) {
          notify('Không có dữ liệu', 'error')
        } else {
          notify('Tải thành công', 'success')
        }
      }
    } catch (e) {
      if (notify) notify(e instanceof Error ? e.message : 'Tải lại thất bại.', 'error')
    } finally {
      setInternalLoading(false)
    }
  }

  return (
    <button className="wf-button" type="button" onClick={() => void handleClick()} disabled={isSpinning} aria-busy={isSpinning}>
      <span className={`wf-refresh-icon${isSpinning ? ' is-loading' : ''}`} aria-hidden="true">↻</span>
      {isSpinning ? 'Đang tải…' : 'Làm lại'}
    </button>
  )
}
function DataTable({ rows, columns }: { rows: Row[]; columns: [string, (row: Row, index?: number) => ReactNode][] }) {
  if (!rows.length) return <Empty />
  const hasSTT = columns.some(([name]) => name === 'STT')
  return (
    <div className="wf-table-wrap">
      <table className="wf-table">
        <thead>
          <tr>
            {!hasSTT && <th style={{ width: '60px', textAlign: 'center' }}>STT</th>}
            {columns.map(([name]) => <th key={name}>{name}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.id ?? row.student_id ?? `${i}`}>
              {!hasSTT && <td style={{ textAlign: 'center', color: '#64748b', fontWeight: 500 }}>{i + 1}</td>}
              {columns.map(([name, render]) => <td key={name}>{render(row, i)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
function DownloadButton({ path, label, notify }: { path: string; label: string; notify: Props['notify'] }) {
  const [busy, setBusy] = useState(false)
  async function download() {
    setBusy(true)
    try {
      const token = localStorage.getItem('tms_token')
      const response = await fetch(`${apiBase}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      if (!response.ok) throw new Error(`Không thể tải tệp (${response.status}).`)
      const blob = await response.blob()
      const disposition = response.headers.get('Content-Disposition') ?? ''
      const filename = disposition.match(/filename="?([^"]+)"?/i)?.[1] ?? 'tms-export.xlsx'
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Không thể tải tệp.', 'error')
    } finally {
      setBusy(false)
    }
  }
  return <button className="wf-button" type="button" disabled={busy} onClick={() => void download()}>{busy ? 'Đang tải…' : label}</button>
}

export default function SprintWorkflows({ module, permission, user, request, notify }: Props) {
  const canWrite = permission !== 'R'
  const isStudent = user.roles.includes('student')
  const [classes, setClasses] = useState<TrainingClass[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [attendanceClassId, setAttendanceClassId] = useState('')
  const [attendanceSummary, setAttendanceSummary] = useState<AttendanceSummary | null>(null)
  const [policies, setPolicies] = useState<Row[]>([])
  const [policyDraft, setPolicyDraft] = useState<Record<number, string>>({})
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [selectedAssignment, setSelectedAssignment] = useState<Assignment | null>(null)
  const [submissions, setSubmissions] = useState<Row[]>([])
  const [gradeInputs, setGradeInputs] = useState<Record<number, { score: string; feedback: string }>>({})
  const [submissionRepo, setSubmissionRepo] = useState('')
  const [submissionFiles, setSubmissionFiles] = useState<FileList | null>(null)
  const [assignmentForm, setAssignmentForm] = useState({ class_id: '', subject_id: '', lesson_id: '', title: '', description: '', due_at: localDateTime(new Date(Date.now() + 86400000)), max_score: '10', late_policy: 'accept' })
  const [materials, setMaterials] = useState<Row[]>([])
  const [announcements, setAnnouncements] = useState<Row[]>([])
  const [notifications, setNotifications] = useState<Row[]>([])
  const [materialForm, setMaterialForm] = useState({ class_id: '', lesson_id: '', title: '', external_url: '', available_early: false, file: null as File | null })
  const [announcementForm, setAnnouncementForm] = useState({ class_ids: '', title: '', body: '' })
  const [gradeConfigs, setGradeConfigs] = useState<Row[]>([])
  const [gradeForm, setGradeForm] = useState({ program_id: '', subject_id: '', class_id: '', passing_score: '5', critical_score: '0', components: 'Chuyên cần:20,Bài tập:30,Thi cuối kỳ:50' })
  const [componentLink, setComponentLink] = useState({ component_id: '', assignment_id: '' })
  const [transcript, setTranscript] = useState<Row | null>(null)
  const [billingPlans, setBillingPlans] = useState<BillingPlan[]>([])
  const [feeSchedules, setFeeSchedules] = useState<Row[]>([])
  const [discountRequests, setDiscountRequests] = useState<Row[]>([])
  const [feeForm, setFeeForm] = useState({ program_id: '', name: '', amount: '', effective_from: dateInput(new Date()) })
  const [planForm, setPlanForm] = useState({ student_id: '', class_id: '', tuition_amount: '', amounts: '', due_dates: '' })
  const [paymentForm, setPaymentForm] = useState({ installment_id: '', amount: '', method: 'bank_transfer', note: '' })
  const [discountForm, setDiscountForm] = useState({ plan_id: '', amount: '', percent: '', reason: '' })
  const [revenue, setRevenue] = useState<Row | null>(null)
  const [revenueDates, setRevenueDates] = useState({ from_date: dateInput(new Date(new Date().getFullYear(), new Date().getMonth(), 1)), to_date: dateInput(new Date()) })
  const [surveys, setSurveys] = useState<Row[]>([])
  const [selectedSurvey, setSelectedSurvey] = useState<Row | null>(null)
  const [surveyAnswers, setSurveyAnswers] = useState<Record<number, string>>({})
  const [surveyForm, setSurveyForm] = useState({ class_id: '', title: 'Khảo sát chất lượng cuối khóa', due_at: localDateTime(new Date(Date.now() + 7 * 86400000)), questions: 'rating|Chất lượng giảng dạy\nrating|Tài liệu học tập\ntext|Góp ý thêm' })
  const [surveyResults, setSurveyResults] = useState<Row | null>(null)
  const [dashboard, setDashboard] = useState<Row | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      if (module === 'attendance') {
        const [classRows, policyRows] = await Promise.all([
          request<Row[] | { items: Row[] }>('/training/classes'),
          request<Row[]>('/attendance/policies'),
        ])
        const normalized = Array.isArray(classRows) ? classRows : classRows.items
        setClasses(normalized as TrainingClass[])
        setPolicies(policyRows)
      } else if (module === 'assignments') {
        const [rows, classRows] = await Promise.all([
          request<Assignment[]>('/assignments'),
          request<Row[] | { items: Row[] }>('/training/classes'),
        ])
        setAssignments(rows)
        const normalized = Array.isArray(classRows) ? classRows : classRows.items
        setClasses(normalized as TrainingClass[])
        setSelectedAssignment((current) => rows.find((row) => row.id === current?.id) ?? rows[0] ?? null)
      } else if (module === 'materials') {
        const [items, notices, inbox] = await Promise.all([
          request<Row[]>('/materials'),
          request<Row[]>('/announcements'),
          request<{ items: Row[] }>('/notifications'),
        ])
        setMaterials(items); setAnnouncements(notices); setNotifications(inbox.items)
        const classRows = await request<Row[] | { items: Row[] }>('/training/classes')
        setClasses((Array.isArray(classRows) ? classRows : classRows.items) as TrainingClass[])
      } else if (module === 'grades') {
        const [configs, classRows] = await Promise.all([
          request<Row[]>('/grades/config'),
          request<Row[] | { items: Row[] }>('/training/classes'),
        ])
        setGradeConfigs(configs)
        setClasses((Array.isArray(classRows) ? classRows : classRows.items) as TrainingClass[])
        if (isStudent) setTranscript(await request<Row>('/grades/transcript'))
      } else if (module === 'billing') {
        const [plans, schedules, discounts] = await Promise.all([
          request<BillingPlan[]>('/billing/plans'),
          request<Row[]>('/billing/fee-schedules'),
          request<Row[]>('/billing/discount-requests'),
        ])
        setBillingPlans(plans); setFeeSchedules(schedules); setDiscountRequests(discounts)
        const classRows = await request<Row[] | { items: Row[] }>('/training/classes')
        setClasses((Array.isArray(classRows) ? classRows : classRows.items) as TrainingClass[])
      } else if (module === 'surveys') {
        const rows = await request<Row[]>('/surveys')
        setSurveys(rows)
        const classRows = await request<Row[] | { items: Row[] }>('/training/classes')
        setClasses((Array.isArray(classRows) ? classRows : classRows.items) as TrainingClass[])
        setSelectedSurvey((current) => rows.find((row) => row.id === current?.id) ?? rows.find((row) => !row.responded) ?? rows[0] ?? null)
      } else if (module === 'reports') {
        const [summary, risks] = await Promise.all([
          request<Row>('/reports/dashboard'),
          request<Row[]>('/reports/attendance-risk'),
        ])
        setDashboard({ ...summary, risk_details: risks })
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Không thể tải dữ liệu.'
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [isStudent, module, request])

  useEffect(() => { void load() }, [load])

  async function run<T>(action: () => Promise<T>, success: string | ((result: T) => { message: string; tone?: 'success' | 'error' }), reload = true) {
    setBusy(true)
    try {
      const result = await action()
      const feedback = typeof success === 'function' ? success(result) : { message: success }
      notify(feedback.message, feedback.tone ?? 'success')
      if (reload) await load()
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : 'Không thể hoàn thành thao tác.', 'error')
    } finally {
      setBusy(false)
    }
  }
  async function loadAttendanceClass(id: string) {
    setAttendanceClassId(id)
    setAttendanceSummary(null)
    if (!id) return
    try { setAttendanceSummary(await request<AttendanceSummary>(`/attendance/classes/${id}/summary`)) }
    catch (cause) { notify(cause instanceof Error ? cause.message : 'Không thể tải chuyên cần.', 'error') }
  }
  async function loadSubmissions(assignment: Assignment) {
    setSelectedAssignment(assignment)
    if (isStudent) return
    try {
      const rows = await request<Row[]>(`/assignments/${assignment.id}/submissions`)
      setSubmissions(rows)
      setGradeInputs(Object.fromEntries(rows.filter((row) => row.submission).map((row) => [row.submission.id, {
        score: String(row.submission.grade?.score ?? ''), feedback: row.submission.grade?.feedback ?? '',
      }])))
    } catch (cause) { notify(cause instanceof Error ? cause.message : 'Không thể tải bài nộp.', 'error') }
  }

  if (module === 'attendance') return <section className="wf-page">
    <header className="wf-heading"><div><small>SPRINT 5 · CHUYÊN CẦN</small><h1>Chuyên cần & cảnh báo rủi ro</h1><p>Theo dõi ma trận điểm danh, ngưỡng vắng theo chương trình và xuất báo cáo Excel.</p></div><RefreshButton loading={loading} onClick={() => void load()} notify={notify} /></header>
    {error && <div className="wf-error" role="alert">{error}</div>}
    <Panel title="Chọn lớp"><Grid><Input label="Lớp"><select value={attendanceClassId} onChange={(e) => void loadAttendanceClass(e.target.value)}><option value="">Chọn lớp để xem chuyên cần</option>{classes.map((row) => <option value={row.id} key={row.id}>{row.name}</option>)}</select></Input>{attendanceSummary && <div className="wf-summary">Ngưỡng cảnh báo mặc định: <strong>{attendanceSummary.threshold_percent}% vắng</strong></div>}</Grid></Panel>
    {attendanceSummary && <Panel title={attendanceSummary.class_name} action={<DownloadButton path={`/attendance/classes/${attendanceSummary.class_id}/summary.xlsx`} label="Xuất Excel" notify={notify} />}><DataTable rows={attendanceSummary.items} columns={[
      ['Học viên', (r) => <><strong>{r.student_name}</strong><small>{r.student_code}</small></>],
      ['Chuyên cần', (r) => `${r.attendance_percent}%`],
      ['Số buổi vắng', (r) => `${r.absence_count} (không phép ${r.unexcused_count})`],
      ['Trạng thái', (r) => <span className={r.at_risk ? 'wf-risk' : 'wf-ok'}>{r.at_risk ? `Cảnh báo · ≥${r.threshold_percent}% vắng` : 'Ổn định'}</span>],
      ['Theo buổi', (r) => r.statuses.map((s: string | null, i: number) => <span className="wf-attendance-cell" title={attendanceSummary.lessons[i]?.title} key={i}>{({ present: '✓', late: 'M', excused: 'P', unexcused: 'V' } as Record<string, string>)[s ?? ''] ?? '·'}</span>)],
    ]} /></Panel>}
    {canWrite && !isStudent && <Panel title="Ngưỡng cảnh báo theo chương trình"><DataTable rows={policies} columns={[
      ['Chương trình', (r) => r.program_name],
      ['Ngưỡng vắng (%)', (r) => <input type="number" min="1" max="100" value={policyDraft[r.program_id] ?? r.absence_threshold_percent} onChange={(e) => setPolicyDraft({ ...policyDraft, [r.program_id]: e.target.value })} />],
      ['Lưu', (r) => <button className="wf-button" disabled={busy} onClick={() => void run(() => request(`/attendance/policies/${r.program_id}`, { method: 'PUT', body: JSON.stringify({ absence_threshold_percent: Number(policyDraft[r.program_id] ?? r.absence_threshold_percent) }) }), 'Đã cập nhật ngưỡng cảnh báo.')}>Lưu</button>],
    ]} /></Panel>}
  </section>

  if (module === 'assignments') return <section className="wf-page">
    <header className="wf-heading"><div><small>SPRINT 5–6 · BÀI TẬP</small><h1>Bài tập & chấm điểm</h1><p>Giao bài, quản lý nộp nhiều phiên bản, chấm điểm, công bố hoặc yêu cầu làm lại.</p></div><RefreshButton loading={loading} onClick={() => void load()} notify={notify} hasData={assignments.length > 0} /></header>
    {error && <div className="wf-error" role="alert">{error}</div>}
    {canWrite && !isStudent && <Panel title="Tạo bài tập (lưu nháp hoặc giao ngay)"><form onSubmit={(e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const state = ((e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.dataset.state ?? 'draft'; void run(async () => {
      const payload = { ...assignmentForm, class_id: Number(assignmentForm.class_id), subject_id: Number(assignmentForm.subject_id), lesson_id: assignmentForm.lesson_id ? Number(assignmentForm.lesson_id) : null, max_score: Number(assignmentForm.max_score), due_at: new Date(assignmentForm.due_at).toISOString(), state }
      return request('/assignments', json(payload))
    }, 'Đã lưu bài tập.') }}><Grid>
      <Input label="Lớp ID"><input required type="number" min="1" value={assignmentForm.class_id} onChange={(e) => setAssignmentForm({ ...assignmentForm, class_id: e.target.value })} /></Input>
      <Input label="Môn học ID"><input required type="number" min="1" value={assignmentForm.subject_id} onChange={(e) => setAssignmentForm({ ...assignmentForm, subject_id: e.target.value })} /></Input>
      <Input label="Buổi học ID (tuỳ chọn)"><input type="number" min="1" value={assignmentForm.lesson_id} onChange={(e) => setAssignmentForm({ ...assignmentForm, lesson_id: e.target.value })} /></Input>
      <Input label="Tiêu đề"><input required maxLength={200} value={assignmentForm.title} onChange={(e) => setAssignmentForm({ ...assignmentForm, title: e.target.value })} /></Input>
      <Input label="Hạn nộp"><input required type="datetime-local" value={assignmentForm.due_at} onChange={(e) => setAssignmentForm({ ...assignmentForm, due_at: e.target.value })} /></Input>
      <Input label="Điểm tối đa"><input required type="number" min="0.1" step="0.1" value={assignmentForm.max_score} onChange={(e) => setAssignmentForm({ ...assignmentForm, max_score: e.target.value })} /></Input>
      <Input label="Nộp muộn"><select value={assignmentForm.late_policy} onChange={(e) => setAssignmentForm({ ...assignmentForm, late_policy: e.target.value })}><option value="accept">Cho nộp và đánh dấu muộn</option><option value="block">Chặn nộp muộn</option></select></Input>
      <Input label="Mô tả"><textarea value={assignmentForm.description} onChange={(e) => setAssignmentForm({ ...assignmentForm, description: e.target.value })} /></Input>
    </Grid><div className="wf-actions"><button className="wf-button" disabled={busy} data-state="draft">Lưu nháp</button><button className="wf-primary" disabled={busy} data-state="published">Giao bài</button></div></form></Panel>}
    <Panel title={isStudent ? 'Bài tập được giao' : 'Danh sách bài tập'}><DataTable rows={assignments} columns={[
      ['Bài tập', (r) => <button className="wf-link" onClick={() => void loadSubmissions(r as Assignment)}>{r.title}</button>],
      ['Lớp / môn', (r) => `#${r.class_id} / #${r.subject_id}`],
      ['Hạn nộp', (r) => displayDate(r.due_at)],
      ['Trạng thái', (r) => r.submission ? `${r.submission.state} · ${r.submission.current_version} phiên bản` : r.state],
      ['Điểm', (r) => r.submission?.grade ? `${r.submission.grade.score}/${r.max_score}` : '—'],
    ]} /></Panel>
    {selectedAssignment && isStudent && <Panel title={`Nộp bài: ${selectedAssignment.title}`}><p>{selectedAssignment.description}</p>{selectedAssignment.submission && selectedAssignment.submission.versions?.length > 0 && <DataTable rows={selectedAssignment.submission.versions} columns={[
      ['Phiên bản', (r) => `#${r.version_number}${r.is_late ? ' · Nộp muộn' : ''}`],
      ['Thời điểm', (r) => displayDate(r.submitted_at)],
      ['Repo', (r) => r.repo_url ? <a href={r.repo_url} target="_blank" rel="noreferrer">Mở liên kết ↗</a> : '—'],
      ['Tệp', (r) => (r.files ?? []).map((f: Row) => <a className="wf-file-link" href={`${apiBase}/submissions/files/${encodeURIComponent(f.storage_name)}`} key={f.storage_name} onClick={(e) => { const token = localStorage.getItem('tms_token'); if (!token) return; e.preventDefault(); void fetch(e.currentTarget.href, { headers: { Authorization: `Bearer ${token}` } }).then((res) => res.blob()).then((blob) => { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = f.file_name; a.click(); URL.revokeObjectURL(url) }).catch(() => notify('Không thể tải tệp nộp.', 'error')) }}>{f.file_name}</a>)],
    ]} />}
      {selectedAssignment.submission?.grade && <p className="wf-success">Điểm đã công bố: {selectedAssignment.submission.grade.score}/{selectedAssignment.max_score} · {selectedAssignment.submission.grade.feedback}</p>}
      <form onSubmit={(e) => { e.preventDefault(); const data = new FormData(); Array.from(submissionFiles ?? []).forEach((file) => data.append('files', file)); const query = submissionRepo.trim() ? `?repo_url=${encodeURIComponent(submissionRepo.trim())}` : ''; void run(() => request(`/assignments/${selectedAssignment.id}/submissions${query}`, { method: 'POST', body: data }), 'Đã nộp bài.') }}>
        <Grid><Input label="Liên kết repo HTTPS"><input type="url" placeholder="https://github.com/..." value={submissionRepo} onChange={(e) => setSubmissionRepo(e.target.value)} /></Input><Input label="Tệp (tối đa 10, mỗi tệp 20MB)"><input type="file" multiple onChange={(e) => setSubmissionFiles(e.target.files)} /></Input></Grid><button className="wf-primary" disabled={busy}>Nộp bài / tạo phiên bản mới</button>
      </form>
    </Panel>}
    {selectedAssignment && !isStudent && <Panel title={`Bài nộp · ${selectedAssignment.title}`}><DataTable rows={submissions} columns={[
      ['Học viên', (r) => `${r.student_name} · ${r.student_code}`],
      ['Trạng thái', (r) => r.submission ? `${r.submission.state} · v${r.submission.current_version}` : 'Chưa nộp'],
      ['Phiên bản mới nhất', (r) => r.submission?.versions?.[0] ? <>{displayDate(r.submission.versions[0].submitted_at)}{r.submission.versions[0].is_late && <strong className="wf-risk"> · Muộn</strong>}</> : '—'],
      ['Tệp / repo', (r) => r.submission?.versions?.[0] ? <>{r.submission.versions[0].files.map((f: Row) => <a className="wf-file-link" href={`${apiBase}/submissions/files/${encodeURIComponent(f.storage_name)}`} key={f.storage_name}>{f.file_name}</a>)}{r.submission.versions[0].repo_url && <a href={r.submission.versions[0].repo_url} target="_blank" rel="noreferrer">Repo ↗</a>}</> : '—'],
      ['Chấm', (r) => r.submission ? <div className="wf-grade-cell"><input aria-label="Điểm" type="number" min="0" max={selectedAssignment.max_score} step="0.1" value={gradeInputs[r.submission.id]?.score ?? ''} onChange={(e) => setGradeInputs({ ...gradeInputs, [r.submission.id]: { ...gradeInputs[r.submission.id], score: e.target.value, feedback: gradeInputs[r.submission.id]?.feedback ?? '' } })} /><input aria-label="Nhận xét" placeholder="Nhận xét" value={gradeInputs[r.submission.id]?.feedback ?? ''} onChange={(e) => setGradeInputs({ ...gradeInputs, [r.submission.id]: { ...gradeInputs[r.submission.id], score: gradeInputs[r.submission.id]?.score ?? '', feedback: e.target.value } })} /><button className="wf-button" onClick={() => void run(() => request(`/assignments/${selectedAssignment.id}/submissions/${r.submission.id}/grade`, json({ score: Number(gradeInputs[r.submission.id]?.score), feedback: gradeInputs[r.submission.id]?.feedback ?? '' })), 'Đã lưu điểm.', false)}>Lưu điểm</button><button className="wf-button" onClick={() => void run(() => request(`/assignments/${selectedAssignment.id}/submissions/${r.submission.id}/publish`, json({})), 'Đã công bố điểm.', false)}>Công bố</button><button className="wf-button" onClick={() => { const due_at = window.prompt('Nhập hạn nộp lại (YYYY-MM-DDTHH:mm):'); const feedback = window.prompt('Nhận xét bắt buộc:'); if (due_at && feedback) void run(() => request(`/assignments/${selectedAssignment.id}/submissions/${r.submission.id}/revision`, json({ due_at: new Date(due_at).toISOString(), feedback })), 'Đã yêu cầu làm lại.') }}>Yêu cầu làm lại</button></div> : '—'],
    ]} /></Panel>}
  </section>

  if (module === 'materials') return <section className="wf-page">
    <header className="wf-heading"><div><small>SPRINT 6 · HỌC LIỆU & THÔNG BÁO</small><h1>Học liệu, thông báo & hộp thư</h1><p>Tài liệu theo buổi, thông báo lớp và thông báo cá nhân.</p></div><RefreshButton loading={loading} onClick={() => void load()} notify={notify} hasData={materials.length > 0 || announcements.length > 0} /></header>
    {error && <div className="wf-error" role="alert">{error}</div>}
    {canWrite && !isStudent && <Panel title="Đăng tài liệu cho một buổi"><form onSubmit={(e) => { e.preventDefault(); const params = new URLSearchParams({ class_id: materialForm.class_id, lesson_id: materialForm.lesson_id, title: materialForm.title, available_early: String(materialForm.available_early) }); if (materialForm.external_url) params.set('external_url', materialForm.external_url); const body = new FormData(); if (materialForm.file) body.append('file', materialForm.file); void run(() => request(`/materials?${params}`, { method: 'POST', body }), 'Đã đăng học liệu.') }}>
      <Grid><Input label="Lớp ID"><input type="number" min="1" required value={materialForm.class_id} onChange={(e) => setMaterialForm({ ...materialForm, class_id: e.target.value })} /></Input><Input label="Buổi học ID"><input type="number" min="1" required value={materialForm.lesson_id} onChange={(e) => setMaterialForm({ ...materialForm, lesson_id: e.target.value })} /></Input><Input label="Tiêu đề"><input required value={materialForm.title} onChange={(e) => setMaterialForm({ ...materialForm, title: e.target.value })} /></Input><Input label="Tệp"><input type="file" onChange={(e) => setMaterialForm({ ...materialForm, file: e.target.files?.[0] ?? null })} /></Input><Input label="Hoặc liên kết HTTPS"><input type="url" value={materialForm.external_url} onChange={(e) => setMaterialForm({ ...materialForm, external_url: e.target.value })} /></Input><label className="wf-check"><input type="checkbox" checked={materialForm.available_early} onChange={(e) => setMaterialForm({ ...materialForm, available_early: e.target.checked })} />Mở trước buổi học</label></Grid><button className="wf-primary" disabled={busy}>Đăng học liệu</button>
    </form></Panel>}
    <Panel title="Học liệu"><DataTable rows={materials} columns={[
      ['Tiêu đề', (r) => r.title],
      ['Buổi học', (r) => r.lesson_title],
      ['Tệp / liên kết', (r) => r.file_name ? <a href={`${apiBase}/materials/${r.id}/file`} onClick={(e) => { const token = localStorage.getItem('tms_token'); if (!token) return; e.preventDefault(); void fetch(e.currentTarget.href, { headers: { Authorization: `Bearer ${token}` } }).then((res) => res.blob()).then((blob) => { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = r.file_name; a.click(); URL.revokeObjectURL(url) }).catch(() => notify('Không thể tải học liệu.', 'error')) }}>{r.file_name}</a> : <a href={r.external_url} target="_blank" rel="noreferrer">Mở liên kết ↗</a>],
      ['Thời điểm', (r) => displayDate(r.created_at)],
    ]} /></Panel>
    {canWrite && !isStudent && <Panel title="Gửi thông báo lớp"><form onSubmit={(e) => { e.preventDefault(); const class_ids = announcementForm.class_ids.split(',').map((s) => Number(s.trim())).filter(Boolean); void run(() => request<{ emails_sent: number; emails_failed: number; emails_skipped: number }>('/announcements', json({ ...announcementForm, class_ids })), (result) => ({ message: `Thông báo đã gửi. Email: ${result.emails_sent} thành công, ${result.emails_failed} lỗi, ${result.emails_skipped} bỏ qua do chưa cấu hình SMTP.`, tone: result.emails_failed ? 'error' : 'success' })) }}><Grid><Input label="Lớp (có thể chọn nhiều)"><select required multiple value={announcementForm.class_ids ? announcementForm.class_ids.split(',') : []} onChange={(e) => setAnnouncementForm({ ...announcementForm, class_ids: Array.from(e.target.selectedOptions, (option) => option.value).join(',') })}>{classes.map((row) => <option value={row.id} key={row.id}>{row.name}</option>)}</select></Input><Input label="Tiêu đề"><input required maxLength={200} value={announcementForm.title} onChange={(e) => setAnnouncementForm({ ...announcementForm, title: e.target.value })} /></Input><Input label="Nội dung"><textarea required value={announcementForm.body} onChange={(e) => setAnnouncementForm({ ...announcementForm, body: e.target.value })} /></Input></Grid><button className="wf-primary" disabled={busy}>Gửi thông báo</button></form></Panel>}
    <Panel title="Thông báo lớp"><DataTable rows={announcements} columns={[
      ['Tiêu đề', (r) => <><strong>{r.title}</strong><small>{r.body}</small></>],
      ['Lớp', (r) => `#${r.class_id}`],
      ['Ngày gửi', (r) => displayDate(r.created_at)],
      ['Trạng thái', (r) => r.read ? 'Đã đọc' : <button className="wf-button" onClick={() => void run(() => request(`/announcements/${r.id}/read`, json({})), 'Đã đánh dấu đã đọc.')}>Đánh dấu đã đọc</button>],
    ]} /></Panel>
    <Panel title="Thông báo cá nhân" action={<button className="wf-button" onClick={() => void run(() => request('/notifications/read-all', json({})), 'Đã đánh dấu tất cả là đã đọc.')}>Đọc tất cả</button>}><DataTable rows={notifications} columns={[
      ['Thông báo', (r) => <><strong>{r.title}</strong><small>{r.body}</small></>],
      ['Thời điểm', (r) => displayDate(r.created_at)],
      ['Trạng thái', (r) => r.read_at ? 'Đã đọc' : <button className="wf-button" onClick={() => void run(() => request(`/notifications/${r.id}/read`, json({})), 'Đã đánh dấu đã đọc.')}>Đánh dấu đã đọc</button>],
    ]} /></Panel>
  </section>

  if (module === 'grades') return <section className="wf-page">
    <header className="wf-heading"><div><small>SPRINT 8 · KẾT QUẢ HỌC TẬP</small><h1>Điểm tổng kết & tốt nghiệp</h1><p>Cấu hình trọng số, tự tính điểm từ bài đã công bố, chốt điểm và xét điều kiện hoàn thành.</p></div><RefreshButton loading={loading} onClick={() => void load()} notify={notify} hasData={Boolean(transcript || gradeConfigs.length > 0)} /></header>
    {error && <div className="wf-error" role="alert">{error}</div>}
    {isStudent && transcript && <Panel title={`Bảng điểm · ${transcript.student_name}`} action={<button className="wf-button" onClick={() => window.print()}>In / lưu PDF</button>}><p>Mã học viên: {transcript.student_code} · Điểm trung bình: {transcript.average ?? 'Chưa đủ điểm'}</p><DataTable rows={transcript.subjects ?? []} columns={[
      ['Lớp', (r) => r.class_name], ['Môn học', (r) => r.subject_name],
      ['Điểm', (r) => r.score ?? 'Chưa đủ điều kiện tính'], ['Kết quả', (r) => r.result],
    ]} /><DownloadButton path="/grades/transcript/export" label="Tải bảng điểm Excel" notify={notify} /></Panel>}
    {canWrite && !isStudent && <Panel title="Cấu hình cách tính điểm"><form onSubmit={(e) => { e.preventDefault(); const components = gradeForm.components.split('\n').flatMap((line) => { const [name, weight] = line.split(':'); return name?.trim() && Number(weight) > 0 ? [{ name: name.trim(), weight_percent: Number(weight), required: true }] : [] }); void run(() => request('/grades/config', { method: 'PUT', body: JSON.stringify({ ...gradeForm, program_id: Number(gradeForm.program_id), subject_id: Number(gradeForm.subject_id), class_id: gradeForm.class_id ? Number(gradeForm.class_id) : null, passing_score: Number(gradeForm.passing_score), critical_score: Number(gradeForm.critical_score), components }) }), 'Đã lưu cấu hình điểm.') }}><Grid><Input label="Chương trình ID"><input required type="number" min="1" value={gradeForm.program_id} onChange={(e) => setGradeForm({ ...gradeForm, program_id: e.target.value })} /></Input><Input label="Môn học ID"><input required type="number" min="1" value={gradeForm.subject_id} onChange={(e) => setGradeForm({ ...gradeForm, subject_id: e.target.value })} /></Input><Input label="Lớp ID (để ghi đè, tuỳ chọn)"><input type="number" min="1" value={gradeForm.class_id} onChange={(e) => setGradeForm({ ...gradeForm, class_id: e.target.value })} /></Input><Input label="Điểm đạt"><input type="number" min="0" max="100" step="0.1" value={gradeForm.passing_score} onChange={(e) => setGradeForm({ ...gradeForm, passing_score: e.target.value })} /></Input><Input label="Điểm liệt"><input type="number" min="0" max="100" step="0.1" value={gradeForm.critical_score} onChange={(e) => setGradeForm({ ...gradeForm, critical_score: e.target.value })} /></Input><Input label="Thành phần (mỗi dòng: tên:trọng số %)"><textarea value={gradeForm.components.replaceAll(',', '\n')} onChange={(e) => setGradeForm({ ...gradeForm, components: e.target.value })} /></Input></Grid><button className="wf-primary" disabled={busy}>Lưu cấu hình (tổng trọng số 100%)</button></form></Panel>}
    {canWrite && !isStudent && <Panel title="Gắn bài tập vào thành phần điểm"><Grid><Input label="ID thành phần điểm"><input type="number" min="1" value={componentLink.component_id} onChange={(e) => setComponentLink({ ...componentLink, component_id: e.target.value })} /></Input><Input label="ID bài tập"><input type="number" min="1" value={componentLink.assignment_id} onChange={(e) => setComponentLink({ ...componentLink, assignment_id: e.target.value })} /></Input></Grid><button className="wf-button" disabled={busy} onClick={() => void run(() => request(`/grades/components/${componentLink.component_id}/assignments`, json({ assignment_id: Number(componentLink.assignment_id) })), 'Đã gắn bài tập vào thành phần điểm.')}>Gắn bài</button></Panel>}
    {!isStudent && <Panel title="Cấu hình hiện có"><DataTable rows={gradeConfigs.flatMap((config) => config.components.map((item: Row) => ({ ...item, program_id: config.program_id, subject_id: config.subject_id, class_id: config.class_id, passing_score: config.passing_score, critical_score: config.critical_score })))} columns={[
      ['Phạm vi', (r) => `CT #${r.program_id} · môn #${r.subject_id}${r.class_id ? ` · lớp #${r.class_id}` : ''}`],
      ['Thành phần', (r) => `${r.name} · ${r.weight_percent}%`],
      ['Điểm đạt / liệt', (r) => `${r.passing_score} / ${r.critical_score}`],
    ]} /></Panel>}
    {canWrite && !isStudent && <Panel title="Tính điểm / chốt điểm"><Grid><Input label="Lớp ID"><input type="number" min="1" value={gradeForm.class_id} onChange={(e) => setGradeForm({ ...gradeForm, class_id: e.target.value })} /></Input><Input label="Môn ID"><input type="number" min="1" value={gradeForm.subject_id} onChange={(e) => setGradeForm({ ...gradeForm, subject_id: e.target.value })} /></Input></Grid><div className="wf-actions"><button className="wf-button" onClick={() => void run(() => request(`/grades/classes/${gradeForm.class_id}/subjects/${gradeForm.subject_id}/recalculate`, json({})), 'Đã tính lại điểm.')}>Tính điểm tự động</button><button className="wf-primary" onClick={() => void run(() => request(`/grades/classes/${gradeForm.class_id}/subjects/${gradeForm.subject_id}/lock`, json({})), 'Đã chốt điểm.')}>Chốt điểm</button><button className="wf-button" onClick={() => { if (window.confirm('Chỉ Quản lý đào tạo mới được mở lại bảng điểm đã chốt. Tiếp tục?')) void run(() => request(`/grades/classes/${gradeForm.class_id}/subjects/${gradeForm.subject_id}/unlock`, json({})), 'Đã mở lại bảng điểm.') }}>Mở lại (quản lý)</button></div></Panel>}
    {canWrite && !isStudent && <Panel title="Xét điều kiện hoàn thành"><Grid><Input label="Lớp ID"><input type="number" min="1" value={gradeForm.class_id} onChange={(e) => setGradeForm({ ...gradeForm, class_id: e.target.value })} /></Input></Grid><button className="wf-button" onClick={async () => { try { const data = await request<Row>(`/grades/classes/${gradeForm.class_id}/graduation`); setDashboard(data) } catch (cause) { notify(cause instanceof Error ? cause.message : 'Không thể xét tốt nghiệp.', 'error') } }}>Kiểm tra đủ điều kiện</button>{dashboard?.eligible && <><DataTable rows={dashboard.eligible} columns={[['Học viên', (r) => `${r.student_name} · ${r.student_code}`], ['Trạng thái', () => 'Đủ điều kiện']]} /><DataTable rows={dashboard.ineligible ?? []} columns={[['Học viên', (r) => r.student_name], ['Lý do chưa đủ', (r) => r.reasons.join(' · ')]]} /><button className="wf-primary" onClick={() => void run(() => request(`/grades/classes/${gradeForm.class_id}/graduation/confirm`, json({ student_ids: dashboard.eligible.map((r: Row) => r.student_id) })), 'Đã xác nhận tốt nghiệp.')}>Xác nhận tốt nghiệp đủ điều kiện</button></>}</Panel>}
  </section>

  if (module === 'billing') return <section className="wf-page">
    <header className="wf-heading"><div><small>SPRINT 7 · HỌC PHÍ</small><h1>Học phí & Khoản nợ</h1><p>Biểu phí theo thời hạn, kế hoạch nhiều đợt, thanh toán bất biến, biên lai và báo cáo doanh thu.</p></div><RefreshButton loading={loading} onClick={() => void load()} notify={notify} hasData={feeSchedules.length > 0 || billingPlans.length > 0} /></header>
    {error && <div className="wf-error" role="alert">{error}</div>}
    {canWrite && !isStudent && <Panel title="Khai báo biểu phí mới"><form onSubmit={(e) => { e.preventDefault(); void run(() => request('/billing/fee-schedules', json({ ...feeForm, program_id: Number(feeForm.program_id), amount: Number(feeForm.amount), effective_to: null })), 'Đã tạo phiên bản biểu phí.') }}><Grid><Input label="Chương trình ID"><input type="number" min="1" required value={feeForm.program_id} onChange={(e) => setFeeForm({ ...feeForm, program_id: e.target.value })} /></Input><Input label="Tên biểu phí"><input required value={feeForm.name} onChange={(e) => setFeeForm({ ...feeForm, name: e.target.value })} /></Input><Input label="Mức phí (VND)"><input type="number" min="1" required value={feeForm.amount} onChange={(e) => setFeeForm({ ...feeForm, amount: e.target.value })} /></Input><Input label="Ngày hiệu lực"><input type="date" required value={feeForm.effective_from} onChange={(e) => setFeeForm({ ...feeForm, effective_from: e.target.value })} /></Input></Grid><button className="wf-primary" disabled={busy}>Tạo biểu phí</button></form></Panel>}
    <Panel title="Biểu phí"><DataTable rows={feeSchedules} columns={[
      ['Tên biểu phí', (r) => r.name], ['Chương trình', (r) => r.program_name], ['Mức phí', (r) => money(r.amount)],
      ['Hiệu lực', (r) => `${r.effective_from} → ${r.effective_to ?? 'hiện hành'}`],
    ]} /></Panel>
    {canWrite && !isStudent && <Panel title="Tạo kế hoạch thanh toán cho học viên"><form onSubmit={(e) => { e.preventDefault(); const amounts = planForm.amounts.split(',').map((s) => Number(s.trim())); const due_dates = planForm.due_dates.split(',').map((s) => s.trim()); const installments = amounts.map((amount, i) => ({ sequence: i + 1, amount, due_date: due_dates[i] })); void run(() => request('/billing/plans', json({ student_id: Number(planForm.student_id), class_id: Number(planForm.class_id), tuition_amount: Number(planForm.tuition_amount), installments })), 'Đã tạo kế hoạch thanh toán.') }}><Grid><Input label="Học viên ID"><input type="number" min="1" required value={planForm.student_id} onChange={(e) => setPlanForm({ ...planForm, student_id: e.target.value })} /></Input><Input label="Lớp ID"><input type="number" min="1" required value={planForm.class_id} onChange={(e) => setPlanForm({ ...planForm, class_id: e.target.value })} /></Input><Input label="Tổng học phí (VND)"><input type="number" min="1" required value={planForm.tuition_amount} onChange={(e) => setPlanForm({ ...planForm, tuition_amount: e.target.value })} /></Input><Input label="Số tiền mỗi đợt (phân cách dấu phẩy)"><input required placeholder="3000000, 3000000" value={planForm.amounts} onChange={(e) => setPlanForm({ ...planForm, amounts: e.target.value })} /></Input><Input label="Ngày đến hạn từng đợt theo thứ tự"><input required placeholder="2026-11-01, 2026-12-01" value={planForm.due_dates} onChange={(e) => setPlanForm({ ...planForm, due_dates: e.target.value })} /></Input></Grid><button className="wf-primary" disabled={busy}>Tạo kế hoạch</button></form></Panel>}
    <Panel title={isStudent ? 'Tình trạng học phí của bạn' : 'Khoản nợ theo học viên'} action={<DownloadButton path="/billing/debts.xlsx" label="Xuất Excel" notify={notify} />}><DataTable rows={billingPlans} columns={[
      ['Học viên / lớp', (r) => <>{r.student_name}<small>{r.class_name}</small></>],
      ['Phải thu', (r) => money(r.amount_due)], ['Đã thu', (r) => money(r.received)], ['Khoản nợ còn lại', (r) => money(r.remaining)],
      ['Các đợt', (r) => r.installments.map((i: Row) => <span className="wf-installment" key={i.id}>#{i.sequence} {money(i.remaining)} · hạn {i.due_date} · {i.status}</span>)],
      ['Thao tác', (r) => canWrite && !isStudent ? <><button className="wf-button" onClick={() => setDiscountForm({ ...discountForm, plan_id: String(r.id) })}>Giảm giá</button>{r.installments.filter((i: Row) => i.remaining > 0).map((i: Row) => <button key={i.id} className="wf-button" onClick={() => setPaymentForm({ ...paymentForm, installment_id: String(i.id), amount: String(i.remaining) })}>Thu đợt {i.sequence}</button>)}</> : '—'],
    ]} /></Panel>
    {canWrite && !isStudent && <Panel title="Ghi nhận khoản thu"><form onSubmit={(e) => { e.preventDefault(); void run(async () => { const result = await request<Row>(`/billing/installments/${paymentForm.installment_id}/payments`, json({ amount: Number(paymentForm.amount), method: paymentForm.method, paid_at: new Date().toISOString(), note: paymentForm.note })); notify(`Đã ghi nhận thanh toán. Mã biên lai: ${result.receipt_code}`, 'success'); return result }, 'Đã ghi nhận khoản thu.') }}><Grid><Input label="Đợt thanh toán ID"><input type="number" min="1" required value={paymentForm.installment_id} onChange={(e) => setPaymentForm({ ...paymentForm, installment_id: e.target.value })} /></Input><Input label="Số tiền thu (VND)"><input type="number" min="1" required value={paymentForm.amount} onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })} /></Input><Input label="Hình thức"><select value={paymentForm.method} onChange={(e) => setPaymentForm({ ...paymentForm, method: e.target.value })}><option value="cash">Tiền mặt</option><option value="bank_transfer">Chuyển khoản</option></select></Input><Input label="Ghi chú"><input value={paymentForm.note} onChange={(e) => setPaymentForm({ ...paymentForm, note: e.target.value })} /></Input></Grid><button className="wf-primary" disabled={busy}>Ghi nhận (không thể xoá)</button></form></Panel>}
    {canWrite && !isStudent && <Panel title="Học bổng / giảm giá"><form onSubmit={(e) => { e.preventDefault(); const body = { reason: discountForm.reason, ...(discountForm.percent ? { percent: Number(discountForm.percent) } : { amount: Number(discountForm.amount) }) }; void run(() => request(`/billing/plans/${discountForm.plan_id}/discount`, json(body)), 'Đã gửi hoặc áp dụng yêu cầu giảm giá.') }}><Grid><Input label="Kế hoạch ID"><input type="number" min="1" required value={discountForm.plan_id} onChange={(e) => setDiscountForm({ ...discountForm, plan_id: e.target.value })} /></Input><Input label="Giảm theo số tiền (VND)"><input type="number" min="1" value={discountForm.amount} onChange={(e) => setDiscountForm({ ...discountForm, amount: e.target.value, percent: '' })} /></Input><Input label="Hoặc giảm theo phần trăm"><input type="number" min="0.01" max="99.99" step="0.01" value={discountForm.percent} onChange={(e) => setDiscountForm({ ...discountForm, percent: e.target.value, amount: '' })} /></Input><Input label="Lý do"><input required value={discountForm.reason} onChange={(e) => setDiscountForm({ ...discountForm, reason: e.target.value })} /></Input></Grid><button className="wf-primary" disabled={busy}>Áp dụng / gửi duyệt</button></form><DataTable rows={discountRequests} columns={[
      ['Học viên', (r) => r.student_name], ['Số tiền', (r) => money(r.discount_amount)], ['Lý do', (r) => r.reason],
      ['Trạng thái', (r) => r.status], ['Duyệt', (r) => user.roles.some((role) => ['training_manager', 'admin'].includes(role)) && r.status === 'pending' ? <div className="wf-actions"><button className="wf-button" onClick={() => void run(() => request(`/billing/discount-requests/${r.id}/decision`, json({ decision: 'approve' })), 'Đã duyệt giảm giá.')}>Duyệt</button><button className="wf-button" onClick={() => void run(() => request(`/billing/discount-requests/${r.id}/decision`, json({ decision: 'reject' })), 'Đã từ chối giảm giá.')}>Từ chối</button></div> : '—'],
    ]} /></Panel>}
    <Panel title="Báo cáo doanh thu"><Grid><Input label="Từ ngày"><input type="date" value={revenueDates.from_date} onChange={(e) => setRevenueDates({ ...revenueDates, from_date: e.target.value })} /></Input><Input label="Đến ngày"><input type="date" value={revenueDates.to_date} onChange={(e) => setRevenueDates({ ...revenueDates, to_date: e.target.value })} /></Input></Grid><button className="wf-button" onClick={async () => { try { setRevenue(await request<Row>(`/billing/revenue?${new URLSearchParams({ ...revenueDates, group_by: 'class' })}`)) } catch (cause) { notify(cause instanceof Error ? cause.message : 'Không tải được báo cáo.', 'error') } }}>Xem báo cáo</button>{revenue && <><p>Đã thu: <strong>{money(revenue.received)}</strong> · Khoản nợ còn lại: <strong>{money(revenue.remaining)}</strong></p><DataTable rows={Object.entries(revenue.groups ?? {}).map(([name, values]) => ({ name, ...(values as Row) }))} columns={[['Lớp', (r) => r.name], ['Đã thu', (r) => money(r.received)]]} /></>}</Panel>
    <Panel title="Nhắc hạn"><p>Hệ thống tự chạy nhắc học phí hằng ngày lúc 08:00 (Asia/Ho_Chi_Minh), đồng thời gửi email khi đã cấu hình SMTP.</p>{canWrite && !isStudent && <button className="wf-button" disabled={busy} onClick={() => void run(() => request('/billing/reminders/run', json({})), 'Đã chạy tác vụ nhắc hạn.')}>Chạy thử ngay</button>}</Panel>
  </section>

  if (module === 'surveys') return <section className="wf-page">
    <header className="wf-heading"><div><small>SPRINT 8 · KHẢO SÁT</small><h1>Khảo sát chất lượng</h1><p>Khảo sát ẩn danh với giảng viên, chỉ quản lý đào tạo xem được kết quả tổng hợp.</p></div><RefreshButton loading={loading} onClick={() => void load()} notify={notify} hasData={surveys.length > 0} /></header>
    {error && <div className="wf-error" role="alert">{error}</div>}
    {canWrite && !isStudent && <Panel title="Tạo khảo sát cho lớp"><form onSubmit={(e) => { e.preventDefault(); const questions = surveyForm.questions.split('\n').map((line) => { const [type, ...text] = line.split('|'); return { type: type.trim(), text: text.join('|').trim() } }).filter((q) => q.text); void run(() => request('/surveys', json({ ...surveyForm, class_id: Number(surveyForm.class_id), due_at: new Date(surveyForm.due_at).toISOString(), questions })), 'Đã tạo khảo sát.') }}><Grid><Input label="Lớp ID"><input type="number" min="1" required value={surveyForm.class_id} onChange={(e) => setSurveyForm({ ...surveyForm, class_id: e.target.value })} /></Input><Input label="Tiêu đề"><input required value={surveyForm.title} onChange={(e) => setSurveyForm({ ...surveyForm, title: e.target.value })} /></Input><Input label="Hạn trả lời"><input type="datetime-local" required value={surveyForm.due_at} onChange={(e) => setSurveyForm({ ...surveyForm, due_at: e.target.value })} /></Input><Input label="Câu hỏi (mỗi dòng rating|nội dung hoặc text|nội dung)"><textarea required value={surveyForm.questions} onChange={(e) => setSurveyForm({ ...surveyForm, questions: e.target.value })} /></Input></Grid><button className="wf-primary" disabled={busy}>Tạo khảo sát</button></form></Panel>}
    <Panel title="Danh sách khảo sát"><DataTable rows={surveys} columns={[
      ['Khảo sát', (r) => <button className="wf-link" onClick={() => setSelectedSurvey(r)}>{r.title}</button>],
      ['Lớp', (r) => r.class_name], ['Hạn', (r) => displayDate(r.due_at)],
      ['Trạng thái', (r) => r.responded ? 'Đã trả lời' : r.state],
      ['Kết quả', (r) => !isStudent && permission === 'F' ? <button className="wf-button" onClick={async () => { try { setSurveyResults(await request<Row>(`/surveys/${r.id}/results`)) } catch (cause) { notify(cause instanceof Error ? cause.message : 'Không thể tải kết quả.', 'error') } }}>Xem tổng hợp</button> : 'Ẩn danh'],
    ]} /></Panel>
    {selectedSurvey && isStudent && !selectedSurvey.responded && <Panel title={`Trả lời: ${selectedSurvey.title}`}><form onSubmit={(e) => { e.preventDefault(); const answers = selectedSurvey.questions.map((_: Row, index: number) => ({ value: selectedSurvey.questions[index].type === 'rating' ? Number(surveyAnswers[index]) : surveyAnswers[index] ?? '' })); void run(() => request(`/surveys/${selectedSurvey.id}/responses`, json({ answers })), 'Đã gửi khảo sát ẩn danh.') }}>{selectedSurvey.questions.map((q: Row, index: number) => <Input key={index} label={q.text}>{q.type === 'rating' ? <select required value={surveyAnswers[index] ?? ''} onChange={(e) => setSurveyAnswers({ ...surveyAnswers, [index]: e.target.value })}><option value="">Chọn điểm 1–5</option>{[1, 2, 3, 4, 5].map((value) => <option key={value}>{value}</option>)}</select> : <textarea maxLength={4000} value={surveyAnswers[index] ?? ''} onChange={(e) => setSurveyAnswers({ ...surveyAnswers, [index]: e.target.value })} />}</Input>)}<button className="wf-primary" disabled={busy}>Gửi một lần</button></form></Panel>}
    {surveyResults && <Panel title={`Kết quả · ${surveyResults.class_name}`}><p>{surveyResults.response_count} phản hồi</p><DataTable rows={surveyResults.results ?? []} columns={[
      ['Câu hỏi', (r) => r.question], ['Điểm trung bình', (r) => r.average ?? '—'], ['Trả lời tự luận', (r) => (r.answers ?? []).join(' | ') || '—'],
    ]} /></Panel>}
  </section>

  const riskRows = dashboard?.risk_details ?? []
  return <section className="wf-page">
    <header className="wf-heading"><div><small>SPRINT 8 · DASHBOARD</small><h1>Dashboard vận hành</h1><p>Tổng quan lớp, học viên, tuyển sinh và danh sách học viên có nguy cơ.</p></div><RefreshButton loading={loading} onClick={() => void load()} notify={notify} hasData={Boolean(dashboard)} /></header>
    {error && <div className="wf-error" role="alert">{error}</div>}
    {dashboard && <><div className="wf-kpis">{[['Lớp đang chạy', dashboard.running_classes ?? 0], ['Học viên đang học', dashboard.active_students ?? 0], ['Lead đang xử lý', dashboard.active_leads ?? 0], ['Khoản nợ quá hạn', dashboard.overdue_debt == null ? 'Không có quyền xem' : money(dashboard.overdue_debt)]].map(([label, value]) => <article key={String(label)}><small>{label}</small><strong>{value}</strong></article>)}</div>
      {dashboard.assignments_due && <Panel title="Bài tập sắp đến hạn"><DataTable rows={dashboard.assignments_due} columns={[['Bài tập', (r) => r.title], ['Hạn', (r) => displayDate(r.due_at)], ['Trạng thái', (r) => r.submitted ? 'Đã nộp' : 'Chưa nộp']]} /></Panel>}
      <Panel title="Học viên cần quan tâm"><DataTable rows={riskRows} columns={[
        ['Học viên', (r) => r.student_name], ['Lớp', (r) => r.class_name],
        ['Tỷ lệ vắng', (r) => <span className="wf-risk">{r.absence_percent}% (ngưỡng {r.threshold_percent}%)</span>],
      ]} /></Panel>
      <Panel title="Lớp"><DataTable rows={dashboard.classes ?? []} columns={[['Lớp', (r) => r.name], ['Trạng thái', (r) => r.status]]} /></Panel>
    </>}
    <div className="wf-actions"><DownloadButton path="/reports/attendance-risk" label="Tải dữ liệu rủi ro (JSON)" notify={notify} /></div>
  </section>
}
