import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import SearchableSelect, { type SelectOption } from './SearchableSelect'
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
      if (elapsed < 800) await new Promise((r) => setTimeout(r, 800 - elapsed))
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
      {isSpinning ? 'Đang tải…' : 'Làm mới'}
    </button>
  )
}

function DataTable({
  rows,
  columns,
  footer,
  pageSize = 10,
  enablePagination = true,
}: {
  rows: Row[]
  columns: [string, (row: Row, index?: number) => ReactNode][]
  footer?: ReactNode
  pageSize?: number
  enablePagination?: boolean
}) {
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(pageSize)

  useEffect(() => {
    setPage(1)
  }, [rows.length, size])

  if (!rows.length) return <Empty />
  const hasSTT = columns.some(([name]) => name === 'STT')

  const totalPages = Math.max(1, Math.ceil(rows.length / size))
  const safePage = Math.min(Math.max(1, page), totalPages)
  const shouldPaginate = enablePagination && rows.length > size
  const paginatedRows = shouldPaginate ? rows.slice((safePage - 1) * size, safePage * size) : rows
  const startIndex = (safePage - 1) * size

  return (
    <div className="wf-table-container">
      <div className="wf-table-wrap">
        <table className="wf-table">
          <thead>
            <tr>
              {!hasSTT && <th style={{ width: '50px', textAlign: 'center' }}>STT</th>}
              {columns.map(([name]) => <th key={name}>{name}</th>)}
            </tr>
          </thead>
          <tbody>
            {paginatedRows.map((row, i) => {
              const globalIndex = startIndex + i
              return (
                <tr key={row.id ?? row.student_id ?? `${globalIndex}`}>
                  {!hasSTT && <td style={{ textAlign: 'center', color: '#64748b', fontWeight: 500 }}>{globalIndex + 1}</td>}
                  {columns.map(([name, render]) => <td key={name}>{render(row, globalIndex)}</td>)}
                </tr>
              )
            })}
          </tbody>
          {footer && <tfoot>{footer}</tfoot>}
        </table>
      </div>

      {shouldPaginate && (
        <div className="wf-table-pagination">
          <div className="wf-pagination-info">
            <span>
              Hiển thị <strong>{startIndex + 1}</strong>–<strong>{Math.min(startIndex + size, rows.length)}</strong> / <strong>{rows.length}</strong> dòng
            </span>
            <label className="wf-pagination-size">
              Hiển thị:
              <select value={size} onChange={(e) => { setSize(Number(e.target.value)); setPage(1) }}>
                <option value={5}>5 dòng</option>
                <option value={10}>10 dòng</option>
                <option value={20}>20 dòng</option>
                <option value={50}>50 dòng</option>
              </select>
            </label>
          </div>
          <div className="wf-pagination-controls">
            <button
              type="button"
              className="wf-page-btn"
              disabled={safePage <= 1}
              onClick={() => setPage(1)}
              title="Trang đầu"
            >
              «
            </button>
            <button
              type="button"
              className="wf-page-btn"
              disabled={safePage <= 1}
              onClick={() => setPage(safePage - 1)}
              title="Trang trước"
            >
              ‹
            </button>
            <span className="wf-page-current">
              Trang <strong>{safePage}</strong> / {totalPages}
            </span>
            <button
              type="button"
              className="wf-page-btn"
              disabled={safePage >= totalPages}
              onClick={() => setPage(safePage + 1)}
              title="Trang sau"
            >
              ›
            </button>
            <button
              type="button"
              className="wf-page-btn"
              disabled={safePage >= totalPages}
              onClick={() => setPage(totalPages)}
              title="Trang cuối"
            >
              »
            </button>
          </div>
        </div>
      )}
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
  const isTeacher = user.roles.includes('instructor') || user.roles.includes('ta')
  const isAdminOrManager = user.roles.includes('admin') || user.roles.includes('training_manager')

  // Common catalog lists for friendly select options
  const [classes, setClasses] = useState<TrainingClass[]>([])
  const [programs, setPrograms] = useState<Row[]>([])
  const [subjects, setSubjects] = useState<Row[]>([])
  const [students, setStudents] = useState<Row[]>([])

  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)

  // Attendance (Sprint 5)
  const [attendanceClassId, setAttendanceClassId] = useState('')
  const [attendanceSummary, setAttendanceSummary] = useState<AttendanceSummary | null>(null)
  const [policies, setPolicies] = useState<Row[]>([])
  const [policyDraft, setPolicyDraft] = useState<Record<number, string>>({})

  // Assignments & Grading (Sprint 5 & 6)
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [selectedAssignment, setSelectedAssignment] = useState<Assignment | null>(null)
  const [submissions, setSubmissions] = useState<Row[]>([])
  const [gradeInputs, setGradeInputs] = useState<Record<number, { score: string; feedback: string }>>({})
  const [submissionRepo, setSubmissionRepo] = useState('')
  const [submissionFiles, setSubmissionFiles] = useState<FileList | null>(null)
  const [assignmentForm, setAssignmentForm] = useState({
    class_id: '', subject_id: '', lesson_id: '', title: '', description: '',
    due_at: localDateTime(new Date(Date.now() + 86400000)), max_score: '10', late_policy: 'accept'
  })
  const [assignmentFilter, setAssignmentFilter] = useState<'all' | 'unsubmitted' | 'submitted' | 'graded' | 'revision'>('all')
  const [submissionFilter, setSubmissionFilter] = useState<'all' | 'ungraded' | 'graded' | 'late' | 'not_submitted'>('all')
  const [rubrics, setRubrics] = useState<Row[]>([])
  const [rubricForm, setRubricForm] = useState({ name: '', criteria: 'Đúng yêu cầu:40\nCấu trúc code:30\nGiao diện & UX:30' })
  const [showRubricModal, setShowRubricModal] = useState(false)
  const [revisionModal, setRevisionModal] = useState<{ open: boolean; submissionId?: number; dueAt: string; feedback: string }>({
    open: false, dueAt: localDateTime(new Date(Date.now() + 3 * 86400000)), feedback: ''
  })

  // Materials & Announcements (Sprint 6)
  const [materials, setMaterials] = useState<Row[]>([])
  const [announcements, setAnnouncements] = useState<Row[]>([])
  const [notifications, setNotifications] = useState<Row[]>([])
  const [materialForm, setMaterialForm] = useState({ class_id: '', lesson_id: '', title: '', external_url: '', available_early: false, file: null as File | null })
  const [announcementForm, setAnnouncementForm] = useState({ class_ids: '', title: '', body: '' })

  // Grades & Transcript & Graduation (Sprint 8)
  const [gradeConfigs, setGradeConfigs] = useState<Row[]>([])
  const [gradeForm, setGradeForm] = useState({ program_id: '', subject_id: '', class_id: '', passing_score: '5', critical_score: '0', components: 'Chuyên cần:20\nBài tập:30\nThi cuối kỳ:50' })
  const [componentLink, setComponentLink] = useState({ component_id: '', assignment_id: '' })
  const [transcript, setTranscript] = useState<Row | null>(null)
  const [graduationClassId, setGraduationClassId] = useState('')
  const [graduationData, setGraduationData] = useState<Row | null>(null)

  // Billing (Sprint 7)
  const [billingPlans, setBillingPlans] = useState<BillingPlan[]>([])
  const [feeSchedules, setFeeSchedules] = useState<Row[]>([])
  const [discountRequests, setDiscountRequests] = useState<Row[]>([])
  const [feeForm, setFeeForm] = useState({ program_id: '', name: '', amount: '', effective_from: dateInput(new Date()) })
  const [planMode, setPlanMode] = useState<'single' | 'bulk'>('single')
  const [planForm, setPlanForm] = useState({ student_id: '', class_id: '', tuition_amount: '', amounts: '', due_dates: '' })
  const [bulkPlanForm, setBulkPlanForm] = useState({ class_id: '', fee_schedule_id: '', amounts: '', due_dates: '' })
  const [paymentForm, setPaymentForm] = useState({ installment_id: '', amount: '', method: 'bank_transfer', note: '' })
  const [discountForm, setDiscountForm] = useState({ plan_id: '', amount: '', percent: '', reason: '' })
  const [debtFilter, setDebtFilter] = useState<'all' | 'overdue'>('all')
  const [receiptModal, setReceiptModal] = useState<Row | null>(null)
  const [revenue, setRevenue] = useState<Row | null>(null)
  const [revenueGroupBy, setRevenueGroupBy] = useState<'class' | 'program'>('class')
  const [revenueDates, setRevenueDates] = useState({ from_date: dateInput(new Date(new Date().getFullYear(), new Date().getMonth(), 1)), to_date: dateInput(new Date()) })

  // Surveys (Sprint 8)
  const [surveys, setSurveys] = useState<Row[]>([])
  const [selectedSurvey, setSelectedSurvey] = useState<Row | null>(null)
  const [surveyAnswers, setSurveyAnswers] = useState<Record<number, string>>({})
  const [surveyForm, setSurveyForm] = useState({ class_id: '', title: 'Khảo sát chất lượng cuối khóa', due_at: localDateTime(new Date(Date.now() + 7 * 86400000)), questions: 'rating|Chất lượng giảng dạy của giảng viên\nrating|Mức độ hữu ích của tài liệu học tập\nrating|Độ khó và thời lượng bài tập\ntext|Góp ý bổ sung của bạn cho trung tâm' })
  const [surveyResults, setSurveyResults] = useState<Row | null>(null)

  // Reports & Dashboard (Sprint 8) & Audit Logs (Sprint 6)
  const [dashboard, setDashboard] = useState<Row | null>(null)
  const [reportTab, setReportTab] = useState<'dashboard' | 'audit'>('dashboard')
  const [auditLogs, setAuditLogs] = useState<Row[]>([])
  const [auditCategory, setAuditCategory] = useState<'all' | 'grade' | 'attendance'>('all')

  // Searchable Select Options
  const classOptions: SelectOption[] = useMemo(
    () => classes.map((c) => ({ value: String(c.id), label: c.name, subLabel: `Mã lớp #${c.id}` })),
    [classes]
  )
  const programOptions: SelectOption[] = useMemo(
    () => programs.map((p) => ({ value: String(p.id), label: p.name, subLabel: p.code || `ID #${p.id}` })),
    [programs]
  )
  const subjectOptions: SelectOption[] = useMemo(
    () => subjects.map((s) => ({ value: String(s.id), label: s.name, subLabel: s.code || `ID #${s.id}` })),
    [subjects]
  )
  const studentOptions: SelectOption[] = useMemo(
    () => students.map((s) => ({ value: String(s.id), label: `${s.full_name} (${s.student_code})`, subLabel: s.phone || s.email })),
    [students]
  )
  const feeScheduleOptions: SelectOption[] = useMemo(
    () => feeSchedules.map((f) => ({ value: String(f.id), label: `${f.name} · ${money(f.amount)}`, subLabel: f.program_name })),
    [feeSchedules]
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      // 1. Common lookup lists
      const [classRes, programRes, subjectRes] = await Promise.all([
        request<Row[] | { items: Row[] }>('/training/classes').catch(() => []),
        request<Row[] | { items: Row[] }>('/training/programs').catch(() => []),
        request<Row[] | { items: Row[] }>('/training/subjects').catch(() => []),
      ])
      const normClasses = (Array.isArray(classRes) ? classRes : classRes.items || []) as TrainingClass[]
      setClasses(normClasses)
      setPrograms(Array.isArray(programRes) ? programRes : programRes.items || [])
      setSubjects(Array.isArray(subjectRes) ? subjectRes : subjectRes.items || [])

      if (module === 'billing' || module === 'grades') {
        const studentRes = await request<Row[] | { items: Row[] }>('/students').catch(() => [])
        setStudents(Array.isArray(studentRes) ? studentRes : studentRes.items || [])
      }

      // 2. Module specific data
      if (module === 'attendance') {
        const policyRows = await request<Row[]>('/attendance/policies').catch(() => [])
        setPolicies(policyRows)
        if (normClasses.length > 0 && !attendanceClassId) {
          void loadAttendanceClass(String(normClasses[0].id))
        }
      } else if (module === 'assignments') {
        const [rows, rubricRows] = await Promise.all([
          request<Assignment[]>('/assignments'),
          canWrite ? request<Row[]>('/rubrics').catch(() => []) : Promise.resolve([]),
        ])
        setAssignments(rows)
        setRubrics(rubricRows)
        setSelectedAssignment((current) => rows.find((row) => row.id === current?.id) ?? rows[0] ?? null)
      } else if (module === 'materials') {
        const [items, notices, inbox] = await Promise.all([
          request<Row[]>('/materials'),
          request<Row[]>('/announcements'),
          request<{ items: Row[] }>('/notifications'),
        ])
        setMaterials(items)
        setAnnouncements(notices)
        setNotifications(inbox.items)
      } else if (module === 'grades') {
        const configs = await request<Row[]>('/grades/config')
        setGradeConfigs(configs)
        if (isStudent) {
          setTranscript(await request<Row>('/grades/transcript'))
        }
      } else if (module === 'billing') {
        const [plans, schedules, discounts] = await Promise.all([
          request<BillingPlan[]>('/billing/plans'),
          request<Row[]>('/billing/fee-schedules'),
          request<Row[]>('/billing/discount-requests'),
        ])
        setBillingPlans(plans)
        setFeeSchedules(schedules)
        setDiscountRequests(discounts)
      } else if (module === 'surveys') {
        const rows = await request<Row[]>('/surveys')
        setSurveys(rows)
        setSelectedSurvey((current) => rows.find((row) => row.id === current?.id) ?? rows.find((row) => !row.responded) ?? rows[0] ?? null)
      } else if (module === 'reports') {
        const [summary, risks, logs] = await Promise.all([
          request<Row>('/reports/dashboard'),
          request<Row[]>('/reports/attendance-risk'),
          isAdminOrManager ? request<Row[]>('/audit-logs').catch(() => []) : Promise.resolve([]),
        ])
        setDashboard({ ...summary, risk_details: risks })
        setAuditLogs(logs)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể tải dữ liệu.')
    } finally {
      setLoading(false)
    }
  }, [attendanceClassId, canWrite, isAdminOrManager, isStudent, module, request])

  useEffect(() => {
    void load()
  }, [load])

  async function run<T>(action: () => Promise<T>, success: string | ((result: T) => { message: string; tone?: 'success' | 'error' }), reload = true) {
    setBusy(true)
    try {
      const result = await action()
      const feedback = typeof success === 'function' ? success(result) : { message: success }
      notify(feedback.message, feedback.tone ?? 'success')
      if (reload) await load()
      return result
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : 'Không thể hoàn thành thao tác.', 'error')
      throw cause
    } finally {
      setBusy(false)
    }
  }

  async function loadAttendanceClass(id: string) {
    setAttendanceClassId(id)
    setAttendanceSummary(null)
    if (!id) return
    try {
      setAttendanceSummary(await request<AttendanceSummary>(`/attendance/classes/${id}/summary`))
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : 'Không thể tải chuyên cần.', 'error')
    }
  }

  async function loadSubmissions(assignment: Assignment) {
    setSelectedAssignment(assignment)
    if (isStudent) return
    try {
      const rows = await request<Row[]>(`/assignments/${assignment.id}/submissions`)
      setSubmissions(rows)
      setGradeInputs(
        Object.fromEntries(
          rows
            .filter((row) => row.submission)
            .map((row) => [
              row.submission.id,
              {
                score: String(row.submission.grade?.score ?? ''),
                feedback: row.submission.grade?.feedback ?? '',
              },
            ])
        )
      )
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : 'Không thể tải bài nộp.', 'error')
    }
  }

  async function viewReceipt(paymentId: number) {
    try {
      const data = await request<Row>(`/billing/payments/${paymentId}/receipt`)
      setReceiptModal(data)
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : 'Không thể tải biên lai.', 'error')
    }
  }

  // Pre-configured installment template generator
  function applyInstallmentTemplate(preset: '1' | '2' | '3', total: number) {
    if (!total || total <= 0) return
    const now = new Date()
    const d1 = dateInput(new Date(now.getTime() + 7 * 86400000))
    const d2 = dateInput(new Date(now.getTime() + 37 * 86400000))
    const d3 = dateInput(new Date(now.getTime() + 67 * 86400000))

    if (preset === '1') {
      setPlanForm((f) => ({ ...f, amounts: String(total), due_dates: d1 }))
      setBulkPlanForm((f) => ({ ...f, amounts: String(total), due_dates: d1 }))
    } else if (preset === '2') {
      const half = Math.round(total / 2)
      setPlanForm((f) => ({ ...f, amounts: `${half}, ${total - half}`, due_dates: `${d1}, ${d2}` }))
      setBulkPlanForm((f) => ({ ...f, amounts: `${half}, ${total - half}`, due_dates: `${d1}, ${d2}` }))
    } else if (preset === '3') {
      const p1 = Math.round(total * 0.4)
      const p2 = Math.round(total * 0.3)
      const p3 = total - p1 - p2
      setPlanForm((f) => ({ ...f, amounts: `${p1}, ${p2}, ${p3}`, due_dates: `${d1}, ${d2}, ${d3}` }))
      setBulkPlanForm((f) => ({ ...f, amounts: `${p1}, ${p2}, ${p3}`, due_dates: `${d1}, ${d2}, ${d3}` }))
    }
  }

  // -------------------------------------------------------------
  // SPRINT 5: ATTENDANCE
  // -------------------------------------------------------------
  if (module === 'attendance') {
    const studentItem = isStudent && attendanceSummary?.items?.[0]
    return (
      <section className="wf-page">
        <header className="wf-heading">
          <div>
            <small>SPRINT 5 · CHUYÊN CẦN & CẢNH BÁO</small>
            <h1>Chuyên cần & cảnh báo rủi ro</h1>
            <p>Theo dõi ma trận điểm danh, cảnh báo ngưỡng vắng vượt mức và xuất báo cáo Excel.</p>
          </div>
          <RefreshButton loading={loading} onClick={() => void load()} notify={notify} />
        </header>

        {error && <div className="wf-error" role="alert">{error}</div>}

        <Panel title="Chọn lớp học">
          <Grid>
            <Input label="Lớp học">
              <SearchableSelect
                options={classOptions}
                value={attendanceClassId}
                onChange={(val) => void loadAttendanceClass(val)}
                placeholder="Chọn lớp học để xem chuyên cần..."
              />
            </Input>
            {attendanceSummary && (
              <div className="wf-summary">
                Ngưỡng cảnh báo vắng của chương trình: <strong>{attendanceSummary.threshold_percent}%</strong>
              </div>
            )}
          </Grid>
        </Panel>

        {isStudent && studentItem && (
          <Panel title={`Chuyên cần của bạn: ${studentItem.student_name} (${studentItem.student_code})`}>
            <div className="wf-kpis">
              <article>
                <small>Tỷ lệ chuyên cần</small>
                <strong>{studentItem.attendance_percent}%</strong>
              </article>
              <article>
                <small>Tổng số buổi vắng</small>
                <strong style={{ color: studentItem.at_risk ? '#dc2626' : '#2563eb' }}>
                  {studentItem.absence_count} buổi (không phép: {studentItem.unexcused_count})
                </strong>
              </article>
              <article>
                <small>Trạng thái rủi ro</small>
                <strong>
                  {studentItem.at_risk ? (
                    <span className="wf-badge wf-badge-danger">Cảnh báo · Vượt ngưỡng {studentItem.threshold_percent}%</span>
                  ) : (
                    <span className="wf-badge wf-badge-success">Chuyên cần tốt</span>
                  )}
                </strong>
              </article>
            </div>
          </Panel>
        )}

        {attendanceSummary && (
          <Panel
            title={`Ma trận chuyên cần: ${attendanceSummary.class_name}`}
            action={!isStudent && <DownloadButton path={`/attendance/classes/${attendanceSummary.class_id}/summary.xlsx`} label="Xuất Excel ma trận" notify={notify} />}
          >
            <DataTable
              rows={attendanceSummary.items}
              columns={[
                ['Học viên', (r) => <><strong>{r.student_name}</strong><small>{r.student_code}</small></>],
                ['Chuyên cần', (r) => `${r.attendance_percent}%`],
                ['Số buổi vắng', (r) => `${r.absence_count} (không phép: ${r.unexcused_count})`],
                [
                  'Trạng thái',
                  (r) => (
                    <span className={`wf-badge ${r.at_risk ? 'wf-badge-danger' : 'wf-badge-success'}`}>
                      {r.at_risk ? `Cảnh báo · ≥${r.threshold_percent}% vắng` : 'Đạt chuẩn'}
                    </span>
                  ),
                ],
                [
                  'Chi tiết từng buổi',
                  (r) => (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
                      {r.statuses.map((s: string | null, i: number) => {
                        const iconMap: Record<string, { label: string; tone: string }> = {
                          present: { label: '✓', tone: '#059669' },
                          late: { label: 'M', tone: '#d97706' },
                          excused: { label: 'P', tone: '#3b82f6' },
                          unexcused: { label: 'V', tone: '#dc2626' },
                        }
                        const item = iconMap[s ?? ''] ?? { label: '·', tone: '#94a3b8' }
                        return (
                          <span
                            key={i}
                            className="wf-attendance-cell"
                            style={{ color: item.tone, fontWeight: 700 }}
                            title={`${attendanceSummary.lessons[i]?.title || `Buổi ${i+1}`}: ${s || 'chưa học'}`}
                          >
                            {item.label}
                          </span>
                        )
                      })}
                    </div>
                  ),
                ],
              ]}
            />
          </Panel>
        )}

        {canWrite && !isStudent && (
          <Panel title="Cấu hình ngưỡng cảnh báo vắng theo chương trình (S5-02)">
            <DataTable
              rows={policies}
              columns={[
                ['Chương trình đào tạo', (r) => <strong>{r.program_name}</strong>],
                [
                  'Ngưỡng cảnh báo (%)',
                  (r) => (
                    <input
                      style={{ width: '120px' }}
                      type="number"
                      min="1"
                      max="100"
                      value={policyDraft[r.program_id] ?? r.absence_threshold_percent}
                      onChange={(e) => setPolicyDraft({ ...policyDraft, [r.program_id]: e.target.value })}
                    />
                  ),
                ],
                [
                  'Thao tác',
                  (r) => (
                    <button
                      className="wf-button"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () =>
                            request(`/attendance/policies/${r.program_id}`, {
                              method: 'PUT',
                              body: JSON.stringify({ absence_threshold_percent: Number(policyDraft[r.program_id] ?? r.absence_threshold_percent) }),
                            }),
                          'Đã cập nhật ngưỡng cảnh báo chương trình.'
                        )
                      }
                    >
                      Lưu ngưỡng
                    </button>
                  ),
                ],
              ]}
            />
          </Panel>
        )}
      </section>
    )
  }

  // -------------------------------------------------------------
  // SPRINT 5 & 6: ASSIGNMENTS & GRADING
  // -------------------------------------------------------------
  if (module === 'assignments') {
    // Filter assignments for student
    const filteredAssignments = assignments.filter((item) => {
      if (assignmentFilter === 'all') return true
      const state = item.submission?.state
      if (assignmentFilter === 'unsubmitted') return !item.submission
      if (assignmentFilter === 'submitted') return state === 'submitted'
      if (assignmentFilter === 'graded') return state === 'graded'
      if (assignmentFilter === 'revision') return state === 'revision_requested'
      return true
    })

    // Filter submissions for teacher
    const filteredSubmissions = submissions.filter((item) => {
      if (submissionFilter === 'all') return true
      if (submissionFilter === 'not_submitted') return !item.submission
      if (submissionFilter === 'ungraded') return item.submission && item.submission.state !== 'graded'
      if (submissionFilter === 'graded') return item.submission && item.submission.state === 'graded'
      if (submissionFilter === 'late') return item.submission?.versions?.[0]?.is_late
      return true
    })

    // Grading progress stats
    const totalSubs = submissions.filter((s) => s.submission).length
    const gradedSubs = submissions.filter((s) => s.submission?.state === 'graded').length
    const progressPct = totalSubs > 0 ? Math.round((gradedSubs / totalSubs) * 100) : 0

    // Next ungraded submission index
    const nextSubmissionIdx = submissions.findIndex((s) => s.submission && s.submission.state !== 'graded')

    return (
      <section className="wf-page">
        <header className="wf-heading">
          <div>
            <small>SPRINT 5–6 · BÀI TẬP & CHẤM ĐIỂM</small>
            <h1>Bài tập, nộp bài & chấm điểm</h1>
            <p>Giao bài tập, quản lý nộp bài đa phiên bản, chấm điểm theo rubric và công bố kết quả.</p>
          </div>
          <div className="wf-actions">
            {canWrite && !isStudent && (
              <button className="wf-button" onClick={() => setShowRubricModal(true)}>
                Quản lý Rubric mẫu ({rubrics.length})
              </button>
            )}
            <RefreshButton loading={loading} onClick={() => void load()} notify={notify} hasData={assignments.length > 0} />
          </div>
        </header>

        {error && <div className="wf-error" role="alert">{error}</div>}

        {/* Create Assignment Form */}
        {canWrite && !isStudent && (
          <Panel title="Tạo bài tập mới (Lưu nháp hoặc Giao bài ngay)">
            <form
              onSubmit={(e: FormEvent<HTMLFormElement>) => {
                e.preventDefault()
                const state = ((e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.dataset.state ?? 'draft'
                void run(async () => {
                  const payload = {
                    ...assignmentForm,
                    class_id: Number(assignmentForm.class_id),
                    subject_id: Number(assignmentForm.subject_id),
                    lesson_id: assignmentForm.lesson_id ? Number(assignmentForm.lesson_id) : null,
                    max_score: Number(assignmentForm.max_score),
                    due_at: new Date(assignmentForm.due_at).toISOString(),
                    state,
                  }
                  return request('/assignments', json(payload))
                }, state === 'published' ? 'Đã giao bài tập cho lớp và gửi thông báo.' : 'Đã lưu nháp bài tập.')
              }}
            >
              <Grid>
                <Input label="Lớp học">
                  <SearchableSelect
                    options={classOptions}
                    value={assignmentForm.class_id}
                    onChange={(val) => setAssignmentForm({ ...assignmentForm, class_id: val })}
                    placeholder="Chọn lớp học..."
                  />
                </Input>
                <Input label="Môn học">
                  <SearchableSelect
                    options={subjectOptions}
                    value={assignmentForm.subject_id}
                    onChange={(val) => setAssignmentForm({ ...assignmentForm, subject_id: val })}
                    placeholder="Chọn môn học..."
                  />
                </Input>
                <Input label="Tiêu đề bài tập">
                  <input
                    required
                    maxLength={200}
                    placeholder="Ví dụ: Bài tập lớn kết thúc môn..."
                    value={assignmentForm.title}
                    onChange={(e) => setAssignmentForm({ ...assignmentForm, title: e.target.value })}
                  />
                </Input>
                <Input label="Hạn nộp bài">
                  <input
                    required
                    type="datetime-local"
                    value={assignmentForm.due_at}
                    onChange={(e) => setAssignmentForm({ ...assignmentForm, due_at: e.target.value })}
                  />
                </Input>
                <Input label="Điểm tối đa">
                  <input
                    required
                    type="number"
                    min="1"
                    max="100"
                    step="0.1"
                    value={assignmentForm.max_score}
                    onChange={(e) => setAssignmentForm({ ...assignmentForm, max_score: e.target.value })}
                  />
                </Input>
                <Input label="Quy định nộp muộn">
                  <select
                    value={assignmentForm.late_policy}
                    onChange={(e) => setAssignmentForm({ ...assignmentForm, late_policy: e.target.value })}
                  >
                    <option value="accept">Cho phép nộp và đánh dấu Nộp muộn</option>
                    <option value="block">Chặn nộp sau hạn</option>
                  </select>
                </Input>
                <Input label="Mô tả & yêu cầu bài nộp">
                  <textarea
                    placeholder="Mô tả chi tiết yêu cầu, định dạng nộp, đường dẫn đề bài..."
                    value={assignmentForm.description}
                    onChange={(e) => setAssignmentForm({ ...assignmentForm, description: e.target.value })}
                  />
                </Input>
              </Grid>
              <div className="wf-actions">
                <button className="wf-button" disabled={busy} data-state="draft">Lưu bản nháp</button>
                <button className="wf-primary" disabled={busy} data-state="published">Giao bài cho lớp ngay</button>
              </div>
            </form>
          </Panel>
        )}

        {/* Assignment List */}
        <Panel
          title={isStudent ? 'Danh sách bài tập của bạn' : 'Danh sách bài tập đã giao'}
          action={
            isStudent && (
              <div className="wf-tabs">
                <button className={`wf-tab-btn ${assignmentFilter === 'all' ? 'is-active' : ''}`} onClick={() => setAssignmentFilter('all')}>Tất cả ({assignments.length})</button>
                <button className={`wf-tab-btn ${assignmentFilter === 'unsubmitted' ? 'is-active' : ''}`} onClick={() => setAssignmentFilter('unsubmitted')}>Chưa nộp</button>
                <button className={`wf-tab-btn ${assignmentFilter === 'submitted' ? 'is-active' : ''}`} onClick={() => setAssignmentFilter('submitted')}>Đã nộp</button>
                <button className={`wf-tab-btn ${assignmentFilter === 'graded' ? 'is-active' : ''}`} onClick={() => setAssignmentFilter('graded')}>Đã chấm</button>
                <button className={`wf-tab-btn ${assignmentFilter === 'revision' ? 'is-active' : ''}`} onClick={() => setAssignmentFilter('revision')}>Cần làm lại</button>
              </div>
            )
          }
        >
          <DataTable
            rows={filteredAssignments}
            columns={[
              [
                'Bài tập',
                (r) => (
                  <div>
                    <button className="wf-link" onClick={() => void loadSubmissions(r as Assignment)}>
                      {r.title}
                    </button>
                    {r.description && <small>{r.description.slice(0, 70)}...</small>}
                  </div>
                ),
              ],
              [
                'Lớp / Môn',
                (r) => {
                  const c = classes.find((item) => item.id === r.class_id)
                  const s = subjects.find((item) => item.id === r.subject_id)
                  return <>{c?.name || `#${r.class_id}`}<small>{s?.name || `#${r.subject_id}`}</small></>
                },
              ],
              [
                'Hạn nộp & Thời gian còn lại',
                (r) => {
                  const msLeft = new Date(r.due_at).getTime() - Date.now()
                  const hoursLeft = Math.round(msLeft / 3600000)
                  const daysLeft = Math.round(msLeft / 86400000)
                  const isExpired = msLeft <= 0
                  return (
                    <div>
                      {displayDate(r.due_at)}
                      <div>
                        {isExpired ? (
                          <span className="wf-badge wf-badge-danger">Đã hết hạn</span>
                        ) : hoursLeft < 24 ? (
                          <span className="wf-badge wf-badge-warning">Sắp hết hạn (còn {hoursLeft} giờ)</span>
                        ) : (
                          <span className="wf-badge wf-badge-info">Còn {daysLeft} ngày</span>
                        )}
                      </div>
                    </div>
                  )
                },
              ],
              [
                'Trạng thái',
                (r) => {
                  if (r.submission) {
                    const st = r.submission.state
                    if (st === 'graded') return <span className="wf-badge wf-badge-success">Đã chấm</span>
                    if (st === 'revision_requested') return <span className="wf-badge wf-badge-warning">Cần làm lại</span>
                    return <span className="wf-badge wf-badge-info">Đã nộp (v{r.submission.current_version})</span>
                  }
                  return <span className="wf-badge">{r.state === 'draft' ? 'Bản nháp' : 'Chưa nộp'}</span>
                },
              ],
              [
                'Điểm',
                (r) =>
                  r.submission?.grade?.score != null ? (
                    <strong style={{ color: '#059669', fontSize: '14px' }}>
                      {r.submission.grade.score}/{r.max_score}
                    </strong>
                  ) : (
                    '—'
                  ),
              ],
            ]}
          />
        </Panel>

        {/* Student Submission View */}
        {selectedAssignment && isStudent && (
          <Panel title={`Nộp bài tập: ${selectedAssignment.title}`}>
            <p>{selectedAssignment.description}</p>
            {selectedAssignment.submission?.grade && (
              <div className="wf-success" style={{ marginBottom: '14px' }}>
                <h4 style={{ margin: '0 0 6px' }}>Điểm đã công bố: {selectedAssignment.submission.grade.score}/{selectedAssignment.max_score}</h4>
                <p style={{ margin: 0 }}><strong>Nhận xét của giảng viên:</strong> {selectedAssignment.submission.grade.feedback || 'Không có nhận xét thêm'}</p>
                {selectedAssignment.submission.grade.criteria_json && selectedAssignment.submission.grade.criteria_json !== '[]' && (
                  <div style={{ marginTop: '8px', fontSize: '12.5px' }}>
                    <strong>Chi tiết Rubric:</strong>
                    {(() => {
                      try {
                        const crit = JSON.parse(selectedAssignment.submission.grade.criteria_json)
                        return (
                          <ul style={{ margin: '4px 0', paddingLeft: '20px' }}>
                            {crit.map((c: Row, idx: number) => (
                              <li key={idx}>{c.name}: {c.score} điểm</li>
                            ))}
                          </ul>
                        )
                      } catch {
                        return null
                      }
                    })()}
                  </div>
                )}
              </div>
            )}

            {/* Submission versions history */}
            {selectedAssignment.submission && selectedAssignment.submission.versions?.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                <h4>Lịch sử các phiên bản nộp:</h4>
                <DataTable
                  rows={selectedAssignment.submission.versions}
                  columns={[
                    ['Phiên bản', (r) => <>#v{r.version_number} {r.is_late && <span className="wf-badge wf-badge-danger">Nộp muộn</span>}</>],
                    ['Thời điểm nộp', (r) => displayDate(r.submitted_at)],
                    ['Repo liên kết', (r) => r.repo_url ? <a href={r.repo_url} target="_blank" rel="noreferrer">Mở liên kết ↗</a> : '—'],
                    [
                      'Tệp đính kèm',
                      (r) =>
                        (r.files ?? []).map((f: Row) => (
                          <a
                            key={f.storage_name}
                            className="wf-file-link"
                            href={`${apiBase}/submissions/files/${encodeURIComponent(f.storage_name)}`}
                            onClick={(e) => {
                              const token = localStorage.getItem('tms_token')
                              if (!token) return
                              e.preventDefault()
                              void fetch(e.currentTarget.href, { headers: { Authorization: `Bearer ${token}` } })
                                .then((res) => res.blob())
                                .then((blob) => {
                                  const url = URL.createObjectURL(blob)
                                  const a = document.createElement('a')
                                  a.href = url
                                  a.download = f.file_name
                                  a.click()
                                  URL.revokeObjectURL(url)
                                })
                                .catch(() => notify('Không thể tải tệp nộp.', 'error'))
                            }}
                          >
                            {f.file_name}
                          </a>
                        )),
                    ],
                  ]}
                />
              </div>
            )}

            {/* Submit form */}
            <form
              onSubmit={(e) => {
                e.preventDefault()
                const data = new FormData()
                Array.from(submissionFiles ?? []).forEach((file) => data.append('files', file))
                const query = submissionRepo.trim() ? `?repo_url=${encodeURIComponent(submissionRepo.trim())}` : ''
                void run(
                  () => request(`/assignments/${selectedAssignment.id}/submissions${query}`, { method: 'POST', body: data }),
                  'Đã nộp bài tập thành công!'
                )
              }}
            >
              <Grid>
                <Input label="Liên kết Repository GitHub/GitLab (HTTPS)">
                  <input
                    type="url"
                    placeholder="https://github.com/..."
                    value={submissionRepo}
                    onChange={(e) => setSubmissionRepo(e.target.value)}
                  />
                </Input>
                <Input label="Tệp đính kèm (cho phép chọn nhiều, tối đa 20MB/tệp)">
                  <input type="file" multiple onChange={(e) => setSubmissionFiles(e.target.files)} />
                </Input>
              </Grid>
              <button className="wf-primary" disabled={busy}>
                {selectedAssignment.submission ? 'Nộp lại bài (tạo phiên bản mới)' : 'Xác nhận nộp bài'}
              </button>
            </form>
          </Panel>
        )}

        {/* Teacher Submissions Grading View */}
        {selectedAssignment && !isStudent && (
          <Panel
            title={`Danh sách bài nộp: ${selectedAssignment.title}`}
            action={
              <div className="wf-tabs">
                <button className={`wf-tab-btn ${submissionFilter === 'all' ? 'is-active' : ''}`} onClick={() => setSubmissionFilter('all')}>Tất cả ({submissions.length})</button>
                <button className={`wf-tab-btn ${submissionFilter === 'ungraded' ? 'is-active' : ''}`} onClick={() => setSubmissionFilter('ungraded')}>Chưa chấm ({submissions.filter((s) => s.submission && s.submission.state !== 'graded').length})</button>
                <button className={`wf-tab-btn ${submissionFilter === 'graded' ? 'is-active' : ''}`} onClick={() => setSubmissionFilter('graded')}>Đã chấm ({gradedSubs})</button>
                <button className={`wf-tab-btn ${submissionFilter === 'late' ? 'is-active' : ''}`} onClick={() => setSubmissionFilter('late')}>Nộp muộn</button>
                <button className={`wf-tab-btn ${submissionFilter === 'not_submitted' ? 'is-active' : ''}`} onClick={() => setSubmissionFilter('not_submitted')}>Chưa nộp</button>
              </div>
            }
          >
            {/* Progress bar */}
            {/* Progress bar */}
            <div className="wf-progress-container">
              <div className="wf-progress-label">
                <span>Tiến độ chấm bài lớp: {gradedSubs} / {totalSubs} bài đã nộp</span>
              </div>
              <div className="wf-progress-track" title={`Tiến độ chấm bài: ${progressPct}%`}>
                <div className="wf-progress-fill" style={{ width: `${progressPct}%` }} />
                <span className="wf-progress-text">{progressPct}%</span>
              </div>
            </div>

            {nextSubmissionIdx >= 0 && (
              <div style={{ marginBottom: '10px' }}>
                <button
                  className="wf-button"
                  style={{ background: '#e0e7ff', borderColor: '#4f46e5', color: '#3730a3' }}
                  onClick={() => {
                    const el = document.getElementById(`sub-row-${submissions[nextSubmissionIdx].submission.id}`)
                    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                  }}
                >
                  ⚡ Chuyển nhanh tới bài chưa chấm tiếp theo ({submissions[nextSubmissionIdx].student_name})
                </button>
              </div>
            )}

            <DataTable
              rows={filteredSubmissions}
              columns={[
                ['Học viên', (r) => <><strong>{r.student_name}</strong><small>{r.student_code}</small></>],
                [
                  'Trạng thái nộp',
                  (r) =>
                    r.submission ? (
                      <div>
                        <span className={`wf-badge ${r.submission.state === 'graded' ? 'wf-badge-success' : 'wf-badge-info'}`}>
                          {r.submission.state === 'graded' ? 'Đã chấm' : `Đã nộp v${r.submission.current_version}`}
                        </span>
                        {r.submission.versions?.[0]?.is_late && <span className="wf-badge wf-badge-danger" style={{ marginLeft: '4px' }}>Muộn</span>}
                      </div>
                    ) : (
                      <span className="wf-badge">Chưa nộp</span>
                    ),
                ],
                [
                  'Tệp / Repo liên kết',
                  (r) =>
                    r.submission?.versions?.[0] ? (
                      <div>
                        {r.submission.versions[0].files?.map((f: Row) => (
                          <a
                            key={f.storage_name}
                            className="wf-file-link"
                            href={`${apiBase}/submissions/files/${encodeURIComponent(f.storage_name)}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            📄 {f.file_name}
                          </a>
                        ))}
                        {r.submission.versions[0].repo_url && (
                          <div><a href={r.submission.versions[0].repo_url} target="_blank" rel="noreferrer">🔗 Mở repo ↗</a></div>
                        )}
                      </div>
                    ) : (
                      '—'
                    ),
                ],
                [
                  'Thao tác chấm điểm & phản hồi',
                  (r) =>
                    r.submission ? (
                      <div id={`sub-row-${r.submission.id}`} className="wf-grade-cell">
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <input
                            aria-label="Điểm"
                            style={{ width: '80px' }}
                            type="number"
                            min="0"
                            max={selectedAssignment.max_score}
                            step="0.1"
                            placeholder="Điểm"
                            value={gradeInputs[r.submission.id]?.score ?? ''}
                            onChange={(e) =>
                              setGradeInputs({
                                ...gradeInputs,
                                [r.submission.id]: {
                                  score: e.target.value,
                                  feedback: gradeInputs[r.submission.id]?.feedback ?? '',
                                },
                              })
                            }
                          />
                          <input
                            aria-label="Nhận xét"
                            placeholder="Nhận xét góp ý cho học viên..."
                            value={gradeInputs[r.submission.id]?.feedback ?? ''}
                            onChange={(e) =>
                              setGradeInputs({
                                ...gradeInputs,
                                [r.submission.id]: {
                                  score: gradeInputs[r.submission.id]?.score ?? '',
                                  feedback: e.target.value,
                                },
                              })
                            }
                          />
                        </div>
                        <div className="wf-actions">
                          <button
                            className="wf-button"
                            onClick={() =>
                              void run(
                                () =>
                                  request(
                                    `/assignments/${selectedAssignment.id}/submissions/${r.submission.id}/grade`,
                                    json({
                                      score: Number(gradeInputs[r.submission.id]?.score),
                                      feedback: gradeInputs[r.submission.id]?.feedback ?? '',
                                    })
                                  ),
                                'Đã lưu điểm bài nộp.',
                                false
                              )
                            }
                          >
                            Lưu điểm
                          </button>
                          <button
                            className="wf-primary"
                            onClick={() =>
                              void run(
                                () => request(`/assignments/${selectedAssignment.id}/submissions/${r.submission.id}/publish`, json({})),
                                'Đã công bố điểm cho học viên.',
                                false
                              )
                            }
                          >
                            Công bố
                          </button>
                          <button
                            className="wf-button"
                            style={{ color: '#b45309' }}
                            onClick={() =>
                              setRevisionModal({
                                open: true,
                                submissionId: r.submission.id,
                                dueAt: localDateTime(new Date(Date.now() + 3 * 86400000)),
                                feedback: '',
                              })
                            }
                          >
                            Yêu cầu làm lại
                          </button>
                        </div>
                      </div>
                    ) : (
                      '—'
                    ),
                ],
              ]}
            />
          </Panel>
        )}

        {/* Revision modal */}
        {revisionModal.open && revisionModal.submissionId && (
          <div className="wf-modal-overlay">
            <div className="wf-modal">
              <div className="wf-modal-header">
                <h3>Yêu cầu học viên làm lại bài nộp</h3>
                <button className="wf-modal-close" onClick={() => setRevisionModal({ ...revisionModal, open: false })}>×</button>
              </div>
              <p>Học viên sẽ nhận thông báo kèm nhận xét và được phép nộp lại phiên bản mới.</p>
              <Input label="Hạn nộp lại mới">
                <input
                  type="datetime-local"
                  required
                  value={revisionModal.dueAt}
                  onChange={(e) => setRevisionModal({ ...revisionModal, dueAt: e.target.value })}
                />
              </Input>
              <Input label="Nhận xét & lý do yêu cầu làm lại (bắt buộc)">
                <textarea
                  required
                  placeholder="Nêu rõ phần cần sửa hoặc bổ sung..."
                  value={revisionModal.feedback}
                  onChange={(e) => setRevisionModal({ ...revisionModal, feedback: e.target.value })}
                />
              </Input>
              <div className="wf-actions" style={{ justifyContent: 'flex-end' }}>
                <button className="wf-button" onClick={() => setRevisionModal({ ...revisionModal, open: false })}>Hủy</button>
                <button
                  className="wf-primary"
                  disabled={!revisionModal.feedback.trim()}
                  onClick={() => {
                    void run(
                      () =>
                        request(
                          `/assignments/${selectedAssignment?.id}/submissions/${revisionModal.submissionId}/revision`,
                          json({
                            due_at: new Date(revisionModal.dueAt).toISOString(),
                            feedback: revisionModal.feedback.trim(),
                          })
                        ),
                      'Đã chuyển trạng thái sang Cần làm lại và thông báo cho học viên.'
                    ).then(() => setRevisionModal({ ...revisionModal, open: false }))
                  }}
                >
                  Xác nhận yêu cầu
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Rubrics modal */}
        {showRubricModal && (
          <div className="wf-modal-overlay">
            <div className="wf-modal">
              <div className="wf-modal-header">
                <h3>Quản lý Rubric chấm điểm mẫu (S6-02)</h3>
                <button className="wf-modal-close" onClick={() => setShowRubricModal(false)}>×</button>
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  const criteria = rubricForm.criteria
                    .split('\n')
                    .map((line) => {
                      const [name, weight] = line.split(':')
                      return { name: name?.trim(), weight: Number(weight?.trim()) }
                    })
                    .filter((c) => c.name && c.weight > 0)
                  void run(
                    () => request('/rubrics', json({ name: rubricForm.name, criteria })),
                    'Đã lưu Rubric mẫu thành công.'
                  )
                }}
              >
                <Input label="Tên bộ tiêu chí (Rubric)">
                  <input
                    required
                    placeholder="Ví dụ: Rubric đồ án web Frontend..."
                    value={rubricForm.name}
                    onChange={(e) => setRubricForm({ ...rubricForm, name: e.target.value })}
                  />
                </Input>
                <Input label="Các tiêu chí & trọng số % (mỗi dòng: Tên tiêu chí:Trọng số %, tổng = 100%)">
                  <textarea
                    rows={4}
                    required
                    value={rubricForm.criteria}
                    onChange={(e) => setRubricForm({ ...rubricForm, criteria: e.target.value })}
                  />
                </Input>
                <button className="wf-primary">Lưu Rubric mẫu mới</button>
              </form>
              <div style={{ marginTop: '12px' }}>
                <h4>Các Rubric hiện có:</h4>
                <DataTable
                  rows={rubrics}
                  columns={[
                    ['Tên Rubric', (r) => <strong>{r.name}</strong>],
                    [
                      'Tiêu chí',
                      (r) => (
                        <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '12px' }}>
                          {r.criteria?.map((c: Row, i: number) => (
                            <li key={i}>{c.name} ({c.weight}%)</li>
                          ))}
                        </ul>
                      ),
                    ],
                  ]}
                />
              </div>
            </div>
          </div>
        )}
      </section>
    )
  }

  // -------------------------------------------------------------
  // SPRINT 6: MATERIALS & ANNOUNCEMENTS
  // -------------------------------------------------------------
  if (module === 'materials') {
    return (
      <section className="wf-page">
        <header className="wf-heading">
          <div>
            <small>SPRINT 6 · HỌC LIỆU & THÔNG BÁO</small>
            <h1>Học liệu, thông báo lớp & hộp thư</h1>
            <p>Đăng học liệu buổi học, gửi thông báo theo lớp và theo dõi hộp thư thông báo cá nhân.</p>
          </div>
          <RefreshButton loading={loading} onClick={() => void load()} notify={notify} hasData={materials.length > 0 || announcements.length > 0} />
        </header>

        {error && <div className="wf-error" role="alert">{error}</div>}

        {/* Upload Learning Material */}
        {canWrite && !isStudent && (
          <Panel title="Đăng tải học liệu cho buổi học">
            <form
              onSubmit={(e) => {
                e.preventDefault()
                const params = new URLSearchParams({
                  class_id: materialForm.class_id,
                  lesson_id: materialForm.lesson_id,
                  title: materialForm.title,
                  available_early: String(materialForm.available_early),
                })
                if (materialForm.external_url) params.set('external_url', materialForm.external_url)
                const body = new FormData()
                if (materialForm.file) body.append('file', materialForm.file)
                void run(() => request(`/materials?${params}`, { method: 'POST', body }), 'Đã đăng tải học liệu thành công.')
              }}
            >
              <Grid>
                <Input label="Lớp học">
                  <SearchableSelect
                    options={classOptions}
                    value={materialForm.class_id}
                    onChange={(val) => setMaterialForm({ ...materialForm, class_id: val })}
                    placeholder="Chọn lớp học..."
                  />
                </Input>
                <Input label="Mã buổi học ID">
                  <input
                    type="number"
                    min="1"
                    required
                    placeholder="Nhập ID buổi học..."
                    value={materialForm.lesson_id}
                    onChange={(e) => setMaterialForm({ ...materialForm, lesson_id: e.target.value })}
                  />
                </Input>
                <Input label="Tiêu đề học liệu">
                  <input
                    required
                    placeholder="Ví dụ: Slide bài giảng Buổi 3..."
                    value={materialForm.title}
                    onChange={(e) => setMaterialForm({ ...materialForm, title: e.target.value })}
                  />
                </Input>
                <Input label="Tệp đính kèm (Slide/PDF/ZIP)">
                  <input type="file" onChange={(e) => setMaterialForm({ ...materialForm, file: e.target.files?.[0] ?? null })} />
                </Input>
                <Input label="Hoặc liên kết ngoài (Drive/Figma/Video)">
                  <input
                    type="url"
                    placeholder="https://..."
                    value={materialForm.external_url}
                    onChange={(e) => setMaterialForm({ ...materialForm, external_url: e.target.value })}
                  />
                </Input>
                <label className="wf-check">
                  <input
                    type="checkbox"
                    checked={materialForm.available_early}
                    onChange={(e) => setMaterialForm({ ...materialForm, available_early: e.target.checked })}
                  />
                  Mở học liệu trước buổi học (học viên xem trước bài)
                </label>
              </Grid>
              <button className="wf-primary" disabled={busy}>Đăng học liệu</button>
            </form>
          </Panel>
        )}

        {/* Materials List */}
        <Panel title="Danh mục học liệu của lớp">
          <DataTable
            rows={materials}
            columns={[
              ['Tiêu đề học liệu', (r) => <strong>{r.title}</strong>],
              ['Buổi học', (r) => r.lesson_title || `Buổi #${r.lesson_id}`],
              [
                'Tệp đính kèm / Liên kết',
                (r) =>
                  r.file_name ? (
                    <a
                      href={`${apiBase}/materials/${r.id}/file`}
                      onClick={(e) => {
                        const token = localStorage.getItem('tms_token')
                        if (!token) return
                        e.preventDefault()
                        void fetch(e.currentTarget.href, { headers: { Authorization: `Bearer ${token}` } })
                          .then((res) => res.blob())
                          .then((blob) => {
                            const url = URL.createObjectURL(blob)
                            const a = document.createElement('a')
                            a.href = url
                            a.download = r.file_name
                            a.click()
                            URL.revokeObjectURL(url)
                          })
                          .catch(() => notify('Không thể tải học liệu.', 'error'))
                      }}
                    >
                      📥 {r.file_name}
                    </a>
                  ) : (
                    <a href={r.external_url} target="_blank" rel="noreferrer">🔗 Mở liên kết ngoài ↗</a>
                  ),
              ],
              ['Thời điểm đăng', (r) => displayDate(r.created_at)],
            ]}
          />
        </Panel>

        {/* Class Announcements */}
        {canWrite && !isStudent && (
          <Panel title="Soạn và gửi thông báo tới các lớp (S6-07)">
            <form
              onSubmit={(e) => {
                e.preventDefault()
                const class_ids = announcementForm.class_ids.split(',').map((s) => Number(s.trim())).filter(Boolean)
                void run(
                  () =>
                    request<{ emails_sent: number; emails_failed: number; emails_skipped: number }>(
                      '/announcements',
                      json({ ...announcementForm, class_ids })
                    ),
                  (res) => ({
                    message: `Thông báo đã gửi thành công! Email: ${res.emails_sent} gửi được, ${res.emails_failed} lỗi, ${res.emails_skipped} bỏ qua (do chưa cấu hình SMTP).`,
                    tone: res.emails_failed ? 'error' : 'success',
                  })
                )
              }}
            >
              <Grid>
                <Input label="Chọn lớp nhận thông báo">
                  <SearchableSelect
                    options={classOptions}
                    value={announcementForm.class_ids}
                    onChange={(val) => setAnnouncementForm({ ...announcementForm, class_ids: val })}
                    placeholder="Chọn lớp học..."
                  />
                </Input>
                <Input label="Tiêu đề thông báo">
                  <input
                    required
                    maxLength={200}
                    placeholder="Ví dụ: Thông báo nghỉ lễ / Đổi phòng học..."
                    value={announcementForm.title}
                    onChange={(e) => setAnnouncementForm({ ...announcementForm, title: e.target.value })}
                  />
                </Input>
                <Input label="Nội dung thông báo">
                  <textarea
                    required
                    placeholder="Nhập nội dung thông báo gửi tới học viên..."
                    value={announcementForm.body}
                    onChange={(e) => setAnnouncementForm({ ...announcementForm, body: e.target.value })}
                  />
                </Input>
              </Grid>
              <button className="wf-primary" disabled={busy}>Gửi thông báo ngay</button>
            </form>
          </Panel>
        )}

        <Panel title="Thông báo lớp học đã gửi">
          <DataTable
            rows={announcements}
            columns={[
              ['Tiêu đề & Nội dung', (r) => <><strong>{r.title}</strong><small>{r.body}</small></>],
              ['Lớp', (r) => { const c = classes.find((item) => item.id === r.class_id); return c?.name || `#${r.class_id}` }],
              ['Ngày gửi', (r) => displayDate(r.created_at)],
              [
                'Trạng thái',
                (r) =>
                  r.read ? (
                    <span className="wf-badge wf-badge-success">Đã đọc</span>
                  ) : (
                    <button className="wf-button" onClick={() => void run(() => request(`/announcements/${r.id}/read`, json({})), 'Đã đánh dấu đã đọc.')}>
                      Đánh dấu đã đọc
                    </button>
                  ),
              ],
            ]}
          />
        </Panel>

        {/* In-app Notifications Box */}
        <Panel
          title="Hộp thư thông báo cá nhân (S6-09 & S6-10)"
          action={
            <button className="wf-button" onClick={() => void run(() => request('/notifications/read-all', json({})), 'Đã đánh dấu toàn bộ là đã đọc.')}>
              Đánh dấu tất cả là đã đọc
            </button>
          }
        >
          <DataTable
            rows={notifications}
            columns={[
              ['Thông báo', (r) => <><strong>{r.title}</strong><small>{r.body}</small></>],
              ['Thời điểm', (r) => displayDate(r.created_at)],
              [
                'Trạng thái',
                (r) =>
                  r.read_at ? (
                    <span className="wf-badge wf-badge-info">Đã đọc ({displayDate(r.read_at)})</span>
                  ) : (
                    <button className="wf-button" onClick={() => void run(() => request(`/notifications/${r.id}/read`, json({})), 'Đã đánh dấu đã đọc.')}>
                      Đánh dấu đã đọc
                    </button>
                  ),
              ],
            ]}
          />
        </Panel>
      </section>
    )
  }

  // -------------------------------------------------------------
  // SPRINT 7: BILLING & DEBTS
  // -------------------------------------------------------------
  if (module === 'billing') {
    // Filter overdue debts
    const filteredPlans = billingPlans.filter((p) => {
      if (debtFilter === 'all') return true
      const now = dateInput(new Date())
      return p.installments?.some((inst: Row) => inst.remaining > 0 && inst.due_date < now)
    })

    const totalDue = filteredPlans.reduce((acc, p) => acc + (p.amount_due || 0), 0)
    const totalReceived = filteredPlans.reduce((acc, p) => acc + (p.received || 0), 0)
    const totalRemaining = filteredPlans.reduce((acc, p) => acc + (p.remaining || 0), 0)

    return (
      <section className="wf-page">
        <header className="wf-heading">
          <div>
            <small>SPRINT 7 · HỌC PHÍ & CÔNG NỢ</small>
            <h1>Học phí, kế hoạch đóng & công nợ</h1>
            <p>Biểu phí theo chương trình, kế hoạch nhiều đợt, ghi nhận thanh toán bất biến và biên lai PDF.</p>
          </div>
          <RefreshButton loading={loading} onClick={() => void load()} notify={notify} hasData={feeSchedules.length > 0 || billingPlans.length > 0} />
        </header>

        {error && <div className="wf-error" role="alert">{error}</div>}

        {/* Create Fee Schedule */}
        {canWrite && !isStudent && (
          <Panel title="Khai báo biểu phí chương trình mới (S7-01)">
            <form
              onSubmit={(e) => {
                e.preventDefault()
                void run(
                  () =>
                    request('/billing/fee-schedules', json({ ...feeForm, program_id: Number(feeForm.program_id), amount: Number(feeForm.amount), effective_to: null })),
                  'Đã tạo biểu phí mới thành công.'
                )
              }}
            >
              <Grid>
                <Input label="Chương trình đào tạo">
                  <SearchableSelect
                    options={programOptions}
                    value={feeForm.program_id}
                    onChange={(val) => setFeeForm({ ...feeForm, program_id: val })}
                    placeholder="Chọn chương trình..."
                  />
                </Input>
                <Input label="Tên biểu phí">
                  <input
                    required
                    placeholder="Ví dụ: Biểu phí tiêu chuẩn K14..."
                    value={feeForm.name}
                    onChange={(e) => setFeeForm({ ...feeForm, name: e.target.value })}
                  />
                </Input>
                <Input label="Mức học phí (VND)">
                  <input
                    required
                    type="number"
                    min="1"
                    placeholder="Ví dụ: 12000000"
                    value={feeForm.amount}
                    onChange={(e) => setFeeForm({ ...feeForm, amount: e.target.value })}
                  />
                </Input>
                <Input label="Ngày bắt đầu hiệu lực">
                  <input
                    required
                    type="date"
                    value={feeForm.effective_from}
                    onChange={(e) => setFeeForm({ ...feeForm, effective_from: e.target.value })}
                  />
                </Input>
              </Grid>
              <button className="wf-primary" disabled={busy}>Lưu biểu phí</button>
            </form>
          </Panel>
        )}

        <Panel title="Danh mục biểu phí chương trình">
          <DataTable
            rows={feeSchedules}
            columns={[
              ['Tên biểu phí', (r) => <strong>{r.name}</strong>],
              ['Chương trình', (r) => r.program_name],
              ['Mức học phí', (r) => <strong style={{ color: '#2563eb' }}>{money(r.amount)}</strong>],
              ['Thời hạn hiệu lực', (r) => `${r.effective_from} → ${r.effective_to ?? 'Hiện hành'}`],
            ]}
          />
        </Panel>

        {/* Create Billing Plans: Single or Bulk */}
        {canWrite && !isStudent && (
          <Panel
            title="Sinh kế hoạch thanh toán học phí (S7-02)"
            action={
              <div className="wf-tabs">
                <button className={`wf-tab-btn ${planMode === 'single' ? 'is-active' : ''}`} onClick={() => setPlanMode('single')}>Tạo cho từng học viên</button>
                <button className={`wf-tab-btn ${planMode === 'bulk' ? 'is-active' : ''}`} onClick={() => setPlanMode('bulk')}>Sinh hàng loạt cho cả lớp ⚡</button>
              </div>
            }
          >
            {planMode === 'single' ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  const amounts = planForm.amounts.split(',').map((s) => Number(s.trim()))
                  const due_dates = planForm.due_dates.split(',').map((s) => s.trim())
                  const installments = amounts.map((amount, i) => ({ sequence: i + 1, amount, due_date: due_dates[i] }))
                  void run(
                    () =>
                      request('/billing/plans', json({
                        student_id: Number(planForm.student_id),
                        class_id: Number(planForm.class_id),
                        tuition_amount: Number(planForm.tuition_amount),
                        installments,
                      })),
                    'Đã tạo kế hoạch thanh toán cho học viên.'
                  )
                }}
              >
                <Grid>
                  <Input label="Học viên">
                    <SearchableSelect
                      options={studentOptions}
                      value={planForm.student_id}
                      onChange={(val) => setPlanForm({ ...planForm, student_id: val })}
                      placeholder="Chọn học viên..."
                    />
                  </Input>
                  <Input label="Lớp học">
                    <SearchableSelect
                      options={classOptions}
                      value={planForm.class_id}
                      onChange={(val) => setPlanForm({ ...planForm, class_id: val })}
                      placeholder="Chọn lớp học..."
                    />
                  </Input>
                  <Input label="Tổng học phí (VND)">
                    <input
                      required
                      type="number"
                      min="1"
                      placeholder="Ví dụ: 9000000"
                      value={planForm.tuition_amount}
                      onChange={(e) => {
                        const val = e.target.value
                        setPlanForm({ ...planForm, tuition_amount: val })
                      }}
                    />
                  </Input>
                  <Input label="Số tiền từng đợt (phân cách bằng dấu phẩy)">
                    <input
                      required
                      placeholder="3000000, 3000000, 3000000"
                      value={planForm.amounts}
                      onChange={(e) => setPlanForm({ ...planForm, amounts: e.target.value })}
                    />
                  </Input>
                  <Input label="Ngày đến hạn từng đợt (phân cách bằng dấu phẩy)">
                    <input
                      required
                      placeholder="2026-11-01, 2026-12-01, 2027-01-01"
                      value={planForm.due_dates}
                      onChange={(e) => setPlanForm({ ...planForm, due_dates: e.target.value })}
                    />
                  </Input>
                </Grid>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '6px' }}>
                  <small style={{ fontWeight: 600 }}>Áp dụng mẫu nhanh:</small>
                  <button type="button" className="wf-button" onClick={() => applyInstallmentTemplate('1', Number(planForm.tuition_amount))}>1 đợt (100%)</button>
                  <button type="button" className="wf-button" onClick={() => applyInstallmentTemplate('2', Number(planForm.tuition_amount))}>2 đợt (50% - 50%)</button>
                  <button type="button" className="wf-button" onClick={() => applyInstallmentTemplate('3', Number(planForm.tuition_amount))}>3 đợt (40% - 30% - 30%)</button>
                </div>
                <button className="wf-primary" disabled={busy}>Xác nhận tạo kế hoạch</button>
              </form>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  const amounts = bulkPlanForm.amounts.split(',').map((s) => Number(s.trim()))
                  const dates = bulkPlanForm.due_dates.split(',').map((s) => s.trim())
                  // Get active student IDs enrolled in this class
                  const enrolledStudentIds = students.map((s) => s.id)
                  void run(
                    () =>
                      request<{ created_count: number }>('/billing/plans/bulk', json({
                        class_id: Number(bulkPlanForm.class_id),
                        fee_schedule_id: bulkPlanForm.fee_schedule_id ? Number(bulkPlanForm.fee_schedule_id) : null,
                        student_ids: enrolledStudentIds,
                        amounts,
                        due_dates: dates,
                      })),
                    (res) => ({ message: `Đã sinh thành công kế hoạch thanh toán cho ${res.created_count} học viên trong lớp!` })
                  )
                }}
              >
                <Grid>
                  <Input label="Chọn lớp sinh hàng loạt">
                    <SearchableSelect
                      options={classOptions}
                      value={bulkPlanForm.class_id}
                      onChange={(val) => setBulkPlanForm({ ...bulkPlanForm, class_id: val })}
                      placeholder="Chọn lớp học..."
                    />
                  </Input>
                  <Input label="Biểu phí áp dụng">
                    <SearchableSelect
                      options={feeScheduleOptions}
                      value={bulkPlanForm.fee_schedule_id}
                      onChange={(val) => {
                        setBulkPlanForm({ ...bulkPlanForm, fee_schedule_id: val })
                        const fee = feeSchedules.find((f) => String(f.id) === val)
                        if (fee) applyInstallmentTemplate('2', fee.amount)
                      }}
                      placeholder="Chọn biểu phí..."
                    />
                  </Input>
                  <Input label="Số tiền từng đợt (phân cách dấu phẩy)">
                    <input
                      required
                      placeholder="5000000, 5000000"
                      value={bulkPlanForm.amounts}
                      onChange={(e) => setBulkPlanForm({ ...bulkPlanForm, amounts: e.target.value })}
                    />
                  </Input>
                  <Input label="Ngày đến hạn từng đợt (phân cách dấu phẩy)">
                    <input
                      required
                      placeholder="2026-11-15, 2026-12-15"
                      value={bulkPlanForm.due_dates}
                      onChange={(e) => setBulkPlanForm({ ...bulkPlanForm, due_dates: e.target.value })}
                    />
                  </Input>
                </Grid>
                <button className="wf-primary" disabled={busy}>Sinh hàng loạt cho cả lớp ⚡</button>
              </form>
            )}
          </Panel>
        )}

        {/* Debts Table */}
        <Panel
          title={isStudent ? 'Tình trạng học phí của bạn' : 'Bảng theo dõi công nợ học viên (S7-05)'}
          action={
            <div className="wf-actions">
              <div className="wf-tabs">
                <button className={`wf-tab-btn ${debtFilter === 'all' ? 'is-active' : ''}`} onClick={() => setDebtFilter('all')}>Tất cả ({billingPlans.length})</button>
                <button className={`wf-tab-btn ${debtFilter === 'overdue' ? 'is-active' : ''}`} onClick={() => setDebtFilter('overdue')}>Chỉ xem quá hạn ⚠️</button>
              </div>
              <DownloadButton path="/billing/debts.xlsx" label="Xuất Excel công nợ" notify={notify} />
            </div>
          }
        >
          <DataTable
            rows={filteredPlans}
            columns={[
              ['Học viên / Lớp', (r) => <><strong>{r.student_name}</strong><small>{r.student_code} · {r.class_name}</small></>],
              ['Phải thu', (r) => money(r.amount_due)],
              ['Đã thu', (r) => <span style={{ color: '#059669', fontWeight: 600 }}>{money(r.received)}</span>],
              [
                'Còn nợ',
                (r) => (
                  <strong style={{ color: r.remaining > 0 ? '#dc2626' : '#64748b' }}>
                    {money(r.remaining)}
                  </strong>
                ),
              ],
              [
                'Chi tiết các đợt',
                (r) => (
                  <div>
                    {r.installments?.map((inst: Row) => {
                      const isOverdue = inst.remaining > 0 && inst.due_date < dateInput(new Date())
                      return (
                        <span key={inst.id} className="wf-installment" style={{ border: isOverdue ? '1px solid #f87171' : 'none' }}>
                          #{inst.sequence} {money(inst.remaining)} · Hạn {inst.due_date} {isOverdue && <strong style={{ color: '#dc2626' }}>· Quá hạn</strong>}
                        </span>
                      )
                    })}
                  </div>
                ),
              ],
              [
                'Thao tác',
                (r) => (
                  <div className="wf-actions">
                    {canWrite && !isStudent && (
                      <button
                        className="wf-button"
                        onClick={() => setDiscountForm({ ...discountForm, plan_id: String(r.id) })}
                      >
                        Giảm giá
                      </button>
                    )}
                    {canWrite && !isStudent &&
                      r.installments
                        ?.filter((inst: Row) => inst.remaining > 0)
                        .map((inst: Row) => (
                          <button
                            key={inst.id}
                            className="wf-button"
                            style={{ background: '#ecfdf5', borderColor: '#10b981', color: '#065f46' }}
                            onClick={() =>
                              setPaymentForm({
                                ...paymentForm,
                                installment_id: String(inst.id),
                                amount: String(inst.remaining),
                              })
                            }
                          >
                            Thu đợt {inst.sequence}
                          </button>
                        ))}
                    {r.installments?.some((inst: Row) => (inst.payments?.length ?? 0) > 0) && (
                      <button
                        className="wf-button"
                        onClick={() => {
                          const firstPayment = r.installments.flatMap((i: Row) => i.payments || [])[0]
                          if (firstPayment) void viewReceipt(firstPayment.id)
                        }}
                      >
                        Xem biên lai
                      </button>
                    )}
                  </div>
                ),
              ],
            ]}
            footer={
              <tr>
                <td colSpan={2} style={{ textAlign: 'right' }}>Tổng cộng ({filteredPlans.length} kế hoạch):</td>
                <td>{money(totalDue)}</td>
                <td style={{ color: '#059669' }}>{money(totalReceived)}</td>
                <td style={{ color: '#dc2626' }}>{money(totalRemaining)}</td>
                <td colSpan={2} />
              </tr>
            }
          />
        </Panel>

        {/* Record Payment Form */}
        {canWrite && !isStudent && (
          <Panel title="Ghi nhận thanh toán & in biên lai (S7-03)">
            <form
              onSubmit={(e) => {
                e.preventDefault()
                void run(async () => {
                  const result = await request<Row>(
                    `/billing/installments/${paymentForm.installment_id}/payments`,
                    json({
                      amount: Number(paymentForm.amount),
                      method: paymentForm.method,
                      paid_at: new Date().toISOString(),
                      note: paymentForm.note,
                    })
                  )
                  setReceiptModal(result)
                  return result
                }, (res) => ({ message: `Đã ghi nhận thanh toán thành công! Mã biên lai: ${res.receipt_code}` }))
              }}
            >
              <Grid>
                <Input label="Mã đợt thanh toán ID">
                  <input
                    required
                    type="number"
                    min="1"
                    placeholder="Chọn từ bảng công nợ hoặc nhập ID..."
                    value={paymentForm.installment_id}
                    onChange={(e) => setPaymentForm({ ...paymentForm, installment_id: e.target.value })}
                  />
                </Input>
                <Input label="Số tiền thu (VND)">
                  <input
                    required
                    type="number"
                    min="1"
                    value={paymentForm.amount}
                    onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })}
                  />
                </Input>
                <Input label="Hình thức thanh toán">
                  <select
                    value={paymentForm.method}
                    onChange={(e) => setPaymentForm({ ...paymentForm, method: e.target.value })}
                  >
                    <option value="bank_transfer">Chuyển khoản ngân hàng</option>
                    <option value="cash">Tiền mặt tại quầy</option>
                  </select>
                </Input>
                <Input label="Ghi chú bút toán">
                  <input
                    placeholder="Ghi chú nội dung chuyển khoản / người nộp..."
                    value={paymentForm.note}
                    onChange={(e) => setPaymentForm({ ...paymentForm, note: e.target.value })}
                  />
                </Input>
              </Grid>
              <button className="wf-primary" disabled={busy}>Xác nhận ghi nhận (Bất biến)</button>
            </form>
          </Panel>
        )}

        {/* Scholarship & Discounts (S7-04) */}
        {canWrite && !isStudent && (
          <Panel title="Học bổng & chương trình giảm giá (S7-04)">
            <form
              onSubmit={(e) => {
                e.preventDefault()
                const body = {
                  reason: discountForm.reason,
                  ...(discountForm.percent ? { percent: Number(discountForm.percent) } : { amount: Number(discountForm.amount) }),
                }
                void run(() => request(`/billing/plans/${discountForm.plan_id}/discount`, json(body)), 'Đã gửi hoặc áp dụng giảm giá.')
              }}
            >
              <Grid>
                <Input label="Mã kế hoạch ID">
                  <input
                    required
                    type="number"
                    min="1"
                    placeholder="Nhập ID kế hoạch..."
                    value={discountForm.plan_id}
                    onChange={(e) => setDiscountForm({ ...discountForm, plan_id: e.target.value })}
                  />
                </Input>
                <Input label="Giảm theo số tiền (VND)">
                  <input
                    type="number"
                    min="1"
                    placeholder="Ví dụ: 1000000"
                    value={discountForm.amount}
                    onChange={(e) => setDiscountForm({ ...discountForm, amount: e.target.value, percent: '' })}
                  />
                </Input>
                <Input label="Hoặc giảm theo phần trăm (%)">
                  <input
                    type="number"
                    min="1"
                    max="100"
                    step="0.1"
                    placeholder="Ví dụ: 15"
                    value={discountForm.percent}
                    onChange={(e) => setDiscountForm({ ...discountForm, percent: e.target.value, amount: '' })}
                  />
                </Input>
                <Input label="Lý do giảm giá (bắt buộc)">
                  <input
                    required
                    placeholder="Học bổng khuyến học / Ưu đãi đóng sớm..."
                    value={discountForm.reason}
                    onChange={(e) => setDiscountForm({ ...discountForm, reason: e.target.value })}
                  />
                </Input>
              </Grid>
              {Number(discountForm.percent) > 30 && (
                <small style={{ color: '#d97706', fontWeight: 600 }}>
                  ⚠️ Mức giảm giá vượt 30% sẽ được gửi tới Quản lý đào tạo để phê duyệt.
                </small>
              )}
              <button className="wf-primary" disabled={busy}>Áp dụng / Gửi phê duyệt</button>
            </form>

            <div style={{ marginTop: '16px' }}>
              <h4>Danh sách yêu cầu miễn giảm:</h4>
              <DataTable
                rows={discountRequests}
                columns={[
                  ['Học viên', (r) => r.student_name],
                  ['Số tiền giảm', (r) => money(r.discount_amount)],
                  ['Lý do', (r) => r.reason],
                  [
                    'Trạng thái',
                    (r) => (
                      <span className={`wf-badge ${r.status === 'approved' ? 'wf-badge-success' : r.status === 'rejected' ? 'wf-badge-danger' : 'wf-badge-warning'}`}>
                        {r.status === 'approved' ? 'Đã duyệt' : r.status === 'rejected' ? 'Từ chối' : 'Chờ duyệt'}
                      </span>
                    ),
                  ],
                  [
                    'Phê duyệt',
                    (r) =>
                      user.roles.some((role) => ['training_manager', 'admin'].includes(role)) && r.status === 'pending' ? (
                        <div className="wf-actions">
                          <button
                            className="wf-button"
                            style={{ color: '#059669', borderColor: '#10b981' }}
                            onClick={() => void run(() => request(`/billing/discount-requests/${r.id}/decision`, json({ decision: 'approve' })), 'Đã duyệt miễn giảm.')}
                          >
                            Duyệt
                          </button>
                          <button
                            className="wf-button"
                            style={{ color: '#dc2626' }}
                            onClick={() => void run(() => request(`/billing/discount-requests/${r.id}/decision`, json({ decision: 'reject' })), 'Đã từ chối miễn giảm.')}
                          >
                            Từ chối
                          </button>
                        </div>
                      ) : (
                        '—'
                      ),
                  ],
                ]}
              />
            </div>
          </Panel>
        )}

        {/* Revenue Report (S7-08) */}
        <Panel title="Báo cáo doanh thu theo kỳ (S7-08)">
          <Grid>
            <Input label="Từ ngày">
              <input type="date" value={revenueDates.from_date} onChange={(e) => setRevenueDates({ ...revenueDates, from_date: e.target.value })} />
            </Input>
            <Input label="Đến ngày">
              <input type="date" value={revenueDates.to_date} onChange={(e) => setRevenueDates({ ...revenueDates, to_date: e.target.value })} />
            </Input>
            <Input label="Nhóm theo">
              <select value={revenueGroupBy} onChange={(e) => setRevenueGroupBy(e.target.value as 'class' | 'program')}>
                <option value="class">Theo lớp học</option>
                <option value="program">Theo chương trình đào tạo</option>
              </select>
            </Input>
          </Grid>
          <button
            className="wf-button"
            onClick={async () => {
              try {
                setRevenue(await request<Row>(`/billing/revenue?${new URLSearchParams({ ...revenueDates, group_by: revenueGroupBy })}`))
              } catch (cause) {
                notify(cause instanceof Error ? cause.message : 'Không tải được báo cáo doanh thu.', 'error')
              }
            }}
          >
            Tổng hợp doanh thu
          </button>

          {revenue && (
            <div style={{ marginTop: '16px' }}>
              <div className="wf-kpis">
                <article>
                  <small>Tổng thực thu trong kỳ</small>
                  <strong style={{ color: '#059669' }}>{money(revenue.received)}</strong>
                </article>
                <article>
                  <small>Tổng công nợ còn lại</small>
                  <strong style={{ color: '#dc2626' }}>{money(revenue.remaining)}</strong>
                </article>
              </div>

              {/* Monthly breakdown chart */}
              {revenue.monthly && revenue.monthly.length > 0 && (
                <div style={{ marginTop: '16px' }}>
                  <h4>Biểu đồ doanh thu theo tháng:</h4>
                  <div className="wf-chart-container">
                    {revenue.monthly.map((mItem: Row) => {
                      const maxVal = Math.max(...revenue.monthly.map((i: Row) => i.received || 1))
                      const pct = Math.round((mItem.received / maxVal) * 100)
                      return (
                        <div key={mItem.month} className="wf-chart-row">
                          <span className="wf-chart-label">{mItem.month}</span>
                          <div className="wf-chart-bar-wrap">
                            <div className="wf-chart-bar" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="wf-chart-val">{money(mItem.received)}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              <div style={{ marginTop: '16px' }}>
                <h4>Chi tiết theo {revenueGroupBy === 'class' ? 'lớp học' : 'chương trình'}:</h4>
                <DataTable
                  rows={Object.entries(revenue.groups ?? {}).map(([name, values]) => ({ name, ...(values as Row) }))}
                  columns={[
                    [revenueGroupBy === 'class' ? 'Lớp học' : 'Chương trình', (r) => <strong>{r.name}</strong>],
                    ['Đã thu', (r) => <strong style={{ color: '#059669' }}>{money(r.received)}</strong>],
                  ]}
                />
              </div>
            </div>
          )}
        </Panel>

        {/* Printable Receipt Modal (S7-03 & S7-07) */}
        {receiptModal && (
          <div className="wf-modal-overlay">
            <div className="wf-modal">
              <div className="wf-modal-header">
                <h3>Biên lai thu học phí điện tử</h3>
                <button className="wf-modal-close" onClick={() => setReceiptModal(null)}>×</button>
              </div>
              <div className="wf-receipt-card">
                <div className="wf-receipt-header">
                  <small style={{ color: '#1e3a8a', fontWeight: 800, letterSpacing: '.1em' }}>TRUNG TÂM ĐÀO TẠO CÔNG NGHỆ ICTU</small>
                  <div className="wf-receipt-title">BIÊN LAI THU TIỀN</div>
                  <div className="wf-receipt-code">Mã biên lai: {receiptModal.receipt_code}</div>
                </div>
                <table className="wf-receipt-table">
                  <tbody>
                    <tr><td>Học viên:</td><td>{receiptModal.student_name} ({receiptModal.student_code})</td></tr>
                    <tr><td>Lớp học:</td><td>{receiptModal.class_name}</td></tr>
                    <tr><td>Hình thức thanh toán:</td><td>{receiptModal.method === 'bank_transfer' ? 'Chuyển khoản' : 'Tiền mặt'}</td></tr>
                    <tr><td>Thời điểm thu:</td><td>{displayDate(receiptModal.paid_at)}</td></tr>
                    <tr><td>Người thu tiền:</td><td>{receiptModal.received_by || user.full_name}</td></tr>
                    {receiptModal.note && <tr><td>Ghi chú:</td><td>{receiptModal.note}</td></tr>}
                  </tbody>
                </table>
                <div className="wf-receipt-total">
                  <span>Số tiền: </span>{money(receiptModal.amount)}
                </div>
              </div>
              <div className="wf-actions" style={{ justifyContent: 'flex-end' }}>
                <button className="wf-primary" onClick={() => window.print()}>In biên lai / Lưu PDF</button>
                <button className="wf-button" onClick={() => setReceiptModal(null)}>Đóng</button>
              </div>
            </div>
          </div>
        )}
      </section>
    )
  }

  // -------------------------------------------------------------
  // SPRINT 8: GRADES, GRADUATION & TRANSCRIPT
  // -------------------------------------------------------------
  if (module === 'grades') {
    return (
      <section className="wf-page">
        <header className="wf-heading">
          <div>
            <small>SPRINT 8 · KẾT QUẢ HỌC TẬP & TỐT NGHIỆP</small>
            <h1>Điểm tổng kết môn & xét tốt nghiệp</h1>
            <p>Cấu hình trọng số môn học, tự tính điểm tổng kết, chốt điểm và công nhận tốt nghiệp.</p>
          </div>
          <RefreshButton loading={loading} onClick={() => void load()} notify={notify} hasData={Boolean(transcript || gradeConfigs.length > 0)} />
        </header>

        {error && <div className="wf-error" role="alert">{error}</div>}

        {/* Student Transcript Certificate (S8-03) */}
        {isStudent && transcript && (
          <Panel
            title="Bảng điểm toàn khóa của bạn (S8-03)"
            action={
              <div className="wf-actions">
                <button className="wf-primary" onClick={() => window.print()}>In / Lưu PDF bảng điểm</button>
                <DownloadButton path="/grades/transcript/export" label="Tải Excel bảng điểm" notify={notify} />
              </div>
            }
          >
            <div className="wf-transcript-card">
              <div className="wf-transcript-header">
                <div className="wf-transcript-center">HỆ THỐNG ĐÀO TẠO CÔNG NGHỆ ICTU</div>
                <div className="wf-transcript-title">BẢNG ĐIỂM CHÍNH THỨC TOÀN KHÓA</div>
                <small style={{ color: '#64748b' }}>Ngày cấp: {new Date().toLocaleDateString('vi-VN')}</small>
              </div>

              <div className="wf-transcript-meta">
                <div>Họ và tên: <strong>{transcript.student_name}</strong></div>
                <div>Mã học viên: <strong>{transcript.student_code}</strong></div>
                <div>Điểm trung bình (GPA): <strong style={{ color: '#2563eb' }}>{transcript.average ?? 'Chưa đủ điều kiện tính'}</strong></div>
              </div>

              <DataTable
                rows={transcript.subjects ?? []}
                columns={[
                  ['Môn học', (r) => <strong>{r.subject_name}</strong>],
                  ['Lớp học', (r) => r.class_name],
                  ['Điểm tổng kết', (r) => r.score != null ? <strong>{r.score}</strong> : <span className="wf-badge wf-badge-warning">Chưa đủ điểm</span>],
                  ['Kết quả môn', (r) => <span className={`wf-badge ${r.result === 'Đạt' || r.result === 'passed' ? 'wf-badge-success' : 'wf-badge-danger'}`}>{r.result === 'passed' ? 'Đạt' : (r.result || 'Chưa đạt')}</span>],
                ]}
              />

              <div className="wf-transcript-footer">
                <div>Trạng thái: <strong>{transcript.status === 'graduated' ? '🎓 Đã tốt nghiệp' : 'Đang theo học'}</strong></div>
                <div style={{ textAlign: 'right' }}>
                  <small>Xác thực số: {transcript.student_code}-{dateInput(new Date())}</small>
                </div>
              </div>
            </div>
          </Panel>
        )}

        {/* Grade Config (S8-01) */}
        {canWrite && !isStudent && (
          <Panel title="Cấu hình cách tính điểm tổng kết môn học (S8-01)">
            <form
              onSubmit={(e) => {
                e.preventDefault()
                const components = gradeForm.components
                  .split('\n')
                  .flatMap((line) => {
                    const [name, weight] = line.split(':')
                    return name?.trim() && Number(weight) > 0
                      ? [{ name: name.trim(), weight_percent: Number(weight), required: true }]
                      : []
                  })
                void run(
                  () =>
                    request('/grades/config', {
                      method: 'PUT',
                      body: JSON.stringify({
                        ...gradeForm,
                        program_id: Number(gradeForm.program_id),
                        subject_id: Number(gradeForm.subject_id),
                        class_id: gradeForm.class_id ? Number(gradeForm.class_id) : null,
                        passing_score: Number(gradeForm.passing_score),
                        critical_score: Number(gradeForm.critical_score),
                        components,
                      }),
                    }),
                  'Đã lưu cấu hình trọng số điểm thành công.'
                )
              }}
            >
              <Grid>
                <Input label="Chương trình đào tạo">
                  <SearchableSelect
                    options={programOptions}
                    value={gradeForm.program_id}
                    onChange={(val) => setGradeForm({ ...gradeForm, program_id: val })}
                    placeholder="Chọn chương trình..."
                  />
                </Input>
                <Input label="Môn học">
                  <SearchableSelect
                    options={subjectOptions}
                    value={gradeForm.subject_id}
                    onChange={(val) => setGradeForm({ ...gradeForm, subject_id: val })}
                    placeholder="Chọn môn học..."
                  />
                </Input>
                <Input label="Lớp học (ghi đè riêng, tuỳ chọn)">
                  <SearchableSelect
                    options={classOptions}
                    value={gradeForm.class_id}
                    onChange={(val) => setGradeForm({ ...gradeForm, class_id: val })}
                    placeholder="Tất cả các lớp thuộc môn..."
                  />
                </Input>
                <Input label="Điểm đạt môn">
                  <input
                    type="number"
                    min="0"
                    max="10"
                    step="0.1"
                    value={gradeForm.passing_score}
                    onChange={(e) => setGradeForm({ ...gradeForm, passing_score: e.target.value })}
                  />
                </Input>
                <Input label="Điểm liệt môn">
                  <input
                    type="number"
                    min="0"
                    max="10"
                    step="0.1"
                    value={gradeForm.critical_score}
                    onChange={(e) => setGradeForm({ ...gradeForm, critical_score: e.target.value })}
                  />
                </Input>
                <Input label="Thành phần điểm & trọng số (mỗi dòng Tên:Trọng số %, tổng = 100%)">
                  <textarea
                    rows={3}
                    value={gradeForm.components}
                    onChange={(e) => setGradeForm({ ...gradeForm, components: e.target.value })}
                  />
                </Input>
              </Grid>
              <button className="wf-primary" disabled={busy}>Lưu cấu hình quy chế điểm</button>
            </form>
          </Panel>
        )}

        {/* Existing Grade Configs */}
        {!isStudent && (
          <Panel title="Danh sách cấu hình điểm hiện hành">
            <DataTable
              rows={gradeConfigs.flatMap((config) =>
                config.components.map((item: Row) => ({
                  ...item,
                  program_id: config.program_id,
                  subject_id: config.subject_id,
                  class_id: config.class_id,
                  passing_score: config.passing_score,
                  critical_score: config.critical_score,
                }))
              )}
              columns={[
                [
                  'Phạm vi áp dụng',
                  (r) => {
                    const p = programs.find((item) => item.id === r.program_id)
                    const s = subjects.find((item) => item.id === r.subject_id)
                    return <><strong>{p?.name || `CT #${r.program_id}`}</strong><small>{s?.name || `Môn #${r.subject_id}`}{r.class_id ? ` · Lớp #${r.class_id}` : ''}</small></>
                  },
                ],
                ['Thành phần điểm', (r) => <strong>{r.name} ({r.weight_percent}%)</strong>],
                ['Điểm đạt / Điểm liệt', (r) => `${r.passing_score} / ${r.critical_score}`],
              ]}
            />
          </Panel>
        )}

        {canWrite && !isStudent && (
          <Panel title="Gắn bài tập vào thành phần điểm tổng kết">
            <Grid>
              <Input label="Mã thành phần điểm ID">
                <input
                  type="number"
                  min="1"
                  placeholder="Nhập ID thành phần điểm..."
                  value={componentLink.component_id}
                  onChange={(e) => setComponentLink({ ...componentLink, component_id: e.target.value })}
                />
              </Input>
              <Input label="Mã bài tập ID">
                <input
                  type="number"
                  min="1"
                  placeholder="Nhập ID bài tập..."
                  value={componentLink.assignment_id}
                  onChange={(e) => setComponentLink({ ...componentLink, assignment_id: e.target.value })}
                />
              </Input>
            </Grid>
            <button
              className="wf-button"
              disabled={busy || !componentLink.component_id || !componentLink.assignment_id}
              onClick={() =>
                void run(
                  () =>
                    request(
                      `/grades/components/${componentLink.component_id}/assignments`,
                      json({ assignment_id: Number(componentLink.assignment_id) })
                    ),
                  'Đã gắn bài tập vào thành phần điểm thành công.'
                )
              }
            >
              Gắn bài tập vào thành phần điểm
            </button>
          </Panel>
        )}

        {/* Recalculate & Lock Grades (S8-02) */}
        {canWrite && !isStudent && (
          <Panel title="Tính điểm tự động & Chốt điểm cuối môn (S8-02)">
            <Grid>
              <Input label="Lớp học">
                <SearchableSelect
                  options={classOptions}
                  value={gradeForm.class_id}
                  onChange={(val) => setGradeForm({ ...gradeForm, class_id: val })}
                  placeholder="Chọn lớp học..."
                />
              </Input>
              <Input label="Môn học">
                <SearchableSelect
                  options={subjectOptions}
                  value={gradeForm.subject_id}
                  onChange={(val) => setGradeForm({ ...gradeForm, subject_id: val })}
                  placeholder="Chọn môn học..."
                />
              </Input>
            </Grid>
            <div className="wf-actions" style={{ marginTop: '10px' }}>
              <button
                className="wf-button"
                onClick={() =>
                  void run(
                    () => request(`/grades/classes/${gradeForm.class_id}/subjects/${gradeForm.subject_id}/recalculate`, json({})),
                    'Đã tính toán lại điểm tổng kết toàn bộ học viên.'
                  )
                }
              >
                ⚡ Tính điểm tự động
              </button>
              <button
                className="wf-primary"
                onClick={() =>
                  void run(
                    () => request(`/grades/classes/${gradeForm.class_id}/subjects/${gradeForm.subject_id}/lock`, json({})),
                    'Đã chốt điểm môn học. Chỉ Quản lý đào tạo mới có quyền mở lại.'
                  )
                }
              >
                🔒 Chốt điểm môn học
              </button>
              {isAdminOrManager && (
                <button
                  className="wf-button"
                  style={{ color: '#b45309' }}
                  onClick={() => {
                    if (window.confirm('Bạn có chắc chắn muốn mở lại bảng điểm đã chốt cho môn này?')) {
                      void run(
                        () => request(`/grades/classes/${gradeForm.class_id}/subjects/${gradeForm.subject_id}/unlock`, json({})),
                        'Đã mở lại bảng điểm môn học.'
                      )
                    }
                  }}
                >
                  🔓 Mở lại bảng điểm (Quản lý)
                </button>
              )}
            </div>
          </Panel>
        )}

        {/* Graduation Eligibility & Confirmation (S8-04) */}
        {isAdminOrManager && (
          <Panel title="Xét điều kiện hoàn thành khóa học & tốt nghiệp (S8-04)">
            <Grid>
              <Input label="Chọn lớp xét tốt nghiệp">
                <SearchableSelect
                  options={classOptions}
                  value={graduationClassId}
                  onChange={(val) => setGraduationClassId(val)}
                  placeholder="Chọn lớp học..."
                />
              </Input>
            </Grid>
            <button
              className="wf-button"
              disabled={!graduationClassId}
              onClick={async () => {
                try {
                  const data = await request<Row>(`/grades/classes/${graduationClassId}/graduation`)
                  setGraduationData(data)
                } catch (cause) {
                  notify(cause instanceof Error ? cause.message : 'Không thể xét tốt nghiệp.', 'error')
                }
              }}
            >
              Kiểm tra điều kiện tốt nghiệp
            </button>

            {graduationData && (
              <div style={{ marginTop: '16px', display: 'grid', gap: '14px' }}>
                <div>
                  <h4 style={{ color: '#059669' }}>
                    Nhóm đủ điều kiện tốt nghiệp ({graduationData.eligible?.length ?? 0} học viên):
                  </h4>
                  <DataTable
                    rows={graduationData.eligible ?? []}
                    columns={[
                      ['Học viên', (r) => <><strong>{r.student_name}</strong><small>{r.student_code}</small></>],
                      ['Điều kiện kiểm tra', () => <span className="wf-badge wf-badge-success">Đạt đủ môn · Chuyên cần đạt · Hết nợ học phí</span>],
                    ]}
                  />
                  {graduationData.eligible?.length > 0 && (
                    <button
                      className="wf-primary"
                      style={{ marginTop: '10px' }}
                      onClick={() =>
                        void run(
                          () =>
                            request(
                              `/grades/classes/${graduationClassId}/graduation/confirm`,
                              json({ student_ids: graduationData.eligible.map((r: Row) => r.student_id) })
                            ),
                          'Đã xác nhận tốt nghiệp hàng loạt và cập nhật hồ sơ học viên thành Đã tốt nghiệp!'
                        )
                      }
                    >
                      🎓 Xác nhận tốt nghiệp hàng loạt cho nhóm đủ điều kiện
                    </button>
                  )}
                </div>

                <div>
                  <h4 style={{ color: '#dc2626' }}>
                    Nhóm chưa đủ điều kiện ({graduationData.ineligible?.length ?? 0} học viên):
                  </h4>
                  <DataTable
                    rows={graduationData.ineligible ?? []}
                    columns={[
                      ['Học viên', (r) => <><strong>{r.student_name}</strong><small>{r.student_code}</small></>],
                      [
                        'Lý do chưa đủ điều kiện',
                        (r) => (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                            {r.reasons?.map((reason: string, idx: number) => (
                              <span key={idx} className="wf-badge wf-badge-danger">{reason}</span>
                            ))}
                          </div>
                        ),
                      ],
                    ]}
                  />
                </div>
              </div>
            )}
          </Panel>
        )}
      </section>
    )
  }

  // -------------------------------------------------------------
  // SPRINT 8: SURVEYS
  // -------------------------------------------------------------
  if (module === 'surveys') {
    return (
      <section className="wf-page">
        <header className="wf-heading">
          <div>
            <small>SPRINT 8 · KHẢO SÁT CHẤT LƯỢNG</small>
            <h1>Khảo sát chất lượng đào tạo</h1>
            <p>Thu thập ý kiến phản hồi ẩn danh từ học viên về giảng viên, bài học và chương trình.</p>
          </div>
          <RefreshButton loading={loading} onClick={() => void load()} notify={notify} hasData={surveys.length > 0} />
        </header>

        {error && <div className="wf-error" role="alert">{error}</div>}

        {/* Create Survey Form */}
        {canWrite && !isStudent && (
          <Panel title="Tạo đợt khảo sát mới cho lớp học (S8-05)">
            <form
              onSubmit={(e) => {
                e.preventDefault()
                const questions = surveyForm.questions
                  .split('\n')
                  .map((line) => {
                    const [type, ...text] = line.split('|')
                    return { type: type.trim(), text: text.join('|').trim() }
                  })
                  .filter((q) => q.text)
                void run(
                  () =>
                    request('/surveys', json({ ...surveyForm, class_id: Number(surveyForm.class_id), due_at: new Date(surveyForm.due_at).toISOString(), questions })),
                  'Đã tạo đợt khảo sát cho lớp học.'
                )
              }}
            >
              <Grid>
                <Input label="Lớp học khảo sát">
                  <SearchableSelect
                    options={classOptions}
                    value={surveyForm.class_id}
                    onChange={(val) => setSurveyForm({ ...surveyForm, class_id: val })}
                    placeholder="Chọn lớp học..."
                  />
                </Input>
                <Input label="Tiêu đề đợt khảo sát">
                  <input
                    required
                    value={surveyForm.title}
                    onChange={(e) => setSurveyForm({ ...surveyForm, title: e.target.value })}
                  />
                </Input>
                <Input label="Hạn chót trả lời">
                  <input
                    type="datetime-local"
                    required
                    value={surveyForm.due_at}
                    onChange={(e) => setSurveyForm({ ...surveyForm, due_at: e.target.value })}
                  />
                </Input>
                <Input label="Bộ câu hỏi (rating|câu hỏi thang 1-5 hoặc text|câu hỏi tự luận)">
                  <textarea
                    rows={4}
                    required
                    value={surveyForm.questions}
                    onChange={(e) => setSurveyForm({ ...surveyForm, questions: e.target.value })}
                  />
                </Input>
              </Grid>
              <button className="wf-primary" disabled={busy}>Mở đợt khảo sát</button>
            </form>
          </Panel>
        )}

        <Panel title="Danh sách các đợt khảo sát">
          <DataTable
            rows={surveys}
            columns={[
              ['Tiêu đề khảo sát', (r) => <button className="wf-link" onClick={() => setSelectedSurvey(r)}>{r.title}</button>],
              ['Lớp học', (r) => r.class_name],
              ['Hạn trả lời', (r) => displayDate(r.due_at)],
              [
                'Trạng thái',
                (r) =>
                  r.responded ? (
                    <span className="wf-badge wf-badge-success">Đã gửi phản hồi</span>
                  ) : (
                    <span className="wf-badge wf-badge-info">{r.state || 'Đang mở'}</span>
                  ),
              ],
              [
                'Kết quả tổng hợp',
                (r) =>
                  !isStudent && permission === 'F' ? (
                    <button
                      className="wf-button"
                      onClick={async () => {
                        try {
                          setSurveyResults(await request<Row>(`/surveys/${r.id}/results`))
                        } catch (cause) {
                          notify(cause instanceof Error ? cause.message : 'Không thể tải kết quả khảo sát.', 'error')
                        }
                      }}
                    >
                      Xem kết quả (Ẩn danh GV)
                    </button>
                  ) : (
                    <span style={{ color: '#64748b' }}>Ẩn danh</span>
                  ),
              ],
            ]}
          />
        </Panel>

        {/* Student Survey Response Form */}
        {selectedSurvey && isStudent && !selectedSurvey.responded && (
          <Panel title={`Trả lời khảo sát: ${selectedSurvey.title}`}>
            <p style={{ color: '#64748b' }}>Câu trả lời của bạn hoàn toàn ẩn danh đối với giảng viên phụ trách.</p>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                const answers = selectedSurvey.questions.map((_: Row, index: number) => ({
                  value: selectedSurvey.questions[index].type === 'rating' ? Number(surveyAnswers[index]) : surveyAnswers[index] ?? '',
                }))
                void run(() => request(`/surveys/${selectedSurvey.id}/responses`, json({ answers })), 'Đã gửi khảo sát ẩn danh thành công!')
              }}
            >
              {selectedSurvey.questions?.map((q: Row, index: number) => (
                <Input key={index} label={`${index + 1}. ${q.text}`}>
                  {q.type === 'rating' ? (
                    <div style={{ display: 'flex', gap: '8px', margin: '4px 0' }}>
                      {[1, 2, 3, 4, 5].map((val) => (
                        <button
                          type="button"
                          key={val}
                          className={`wf-button ${surveyAnswers[index] === String(val) ? 'wf-primary' : ''}`}
                          style={{ width: '42px', height: '42px' }}
                          onClick={() => setSurveyAnswers({ ...surveyAnswers, [index]: String(val) })}
                        >
                          {val}★
                        </button>
                      ))}
                    </div>
                  ) : (
                    <textarea
                      maxLength={4000}
                      placeholder="Nhập ý kiến đóng góp của bạn..."
                      value={surveyAnswers[index] ?? ''}
                      onChange={(e) => setSurveyAnswers({ ...surveyAnswers, [index]: e.target.value })}
                    />
                  )}
                </Input>
              ))}
              <button className="wf-primary" disabled={busy}>Xác nhận gửi phản hồi</button>
            </form>
          </Panel>
        )}

        {/* Survey Results for Training Manager (S8-06) */}
        {surveyResults && (
          <Panel title={`Kết quả khảo sát: ${surveyResults.class_name} (${surveyResults.response_count} học viên tham gia)`}>
            <DataTable
              rows={surveyResults.results ?? []}
              columns={[
                ['Câu hỏi khảo sát', (r) => <strong>{r.question}</strong>],
                [
                  'Điểm đánh giá trung bình',
                  (r) =>
                    r.average != null ? (
                      <strong style={{ color: '#2563eb', fontSize: '15px' }}>{r.average} / 5.0 ★</strong>
                    ) : (
                      '—'
                    ),
                ],
                [
                  'Ý kiến tự luận ẩn danh',
                  (r) => (
                    <div>
                      {r.answers?.length > 0 ? (
                        <ul style={{ margin: 0, paddingLeft: '16px', fontSize: '12.5px' }}>
                          {r.answers.map((ans: string, i: number) => (
                            <li key={i}>{ans}</li>
                          ))}
                        </ul>
                      ) : (
                        '—'
                      )}
                    </div>
                  ),
                ],
              ]}
            />
          </Panel>
        )}
      </section>
    )
  }

  // -------------------------------------------------------------
  // SPRINT 8 & SPRINT 6: DASHBOARD & AUDIT LOGS
  // -------------------------------------------------------------
  const riskRows = dashboard?.risk_details ?? []
  return (
    <section className="wf-page">
      <header className="wf-heading">
        <div>
          <small>SPRINT 8 · DASHBOARD & NHẬT KÝ</small>
          <h1>Dashboard vận hành & nhật ký hệ thống</h1>
          <p>Chỉ số KPI toàn trung tâm, học viên rủi ro, thời khóa biểu kế tiếp và nhật ký nhạy cảm.</p>
        </div>
        <div className="wf-actions">
          {isAdminOrManager && (
            <div className="wf-tabs">
              <button className={`wf-tab-btn ${reportTab === 'dashboard' ? 'is-active' : ''}`} onClick={() => setReportTab('dashboard')}>Dashboard</button>
              <button className={`wf-tab-btn ${reportTab === 'audit' ? 'is-active' : ''}`} onClick={() => setReportTab('audit')}>Nhật ký thao tác (S6-11)</button>
            </div>
          )}
          <RefreshButton loading={loading} onClick={() => void load()} notify={notify} hasData={Boolean(dashboard)} />
        </div>
      </header>

      {error && <div className="wf-error" role="alert">{error}</div>}

      {reportTab === 'dashboard' && dashboard && (
        <>
          {/* Teacher Dedicated Dashboard (S8-08) */}
          {isTeacher && (
            <Panel title="Bảng điều khiển giảng viên (S8-08)">
              <div className="wf-teacher-quick">
                <div className="wf-teacher-card">
                  <div>
                    <span className="wf-badge wf-badge-info">Lịch dạy sắp tới</span>
                    <h3 style={{ marginTop: '8px' }}>Buổi dạy tiếp theo</h3>
                    <p>{dashboard.classes?.[0]?.name ? `Lớp ${dashboard.classes[0].name}` : 'Chưa có lịch buổi học mới'}</p>
                  </div>
                  <button className="wf-primary" onClick={() => notify('Chuyển tới module Điểm danh')}>Điểm danh buổi học ngay ↗</button>
                </div>

                <div className="wf-teacher-card">
                  <div>
                    <span className="wf-badge wf-badge-warning">Cần xử lý</span>
                    <h3 style={{ marginTop: '8px' }}>Bài tập chờ chấm</h3>
                    <p>{dashboard.assignments_due?.length ? `${dashboard.assignments_due.length} bài nộp đang chờ giảng viên chấm` : 'Tất cả bài tập đã được chấm đầy đủ'}</p>
                  </div>
                  <button className="wf-button" onClick={() => notify('Chuyển tới module Bài tập & chấm điểm')}>Mở màn hình chấm bài ↗</button>
                </div>
              </div>
            </Panel>
          )}

          {/* Operational Manager KPIs (S8-07) */}
          <div className="wf-kpis">
            <article>
              <small>Lớp học đang chạy</small>
              <strong>{dashboard.running_classes ?? 0} lớp</strong>
            </article>
            <article>
              <small>Tổng học viên đang học</small>
              <strong>{dashboard.active_students ?? 0} học viên</strong>
            </article>
            <article>
              <small>Lead tuyển sinh đang xử lý</small>
              <strong>{dashboard.active_leads ?? 0} lead</strong>
            </article>
            <article>
              <small>Công nợ học phí quá hạn</small>
              <strong style={{ color: dashboard.overdue_debt ? '#dc2626' : '#2563eb' }}>
                {dashboard.overdue_debt == null ? 'Không có quyền xem' : money(dashboard.overdue_debt)}
              </strong>
            </article>
          </div>

          {/* Student upcoming assignments */}
          {dashboard.assignments_due && (
            <Panel title="Bài tập cần chú ý">
              <DataTable
                rows={dashboard.assignments_due}
                columns={[
                  ['Tên bài tập', (r) => <strong>{r.title}</strong>],
                  ['Hạn nộp', (r) => displayDate(r.due_at)],
                  [
                    'Trạng thái',
                    (r) => (
                      <span className={`wf-badge ${r.submitted ? 'wf-badge-success' : 'wf-badge-warning'}`}>
                        {r.submitted ? 'Đã nộp' : 'Chưa nộp'}
                      </span>
                    ),
                  ],
                ]}
              />
            </Panel>
          )}

          {/* High risk students */}
          <Panel
            title="Danh sách học viên rủi ro chuyên cần cao (S8-07)"
            action={<DownloadButton path="/reports/attendance-risk" label="Tải dữ liệu rủi ro (JSON)" notify={notify} />}
          >
            <DataTable
              rows={riskRows}
              columns={[
                ['Học viên', (r) => <strong>{r.student_name}</strong>],
                ['Lớp học', (r) => r.class_name],
                [
                  'Tỷ lệ vắng',
                  (r) => (
                    <span className="wf-badge wf-badge-danger">
                      {r.absence_percent}% (ngưỡng cho phép {r.threshold_percent}%)
                    </span>
                  ),
                ],
              ]}
            />
          </Panel>

          <Panel title="Các lớp học phụ trách">
            <DataTable
              rows={dashboard.classes ?? []}
              columns={[
                ['Tên lớp học', (r) => <strong>{r.name}</strong>],
                [
                  'Trạng thái lớp',
                  (r) => (
                    <span className={`wf-badge ${r.status === 'running' ? 'wf-badge-success' : 'wf-badge-info'}`}>
                      {r.status === 'running' ? 'Đang chạy' : r.status}
                    </span>
                  ),
                ],
              ]}
            />
          </Panel>
        </>
      )}

      {/* SPRINT 6: AUDIT LOGS (S6-11) */}
      {reportTab === 'audit' && (
        <Panel
          title="Nhật ký thao tác trên dữ liệu nhạy cảm (S6-11)"
          action={
            <div className="wf-tabs">
              <button className={`wf-tab-btn ${auditCategory === 'all' ? 'is-active' : ''}`} onClick={() => setAuditCategory('all')}>Tất cả</button>
              <button className={`wf-tab-btn ${auditCategory === 'grade' ? 'is-active' : ''}`} onClick={() => setAuditCategory('grade')}>Điểm số</button>
              <button className={`wf-tab-btn ${auditCategory === 'attendance' ? 'is-active' : ''}`} onClick={() => setAuditCategory('attendance')}>Chuyên cần</button>
            </div>
          }
        >
          <DataTable
            rows={auditLogs.filter((l) => (auditCategory === 'all' ? true : l.category.toLowerCase().includes(auditCategory === 'grade' ? 'điểm' : 'chuyên')))}
            columns={[
              ['Thời điểm', (r) => displayDate(r.created_at)],
              ['Người thực hiện', (r) => <><strong>{r.actor_name}</strong><small>{r.actor_email}</small></>],
              ['Danh mục', (r) => <span className="wf-badge wf-badge-info">{r.category}</span>],
              ['Hành động', (r) => <strong>{r.action}</strong>],
              ['Đối tượng', (r) => r.target],
              [
                'Chi tiết trước & sau',
                (r) => {
                  try {
                    const parsed = JSON.parse(r.detail)
                    return <pre style={{ margin: 0, fontSize: '11px', whiteSpace: 'pre-wrap' }}>{JSON.stringify(parsed, null, 2)}</pre>
                  } catch {
                    return <small>{r.detail}</small>
                  }
                },
              ],
            ]}
          />
        </Panel>
      )}
    </section>
  )
}
