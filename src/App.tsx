import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent, FormEvent, InputHTMLAttributes } from 'react'
import { createPortal } from 'react-dom'
import './App.css'
import Operations, { TopbarNavPortal } from './Operations'
import SearchableSelect from './SearchableSelect'
import SprintWorkflows from './SprintWorkflows'

type Role =
  | 'guest'
  | 'student'
  | 'instructor'
  | 'ta'
  | 'training_manager'
  | 'admissions'
  | 'accountant'
  | 'admin'
type ModuleId =
  | 'courses'
  | 'leads'
  | 'student_records'
  | 'classes'
  | 'attendance'
  | 'materials'
  | 'assignments'
  | 'grades'
  | 'billing'
  | 'surveys'
  | 'reports'
type AppView = 'overview' | 'users' | `module:${ModuleId}`
type User = {
  id: number
  full_name: string
  email: string
  phone: string | null
  assigned_classes: string[]
  handover_required: boolean
  role: Role
  roles: Role[]
  permissions: Record<ModuleId | 'users', 'R' | 'W' | 'F' | '-'>
  is_active: boolean
  lock_reason: string | null
  must_change_password: boolean
  date_of_birth?: string | null
  address?: string | null
  avatar_url?: string | null
  created_at: string
}

type UserPage = { items: User[]; total: number; page: number; page_size: number }
type Summary = { greeting: string; total_users: number; active_users: number; locked_users: number }
type UserFilters = { q: string; role: string; active: string; page: number }
type AccountFormRoute =
  | { ownerId: number; mode: 'create' }
  | { ownerId: number; mode: 'edit'; userId: number }
type ImportPreviewRow = {
  row_number: number
  full_name: string
  email: string
  roles: string[]
  phone: string | null
  assigned_classes: string[]
  status?: 'valid' | 'duplicate' | 'error'
  message?: string
}
type ImportPreview = {
  valid: number
  skipped: number
  duplicates?: number
  error_count?: number
  errors: string[]
  preview_rows: ImportPreviewRow[]
  all_rows?: ImportPreviewRow[]
}
const IMPORT_PAGE_SIZE = 20
const DEFAULT_PAGE_SIZE = 20
const CATALOG_ACTION_MINIMUM_MS = 500

function CatalogPagination({
  page,
  total,
  pageSize = DEFAULT_PAGE_SIZE,
  onChange,
  label = 'danh mục',
}: {
  page: number
  total: number
  pageSize?: number
  onChange: (page: number) => void
  onPageSizeChange?: (pageSize: number) => void
  label?: string
}) {
  const pageCount = Math.max(1, Math.ceil(total / (pageSize || DEFAULT_PAGE_SIZE)))
  const safePage = Math.max(1, Math.min(page, pageCount))
  return (
    <nav className="catalog-pagination" aria-label={`Phân trang ${label}`}>
      <div className="catalog-pagination-box">
        <button
          type="button"
          className="page-nav-button"
          aria-label="Trang trước"
          disabled={safePage <= 1}
          onClick={() => onChange(safePage - 1)}
        >
          ‹
        </button>
        <strong className="page-indicator">Trang {safePage} / {pageCount}</strong>
        <button
          type="button"
          className="page-nav-button"
          aria-label="Trang sau"
          disabled={safePage >= pageCount}
          onClick={() => onChange(safePage + 1)}
        >
          ›
        </button>
      </div>
    </nav>
  )
}

function ImportPagination({
  page,
  total,
  pageSize = IMPORT_PAGE_SIZE,
  onChange,
  onPageSizeChange,
}: {
  page: number
  total: number
  pageSize?: number
  onChange: (page: number) => void
  onPageSizeChange?: (pageSize: number) => void
}) {
  const pageCount = Math.max(1, Math.ceil(total / (pageSize || IMPORT_PAGE_SIZE)))
  const safePage = Math.max(1, Math.min(page, pageCount))
  const [pageInput, setPageInput] = useState(String(safePage))
  useEffect(() => setPageInput(String(safePage)), [safePage])
  if (total <= 0) return null
  const first = (safePage - 1) * pageSize + 1
  const last = Math.min(safePage * pageSize, total)
  function commitPage() {
    const parsedPage = Number(pageInput)
    if (Number.isInteger(parsedPage)) onChange(Math.max(1, Math.min(parsedPage, pageCount)))
    else setPageInput(String(safePage))
  }
  return (
    <nav className="import-pagination" aria-label="Phân trang kết quả nhập Excel">
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
        <span>Đang xem {first.toLocaleString('vi-VN')}–{last.toLocaleString('vi-VN')} / {total.toLocaleString('vi-VN')}</span>
        {onPageSizeChange && (
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#475569' }}>
            Hiển thị:
            <select
              value={pageSize}
              onChange={(e) => { onPageSizeChange(Number(e.target.value)); onChange(1) }}
              style={{ padding: '3px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px', background: '#ffffff' }}
            >
              <option value={5}>5 dòng</option>
              <option value={10}>10 dòng</option>
              <option value={20}>20 dòng</option>
              <option value={50}>50 dòng</option>
              <option value={100}>100 dòng</option>
            </select>
          </label>
        )}
      </div>
      <div>
        <button type="button" className="page-nav-button" aria-label="Trang trước" disabled={safePage <= 1} onClick={() => onChange(safePage - 1)}>‹</button>
        <label>
          Trang
          <input aria-label="Số trang" type="number" min={1} max={pageCount} value={pageInput} onChange={(event) => setPageInput(event.target.value)} onBlur={commitPage} onKeyDown={(event) => { if (event.key === 'Enter') commitPage() }} />
          / {pageCount.toLocaleString('vi-VN')}
        </label>
        <button type="button" className="page-nav-button" aria-label="Trang sau" disabled={safePage >= pageCount} onClick={() => onChange(safePage + 1)}>›</button>
      </div>
    </nav>
  )
}
type UserInput = {
  full_name: string
  email: string
  phone: string
  roles: Role[]
  assigned_classes: string[]
}

class ApiError extends Error {
  readonly status: number
  readonly retryAfterSeconds: number | null

  constructor(message: string, status: number, retryAfterSeconds: number | null = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.retryAfterSeconds = retryAfterSeconds
  }
}

function TransientMessage({ message, tone = 'success' }: { message: string; tone?: 'success' | 'error' }) {
  const [expired, setExpired] = useState(false)

  useEffect(() => {
    if (!message || tone !== 'success') return
    const timer = window.setTimeout(() => setExpired(true), 5_000)
    return () => window.clearTimeout(timer)
  }, [message, tone])

  if (!message || expired) return null
  return (
    <div className={`notice ${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {message}
      <button type="button" onClick={() => setExpired(true)} aria-label="Đóng thông báo">×</button>
    </div>
  )
}

function NoticeToast({
  message,
  tone,
  onDismiss,
}: {
  message: string
  tone: 'success' | 'error'
  onDismiss: () => void
}) {
  if (!message) return null
  return (
    <div className={`notice ${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {message}
      <button type="button" onClick={onDismiss} aria-label="Đóng thông báo">×</button>
    </div>
  )
}

function ButtonSpinner() {
  return <span className="button-spinner" aria-hidden="true" />
}

type LoginLock = { email: string; until: number }

function loginLockKey(email: string) {
  return `tms:login-lock:${email.trim().toLowerCase()}`
}

function readLoginLock(email: string): LoginLock | null {
  const normalizedEmail = email.trim().toLowerCase()
  if (!normalizedEmail) return null
  const until = Number(localStorage.getItem(loginLockKey(normalizedEmail)) ?? 0)
  if (!Number.isFinite(until) || until <= Date.now()) {
    localStorage.removeItem(loginLockKey(normalizedEmail))
    return null
  }
  return { email: normalizedEmail, until }
}

function vietnameseApiError(detail: unknown, status: number): string {
  if (typeof detail === 'string' && /[ăâđêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/i.test(detail)) {
    return detail
  }
  if (status === 401) return 'Email hoặc mật khẩu không đúng, hoặc phiên đăng nhập đã hết hạn.'
  if (status === 403) return 'Bạn không có quyền thực hiện thao tác này.'
  if (status === 404) return 'Không tìm thấy dữ liệu được yêu cầu.'
  if (status === 409) return 'Thông tin bị trùng lặp. Vui lòng kiểm tra lại.'
  if (status === 422) return 'Thông tin chưa hợp lệ. Vui lòng kiểm tra lại các trường đã nhập.'
  if (status === 423) return 'Tài khoản đang tạm khóa. Vui lòng thử lại sau.'
  if (status >= 500) return 'Máy chủ đang gặp sự cố. Vui lòng thử lại sau.'
  return 'Không thể hoàn thành yêu cầu. Vui lòng kiểm tra thông tin và thử lại.'
}

function readUserDraft(key: string): Partial<UserInput> | null {
  const saved = sessionStorage.getItem(key)
  if (!saved) return null
  try {
    return JSON.parse(saved) as Partial<UserInput>
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    sessionStorage.removeItem(key)
    return null
  }
}

function readUserFilters(ownerId: number): UserFilters {
  const key = `tms:users-filter:${ownerId}`
  const saved = sessionStorage.getItem(key)
  if (!saved) return { q: '', role: '', active: '', page: 1 }
  try {
    const parsed = JSON.parse(saved) as Partial<UserFilters>
    return {
      q: typeof parsed.q === 'string' ? parsed.q : '',
      role: typeof parsed.role === 'string' ? parsed.role : '',
      active: typeof parsed.active === 'string' ? parsed.active : '',
      page: typeof parsed.page === 'number' && parsed.page >= 1 ? parsed.page : 1,
    }
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    sessionStorage.removeItem(key)
    return { q: '', role: '', active: '', page: 1 }
  }
}

function readAccountFormRoute(): AccountFormRoute | null {
  const ownerId = Number(sessionStorage.getItem('tms:draft-owner'))
  if (!Number.isInteger(ownerId) || ownerId < 1) return null
  const saved = sessionStorage.getItem(`tms:account-form:${ownerId}`)
  if (saved === 'create') return { ownerId, mode: 'create' }
  const editUserId = saved?.match(/^edit:(\d+)$/)
  return editUserId
    ? { ownerId, mode: 'edit', userId: Number(editUserId[1]) }
    : null
}

function saveUserFilters(ownerId: number, filters: UserFilters) {
  sessionStorage.setItem(`tms:users-filter:${ownerId}`, JSON.stringify(filters))
}

const API_URL = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000'
const PASSWORD_RESET_COOLDOWN_MS = 60_000
function passwordResetCooldownKey(email: string) {
  return `tms:password-reset-cooldown:${email.trim().toLowerCase()}`
}

function readPasswordResetCooldown(email: string) {
  const normalizedEmail = email.trim().toLowerCase()
  const savedUntil = Number(localStorage.getItem(passwordResetCooldownKey(normalizedEmail)) ?? 0)
  return { email: normalizedEmail, until: Number.isFinite(savedUntil) ? savedUntil : 0 }
}

function formatLeadTimestamp(value: string) {
  const timestamp = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? value : `${value}Z`
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(timestamp))
}

const roleLabels: Record<Role, string> = {
  guest: 'Khách truy cập',
  student: 'Học viên',
  instructor: 'Giảng viên',
  ta: 'Trợ giảng',
  training_manager: 'Quản lý đào tạo',
  admissions: 'Tư vấn tuyển sinh',
  accountant: 'Kế toán',
  admin: 'Quản trị hệ thống',
}
const roleHomeMessages: Record<Role, string> = {
  guest: 'Theo dõi thông tin và các bước đăng ký tư vấn.',
  student: 'Theo dõi lớp học, bài tập, điểm số và học phí của bạn.',
  instructor: 'Quản lý lớp giảng dạy, điểm danh, bài tập và tiến độ học viên.',
  ta: 'Hỗ trợ điểm danh và học viên trong các lớp được phân công.',
  training_manager: 'Theo dõi hoạt động đào tạo và vận hành các lớp học.',
  admissions: 'Theo dõi đầu mối tuyển sinh và hồ sơ học viên.',
  accountant: 'Theo dõi học phí, khoản nợ và báo cáo doanh thu.',
  admin: 'Quản trị tài khoản, phân quyền và vận hành hệ thống.',
}
const moduleLabels: Record<ModuleId, string> = {
  courses: 'Chương trình & môn học',
  leads: 'Tuyển sinh & lead',
  student_records: 'Hồ sơ học viên',
  classes: 'Lớp học & thời khóa biểu',
  attendance: 'Điểm danh',
  materials: 'Học liệu & thông báo lớp',
  assignments: 'Bài tập & chấm điểm',
  grades: 'Điểm tổng kết & tốt nghiệp',
  billing: 'Học phí & Khoản nợ',
  surveys: 'Khảo sát chất lượng',
  reports: 'Báo cáo & dashboard',
}
const moduleOrder: ModuleId[] = [
  'courses',
  'leads',
  'student_records',
  'classes',
  'attendance',
  'materials',
  'assignments',
  'grades',
  'billing',
  'surveys',
  'reports',
]
const moduleIcons: Record<ModuleId, string> = {
  courses: '▤',
  leads: '⌕',
  student_records: '♙',
  classes: '▦',
  attendance: '✓',
  materials: '▧',
  assignments: '✎',
  grades: '★',
  billing: '₫',
  surveys: '☷',
  reports: '▥',
}
const roleOptions = Object.entries(roleLabels) as [Role, string][]
const moduleFromView = (value: string): ModuleId | null =>
  value.startsWith('module:') && moduleOrder.includes(value.slice(7) as ModuleId)
    ? value.slice(7) as ModuleId
    : null
const viewKey = (value: string): value is AppView =>
  value === 'overview' || value === 'users' || moduleFromView(value) !== null
const permissionFor = (user: User, module: ModuleId): 'R' | 'W' | 'F' | null => {
  const permission = user.permissions[module]
  return permission !== '-' ? permission : null
}
const canManageUsers = (user: User) => user.permissions.users === 'F'
const canViewUsers = (user: User) =>
  user.permissions.users === 'R' || user.permissions.users === 'W' || user.permissions.users === 'F'
const ACTIVITY_KEY = 'tms:last_activity'
const ACTIVE_WINDOW_MS = 15 * 60 * 1000
const REFRESH_INTERVAL_MS = 60 * 1000

function PasswordInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const [visible, setVisible] = useState(false)
  return (
    <span className="password-field">
      <input {...props} type={visible ? 'text' : 'password'} />
      <button
        type="button"
        aria-label={visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
        aria-pressed={visible}
        title={visible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
        onClick={() => setVisible((current) => !current)}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          {visible ? (
            <>
              <path d="M3 3l18 18" />
              <path d="M10.6 10.6a2 2 0 002.8 2.8" />
              <path d="M9.9 5.2A10.8 10.8 0 0112 5c5 0 8.3 4.6 9 6-.3.6-1.2 2-2.8 3.5" />
              <path d="M6.2 6.2C4.2 7.5 3.3 9.5 3 11c.7 1.4 4 6 9 6 1 0 1.9-.2 2.7-.5" />
            </>
          ) : (
            <>
              <path d="M2.5 12s3.3-6 9.5-6 9.5 6 9.5 6-3.3 6-9.5 6-9.5-6-9.5-6z" />
              <circle cx="12" cy="12" r="2.5" />
            </>
          )}
        </svg>
      </button>
    </span>
  )
}

function clearSessionDrafts() {
  for (const key of Object.keys(sessionStorage)) {
    if (
      key.startsWith('tms:user-draft:') ||
      key.startsWith('tms:lock-reason:') ||
      key.startsWith('tms:editing-user') ||
      key.startsWith('tms:locking-user') ||
      key.startsWith('tms:users-filter:')
      || key.startsWith('tms:account-form:')
      || key.startsWith('tms:create-modal:')
      || key === 'tms:current-view'
      || key === 'tms:view-owner'
    ) {
      sessionStorage.removeItem(key)
    }
  }
  sessionStorage.removeItem('tms:draft-owner')
  localStorage.removeItem(ACTIVITY_KEY)
}

async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('tms_token')
  const isFormData = options.body instanceof FormData
  let response: Response
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        ...(!isFormData ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    })
  } catch (error) {
    const reason = error instanceof Error && error.message ? ` (${error.message})` : ''
    throw new Error(`Không thể kết nối API tại ${API_URL}. Hãy kiểm tra máy chủ backend đang chạy.${reason}`)
  }
  if (!response.ok) {
    const error = (await response.json().catch(() => ({ detail: 'Có lỗi xảy ra' }))) as {
      detail?: unknown
    }
    const message = vietnameseApiError(error.detail, response.status)
    if (response.status === 401 && token && path !== '/auth/logout') {
      window.dispatchEvent(
        new CustomEvent('tms:session-expired', {
          detail: message,
        }),
      )
    } else if (response.status === 403 && path !== '/auth/login') {
      window.dispatchEvent(new CustomEvent('tms:access-denied', { detail: message }))
    }
    const retryAfterHeader = response.headers.get('Retry-After')
    const retryAfterSeconds = retryAfterHeader && /^\d+$/.test(retryAfterHeader)
      ? Number(retryAfterHeader)
      : null
    throw new ApiError(message, response.status, retryAfterSeconds)
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

function App() {
  const [user, setUser] = useState<User | null>(null)
  const [loginLock, setLoginLock] = useState<LoginLock | null>(() =>
    readLoginLock(localStorage.getItem('tms_login_email') ?? ''),
  )
  const [loading, setLoading] = useState(() => Boolean(localStorage.getItem('tms_token')))
  const [view, setView] = useState<AppView>(() => {
    const saved = sessionStorage.getItem('tms:current-view') ?? 'overview'
    return viewKey(saved) ? saved : 'overview'
  })
  const [showAttendanceRisk, setShowAttendanceRisk] = useState(false)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [users, setUsers] = useState<User[]>([])
  const [userPage, setUserPage] = useState<UserPage | null>(null)
  const [accountForm, setAccountForm] = useState<AccountFormRoute | null>(readAccountFormRoute)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [noticeTone, setNoticeTone] = useState<'success' | 'error'>('error')
  const [noticeVersion, setNoticeVersion] = useState(0)
  const [accessError, setAccessError] = useState('')
  const lastActivityWrite = useRef(0)
  const accountRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!accountMenuOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (accountRef.current && !accountRef.current.contains(e.target as Node)) {
        setAccountMenuOpen(false)
      }
    }
    document.addEventListener('pointerdown', handleClickOutside)
    return () => document.removeEventListener('pointerdown', handleClickOutside)
  }, [accountMenuOpen])

  useEffect(() => {
    if (!accountMenuOpen && !mobileNavOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setAccountMenuOpen(false)
        setMobileNavOpen(false)
      }
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [accountMenuOpen, mobileNavOpen])

  function showNotice(message: string, tone: 'success' | 'error' = 'error') {
    setNoticeTone(tone)
    setNotice(message)
    setNoticeVersion((version) => version + 1)
  }

  useEffect(() => {
    if (!notice || noticeTone !== 'success') return
    const timer = window.setTimeout(() => setNotice(''), 5_000)
    return () => window.clearTimeout(timer)
  }, [notice, noticeTone, noticeVersion])

  useEffect(() => {
    const localizeInvalidField = (event: Event) => {
      const field = event.target
      if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement)) return
      const name = field.labels?.[0]?.textContent?.trim().replace(/\s+/g, ' ') || field.getAttribute('aria-label') || 'trường này'
      const validity = field.validity
      let message = 'Giá trị đã nhập chưa hợp lệ.'
      if (validity.valueMissing) {
        message = field instanceof HTMLSelectElement ? `Vui lòng chọn ${name}.` : `Vui lòng nhập ${name}.`
      } else if (validity.typeMismatch && field.type === 'email') {
        message = 'Vui lòng nhập địa chỉ email đúng định dạng.'
      } else if (validity.tooShort) {
        const minLength = field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement ? field.minLength : 0
        message = `${name} cần có ít nhất ${minLength} ký tự.`
      } else if (validity.tooLong) {
        message = `${name} vượt quá độ dài cho phép.`
      } else if (validity.rangeUnderflow) {
        message = `${name} không được nhỏ hơn ${field instanceof HTMLInputElement ? field.min : ''}.`
      } else if (validity.rangeOverflow) {
        message = `${name} không được lớn hơn ${field instanceof HTMLInputElement ? field.max : ''}.`
      } else if (validity.patternMismatch) {
        message = `${name} chưa đúng định dạng yêu cầu.`
      }
      field.setCustomValidity(message)
    }
    const clearFieldMessage = (event: Event) => {
      const field = event.target
      if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement) {
        field.setCustomValidity('')
      }
    }
    document.addEventListener('invalid', localizeInvalidField, true)
    document.addEventListener('input', clearFieldMessage, true)
    document.addEventListener('change', clearFieldMessage, true)
    return () => {
      document.removeEventListener('invalid', localizeInvalidField, true)
      document.removeEventListener('input', clearFieldMessage, true)
      document.removeEventListener('change', clearFieldMessage, true)
    }
  }, [])

  useEffect(() => {
    const showEventNotice = (event: Event) => showNotice((event as CustomEvent<string>).detail)
    const showAccessError = (event: Event) => setAccessError((event as CustomEvent<string>).detail)
    const syncRevokedSession = (event: StorageEvent) => {
      if (event.key === 'tms_token' && event.newValue === null) {
        window.dispatchEvent(new CustomEvent('tms:session-expired', {
          detail: 'Phiên đăng nhập đã kết thúc. Vui lòng đăng nhập lại.',
        }))
      }
    }
    const expireSession = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail
      localStorage.removeItem('tms_token')
      localStorage.removeItem(ACTIVITY_KEY)
      setUser(null)
      setSummary(null)
      setUsers([])
      setUserPage(null)
      setPasswordOpen(false)
      setProfileOpen(false)
      setAccountMenuOpen(false)
      setAccessError('')
      showNotice(detail)
    }
    window.addEventListener('tms:notice', showEventNotice)
    window.addEventListener('tms:access-denied', showAccessError)
    window.addEventListener('tms:session-expired', expireSession)
    window.addEventListener('storage', syncRevokedSession)
    return () => {
      window.removeEventListener('tms:notice', showEventNotice)
      window.removeEventListener('tms:access-denied', showAccessError)
      window.removeEventListener('tms:session-expired', expireSession)
      window.removeEventListener('storage', syncRevokedSession)
    }
  }, [])

  useEffect(() => {
    const token = localStorage.getItem('tms_token')
    if (!token) return
    apiRequest<User>('/auth/me')
      .then(setUser)
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 401) {
          localStorage.removeItem('tms_token')
        }
        showNotice(error instanceof Error ? error.message : 'Không thể khôi phục phiên đăng nhập.')
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!user) return
    const draftOwner = sessionStorage.getItem('tms:draft-owner')
    if (draftOwner !== String(user.id)) {
      clearSessionDrafts()
      sessionStorage.setItem('tms:draft-owner', String(user.id))
    }
    if (canViewUsers(user)) {
      apiRequest<Summary>('/dashboard/summary').then(setSummary).catch((error: Error) => showNotice(error.message))
      loadUsers(readUserFilters(user.id), user.id).catch((error: Error) => showNotice(error.message))
    }
  }, [user])

  function navigate(nextView: AppView) {
    if (!user) return
    setProfileOpen(false)
    setAccountMenuOpen(false)
    setMobileNavOpen(false)
    if (nextView !== 'users') {
      sessionStorage.removeItem(`tms:account-form:${user.id}`)
      setAccountForm(null)
    }
    sessionStorage.setItem('tms:current-view', nextView)
    sessionStorage.setItem('tms:view-owner', String(user.id))
    setView(nextView)
  }

  function openAccountForm(route: AccountFormRoute) {
    sessionStorage.setItem(
      `tms:account-form:${route.ownerId}`,
      route.mode === 'create' ? 'create' : `edit:${route.userId}`,
    )
    setAccountForm(route)
  }

  function closeAccountForm() {
    if (user) sessionStorage.removeItem(`tms:account-form:${user.id}`)
    setAccountForm(null)
  }

  useEffect(() => {
    if (!user) return
    let expiryDispatched = false
    const markActivity = () => {
      const now = Date.now()
      if (now - lastActivityWrite.current < 15_000) return
      lastActivityWrite.current = now
      localStorage.setItem(ACTIVITY_KEY, String(now))
    }
    if (!localStorage.getItem(ACTIVITY_KEY)) {
      localStorage.setItem(ACTIVITY_KEY, String(Date.now()))
    }
    const activityEvents: (keyof WindowEventMap)[] = [
      'pointerdown',
      'pointermove',
      'keydown',
      'input',
      'scroll',
      'touchstart',
      'focus',
    ]
    activityEvents.forEach((eventName) => window.addEventListener(eventName, markActivity, { passive: true }))
    const markVisibleActivity = () => {
      if (document.visibilityState === 'visible') markActivity()
    }
    document.addEventListener('visibilitychange', markVisibleActivity)
    const idleTimer = window.setInterval(() => {
      const lastActivity = Number(localStorage.getItem(ACTIVITY_KEY) ?? 0)
      if (Date.now() - lastActivity <= ACTIVE_WINDOW_MS || expiryDispatched) return
      expiryDispatched = true
      window.dispatchEvent(new CustomEvent('tms:session-expired', {
        detail: 'Phiên đăng nhập đã hết hạn do không hoạt động trong 15 phút. Bản nháp chưa lưu vẫn được giữ trong tab này.',
      }))
    }, 1000)
    const refreshTimer = window.setInterval(async () => {
      const lastActivity = Number(localStorage.getItem(ACTIVITY_KEY) ?? 0)
      const isActive = Date.now() - lastActivity <= ACTIVE_WINDOW_MS
      if (!isActive || document.visibilityState !== 'visible') return
      try {
        const result = await apiRequest<{ access_token: string; user: User }>('/auth/refresh', { method: 'POST' })
        localStorage.setItem('tms_token', result.access_token)
        setUser((current) => {
          if (
            current &&
            current.id === result.user.id &&
            current.is_active === result.user.is_active &&
            current.roles.length === result.user.roles.length &&
            current.roles.every((role, index) => role === result.user.roles[index])
          ) {
            return current
          }
          return result.user
        })
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 401)) {
          showNotice(error instanceof Error ? error.message : 'Không thể gia hạn phiên đăng nhập.')
        }
      }
    }, REFRESH_INTERVAL_MS)
    return () => {
      window.clearInterval(refreshTimer)
      window.clearInterval(idleTimer)
      activityEvents.forEach((eventName) => window.removeEventListener(eventName, markActivity))
      document.removeEventListener('visibilitychange', markVisibleActivity)
    }
  }, [user])

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const email = String(data.get('email') ?? '').trim()
    const password = String(data.get('password') ?? '')
    if (!email || !password) {
      showNotice('Vui lòng nhập email và mật khẩu.')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showNotice('Vui lòng nhập địa chỉ email hợp lệ.')
      return
    }
    try {
      const result = await apiRequest<{ access_token: string; user: User }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      })
      localStorage.setItem('tms_token', result.access_token)
      localStorage.setItem(ACTIVITY_KEY, String(Date.now()))
      localStorage.removeItem('tms_login_email')
      localStorage.removeItem(loginLockKey(email))
      setLoginLock(null)
      setUser(result.user)
      showNotice('Đăng nhập thành công.', 'success')
    } catch (error) {
      if (error instanceof ApiError && error.status === 423) {
        const retryAfterSeconds = error.retryAfterSeconds ?? 15 * 60
        const lock = { email: email.toLowerCase(), until: Date.now() + retryAfterSeconds * 1000 }
        localStorage.setItem(loginLockKey(lock.email), String(lock.until))
        setLoginLock(lock)
        showNotice(error.message)
      } else {
        showNotice(error instanceof Error ? error.message : 'Không thể đăng nhập. Vui lòng thử lại.')
      }
    }
  }

  async function loadUsers(filters: UserFilters, ownerId: number) {
    saveUserFilters(ownerId, filters)
    const params = new URLSearchParams({
      page: String(filters.page),
      page_size: '20',
    })
    if (filters.q.trim()) params.set('q', filters.q.trim())
    if (filters.role) params.set('role', filters.role)
    if (filters.active) params.set('active', filters.active)
    const result = await apiRequest<UserPage>(`/users?${params.toString()}`)
    setUsers(result.items)
    setUserPage(result)
  }

  async function logout() {
    try {
      await apiRequest('/auth/logout', { method: 'POST' })
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        // An expired or already-revoked session is already invalid on the server.
      } else if (error instanceof ApiError) {
        showNotice(
          `Máy chủ chưa xác nhận đăng xuất (mã ${error.status}). Phiên đăng nhập vẫn được giữ; ${error.message}`,
        )
        return
      } else {
        showNotice(
          'Không thể kết nối máy chủ để thu hồi phiên. Phiên đăng nhập vẫn được giữ; hãy kiểm tra máy chủ rồi thử lại.',
        )
        return
      }
    }
    localStorage.removeItem('tms_token')
    setUser(null)
    setSummary(null)
    setUsers([])
    setUserPage(null)
    setView('overview')
    setAccountForm(null)
    setProfileOpen(false)
    setAccountMenuOpen(false)
    showNotice('Đăng xuất thành công. Phiên đăng nhập đã được thu hồi.', 'success')
    setAccessError('')
    clearSessionDrafts()
  }

  async function createUser(data: UserInput) {
    if (!user) throw new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.')
    const ownerId = user.id
    const created = await apiRequest<User>('/users', {
      method: 'POST',
      body: JSON.stringify(data),
    })
    setAccountForm(null)
    sessionStorage.removeItem(`tms:account-form:${ownerId}`)
    sessionStorage.removeItem(`tms:create-modal:${ownerId}`)
    sessionStorage.removeItem(`tms:user-draft:${ownerId}:new`)
    const activationNotice =
      `Đã tạo tài khoản ${created.email}. Máy chủ email đã chấp nhận thư kích hoạt; điều này chưa xác nhận thư đã tới hộp thư. Nếu chưa thấy thư, hãy kiểm tra Thư rác/Quảng cáo hoặc dùng chức năng Quên mật khẩu.`
    showNotice(activationNotice, 'success')
    try {
      await loadUsers(readUserFilters(ownerId), ownerId)
    } catch {
      showNotice(`${activationNotice} Không thể làm mới danh sách ngay lúc này; hãy bấm Tìm kiếm để tải lại.`, 'success')
    }
  }

  async function saveUser(id: number, data: UserInput) {
    const original = users.find((item) => item.id === id)
    if (!original) throw new Error('Không tìm thấy tài khoản đang chỉnh sửa. Hãy tải lại danh sách.')
    const changedFields = [
      original.full_name !== data.full_name && 'Họ và tên',
      original.email !== data.email && 'Email',
      (original.phone ?? '') !== data.phone && 'Số điện thoại',
      original.assigned_classes.join(',') !== data.assigned_classes.join(',') && 'Lớp phụ trách',
      JSON.stringify([...original.roles].sort()) !== JSON.stringify([...data.roles].sort()) && 'Vai trò',
    ].filter((field): field is string => Boolean(field))
    let updated: User | null = null
    try {
      updated = await apiRequest<User>(`/users/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      })
      if (JSON.stringify([...original.roles].sort()) !== JSON.stringify([...data.roles].sort())) {
        updated = await apiRequest<User>(`/users/${id}/role`, {
          method: 'PATCH',
          body: JSON.stringify({ roles: data.roles }),
        })
      }
      const savedUser = updated
      if (!savedUser) throw new Error('Máy chủ không trả về thông tin tài khoản đã cập nhật.')
      setUsers((current) => current.map((item) => (item.id === id ? savedUser : item)))
      setUser((current) => current?.id === id ? savedUser : current)
      showNotice(
        changedFields.length
          ? `Đã cập nhật ${changedFields.join(', ')} cho tài khoản ${savedUser.email}.`
          : 'Không có thông tin nào thay đổi.',
        'success',
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Không thể cập nhật tài khoản.'
      const partiallyUpdated = updated
      if (partiallyUpdated) {
        setUsers((current) => current.map((item) => (item.id === id ? partiallyUpdated : item)))
        setUser((current) => current?.id === id ? partiallyUpdated : current)
        const savedFields = changedFields.filter((field) => field !== 'Vai trò')
        throw new Error(
          `Đã cập nhật ${savedFields.length ? savedFields.join(', ') : 'thông tin tài khoản'}, nhưng cập nhật vai trò thất bại: ${message}`,
        )
      }
      throw error
    }
  }

  async function deleteUser(userToDelete: User) {
    await apiRequest<void>(`/users/${userToDelete.id}`, { method: 'DELETE' })
    setUsers((current) => current.filter((item) => item.id !== userToDelete.id))
    const ownerId = user?.id
    const currentFilters = ownerId ? readUserFilters(ownerId) : null
    const nextTotal = Math.max(0, (userPage?.total ?? 0) - 1)
    const lastPage = userPage ? Math.max(1, Math.ceil(nextTotal / userPage.page_size)) : 1
    const nextPage = Math.min(currentFilters?.page ?? 1, lastPage)
    setUserPage((current) => current ? { ...current, total: nextTotal, page: nextPage } : current)
    showNotice(`Đã xóa vĩnh viễn tài khoản ${userToDelete.email}.`, 'success')
    if (ownerId && currentFilters) {
      try {
        await loadUsers({ ...currentFilters, page: nextPage }, ownerId)
      } catch {
        showNotice(`Đã xóa tài khoản ${userToDelete.email}, nhưng chưa tải lại được danh sách. Vui lòng bấm Tìm kiếm.`, 'success')
      }
    }
  }

  async function updateStatus(userToUpdate: User, active: boolean, reason: string) {
    try {
      const updated = await apiRequest<User>(`/users/${userToUpdate.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ active, reason }),
      })
      setUsers((current) => current.map((item) => (item.id === userToUpdate.id ? updated : item)))
      if (!active && updated.handover_required) {
        showNotice(`Đã khóa tài khoản ${updated.email}. Cần bàn giao lớp: ${updated.assigned_classes.join(', ')}.`, 'success')
      } else {
        showNotice(`Đã ${active ? 'mở khóa' : 'khóa'} tài khoản ${updated.email}.`, 'success')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Không thể cập nhật trạng thái tài khoản.'
      showNotice(`Thay đổi trạng thái tài khoản thất bại: ${message}`)
      throw error
    }
  }

  async function changePassword(data: { current_password: string; new_password: string }) {
    await apiRequest<{ message: string; access_token: string; user: User }>('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify(data),
    })
    localStorage.removeItem('tms_token')
    localStorage.removeItem(ACTIVITY_KEY)
    setUser(null)
    setSummary(null)
    setUsers([])
    setUserPage(null)
    setView('overview')
    setPasswordOpen(false)
    setProfileOpen(false)
    setAccountMenuOpen(false)
    setAccessError('')
    clearSessionDrafts()
    showNotice('Mật khẩu tài khoản của quý khách đã được đổi thành công. Vui lòng đăng nhập lại bằng mật khẩu mới.', 'success')
  }

  async function updateProfile(data: { full_name: string; phone: string; date_of_birth: string; address: string }) {
    const updated = await apiRequest<Partial<User>>('/profile', {
      method: 'PATCH',
      body: JSON.stringify({ ...data, date_of_birth: data.date_of_birth || null }),
    })
    setUser((current) => current ? { ...current, ...updated } : current)
    showNotice('Đã cập nhật hồ sơ cá nhân.', 'success')
  }

  async function uploadAvatar(file: File) {
    const formData = new FormData()
    formData.append('file', file)
    const result = await apiRequest<{ avatar_url: string }>('/profile/avatar', {
      method: 'POST',
      body: formData,
    })
    setUser((current) => current ? { ...current, avatar_url: result.avatar_url } : current)
    showNotice('Đã cập nhật ảnh đại diện.', 'success')
  }

  async function importUsers(file: File) {
    const formData = new FormData()
    formData.append('file', file)
    const result = await apiRequest<{ imported: number; skipped: number; errors: string[] }>('/users/import-excel', {
      method: 'POST',
      body: formData,
    })
    if (user) {
      try {
        await loadUsers({ ...readUserFilters(user.id), page: 1 }, user.id)
      } catch (error) {
        showNotice(`Nhập tài khoản đã hoàn tất, nhưng không thể tải lại danh sách: ${error instanceof Error ? error.message : 'lỗi không xác định'}`)
      }
    }
    return result
  }

  async function previewUsersImport(file: File) {
    const formData = new FormData()
    formData.append('file', file)
    return apiRequest<ImportPreview>('/users/import-excel/preview', {
      method: 'POST',
      body: formData,
    })
  }

  if (window.location.pathname !== '/' && window.location.pathname !== '/index.html') {
    if (window.location.pathname === '/register') return <PublicLeadPage />
    return (
      <ErrorScreen
        title="Không tìm thấy trang"
        message="Địa chỉ này không thuộc luồng làm việc hiện tại."
        actionLabel="Quay lại trang chủ"
        onAction={() => window.location.assign('/')}
      />
    )
  }
  const hasResetToken = new URLSearchParams(window.location.search).has('reset_token')
  if (loading && !hasResetToken) return <div className="page-loader">Đang khởi động hệ thống...</div>
  if (!user || hasResetToken) return (
    <LoginPage
      lock={loginLock}
      notice={notice}
      noticeTone={noticeTone}
      onDismissNotice={() => setNotice('')}
      onEmailChange={(email) => setLoginLock(readLoginLock(email))}
      onSubmit={login}
      onNotify={showNotice}
    />
  )
  const showPasswordModal = passwordOpen || user.must_change_password
  const savedViewBelongsToUser =
    sessionStorage.getItem('tms:view-owner') === String(user.id)
  const selectedModule = moduleFromView(view)
  const selectedModulePermission = selectedModule ? permissionFor(user, selectedModule) : null
  const currentView: AppView = !savedViewBelongsToUser
    ? 'overview'
    : view === 'users' && canViewUsers(user)
      ? 'users'
      : selectedModule && selectedModulePermission
        ? view
        : 'overview'
  const pageTitle = profileOpen
    ? 'Thông tin tài khoản'
    : currentView === 'overview'
      ? `Xin chào, ${user.full_name.split(' ').at(-1)}`
      : currentView === 'users'
        ? accountForm
          ? accountForm.mode === 'create' ? 'Tạo tài khoản' : 'Chỉnh sửa tài khoản'
          : 'Tài khoản'
        : selectedModule === 'leads'
          ? 'Tuyển sinh & phễu tư vấn'
          : selectedModule === 'student_records'
            ? user.roles.includes('student') ? 'Lịch học của tôi' : moduleLabels.student_records
            : selectedModule === 'classes'
              ? 'Lớp học & thời khóa biểu'
              : selectedModule === 'attendance'
                ? showAttendanceRisk ? 'Chuyên cần & cảnh báo rủi ro' : 'Điểm danh & đơn vắng'
                : selectedModule === 'materials'
                  ? 'Học liệu, thông báo & hộp thư'
                  : selectedModule === 'assignments'
                    ? 'Bài tập & chấm điểm'
                    : selectedModule === 'grades'
                      ? 'Điểm tổng kết & tốt nghiệp'
                      : selectedModule === 'billing'
                        ? 'Học phí & Khoản nợ'
                        : selectedModule === 'surveys'
                          ? 'Khảo sát chất lượng'
                          : selectedModule === 'reports'
                            ? 'Dashboard vận hành'
                            : selectedModule
                              ? moduleLabels[selectedModule]
                              : 'Tài khoản'
  if (accessError) {
    return (
      <ErrorScreen
        title="Không đủ quyền truy cập"
        message={accessError}
        actionLabel="Quay lại tổng quan"
        onAction={() => { setAccessError(''); navigate('overview') }}
      />
    )
  }

  return (
    <div className="app-shell">
      <NoticeToast message={notice} tone={noticeTone} onDismiss={() => setNotice('')} />
      {mobileNavOpen && (
        <button
          className="mobile-nav-backdrop"
          type="button"
          aria-label="Đóng menu điều hướng"
          onClick={() => setMobileNavOpen(false)}
        />
      )}
      <aside className={`sidebar${mobileNavOpen ? ' mobile-nav-open' : ''}`}>
        <div className="brand">
          <img className="institution-logo" src="/ictu-logo.png" alt="Biểu trưng ICTU" />
          <div className="brand-name"><span>Hệ Thống</span><span>Quản Lý Đào Tạo</span></div>
          <button
            type="button"
            className="mobile-sidebar-close"
            aria-label="Đóng menu"
            onClick={() => setMobileNavOpen(false)}
          >
            ✕
          </button>
        </div>
        <div className={`sidebar-account${accountMenuOpen ? ' menu-open' : ''}`} ref={accountRef}>
          <button
            className="sidebar-account-toggle"
            type="button"
            aria-label={accountMenuOpen ? 'Đóng menu tài khoản' : 'Mở menu tài khoản'}
            aria-expanded={accountMenuOpen}
            aria-controls="account-menu"
            onClick={() => setAccountMenuOpen((open) => !open)}
          >
            <Avatar name={user.full_name} avatarUrl={user.avatar_url} />
            <span className="sidebar-account-label">
              <strong>{user.full_name}</strong>
              <small title={user.roles.map((role) => roleLabels[role]).join(', ')}>
                {user.roles.map((role) => roleLabels[role]).join(', ')}
              </small>
            </span>
            <span className="sidebar-account-menu-icon" aria-hidden="true"><i /><i /><i /></span>
          </button>
          <div className="account-menu" id="account-menu" aria-label="Menu tài khoản" hidden={!accountMenuOpen}>
            <button type="button" className="account-menu-item" onClick={() => { setAccountMenuOpen(false); setProfileOpen(true) }}>
              <span aria-hidden="true">♙</span>Thông tin tài khoản
            </button>
            {!user.must_change_password && (
              <button type="button" className="account-menu-item" onClick={() => { setAccountMenuOpen(false); setPasswordOpen(true) }}>
                <span aria-hidden="true">♧</span>Đổi mật khẩu
              </button>
            )}
            <button type="button" className="account-menu-item account-menu-logout" onClick={() => { setAccountMenuOpen(false); void logout() }}>
              <span aria-hidden="true">⇥</span>Đăng xuất
            </button>
          </div>
        </div>
        <div className="workspace-label">KHÔNG GIAN LÀM VIỆC</div>
        <nav className="main-nav">
          <button className={currentView === 'overview' ? 'nav-item active' : 'nav-item'} onClick={() => navigate('overview')}>
            <span>⌂</span>Tổng quan
          </button>
          {moduleOrder.filter((module) => permissionFor(user, module) !== null).map((module) => (
            <button
              key={module}
              className={currentView === `module:${module}` ? 'nav-item active' : 'nav-item'}
              onClick={() => {
                navigate(`module:${module}`)
              }}
              title={`${moduleLabels[module]} · Quyền ${permissionFor(user, module)}`}
            >
              <span aria-hidden="true">{moduleIcons[module]}</span>{moduleLabels[module]}
            </button>
          ))}
          {canViewUsers(user) && (
            <button className={currentView === 'users' ? 'nav-item active' : 'nav-item'} onClick={() => navigate('users')}>
              <span>♙</span>Tài khoản
            </button>
          )}
        </nav>
      </aside>
      <main className="main-content">
        <header className={`topbar${selectedModule === 'classes' && !profileOpen ? ' class-view' : ''}`}>
          <button
            className="mobile-nav-toggle"
            type="button"
            aria-label={mobileNavOpen ? 'Đóng menu điều hướng' : 'Mở menu điều hướng'}
            aria-expanded={mobileNavOpen}
            onClick={() => setMobileNavOpen((open) => !open)}
          >
            <span className="mobile-toggle-bars"><span /><span /><span /></span>
            <span className="mobile-toggle-text">Menu</span>
          </button>
          <div className={`topbar-page-heading${profileOpen ? ' profile-page-heading' : ''}`}>
            <h1>{pageTitle}</h1>
            <span className="topbar-status"><span className="status-dot" />Hệ thống đang hoạt động</span>
          </div>
        </header>
        <div id="topbar-nav-slot" className="subnav-horizontal-strip" />
        <div className="main-content-body">
          <div className={profileOpen ? 'content-wrap profile-content-wrap' : 'content-wrap'}>
          {profileOpen ? (
            <ProfileView user={user} onUpdate={updateProfile} onUploadAvatar={uploadAvatar} />
          ) : currentView === 'overview' ? (
            <Overview user={user} summary={summary} onUsers={() => navigate('users')} canViewUsers={canViewUsers(user)} onModule={(module) => navigate(`module:${module}`)} />
          ) : currentView === 'users' && accountForm?.ownerId === user.id && canManageUsers(user) ? (
            accountForm.mode === 'create' ? (
              <UserFormPage
                ownerId={user.id}
                title="Tạo tài khoản"
                onClose={closeAccountForm}
                onSave={createUser}
              />
            ) : users.find((item) => item.id === accountForm.userId) ? (
              <UserFormPage
                key={`edit-user-${accountForm.userId}`}
                ownerId={user.id}
                user={users.find((item) => item.id === accountForm.userId)}
                title="Chỉnh sửa tài khoản"
                onClose={closeAccountForm}
                onSave={async (data) => {
                  await saveUser(accountForm.userId, data)
                  closeAccountForm()
                }}
                onDelete={async () => {
                  const editingUser = users.find((item) => item.id === accountForm.userId)
                  if (!editingUser) throw new Error('Không tìm thấy tài khoản đang chỉnh sửa.')
                  await deleteUser(editingUser)
                  sessionStorage.removeItem(`tms:user-draft:${user.id}:${editingUser.id}`)
                  closeAccountForm()
                }}
              />
            ) : userPage ? (
              <ErrorScreen
                title="Không tìm thấy tài khoản"
                message="Tài khoản có thể đã bị xóa hoặc không còn trong danh sách hiện tại."
                actionLabel="Quay lại danh sách"
                onAction={closeAccountForm}
              />
            ) : (
              <div className="page-loader">Đang tải tài khoản...</div>
            )
          ) : currentView === 'users' && userPage ? (
            <UsersView
              users={users}
              page={userPage}
              ownerId={user.id}
              canManage={canManageUsers(user)}
              onQuery={(filters) => loadUsers(filters, user.id)}
              onCreate={() => openAccountForm({ ownerId: user.id, mode: 'create' })}
              onEditOpen={(userId) => openAccountForm({ ownerId: user.id, mode: 'edit', userId })}
              onStatus={updateStatus}
              onImport={importUsers}
              onPreviewImport={previewUsersImport}
              onCreateUser={createUser}
            />
          ) : selectedModule && selectedModulePermission ? (
            selectedModule === 'leads' ? (
              <Operations module="leads" permission={selectedModulePermission} user={user} request={apiRequest} notify={showNotice} />
            ) : selectedModule === 'attendance' ? (
              <div className="lead-module-shell">
                <div className="lead-mode-switch" role="tablist" aria-label="Chế độ điểm danh">
                  <button className={!showAttendanceRisk ? 'active' : ''} role="tab" aria-selected={!showAttendanceRisk} onClick={() => setShowAttendanceRisk(false)}>Điểm danh buổi học</button>
                  <button className={showAttendanceRisk ? 'active' : ''} role="tab" aria-selected={showAttendanceRisk} onClick={() => setShowAttendanceRisk(true)}>Chuyên cần & cảnh báo</button>
                </div>
                {showAttendanceRisk
                  ? <SprintWorkflows module="attendance" permission={selectedModulePermission} user={user} request={apiRequest} notify={showNotice} />
                  : <Operations module="attendance" permission={selectedModulePermission} user={user} request={apiRequest} notify={showNotice} />}
              </div>
            ) : selectedModule === 'student_records' || selectedModule === 'classes'
              ? <Operations module={selectedModule} permission={selectedModulePermission} user={user} request={apiRequest} notify={showNotice} />
              : selectedModule === 'materials' || selectedModule === 'assignments' || selectedModule === 'grades' || selectedModule === 'billing' || selectedModule === 'surveys' || selectedModule === 'reports'
                ? <SprintWorkflows module={selectedModule} permission={selectedModulePermission} user={user} request={apiRequest} notify={showNotice} />
              : <ModuleLanding module={selectedModule} permission={selectedModulePermission} canDeleteLeads={user.roles.includes('training_manager')} />
          ) : (
            <div className="page-loader">Đang tải danh sách tài khoản...</div>
          )}
        </div>
        </div>
      </main>
      {showPasswordModal && (
        <ChangePasswordModal
          required={user.must_change_password}
          onClose={() => setPasswordOpen(false)}
          onChange={changePassword}
        />
      )}
    </div>
  )
}

function ErrorScreen({ title, message, actionLabel, onAction }: { title: string; message: string; actionLabel: string; onAction: () => void }) {
  return (
    <main className="error-screen">
      <section className="error-card">
        <div className="brand-mark large">T</div>
        <p className="eyebrow blue">THÔNG BÁO</p>
        <h2>{title}</h2>
        <p>{message}</p>
        <button className="primary-button full" onClick={onAction}>{actionLabel}</button>
      </section>
    </main>
  )
}

function LoginPage({
  lock,
  notice,
  noticeTone,
  onDismissNotice,
  onEmailChange,
  onSubmit,
  onNotify,
}: {
  lock: LoginLock | null
  notice: string
  noticeTone: 'success' | 'error'
  onDismissNotice: () => void
  onEmailChange: (email: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>
  onNotify: (message: string, tone?: 'success' | 'error') => void
}) {
  const resetParams = new URLSearchParams(window.location.search)
  const initialResetToken = resetParams.get('reset_token') ?? ''
  const [resetAccount, setResetAccount] = useState('')
  const [resetLinkStatus, setResetLinkStatus] = useState<'checking' | 'valid' | 'invalid' | 'error'>(
    initialResetToken ? 'checking' : 'valid',
  )
  const [forgot, setForgot] = useState(Boolean(initialResetToken))
  const [resetToken, setResetToken] = useState(initialResetToken)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [email, setEmail] = useState(localStorage.getItem('tms_login_email') ?? '')
  const [resetEmail, setResetEmail] = useState(localStorage.getItem('tms_login_email') ?? '')
  const [resetCooldown, setResetCooldown] = useState(() => readPasswordResetCooldown(localStorage.getItem('tms_login_email') ?? ''))
  const [resetNotice, setResetNotice] = useState('')
  const [resetError, setResetError] = useState('')
  const [sendingReset, setSendingReset] = useState(false)
  const sendingResetRef = useRef(false)
  const [resettingPassword, setResettingPassword] = useState(false)
  const loginSubmittingRef = useRef(false)
  const [loginSubmitting, setLoginSubmitting] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const normalizedEmail = email.trim().toLowerCase()
  const normalizedResetEmail = resetEmail.trim().toLowerCase()
  const resetCooldownRemaining = resetCooldown.email === normalizedResetEmail
    ? Math.max(0, Math.ceil((resetCooldown.until - now) / 1000))
    : 0
  const resetCooldownCountdown = `${String(Math.floor(resetCooldownRemaining / 60)).padStart(2, '0')}:${String(resetCooldownRemaining % 60).padStart(2, '0')}`
  const lockRemaining = lock?.email === normalizedEmail
    ? Math.max(0, Math.ceil((lock.until - now) / 1000))
    : 0
  const lockCountdown = `${String(Math.floor(lockRemaining / 60)).padStart(2, '0')}:${String(lockRemaining % 60).padStart(2, '0')}`
  const loginNotice = lockRemaining > 0
    ? `Tài khoản bị khóa tạm thời 15 phút do đăng nhập sai 5 lần liên tiếp. Bạn có thể thử lại sau ${lockCountdown}.`
    : notice
  const loginNoticeTone = lockRemaining > 0 ? 'error' : noticeTone

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!initialResetToken) return
    const params = new URLSearchParams({ token: initialResetToken })
    apiRequest<{ email: string }>(`/auth/reset-password/validate?${params.toString()}`)
      .then(({ email }) => {
        setResetAccount(email)
        setResetLinkStatus('valid')
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 400) {
          setResetLinkStatus('invalid')
          return
        }
        setResetLinkStatus('error')
      })
  }, [initialResetToken])

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (loginSubmittingRef.current) return
    loginSubmittingRef.current = true
    setLoginSubmitting(true)
    try {
      await onSubmit(event)
    } finally {
      loginSubmittingRef.current = false
      setLoginSubmitting(false)
    }
  }

  async function requestReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (sendingResetRef.current || resetCooldownRemaining > 0) return
    const email = String(new FormData(event.currentTarget).get('email') ?? '').trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setResetError('Vui lòng nhập địa chỉ email hợp lệ.')
      return
    }
    setResetNotice('')
    setResetError('')
    sendingResetRef.current = true
    setSendingReset(true)
    try {
      const result = await apiRequest<{ message: string }>('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email }),
      })
      const normalizedEmail = email.toLowerCase()
      const cooldownUntil = Date.now() + PASSWORD_RESET_COOLDOWN_MS
      localStorage.setItem('tms_login_email', email)
      localStorage.setItem(passwordResetCooldownKey(normalizedEmail), String(cooldownUntil))
      setEmail(email)
      setResetEmail(email)
      setResetCooldown({ email: normalizedEmail, until: cooldownUntil })
      setNow(Date.now())
      setResetNotice(result.message)
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : 'Không thể khôi phục mật khẩu'
      setResetError(message)
    } finally {
      sendingResetRef.current = false
      setSendingReset(false)
    }
  }

  async function submitReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (resettingPassword) return
    if (newPassword.length < 8 || !/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
      onNotify('Mật khẩu phải có ít nhất 8 ký tự, gồm chữ cái và chữ số.')
      return
    }
    if (newPassword !== confirmPassword) {
      onNotify('Mật khẩu xác nhận không khớp. Vui lòng nhập lại.')
      return
    }
    setResettingPassword(true)
    try {
      const result = await apiRequest<{ message: string }>('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token: resetToken, new_password: newPassword }),
      })
      setResetToken('')
      setNewPassword('')
      setConfirmPassword('')
      window.history.replaceState({}, '', window.location.pathname)
      setResetLinkStatus('valid')
      setForgot(false)
      onNotify(result.message, 'success')
    } catch (requestError) {
      if (requestError instanceof ApiError && requestError.status === 400) {
        setResetLinkStatus('invalid')
        setNewPassword('')
        setConfirmPassword('')
      } else {
        onNotify(requestError instanceof Error ? requestError.message : 'Không thể đặt lại mật khẩu')
      }
    } finally {
      setResettingPassword(false)
    }
  }

  return (
    <main className="login-page">
      <section className="login-visual"><div className="visual-overlay" /></section>
      <section className="login-panel">
        <div className="login-form-wrap login-card">
          <div className="school-brand"><img className="institution-logo" src="/ictu-logo.png" alt="Biểu trưng ICTU" /><h1><span>Hệ Thống</span><span>Quản Lý Đào Tạo</span></h1></div>
          {forgot ? (
            <>
              <p className="eyebrow blue">KHÔI PHỤC TRUY CẬP</p>
              <h2>Quên mật khẩu</h2>
              {resetToken ? (
                <>
                  {resetLinkStatus === 'checking' ? (
                    <p className="form-intro" role="status">Đang kiểm tra liên kết đặt lại mật khẩu...</p>
                  ) : resetLinkStatus === 'invalid' ? (
                    <>
                      <p className="reset-request-error" role="alert">Liên kết đặt lại mật khẩu không còn hiệu lực. Liên kết chỉ dùng được một lần và hết hạn sau 30 phút.</p>
                      <button className="link-button back-link" onClick={() => { window.history.replaceState({}, '', window.location.pathname); setResetToken(''); setForgot(false) }}>← Quay lại đăng nhập</button>
                    </>
                  ) : resetLinkStatus === 'error' ? (
                    <>
                      <p className="reset-request-error" role="alert">Không thể xác thực liên kết lúc này. Vui lòng kiểm tra kết nối rồi tải lại trang.</p>
                      <button className="link-button back-link" onClick={() => window.location.reload()}>Thử lại</button>
                    </>
                  ) : (
                    <>
                      <p className="form-intro">Đặt mật khẩu mới cho tài khoản của bạn.</p>
                      {resetAccount && <p className="reset-account">Tài khoản: <strong>{resetAccount}</strong></p>}
                      <form onSubmit={submitReset} className="login-form" noValidate>
                        <label>Mật khẩu mới<PasswordInput value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={8} autoComplete="new-password" required /></label>
                        <label>Nhập lại mật khẩu mới<PasswordInput value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" required /></label>
                        <button className="primary-button full" type="submit" disabled={resettingPassword} aria-busy={resettingPassword}>
                          {resettingPassword && <ButtonSpinner />}
                          {resettingPassword ? 'Đang cập nhật mật khẩu...' : 'Đặt lại mật khẩu'}
                        </button>
                      </form>
                    </>
                  )}
                </>
              ) : (
                <>
                  <p className="form-intro reset-warning">
                    <svg className="reset-warning-icon" aria-hidden="true" viewBox="0 0 24 24">
                      <path d="M12 3.5 22 20.5H2L12 3.5Z" />
                      <path d="M12 9v5.5" />
                      <circle cx="12" cy="17.5" r=".7" />
                    </svg>
                    <span>Liên kết đặt lại mật khẩu có hiệu lực trong 30 phút.</span>
                  </p>
                  <form onSubmit={requestReset} className="login-form reset-request-form" noValidate>
                    <label>Email công việc<input name="email" type="email" value={resetEmail} onChange={(event) => { setResetEmail(event.target.value); setResetCooldown(readPasswordResetCooldown(event.target.value)); localStorage.setItem('tms_login_email', event.target.value); setResetNotice(''); setResetError('') }} disabled={sendingReset} required /></label>
                    <button className={`primary-button full reset-send-button${sendingReset ? ' is-sending' : ''}`} type="submit" disabled={sendingReset || resetCooldownRemaining > 0} aria-busy={sendingReset}>
                      {sendingReset && <ButtonSpinner />}
                      {sendingReset
                        ? 'Đang gửi liên kết...'
                        : resetCooldownRemaining > 0
                          ? `Gửi lại sau ${resetCooldownCountdown}`
                          : 'Gửi liên kết đặt lại'}
                    </button>
                    {resetNotice && resetCooldownRemaining > 0 && (
                      <p className="reset-request-notice" role="status">
                        {resetNotice} Không thấy thư? Kiểm tra Spam hoặc liên hệ quản trị viên.
                      </p>
                    )}
                    {resetError && <p className="reset-request-error" role="alert">{resetError}</p>}
                  </form>
                </>
              )}
              {notice && (
                <div className={`login-inline-notice ${noticeTone}`} role={noticeTone === 'error' ? 'alert' : 'status'}>
                  <span>{notice}</span>
                  <button type="button" onClick={onDismissNotice} aria-label="Đóng thông báo">×</button>
                </div>
              )}
              <button className="link-button back-link" disabled={sendingReset} onClick={() => { setForgot(false); setResetToken(''); setNewPassword(''); setConfirmPassword('') }}>← Quay lại đăng nhập</button>
            </>
          ) : (
            <>
              <p className="eyebrow blue">CHÀO MỪNG QUAY TRỞ LẠI</p>
              <h2>Đăng nhập</h2>
              <p className="form-intro">Đăng nhập để tiếp tục với không gian làm việc của bạn.</p>
              <form onSubmit={(event) => void submitLogin(event)} className="login-form" noValidate>
                <label>Email công việc<input name="email" type="email" value={email} onChange={(event) => { setEmail(event.target.value); localStorage.setItem('tms_login_email', event.target.value); onEmailChange(event.target.value); if (noticeTone === 'error') onDismissNotice() }} required /></label>
                <label>Mật khẩu<PasswordInput name="password" autoComplete="current-password" onChange={() => { if (noticeTone === 'error') onDismissNotice() }} required /></label>
                <button className="primary-button full login-submit" type="submit" disabled={lockRemaining > 0 || loginSubmitting} aria-busy={loginSubmitting}>
                  {loginSubmitting ? <ButtonSpinner /> : lockRemaining > 0 ? `Đang khóa · ${lockCountdown}` : 'Đăng nhập'}
                  {lockRemaining <= 0 && !loginSubmitting && <span>→</span>}
                </button>
              </form>
              {loginNotice && (
                <div className={`login-inline-notice login-lock-notice ${loginNoticeTone}`} role={loginNoticeTone === 'error' ? 'alert' : 'status'}>
                  <span>{loginNotice}</span>
                  {lockRemaining <= 0 && <button type="button" onClick={onDismissNotice} aria-label="Đóng thông báo">×</button>}
                </div>
              )}
              <nav className="login-links" aria-label="Hỗ trợ đăng nhập">
                <button className="link-button" onClick={() => { onDismissNotice(); setForgot(true) }}>Quên mật khẩu?</button>
                <a className="link-button" href="/register">Đăng ký tư vấn</a>
              </nav>
            </>
          )}
        </div>
      </section>
    </main>
  )
}

function PublicLeadPage() {
  const [form, setForm] = useState({ full_name: '', phone: '', email: '', program_interest: '', notes: '' })
  const [message, setMessage] = useState('')
  const [messageVersion, setMessageVersion] = useState(0)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    setMessage('')
    try {
      const data = new FormData(event.currentTarget)
      const result = await apiRequest<{ message: string }>('/leads/public', {
        method: 'POST',
        body: JSON.stringify({ ...form, source: 'website', website: String(data.get('website') ?? '') }),
      })
      setMessage(result.message)
      setMessageVersion((version) => version + 1)
      setForm({ full_name: '', phone: '', email: '', program_interest: '', notes: '' })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể gửi đăng ký tư vấn.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="error-screen public-lead-screen">
      <section className="modal public-lead-card">
        <p className="eyebrow blue">TƯ VẤN TUYỂN SINH</p>
        <h1>Đăng ký nhận tư vấn</h1>
        <p className="muted">Để lại thông tin, bộ phận tuyển sinh sẽ sớm liên hệ với bạn.</p>
        {message && createPortal(<TransientMessage key={`${messageVersion}-${message}`} message={message} />, document.body)}
        {error && createPortal(<TransientMessage key={`public-lead-error-${error}`} message={error} tone="error" />, document.body)}
        <form id="public-lead-form" className="stack" onSubmit={(event) => void submit(event)}>
          <label>Họ và tên<input value={form.full_name} onChange={(event) => setForm({ ...form, full_name: event.target.value })} placeholder="Ví dụ: Nguyễn Văn An" required /></label>
          <label>Số điện thoại<input type="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="Ví dụ: 0912345678" required /></label>
          <label>Email<input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="Ví dụ: an@example.com (không bắt buộc)" /></label>
          <label>Chương trình quan tâm<input value={form.program_interest} onChange={(event) => setForm({ ...form, program_interest: event.target.value })} placeholder="Tên khóa học muốn tìm hiểu, ví dụ: Lập trình Web" /><small className="field-hint">Nhập lĩnh vực hoặc khóa học bạn muốn được tư vấn; nếu chưa rõ, có thể để trống.</small></label>
          <label>Ghi chú<textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Ví dụ: Thời gian thuận tiện để liên hệ hoặc câu hỏi bạn muốn được giải đáp." /></label>
          <label className="lead-honeypot" aria-hidden="true">Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
        </form>
        <div className="public-lead-actions">
          <a className="link-button public-lead-back" href="/">
            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M19 12H5m7 7-7-7 7-7" /></svg>
            <span>Quay lại đăng nhập</span>
          </a>
          <button className="primary-button" type="submit" form="public-lead-form" disabled={submitting}>
            {submitting ? 'Đang gửi...' : 'Đăng ký'}
          </button>
        </div>
      </section>
    </main>
  )
}

function Overview({
  user,
  summary,
  onUsers,
  canViewUsers: showUsers,
  onModule,
}: {
  user: User
  summary: Summary | null
  onUsers: () => void
  canViewUsers: boolean
  onModule: (module: ModuleId) => void
}) {
  const accessibleModules = moduleOrder.filter((module) => permissionFor(user, module) !== null)
  return (
    <div className="view">
      <div className="page-heading">
        <div>
          <p className="eyebrow blue">KHÔNG GIAN {user.roles.length > 1 ? 'LÀM VIỆC' : roleLabels[user.roles[0] ?? user.role].toLocaleUpperCase('vi-VN')}</p>
          <h1>Xin chào, {user.full_name.split(' ').at(-1)}</h1>
          <p className="muted">{roleHomeMessages[user.roles[0] ?? user.role]} Vai trò: {user.roles.map((role) => roleLabels[role]).join(', ')}</p>
        </div>
        {showUsers && <button className="primary-button" onClick={onUsers}>Quản lý tài khoản <span>→</span></button>}
      </div>
      {summary && showUsers ? (
        <div className="stat-grid">
          <StatCard label="Tổng tài khoản" value={summary.total_users} detail="Trong hệ thống" icon="◎" tone="blue" />
          <StatCard label="Đang hoạt động" value={summary.active_users} detail="Tài khoản khả dụng" icon="✓" tone="green" />
          <StatCard label="Đang bị khóa" value={summary.locked_users} detail="Cần kiểm tra" icon="⊘" tone="orange" />
        </div>
      ) : (
        <section className="welcome-card role-welcome">
          <p className="eyebrow light">KHÔNG GIAN LÀM VIỆC</p>
          <h2>{roleLabels[user.roles[0] ?? user.role]}</h2>
          <p>{roleHomeMessages[user.roles[0] ?? user.role]}</p>
        </section>
      )}
      <section className="role-workspace">
        <div className="section-title"><div><h2>Chức năng theo quyền</h2><p className="muted">Các mục dưới đây được lọc theo vai trò của bạn.</p></div><span className="count-badge">{accessibleModules.length} mục</span></div>
        {accessibleModules.length > 0 ? (
          <div className="module-grid">
            {accessibleModules.map((module) => (
              <button className="module-card" key={module} onClick={() => onModule(module)}>
                <span className="module-icon">{moduleIcons[module]}</span>
                <span><strong>{moduleLabels[module]}</strong><small>Quyền: {permissionLabel(permissionFor(user, module))}</small></span>
                <span className="module-arrow">→</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="muted">Tài khoản chưa được cấp quyền truy cập module nghiệp vụ nào.</p>
        )}
      </section>
    </div>
  )
}

function permissionLabel(permission: 'R' | 'W' | 'F' | null) {
  if (permission === 'F') return 'Toàn quyền'
  if (permission === 'W') return 'Được ghi'
  if (permission === 'R') return 'Chỉ xem'
  return 'Không truy cập'
}

function ModuleLanding({ module, permission, canDeleteLeads }: { module: ModuleId; permission: 'R' | 'W' | 'F'; canDeleteLeads: boolean }) {
  type Program = {
    id: number
    code: string
    name: string
    description: string | null
    total_duration_hours: number
    standard_fee: number
    status: string
  }

  type Subject = {
    id: number
    code: string
    name: string
    session_count: number
    weight: number
    description: string | null
    learning_outcomes: string | null
  }

  type ProgramSubject = {
    id: number
    subject_id: number
    code: string
    name: string
    sequence_order: number
    prerequisite_subject_id: number | null
    prerequisite_name: string | null
    is_required: boolean
  }

  type SubjectSession = { id: number; sequence: number; title: string; objectives: string | null }
  type TrainingClassRecord = { id: number; name: string; status: 'planned' | 'running' | 'completed' | 'cancelled' }
  type CatalogPage<T> = { items: T[]; total: number; page: number; page_size: number }

  type LeadRecord = {
    id: number
    full_name: string
    phone: string
    email: string | null
    source: string
    status: string
    program_interest: string | null
    notes: string | null
    assigned_to_user_id: number | null
    assigned_to_name: string | null
    created_at: string
  }
  type LeadAssignee = { id: number; full_name: string }
  type LeadInteraction = { id: number; action: string; note: string; user_name: string; created_at: string }

  const [programs, setPrograms] = useState<Program[]>([])
  const [programTotal, setProgramTotal] = useState(0)
  const [programPage, setProgramPage] = useState(1)
  const [programPageSize, setProgramPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [programSearchInput, setProgramSearchInput] = useState('')
  const [programSearch, setProgramSearch] = useState('')
  const [loadingPrograms, setLoadingPrograms] = useState(false)
  const [loadingProgramDetails, setLoadingProgramDetails] = useState(false)
  const [selectedProgramId, setSelectedProgramId] = useState<number | null>(null)
  const [selectedProgramStatus, setSelectedProgramStatus] = useState<string | null>(null)
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [subjectTotal, setSubjectTotal] = useState(0)
  const [subjectPage, setSubjectPage] = useState(1)
  const [subjectPageSize, setSubjectPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [subjectSearchInput, setSubjectSearchInput] = useState('')
  const [subjectSearch, setSubjectSearch] = useState('')
  const [loadingSubjects, setLoadingSubjects] = useState(false)
  const [linkSubjectSearch, setLinkSubjectSearch] = useState('')
  const [linkSubjectOptions, setLinkSubjectOptions] = useState<Subject[]>([])
  const [loadingLinkSubjects, setLoadingLinkSubjects] = useState(false)
  const [cloneSubjectSearch, setCloneSubjectSearch] = useState('')
  const [cloneSubjectOptions, setCloneSubjectOptions] = useState<Subject[]>([])
  const [loadingCloneSubjects, setLoadingCloneSubjects] = useState(false)
  const [selectedSubjectId, setSelectedSubjectId] = useState<number | null>(null)
  const [subjectSessions, setSubjectSessions] = useState<SubjectSession[]>([])
  const [loadingSubjectSessions, setLoadingSubjectSessions] = useState(false)
  const [programSubjects, setProgramSubjects] = useState<ProgramSubject[]>([])
  const [trainingClasses, setTrainingClasses] = useState<TrainingClassRecord[]>([])
  const [className, setClassName] = useState('')
  const [leads, setLeads] = useState<LeadRecord[]>([])
  const [leadTotal, setLeadTotal] = useState(0)
  const [leadPage, setLeadPage] = useState(1)
  const [leadPageSize, setLeadPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [loadingLeads, setLoadingLeads] = useState(false)
  const [leadAssignees, setLeadAssignees] = useState<LeadAssignee[]>([])
  const [leadFilters, setLeadFilters] = useState({ q: '', status: '', source: '', assigned_to: '', from_date: '', to_date: '' })
  const [selectedLeadIds, setSelectedLeadIds] = useState<number[]>([])
  const [bulkAssigneeId, setBulkAssigneeId] = useState('')
  const [editingLeadId, setEditingLeadId] = useState<number | null>(null)
  const [duplicateWarning, setDuplicateWarning] = useState('')
  const [expandedLeadId, setExpandedLeadId] = useState<number | null>(null)
  const [leadInteractions, setLeadInteractions] = useState<LeadInteraction[]>([])
  const [interactionNote, setInteractionNote] = useState('')
  const [leadError, setLeadError] = useState('')
  const [retryingLeadConnection, setRetryingLeadConnection] = useState(false)
  const [programForm, setProgramForm] = useState({ code: '', name: '', description: '', total_duration_hours: '0', standard_fee: '0', status: 'active' })
  const [subjectForm, setSubjectForm] = useState({ code: '', name: '', session_count: '0', weight: '1', description: '', learning_outcomes: '' })
  const [editingProgramId, setEditingProgramId] = useState<number | null>(null)
  const [editingSubjectId, setEditingSubjectId] = useState<number | null>(null)
  type CatalogTab = 'programs' | 'create-program' | 'subjects' | 'create-subject' | 'sessions' | 'create-session' | 'clone-sessions' | 'program-details'
  const [catalogTab, setCatalogTab] = useState<CatalogTab>('programs')
  const [showLeadForm, setShowLeadForm] = useState(false)
  const [savingCatalogAction, setSavingCatalogAction] = useState('')
  const [programLinkForm, setProgramLinkForm] = useState({ subject_id: '', sequence_order: '1', prerequisite_subject_id: '', is_required: 'true' })
  const [leadForm, setLeadForm] = useState({ full_name: '', phone: '', email: '', source: 'website', program_interest: '', notes: '' })
  const [sessionForm, setSessionForm] = useState({ sequence: '1', title: '', objectives: '' })
  const [cloneSourceSubjectId, setCloneSourceSubjectId] = useState('')
  const [statusMessage, setStatusMessage] = useState('')
  const [statusTone, setStatusTone] = useState<'success' | 'error'>('success')
  const [statusVersion, setStatusVersion] = useState(0)

  async function finishCatalogAction(startedAt: number) {
    const remaining = CATALOG_ACTION_MINIMUM_MS - (Date.now() - startedAt)
    if (remaining > 0) await new Promise((resolve) => window.setTimeout(resolve, remaining))
    setSavingCatalogAction('')
  }

  function showStatus(message: string, tone: 'success' | 'error' = 'success') {
    setStatusTone(tone)
    setStatusMessage(message)
    setStatusVersion((version) => version + 1)
  }

  async function loadPrograms(page = programPage, query = programSearch, pageSize = programPageSize) {
    const startedAt = Date.now()
    setLoadingPrograms(true)
    try {
      const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) })
      if (query) params.set('q', query)
      const result = await apiRequest<CatalogPage<Program>>(`/training/programs?${params.toString()}`, { method: 'GET' })
      setPrograms(result.items)
      setProgramTotal(result.total)
      setProgramPage(Math.min(page, Math.max(1, Math.ceil(result.total / pageSize))))
      const selectedProgram = result.items.find((item) => item.id === selectedProgramId)
      if (selectedProgram) setSelectedProgramStatus(selectedProgram.status)
      if (!selectedProgramId && result.items[0]) {
        setSelectedProgramId(result.items[0].id)
        setSelectedProgramStatus(result.items[0].status)
      }
    } finally {
      const elapsed = Date.now() - startedAt
      if (elapsed < 1500) await new Promise((resolve) => setTimeout(resolve, 1500 - elapsed))
      setLoadingPrograms(false)
    }
  }

  async function loadSubjects(page = subjectPage, query = subjectSearch, pageSize = subjectPageSize) {
    const startedAt = Date.now()
    setLoadingSubjects(true)
    try {
      const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) })
      if (query) params.set('q', query)
      const result = await apiRequest<CatalogPage<Subject>>(`/training/subjects?${params.toString()}`, { method: 'GET' })
      setSubjects(result.items)
      setSubjectTotal(result.total)
      setSubjectPage(Math.min(page, Math.max(1, Math.ceil(result.total / pageSize))))
    } finally {
      const elapsed = Date.now() - startedAt
      if (elapsed < 1500) await new Promise((resolve) => setTimeout(resolve, 1500 - elapsed))
      setLoadingSubjects(false)
    }
  }

  async function searchLinkSubjects(query: string) {
    setLoadingLinkSubjects(true)
    try {
      const params = new URLSearchParams({ page: '1', page_size: String(DEFAULT_PAGE_SIZE) })
      if (query.trim()) params.set('q', query.trim())
      const result = await apiRequest<CatalogPage<Subject>>(`/training/subjects?${params.toString()}`, { method: 'GET' })
      setLinkSubjectOptions(result.items)
    } finally {
      setLoadingLinkSubjects(false)
    }
  }

  async function searchCloneSubjects(query: string) {
    setLoadingCloneSubjects(true)
    try {
      const params = new URLSearchParams({ page: '1', page_size: String(DEFAULT_PAGE_SIZE) })
      if (query.trim()) params.set('q', query.trim())
      const result = await apiRequest<CatalogPage<Subject>>(`/training/subjects?${params.toString()}`, { method: 'GET' })
      setCloneSubjectOptions(result.items)
    } finally {
      setLoadingCloneSubjects(false)
    }
  }

  async function loadProgramSubjects(programId: number) {
    const next = await apiRequest<ProgramSubject[]>(`/training/programs/${programId}/subjects`, { method: 'GET' })
    setProgramSubjects(next)
  }

  async function loadTrainingClasses(programId: number) {
    const next = await apiRequest<TrainingClassRecord[]>(`/training/programs/${programId}/classes`, { method: 'GET' })
    setTrainingClasses(next)
  }

  async function loadSubjectSessions(subjectId: number) {
    const next = await apiRequest<SubjectSession[]>(`/training/subjects/${subjectId}/sessions`, { method: 'GET' })
    setSubjectSessions(next)
  }

  async function loadLeads(filters = leadFilters, page = leadPage, pageSize = leadPageSize) {
    const startedAt = Date.now()
    setLoadingLeads(true)
    try {
      const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) })
      if (filters.q.trim()) params.set('q', filters.q.trim())
      if (filters.status) params.set('status', filters.status)
      if (filters.source) params.set('source', filters.source)
      if (filters.assigned_to) params.set('assigned_to', filters.assigned_to)
      if (filters.from_date) params.set('from_date', filters.from_date)
      if (filters.to_date) params.set('to_date', filters.to_date)
      const result = await apiRequest<CatalogPage<LeadRecord>>(`/leads?${params.toString()}`, { method: 'GET' })
      setLeads(result.items)
      setLeadTotal(result.total)
      setSelectedLeadIds((current) => current.filter((id) => result.items.some((lead) => lead.id === id)))
      setExpandedLeadId(null)
      setLeadInteractions([])
      setLeadPage(Math.min(page, Math.max(1, Math.ceil(result.total / pageSize))))
      setLeadError('')
    } finally {
      const elapsed = Date.now() - startedAt
      if (elapsed < 1500) await new Promise((resolve) => setTimeout(resolve, 1500 - elapsed))
      setLoadingLeads(false)
    }
  }

  async function retryLeadConnection() {
    if (retryingLeadConnection) return
    setRetryingLeadConnection(true)
    setLeadError('')
    try {
      await loadLeads()
      if (permission === 'F') {
        setLeadAssignees(await apiRequest<LeadAssignee[]>('/leads/assignees', { method: 'GET' }))
      }
    } catch (error) {
      setLeadError(error instanceof Error ? error.message : 'Không thể tải dữ liệu tuyển sinh.')
    } finally {
      setRetryingLeadConnection(false)
    }
  }

  useEffect(() => {
    if (module === 'leads') {
      void loadLeads(leadFilters, leadPage, leadPageSize).catch((error: Error) => setLeadError(error.message))
      if (permission === 'F') {
        apiRequest<LeadAssignee[]>('/leads/assignees', { method: 'GET' })
          .then(setLeadAssignees)
          .catch((error: Error) => setLeadError(error.message))
      }
    }
  }, [module, permission, leadPage, leadPageSize])

  useEffect(() => {
    if (module === 'courses') {
      void loadPrograms(programPage, programSearch).catch((error: Error) => showStatus(error.message, 'error'))
    }
  }, [module, programPage, programPageSize, programSearch])

  useEffect(() => {
    if (module === 'courses') {
      void loadSubjects(subjectPage, subjectSearch).catch((error: Error) => showStatus(error.message, 'error'))
    }
  }, [module, subjectPage, subjectPageSize, subjectSearch])

  useEffect(() => {
    if (module !== 'courses' || permission !== 'F') return
    const timeout = window.setTimeout(() => {
      void searchLinkSubjects(linkSubjectSearch).catch((error: Error) => showStatus(error.message, 'error'))
    }, 250)
    return () => window.clearTimeout(timeout)
  }, [module, permission, selectedProgramId, linkSubjectSearch])

  useEffect(() => {
    if (module !== 'courses' || permission !== 'F') return
    const timeout = window.setTimeout(() => {
      void searchCloneSubjects(cloneSubjectSearch).catch((error: Error) => showStatus(error.message, 'error'))
    }, 250)
    return () => window.clearTimeout(timeout)
  }, [module, permission, cloneSubjectSearch])

  useEffect(() => {
    if (module === 'courses' && selectedProgramId) {
      setLoadingProgramDetails(true)
      void Promise.all([
        loadProgramSubjects(selectedProgramId),
        loadTrainingClasses(selectedProgramId),
      ]).catch((error: Error) => showStatus(error.message, 'error'))
        .finally(() => setLoadingProgramDetails(false))
    }
  }, [module, selectedProgramId])

  useEffect(() => {
    if (module === 'courses' && selectedSubjectId) {
      setLoadingSubjectSessions(true)
      void loadSubjectSessions(selectedSubjectId)
        .catch((error: Error) => showStatus(error.message, 'error'))
        .finally(() => setLoadingSubjectSessions(false))
    }
  }, [module, selectedSubjectId])

  async function saveProgram(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const payload = {
      code: programForm.code,
      name: programForm.name,
      description: programForm.description,
      total_duration_hours: Number(programForm.total_duration_hours || 0),
      standard_fee: Number(programForm.standard_fee || 0),
      status: programForm.status,
    }
    const startedAt = Date.now()
    setSavingCatalogAction('program')
    try {
      await apiRequest(editingProgramId ? `/training/programs/${editingProgramId}` : '/training/programs', {
        method: editingProgramId ? 'PATCH' : 'POST',
        body: JSON.stringify(payload),
      })
      setProgramForm({ code: '', name: '', description: '', total_duration_hours: '0', standard_fee: '0', status: 'active' })
      showStatus(editingProgramId ? 'Đã cập nhật chương trình đào tạo.' : 'Đã lưu chương trình đào tạo.')
      if (editingProgramId === selectedProgramId) setSelectedProgramStatus(payload.status)
      setEditingProgramId(null)
      setCatalogTab('programs')
      await loadPrograms(programPage, programSearch)
    } catch (error) {
      showStatus(error instanceof Error ? error.message : 'Không thể lưu chương trình.', 'error')
    } finally {
      await finishCatalogAction(startedAt)
    }
  }

  function startCreateProgram() {
    setEditingProgramId(null)
    setProgramForm({ code: '', name: '', description: '', total_duration_hours: '0', standard_fee: '0', status: 'active' })
    setCatalogTab('create-program')
  }

  function editProgram(program: Program) {
    setEditingProgramId(program.id)
    setProgramForm({
      code: program.code,
      name: program.name,
      description: program.description ?? '',
      total_duration_hours: String(program.total_duration_hours),
      standard_fee: String(program.standard_fee),
      status: program.status,
    })
    setCatalogTab('create-program')
  }

  function openProgramDetails(program: Program) {
    setSelectedProgramId(program.id)
    setSelectedProgramStatus(program.status)
    setCatalogTab('program-details')
    void loadProgramSubjects(program.id)
    void loadTrainingClasses(program.id)
  }

  async function deleteProgram(program: Program) {
    if (!window.confirm(`Xóa chương trình ${program.name}? Các liên kết môn học và hồ sơ lớp không còn diễn ra sẽ bị xóa. Chương trình đang có lớp diễn ra không thể xóa.`)) return
    const startedAt = Date.now()
    setSavingCatalogAction(`delete-program-${program.id}`)
    try {
      await apiRequest(`/training/programs/${program.id}`, { method: 'DELETE' })
      showStatus('Đã xóa chương trình đào tạo.')
      if (selectedProgramId === program.id) {
        setSelectedProgramId(null)
        setSelectedProgramStatus(null)
        setProgramSubjects([])
        setTrainingClasses([])
      }
      if (editingProgramId === program.id) {
        setEditingProgramId(null)
        setProgramForm({ code: '', name: '', description: '', total_duration_hours: '0', standard_fee: '0', status: 'active' })
      }
      await loadPrograms()
    } catch (error) {
      showStatus(error instanceof Error ? error.message : 'Không thể xóa chương trình.', 'error')
    } finally {
      await finishCatalogAction(startedAt)
    }
  }

  async function saveSubject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const payload = {
      code: subjectForm.code,
      name: subjectForm.name,
      session_count: Number(subjectForm.session_count || 0),
      weight: Number(subjectForm.weight || 1),
      description: subjectForm.description,
      learning_outcomes: subjectForm.learning_outcomes,
    }
    const startedAt = Date.now()
    setSavingCatalogAction('subject')
    try {
      await apiRequest(editingSubjectId ? `/training/subjects/${editingSubjectId}` : '/training/subjects', {
        method: editingSubjectId ? 'PATCH' : 'POST',
        body: JSON.stringify(payload),
      })
      setSubjectForm({ code: '', name: '', session_count: '0', weight: '1', description: '', learning_outcomes: '' })
      showStatus(editingSubjectId ? 'Đã cập nhật môn học.' : 'Đã lưu môn học.')
      setEditingSubjectId(null)
      setCatalogTab('subjects')
      await loadSubjects(subjectPage, subjectSearch)
    } catch (error) {
      showStatus(error instanceof Error ? error.message : 'Không thể lưu môn học.', 'error')
    } finally {
      await finishCatalogAction(startedAt)
    }
  }

  function startCreateSubject() {
    setEditingSubjectId(null)
    setSubjectForm({ code: '', name: '', session_count: '0', weight: '1', description: '', learning_outcomes: '' })
    setCatalogTab('create-subject')
  }

  function editSubject(subject: Subject) {
    setEditingSubjectId(subject.id)
    setSubjectForm({
      code: subject.code,
      name: subject.name,
      session_count: String(subject.session_count),
      weight: String(subject.weight),
      description: subject.description ?? '',
      learning_outcomes: subject.learning_outcomes ?? '',
    })
    setCatalogTab('create-subject')
  }

  function openSubjectSessions(subject: Subject) {
    setSelectedSubjectId(subject.id)
    setCatalogTab('sessions')
    void loadSubjectSessions(subject.id)
  }

  async function deleteSubject(subject: Subject) {
    if (!window.confirm(`Xóa môn học ${subject.name}? Môn sẽ được gỡ khỏi tất cả chương trình và không thể xóa khi đang được dùng trong lớp diễn ra.`)) return
    const startedAt = Date.now()
    setSavingCatalogAction(`delete-subject-${subject.id}`)
    try {
      await apiRequest(`/training/subjects/${subject.id}`, { method: 'DELETE' })
      showStatus('Đã xóa môn học.')
      if (editingSubjectId === subject.id) {
        setEditingSubjectId(null)
        setSubjectForm({ code: '', name: '', session_count: '0', weight: '1', description: '', learning_outcomes: '' })
      }
      if (selectedSubjectId === subject.id) {
        setSelectedSubjectId(null)
        setSubjectSessions([])
      }
      await loadSubjects()
      if (selectedProgramId) await loadProgramSubjects(selectedProgramId)
    } catch (error) {
      showStatus(error instanceof Error ? error.message : 'Không thể xóa môn học.', 'error')
    } finally {
      await finishCatalogAction(startedAt)
    }
  }

  async function saveProgramSubject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedProgramId) return
    if (!programLinkForm.subject_id) {
      showStatus('Hãy chọn môn học cần gán.', 'error')
      return
    }
    const payload = {
      subject_id: Number(programLinkForm.subject_id),
      sequence_order: Number(programLinkForm.sequence_order || 1),
      prerequisite_subject_id: programLinkForm.prerequisite_subject_id ? Number(programLinkForm.prerequisite_subject_id) : null,
      is_required: programLinkForm.is_required === 'true',
    }
    const startedAt = Date.now()
    setSavingCatalogAction('link')
    try {
      await apiRequest(`/training/programs/${selectedProgramId}/subjects`, { method: 'POST', body: JSON.stringify(payload) })
      setProgramLinkForm({ subject_id: '', sequence_order: '1', prerequisite_subject_id: '', is_required: 'true' })
      showStatus('Đã gán môn học vào chương trình.')
      await loadProgramSubjects(selectedProgramId)
    } catch (error) {
      showStatus(error instanceof Error ? error.message : 'Không thể gán môn học vào chương trình.', 'error')
    } finally {
      await finishCatalogAction(startedAt)
    }
  }

  async function removeProgramSubject(item: ProgramSubject) {
    if (!selectedProgramId) return
    const startedAt = Date.now()
    setSavingCatalogAction(`remove-link-${item.id}`)
    try {
      await apiRequest(`/training/programs/${selectedProgramId}/subjects/${item.id}`, { method: 'DELETE' })
      await loadProgramSubjects(selectedProgramId)
      showStatus(`Đã gỡ ${item.name} khỏi chương trình.`)
    } catch (error) {
      showStatus(error instanceof Error ? error.message : 'Không thể gỡ môn học.', 'error')
    } finally {
      await finishCatalogAction(startedAt)
    }
  }

  async function persistProgramSubjectOrder(orderedItems: ProgramSubject[]) {
    if (!selectedProgramId) return
    const startedAt = Date.now()
    setSavingCatalogAction('reorder')
    try {
      await apiRequest(`/training/programs/${selectedProgramId}/subjects/order`, {
        method: 'PUT',
        body: JSON.stringify({ association_ids: orderedItems.map((item) => item.id) }),
      })
      await loadProgramSubjects(selectedProgramId)
      showStatus('Đã lưu thứ tự môn học.')
    } catch (error) {
      showStatus(error instanceof Error ? error.message : 'Không thể lưu thứ tự môn học.', 'error')
    } finally {
      await finishCatalogAction(startedAt)
    }
  }

  async function createTrainingClass(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedProgramId) return
    const startedAt = Date.now()
    setSavingCatalogAction('class')
    try {
      await apiRequest(`/training/programs/${selectedProgramId}/classes`, {
        method: 'POST',
        body: JSON.stringify({ name: className }),
      })
      setClassName('')
      await loadTrainingClasses(selectedProgramId)
      showStatus('Đã tạo lớp ở trạng thái chuẩn bị.')
    } catch (error) {
      showStatus(error instanceof Error ? error.message : 'Không thể tạo lớp.', 'error')
    } finally {
      await finishCatalogAction(startedAt)
    }
  }

  async function updateTrainingClass(classId: number, status: TrainingClassRecord['status']) {
    const startedAt = Date.now()
    setSavingCatalogAction(`class-status-${classId}`)
    try {
      await apiRequest(`/training/classes/${classId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      })
      if (selectedProgramId) await loadTrainingClasses(selectedProgramId)
      showStatus('Đã cập nhật trạng thái lớp.')
    } catch (error) {
      showStatus(error instanceof Error ? error.message : 'Không thể cập nhật trạng thái lớp.', 'error')
    } finally {
      await finishCatalogAction(startedAt)
    }
  }

  async function saveSubjectSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedSubjectId) return
    const startedAt = Date.now()
    setSavingCatalogAction('session')
    try {
      await apiRequest(`/training/subjects/${selectedSubjectId}/sessions`, {
        method: 'POST',
        body: JSON.stringify({
          sequence: Number(sessionForm.sequence),
          title: sessionForm.title,
          objectives: sessionForm.objectives,
        }),
      })
      setSessionForm({ sequence: String(subjectSessions.length + 2), title: '', objectives: '' })
      showStatus('Đã lưu buổi học.')
      await loadSubjectSessions(selectedSubjectId)
    } catch (error) {
      showStatus(error instanceof Error ? error.message : 'Không thể lưu buổi học.', 'error')
    } finally {
      await finishCatalogAction(startedAt)
    }
  }

  async function cloneSubjectSessions(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedSubjectId || !cloneSourceSubjectId) return
    const startedAt = Date.now()
    setSavingCatalogAction('clone')
    try {
      const result = await apiRequest<{ copied_count: number }>(`/training/subjects/${selectedSubjectId}/sessions/clone`, {
        method: 'POST',
        body: JSON.stringify({ source_subject_id: Number(cloneSourceSubjectId) }),
      })
      await loadSubjectSessions(selectedSubjectId)
      setCloneSourceSubjectId('')
      showStatus(`Đã sao chép ${result.copied_count} buổi học vào môn đích.`)
    } catch (error) {
      showStatus(error instanceof Error ? error.message : 'Không thể sao chép buổi học.', 'error')
    } finally {
      await finishCatalogAction(startedAt)
    }
  }

  async function submitLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLeadError('')
    setDuplicateWarning('')
    const wasEditing = editingLeadId !== null
    const payload = {
      full_name: leadForm.full_name,
      phone: leadForm.phone,
      email: leadForm.email,
      source: leadForm.source,
      program_interest: leadForm.program_interest,
      notes: leadForm.notes,
      website: '',
    }
    try {
      await apiRequest(editingLeadId ? `/leads/${editingLeadId}` : '/leads', {
        method: editingLeadId ? 'PATCH' : 'POST',
        body: JSON.stringify(payload),
      })
    } catch (error) {
      setLeadError(error instanceof Error ? error.message : 'Không thể gửi đăng ký tư vấn.')
      return
    }
    setLeadForm({ full_name: '', phone: '', email: '', source: 'website', program_interest: '', notes: '' })
    setEditingLeadId(null)
    setShowLeadForm(false)
    showStatus(wasEditing ? 'Đã cập nhật lead.' : 'Đã tạo lead và ghi nhận thông tin tư vấn.')
    if (wasEditing) {
      await loadLeads().catch((error: Error) => setLeadError(error.message))
    } else if (leadPage === 1) {
      await loadLeads(leadFilters, 1).catch((error: Error) => setLeadError(error.message))
    } else {
      setLeadPage(1)
    }
  }

  async function checkLeadDuplicate(phone: string, excludeId?: number) {
    if (!phone.trim()) {
      setDuplicateWarning('')
      return
    }
    const params = new URLSearchParams({ phone })
    if (excludeId) params.set('exclude_id', String(excludeId))
    try {
      const result = await apiRequest<{ duplicate: boolean }>(`/leads/duplicate-check?${params.toString()}`, { method: 'GET' })
      setDuplicateWarning(result.duplicate ? 'Số điện thoại này đã tồn tại trong danh sách lead.' : '')
    } catch (error) {
      setLeadError(error instanceof Error ? error.message : 'Không thể kiểm tra số điện thoại trùng.')
    }
  }

  async function editLead(lead: LeadRecord) {
    setEditingLeadId(lead.id)
    setShowLeadForm(true)
    setLeadForm({
      full_name: lead.full_name,
      phone: lead.phone,
      email: lead.email ?? '',
      source: lead.source,
      program_interest: lead.program_interest ?? '',
      notes: lead.notes ?? '',
    })
    setDuplicateWarning('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function removeLead(lead: LeadRecord) {
    if (!window.confirm(`Xóa lead của ${lead.full_name}? Thao tác này không thể hoàn tác.`)) return
    try {
      await apiRequest(`/leads/${lead.id}`, { method: 'DELETE' })
      setSelectedLeadIds((current) => current.filter((id) => id !== lead.id))
      showStatus('Đã xóa lead.')
      await loadLeads()
    } catch (error) {
      setLeadError(error instanceof Error ? error.message : 'Không thể xóa lead.')
    }
  }

  async function assignSelectedLeads(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (selectedLeadIds.length === 0) return
    try {
      await apiRequest<{ assigned_count: number }>('/leads/assign-bulk', {
        method: 'POST',
        body: JSON.stringify({
          lead_ids: selectedLeadIds,
          assigned_to_user_id: bulkAssigneeId || null,
        }),
      })
      setSelectedLeadIds([])
      showStatus('Đã phân công các lead đã chọn.')
      await loadLeads()
    } catch (error) {
      setLeadError(error instanceof Error ? error.message : 'Không thể phân công lead hàng loạt.')
    }
  }

  async function toggleLeadHistory(leadId: number) {
    if (expandedLeadId === leadId) {
      setExpandedLeadId(null)
      setLeadInteractions([])
      return
    }
    try {
      const history = await apiRequest<LeadInteraction[]>(`/leads/${leadId}/interactions`, { method: 'GET' })
      setLeadInteractions(history)
      setInteractionNote('')
      setExpandedLeadId(leadId)
    } catch (error) {
      setLeadError(error instanceof Error ? error.message : 'Không thể tải lịch sử trao đổi.')
    }
  }

  async function addLeadInteraction(event: FormEvent<HTMLFormElement>, leadId: number) {
    event.preventDefault()
    try {
      await apiRequest(`/leads/${leadId}/interactions`, {
        method: 'POST',
        body: JSON.stringify({ note: interactionNote }),
      })
      setInteractionNote('')
      const history = await apiRequest<LeadInteraction[]>(`/leads/${leadId}/interactions`, { method: 'GET' })
      setLeadInteractions(history)
    } catch (error) {
      setLeadError(error instanceof Error ? error.message : 'Không thể lưu ghi chú trao đổi.')
    }
  }

  async function updateLead(leadId: number, status: string) {
    try {
      await apiRequest(`/leads/${leadId}`, { method: 'PATCH', body: JSON.stringify({ status }) })
      await loadLeads()
      setLeadError('')
    } catch (error) {
      setLeadError(error instanceof Error ? error.message : 'Không thể cập nhật trạng thái lead.')
    }
  }

  async function assignLead(leadId: number, assignedTo: string) {
    try {
      await apiRequest(`/leads/${leadId}/assign`, {
        method: 'POST',
        body: JSON.stringify({ assigned_to_user_id: assignedTo || null }),
      })
      await loadLeads()
      setLeadError('')
    } catch (error) {
      setLeadError(error instanceof Error ? error.message : 'Không thể phân công lead.')
    }
  }

  if (module === 'courses') {
    const selectedProgram = programs.find((p) => p.id === selectedProgramId)
    const selectedSubject = subjects.find((s) => s.id === selectedSubjectId)

    return (
      <section className="courses-workspace-view">
        <TopbarNavPortal>
          <nav className="ops-tabs" role="tablist" aria-label="Danh mục đào tạo">
            <button
              type="button"
              className={catalogTab === 'programs' ? 'active selected' : ''}
              role="tab"
              aria-selected={catalogTab === 'programs'}
              onClick={() => setCatalogTab('programs')}
            >
              <span>📚 Danh sách chương trình</span>
              <span className="tab-pill-count">{programTotal.toLocaleString('vi-VN')}</span>
            </button>
            {catalogTab === 'create-program' && (
              <button
                type="button"
                className="active selected"
                role="tab"
                aria-selected="true"
              >
                <span>{editingProgramId ? `✏️ Sửa chương trình: ${programForm.name || programForm.code || ''}` : '➕ Thêm chương trình mới'}</span>
              </button>
            )}
            <button
              type="button"
              className={catalogTab === 'subjects' ? 'active selected' : ''}
              role="tab"
              aria-selected={catalogTab === 'subjects'}
              onClick={() => setCatalogTab('subjects')}
            >
              <span>📖 Danh sách môn học</span>
              <span className="tab-pill-count">{subjectTotal.toLocaleString('vi-VN')}</span>
            </button>
            {catalogTab === 'create-subject' && (
              <button
                type="button"
                className="active selected"
                role="tab"
                aria-selected="true"
              >
                <span>{editingSubjectId ? `✏️ Sửa môn học: ${subjectForm.name || subjectForm.code || ''}` : '➕ Thêm môn học mới'}</span>
              </button>
            )}
            {catalogTab === 'sessions' && (
              <button
                type="button"
                className="active selected"
                role="tab"
                aria-selected="true"
                onClick={() => setCatalogTab('sessions')}
              >
                <span>📅 Danh sách buổi: {selectedSubject ? selectedSubject.name : 'Môn học'}</span>
              </button>
            )}
            {catalogTab === 'create-session' && (
              <button
                type="button"
                className="active selected"
                role="tab"
                aria-selected="true"
              >
                <span>➕ Thêm buổi học mới</span>
              </button>
            )}
            {catalogTab === 'clone-sessions' && (
              <button
                type="button"
                className="active selected"
                role="tab"
                aria-selected="true"
              >
                <span>📋 Sao chép buổi học</span>
              </button>
            )}
            {catalogTab === 'program-details' && (
              <button
                type="button"
                className="active selected"
                role="tab"
                aria-selected="true"
              >
                <span>🔗 Chi tiết môn & Lớp</span>
              </button>
            )}
          </nav>
        </TopbarNavPortal>

        {statusMessage && <TransientMessage key={`${statusVersion}-${statusTone}-${statusMessage}`} message={statusMessage} tone={statusTone} />}

        {/* 1. VIEW DANH SÁCH CHƯƠNG TRÌNH */}
        {catalogTab === 'programs' && (
          <div className="card-panel">
            <div className="courses-page-header">
              <div>
                <h2>Danh sách chương trình đào tạo</h2>
                <p>{programTotal.toLocaleString('vi-VN')} chương trình đang hoạt động trong hệ thống</p>
              </div>
            </div>

            <div className="catalog-toolbar-row">
              <form className="catalog-search" onSubmit={(event) => {
                event.preventDefault()
                const query = programSearchInput.trim()
                if (programPage === 1 && query === programSearch) void loadPrograms(1, query).catch((error: Error) => showStatus(error.message, 'error'))
                setProgramSearch(query)
                setProgramPage(1)
              }}>
                <input type="search" aria-label="Tìm chương trình" placeholder="Tìm theo mã hoặc tên..." value={programSearchInput} onChange={(event) => setProgramSearchInput(event.target.value)} />
                <button className="catalog-search-button" type="submit" disabled={loadingPrograms}>
                  {loadingPrograms ? <><ButtonSpinner /> Đang tìm...</> : '🔍 Tìm kiếm'}
                </button>
              </form>
              {permission === 'F' && (
                <button className="primary-button catalog-add-btn" type="button" onClick={startCreateProgram}>
                  ➕ Thêm chương trình
                </button>
              )}
            </div>

            {loadingPrograms ? (
              <p className="catalog-loading" role="status"><ButtonSpinner /> Đang tải danh sách chương trình...</p>
            ) : programs.length === 0 ? (
              <p className="muted">{programSearch ? 'Không tìm thấy chương trình phù hợp.' : 'Chưa có chương trình nào.'}</p>
            ) : (
              <div className="management-table-wrap">
                <table className="management-table">
                  <thead>
                    <tr>
                      <th style={{ width: '60px', textAlign: 'center' }}>STT</th>
                      <th>Mã chương trình</th>
                      <th>Tên chương trình</th>
                      <th>Thời lượng</th>
                      <th>Học phí chuẩn</th>
                      <th>Trạng thái</th>
                      <th>Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {programs.map((program, index) => (
                      <tr key={program.id}>
                        <td style={{ textAlign: 'center', color: '#64748b', fontWeight: 500 }}>{(programPage - 1) * programPageSize + index + 1}</td>
                        <td>
                          <button
                            className="table-select-button"
                            type="button"
                            onClick={() => openProgramDetails(program)}
                            title="Bấm để xem môn học & lớp thuộc chương trình"
                          >
                            {program.code}
                          </button>
                        </td>
                        <td><strong>{program.name}</strong></td>
                        <td>{program.total_duration_hours.toLocaleString('vi-VN')} giờ</td>
                        <td>{program.standard_fee.toLocaleString('vi-VN')} VNĐ</td>
                        <td>
                          <span className={`catalog-status-pill ${program.status}`}>
                            {program.status === 'active' ? 'Đang áp dụng' : 'Tạm ngưng'}
                          </span>
                        </td>
                        <td>
                          <div className="row-actions">
                            <button
                              className="row-action"
                              type="button"
                              onClick={() => openProgramDetails(program)}
                              title="Xem chi tiết môn học & lớp học thuộc chương trình"
                            >
                              🔗 Môn & Lớp
                            </button>
                            {permission === 'F' && (
                              <>
                                <button className="row-action" type="button" onClick={() => editProgram(program)} disabled={savingCatalogAction !== ''}>
                                  ✏️ Sửa
                                </button>
                                <button className="row-action danger" type="button" onClick={() => void deleteProgram(program)} disabled={savingCatalogAction !== ''}>
                                  {savingCatalogAction === `delete-program-${program.id}` ? <><ButtonSpinner /> Đang xóa...</> : '🗑️ Xóa'}
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <CatalogPagination page={programPage} total={programTotal} pageSize={programPageSize} onChange={setProgramPage} onPageSizeChange={(size) => { setProgramPageSize(size); setProgramPage(1) }} label="chương trình" />
          </div>
        )}

        {/* 2. VIEW TẠO / SỬA CHƯƠNG TRÌNH (PHÂN TRANG RIÊNG) */}
        {catalogTab === 'create-program' && permission === 'F' && (
          <div className="card-panel courses-form-card">
            <div className="courses-page-header">
              <div>
                <h2>{editingProgramId ? 'Chỉnh sửa chương trình đào tạo' : 'Thêm mới chương trình đào tạo'}</h2>
                <p>Nhập thông tin chương trình chuẩn để áp dụng cho các lớp học</p>
              </div>
            </div>
            <form onSubmit={saveProgram}>
              <div className="courses-form-grid">
                <label>
                  Mã chương trình (bắt buộc)
                  <input value={programForm.code} onChange={(event) => setProgramForm({ ...programForm, code: event.target.value })} required placeholder="Ví dụ: CNTT-01" />
                </label>
                <label>
                  Tên chương trình (bắt buộc)
                  <input value={programForm.name} onChange={(event) => setProgramForm({ ...programForm, name: event.target.value })} required placeholder="Ví dụ: Công nghệ thông tin K23" />
                </label>
                <label>
                  Thời lượng chuẩn (giờ)
                  <input type="number" min="0" value={programForm.total_duration_hours} onChange={(event) => setProgramForm({ ...programForm, total_duration_hours: event.target.value })} />
                </label>
                <label>
                  Học phí chuẩn (VNĐ)
                  <input type="number" min="0" value={programForm.standard_fee} onChange={(event) => setProgramForm({ ...programForm, standard_fee: event.target.value })} />
                </label>
                <label className="full-span">
                  Trạng thái áp dụng
                  <select value={programForm.status} onChange={(event) => setProgramForm({ ...programForm, status: event.target.value })}>
                    <option value="active">Đang áp dụng</option>
                    <option value="inactive">Tạm ngưng</option>
                  </select>
                </label>
                <label className="full-span">
                  Mô tả chương trình
                  <textarea value={programForm.description} onChange={(event) => setProgramForm({ ...programForm, description: event.target.value })} placeholder="Thông tin tóm tắt về mục tiêu đào tạo, đối tượng học viên..." />
                </label>
              </div>
              <div className="courses-form-actions">
                <button className="secondary-button" type="button" onClick={() => setCatalogTab('programs')}>
                  Hủy & Quay lại
                </button>
                <button className={`primary-button catalog-submit-button${savingCatalogAction === 'program' ? ' is-saving' : ''}`} type="submit" disabled={savingCatalogAction !== ''} aria-busy={savingCatalogAction === 'program'}>
                  {savingCatalogAction === 'program' && <ButtonSpinner />}
                  {savingCatalogAction === 'program' ? 'Đang lưu chương trình...' : editingProgramId ? '✓ Lưu thay đổi' : '✓ Lưu chương trình mới'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* 3. VIEW DANH SÁCH MÔN HỌC */}
        {catalogTab === 'subjects' && (
          <div className="card-panel">
            <div className="courses-page-header">
              <div>
                <h2>Danh sách môn học & học phần</h2>
                <p>{subjectTotal.toLocaleString('vi-VN')} môn học trong danh mục đào tạo</p>
              </div>
            </div>

            <div className="catalog-toolbar-row">
              <form className="catalog-search" onSubmit={(event) => {
                event.preventDefault()
                const query = subjectSearchInput.trim()
                if (subjectPage === 1 && query === subjectSearch) void loadSubjects(1, query).catch((error: Error) => showStatus(error.message, 'error'))
                setSubjectSearch(query)
                setSubjectPage(1)
              }}>
                <input type="search" aria-label="Tìm môn học" placeholder="Tìm theo mã hoặc tên..." value={subjectSearchInput} onChange={(event) => setSubjectSearchInput(event.target.value)} />
                <button className="catalog-search-button" type="submit" disabled={loadingSubjects}>
                  {loadingSubjects ? <><ButtonSpinner /> Đang tìm...</> : '🔍 Tìm kiếm'}
                </button>
              </form>
              {permission === 'F' && (
                <button className="primary-button catalog-add-btn" type="button" onClick={startCreateSubject}>
                  ➕ Thêm môn học
                </button>
              )}
            </div>

            {loadingSubjects ? (
              <p className="catalog-loading" role="status"><ButtonSpinner /> Đang tải danh sách môn học...</p>
            ) : subjects.length === 0 ? (
              <p className="muted">{subjectSearch ? 'Không tìm thấy môn học phù hợp.' : 'Chưa có môn học nào.'}</p>
            ) : (
              <div className="management-table-wrap">
                <table className="management-table">
                  <thead>
                    <tr>
                      <th style={{ width: '60px', textAlign: 'center' }}>STT</th>
                      <th>Mã môn</th>
                      <th>Tên môn học</th>
                      <th>Số buổi</th>
                      <th>Trọng số</th>
                      <th>Cấu hình bài học</th>
                      <th>Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subjects.map((subject, index) => (
                      <tr key={subject.id}>
                        <td style={{ textAlign: 'center', color: '#64748b', fontWeight: 500 }}>{(subjectPage - 1) * subjectPageSize + index + 1}</td>
                        <td><strong>{subject.code}</strong></td>
                        <td>{subject.name}</td>
                        <td>{subject.session_count} buổi</td>
                        <td>{subject.weight}</td>
                        <td>
                          <button
                            className="primary-button"
                            type="button"
                            style={{ minHeight: '32px', padding: '0 12px', fontSize: '12px', borderRadius: '7px' }}
                            onClick={() => openSubjectSessions(subject)}
                            title="Bấm để mở trang danh sách chi tiết các buổi học của môn này"
                          >
                            👁️ Xem danh sách buổi ({subject.session_count})
                          </button>
                        </td>
                        <td>
                          <div className="row-actions">
                            {permission === 'F' && (
                              <>
                                <button className="row-action" type="button" onClick={() => editSubject(subject)} disabled={savingCatalogAction !== ''}>
                                  ✏️ Sửa
                                </button>
                                <button className="row-action danger" type="button" onClick={() => void deleteSubject(subject)} disabled={savingCatalogAction !== ''}>
                                  {savingCatalogAction === `delete-subject-${subject.id}` ? <><ButtonSpinner /> Đang xóa...</> : '🗑️ Xóa'}
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <CatalogPagination page={subjectPage} total={subjectTotal} pageSize={subjectPageSize} onChange={setSubjectPage} onPageSizeChange={(size) => { setSubjectPageSize(size); setSubjectPage(1) }} label="môn học" />
          </div>
        )}

        {/* 4. VIEW TẠO / SỬA MÔN HỌC (PHÂN TRANG RIÊNG) */}
        {catalogTab === 'create-subject' && permission === 'F' && (
          <div className="card-panel courses-form-card">
            <div className="courses-page-header">
              <div>
                <h2>{editingSubjectId ? 'Chỉnh sửa môn học' : 'Thêm mới môn học'}</h2>
                <p>Khai báo môn học mới, số buổi và kết quả chuẩn đầu ra</p>
              </div>
            </div>
            <form onSubmit={saveSubject}>
              <div className="courses-form-grid">
                <label>
                  Mã môn học (bắt buộc)
                  <input value={subjectForm.code} onChange={(event) => setSubjectForm({ ...subjectForm, code: event.target.value })} required placeholder="Ví dụ: WEB101" />
                </label>
                <label>
                  Tên môn học (bắt buộc)
                  <input value={subjectForm.name} onChange={(event) => setSubjectForm({ ...subjectForm, name: event.target.value })} required placeholder="Ví dụ: Lập trình Web căn bản" />
                </label>
                <label>
                  Số buổi học
                  <input type="number" min="0" value={subjectForm.session_count} onChange={(event) => setSubjectForm({ ...subjectForm, session_count: event.target.value })} />
                </label>
                <label>
                  Trọng số môn
                  <input type="number" min="1" value={subjectForm.weight} onChange={(event) => setSubjectForm({ ...subjectForm, weight: event.target.value })} />
                </label>
                <label className="full-span">
                  Mô tả môn học
                  <textarea value={subjectForm.description} onChange={(event) => setSubjectForm({ ...subjectForm, description: event.target.value })} placeholder="Nội dung tổng quan của môn..." />
                </label>
                <label className="full-span">
                  Kết quả đầu ra (Learning Outcomes)
                  <textarea value={subjectForm.learning_outcomes} onChange={(event) => setSubjectForm({ ...subjectForm, learning_outcomes: event.target.value })} placeholder="Kiến thức và kỹ năng sinh viên đạt được sau môn học..." />
                </label>
              </div>
              <div className="courses-form-actions">
                <button className="secondary-button" type="button" onClick={() => setCatalogTab('subjects')}>
                  Hủy & Quay lại
                </button>
                <button className={`primary-button catalog-submit-button${savingCatalogAction === 'subject' ? ' is-saving' : ''}`} type="submit" disabled={savingCatalogAction !== ''} aria-busy={savingCatalogAction === 'subject'}>
                  {savingCatalogAction === 'subject' && <ButtonSpinner />}
                  {savingCatalogAction === 'subject' ? 'Đang lưu môn học...' : editingSubjectId ? '✓ Lưu thay đổi' : '✓ Lưu môn học mới'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* 5. VIEW XEM DANH SÁCH BUỔI HỌC CỦA MÔN (PHÂN TRANG RIÊNG BIỆT - HÌNH 3) */}
        {catalogTab === 'sessions' && (
          <div className="card-panel">
            <div className="courses-page-header">
              <div>
                <h2>Danh sách buổi học của môn: {selectedSubject ? `${selectedSubject.code} · ${selectedSubject.name}` : 'Môn học'}</h2>
                <p>{subjectSessions.length} buổi học chi tiết đã được cấu hình cho môn học này</p>
              </div>
              <div className="courses-page-actions" style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <button
                  className="secondary-button"
                  type="button"
                  style={{ padding: '5px 12px', fontSize: '13px', height: '32px', borderRadius: '7px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                  onClick={() => setCatalogTab('subjects')}
                  title="Quay lại danh sách môn học"
                >
                  ← Quay lại
                </button>
                {permission === 'F' && (
                  <>
                    <button className="secondary-button" type="button" onClick={() => setCatalogTab('clone-sessions')}>
                      📋 Sao chép từ môn khác
                    </button>
                    <button className="primary-button" type="button" onClick={() => setCatalogTab('create-session')}>
                      ➕ Thêm buổi học mới
                    </button>
                  </>
                )}
              </div>
            </div>

            {loadingSubjectSessions ? (
              <p className="catalog-loading" role="status"><ButtonSpinner /> Đang tải danh sách buổi học...</p>
            ) : subjectSessions.length > 0 ? (
              <div className="management-table-wrap">
                <table className="management-table sessions-view-table">
                  <thead>
                    <tr>
                      <th style={{ width: '60px', textAlign: 'center' }}>STT</th>
                      <th style={{ width: '130px' }}>Thứ tự</th>
                      <th style={{ width: '280px' }}>Tên buổi học</th>
                      <th>Mục tiêu buổi học (Learning Objectives)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {subjectSessions.map((session, index) => (
                      <tr key={session.id}>
                        <td style={{ textAlign: 'center', color: '#64748b', fontWeight: 500 }}>{index + 1}</td>
                        <td><span className="session-seq-badge">Buổi {session.sequence}</span></td>
                        <td><strong>{session.title}</strong></td>
                        <td><span style={{ color: '#475569', fontSize: '13.5px' }}>{session.objectives || '—'}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-notice-card" style={{ padding: '48px 20px', textAlign: 'center', background: '#f8fafc', borderRadius: '12px', border: '1px dashed #cbd5e1' }}>
                <p style={{ fontSize: '15px', color: '#64748b', margin: 0 }}>Môn học này hiện chưa có buổi học nào.</p>
              </div>
            )}
          </div>
        )}

        {/* 5B. VIEW THÊM BUỔI HỌC MỚI (TRANG FORM CHUYÊN BIỆT RIÊNG - HÌNH 3) */}
        {catalogTab === 'create-session' && permission === 'F' && (
          <div className="card-panel courses-form-card">
            <div className="courses-page-header">
              <div>
                <h2>Thêm buổi học mới · Môn: {selectedSubject ? `${selectedSubject.code} - ${selectedSubject.name}` : ''}</h2>
                <p>Nhập số thứ tự, tên buổi học và các mục tiêu kiến thức chuẩn đầu ra</p>
              </div>
            </div>
            <form onSubmit={(event) => void saveSubjectSession(event)}>
              <div className="courses-form-grid">
                <label>
                  Thứ tự buổi học (bắt buộc)
                  <input type="number" min="1" value={sessionForm.sequence} onChange={(event) => setSessionForm({ ...sessionForm, sequence: event.target.value })} required />
                </label>
                <label>
                  Tên buổi học (bắt buộc)
                  <input value={sessionForm.title} onChange={(event) => setSessionForm({ ...sessionForm, title: event.target.value })} required placeholder="Ví dụ: Giới thiệu cú pháp JavaScript căn bản" />
                </label>
                <label className="full-span">
                  Mục tiêu buổi học (Learning Objectives)
                  <textarea value={sessionForm.objectives} onChange={(event) => setSessionForm({ ...sessionForm, objectives: event.target.value })} placeholder="Kiến thức/kỹ năng trọng tâm trong buổi học..." rows={4} />
                </label>
              </div>
              <div className="courses-form-actions">
                <button className="secondary-button" type="button" onClick={() => setCatalogTab('sessions')}>
                  Hủy & Quay lại
                </button>
                <button className={`primary-button catalog-submit-button${savingCatalogAction === 'session' ? ' is-saving' : ''}`} type="submit" disabled={savingCatalogAction !== ''} aria-busy={savingCatalogAction === 'session'}>
                  {savingCatalogAction === 'session' && <ButtonSpinner />}
                  {savingCatalogAction === 'session' ? 'Đang thêm buổi...' : '✓ Lưu buổi học'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* 5C. VIEW SAO CHÉP BUỔI HỌC (TRANG FORM CHUYÊN BIỆT RIÊNG - HÌNH 3) */}
        {catalogTab === 'clone-sessions' && permission === 'F' && (
          <div className="card-panel courses-form-card">
            <div className="courses-page-header">
              <div>
                <h2>Sao chép khung buổi học sang môn: {selectedSubject ? `${selectedSubject.code} - ${selectedSubject.name}` : ''}</h2>
                <p>Sao chép toàn bộ danh mục các buổi học từ một môn học nguồn có sẵn trong hệ thống</p>
              </div>
            </div>
            <form onSubmit={(event) => void cloneSubjectSessions(event)}>
              <div className="courses-form-grid">
                <label className="full-span">
                  Tìm kiếm môn học nguồn
                  <input type="search" value={cloneSubjectSearch} onChange={(event) => setCloneSubjectSearch(event.target.value)} placeholder="Nhập mã hoặc tên môn nguồn..." />
                </label>
                <label className="full-span">
                  Chọn môn học nguồn để sao chép
                  <select value={cloneSourceSubjectId} onChange={(event) => setCloneSourceSubjectId(event.target.value)} disabled={loadingCloneSubjects} required>
                    <option value="">-- Chọn môn nguồn --</option>
                    {cloneSubjectOptions.filter((s) => s.id !== selectedSubjectId).map((s) => (
                      <option key={s.id} value={String(s.id)}>{s.code} · {s.name} ({s.session_count} buổi)</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="courses-form-actions">
                <button className="secondary-button" type="button" onClick={() => setCatalogTab('sessions')}>
                  Hủy & Quay lại
                </button>
                <button className={`primary-button catalog-submit-button${savingCatalogAction === 'clone' ? ' is-saving' : ''}`} type="submit" disabled={savingCatalogAction !== '' || loadingCloneSubjects || !cloneSourceSubjectId} aria-busy={savingCatalogAction === 'clone'}>
                  {savingCatalogAction === 'clone' && <ButtonSpinner />}
                  {savingCatalogAction === 'clone' ? 'Đang sao chép...' : '📋 Sao chép toàn bộ buổi'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* 6. VIEW CHI TIẾT MÔN VÀ LỚP CỦA CHƯƠNG TRÌNH (PHÂN TRANG RIÊNG) */}
        {catalogTab === 'program-details' && (
          <div className="card-panel">
            <div className="courses-page-header">
              <div>
                <h2>Chi tiết chương trình: {selectedProgram ? `${selectedProgram.code} · ${selectedProgram.name}` : 'Chương trình đào tạo'}</h2>
                <p>Quản lý danh mục môn học thuộc khung chương trình và các lớp đào tạo đã mở</p>
              </div>
              <button className="secondary-button" type="button" style={{ padding: '5px 12px', fontSize: '13px', height: '32px', borderRadius: '7px' }} onClick={() => setCatalogTab('programs')}>
                ← Quay lại
              </button>
            </div>

            <div className="two-column-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1fr)', gap: '24px' }}>
              {/* Cột 1: Môn học trong chương trình */}
              <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px' }}>
                <h3 style={{ margin: '0 0 14px', fontSize: '17px', color: '#1e293b' }}>
                  Khung môn học ({programSubjects.length} môn)
                </h3>
                {selectedProgramId && permission === 'F' && (
                  <form onSubmit={saveProgramSubject} style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px', padding: '14px', background: '#f8fafc', borderRadius: '8px' }}>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12.5px', fontWeight: 600 }}>
                      Gán môn học vào chương trình:
                      <input
                        type="search"
                        placeholder="Tìm môn học để gán..."
                        value={linkSubjectSearch}
                        onChange={(event) => setLinkSubjectSearch(event.target.value)}
                        style={{ marginBottom: '6px' }}
                      />
                      <select value={programLinkForm.subject_id} onChange={(event) => setProgramLinkForm({ ...programLinkForm, subject_id: event.target.value })} disabled={loadingLinkSubjects} required>
                        <option value="">-- Chọn môn học cần gán --</option>
                        {linkSubjectOptions.filter((subject) => !programSubjects.some((link) => link.subject_id === subject.id)).map((subject) => (
                          <option key={subject.id} value={String(subject.id)}>{subject.code} · {subject.name}</option>
                        ))}
                      </select>
                    </label>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                      <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12.5px', fontWeight: 600 }}>
                        Thứ tự học
                        <input type="number" min="1" value={programLinkForm.sequence_order} onChange={(event) => setProgramLinkForm({ ...programLinkForm, sequence_order: event.target.value })} />
                      </label>
                      <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '12.5px', fontWeight: 600 }}>
                        Bắt buộc
                        <select value={programLinkForm.is_required} onChange={(event) => setProgramLinkForm({ ...programLinkForm, is_required: event.target.value })}>
                          <option value="true">Bắt buộc</option>
                          <option value="false">Tự chọn</option>
                        </select>
                      </label>
                    </div>
                    <button className={`primary-button catalog-submit-button${savingCatalogAction === 'link' ? ' is-saving' : ''}`} type="submit" disabled={savingCatalogAction !== '' || loadingLinkSubjects || !programLinkForm.subject_id} aria-busy={savingCatalogAction === 'link'}>
                      {savingCatalogAction === 'link' && <ButtonSpinner />}
                      {savingCatalogAction === 'link' ? 'Đang gán môn...' : '➕ Gán môn học vào khung'}
                    </button>
                  </form>
                )}

                <div className="curriculum-list-scroll">
                  {loadingProgramDetails ? (
                    <p className="catalog-loading" role="status"><ButtonSpinner /> Đang tải môn trong chương trình...</p>
                  ) : programSubjects.length > 0 ? (
                    [...programSubjects].sort((a, b) => a.sequence_order - b.sequence_order).map((item, idx, arr) => (
                      <div key={item.id} className="curriculum-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', border: '1px solid #e2e8f0', borderRadius: '8px', marginBottom: '8px' }}>
                        <div>
                          <strong>{item.sequence_order}. {item.name}</strong>
                          <small style={{ display: 'block', color: '#64748b' }}>{item.is_required ? 'Bắt buộc' : 'Tự chọn'}{item.prerequisite_name ? ` · Tiên quyết: ${item.prerequisite_name}` : ''}</small>
                        </div>
                        {permission === 'F' && (
                          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                            <button
                              type="button"
                              className="row-action"
                              disabled={idx === 0 || savingCatalogAction !== ''}
                              onClick={() => {
                                const next = [...arr]
                                const prev = next[idx - 1]
                                next[idx - 1] = item
                                next[idx] = prev
                                void persistProgramSubjectOrder(next)
                              }}
                              title="Di chuyển lên trên"
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              className="row-action"
                              disabled={idx === arr.length - 1 || savingCatalogAction !== ''}
                              onClick={() => {
                                const next = [...arr]
                                const nxt = next[idx + 1]
                                next[idx + 1] = item
                                next[idx] = nxt
                                void persistProgramSubjectOrder(next)
                              }}
                              title="Di chuyển xuống dưới"
                            >
                              ↓
                            </button>
                            <button className="row-action danger" type="button" onClick={() => void removeProgramSubject(item)} disabled={savingCatalogAction !== ''}>
                              {savingCatalogAction === `remove-link-${item.id}` ? <><ButtonSpinner /> Đang gỡ...</> : 'Gỡ'}
                            </button>
                          </div>
                        )}
                      </div>
                    ))
                  ) : (
                    <p className="muted">Chưa có môn nào được gắn cho chương trình này.</p>
                  )}
                </div>
              </div>

              {/* Cột 2: Các lớp học thuộc chương trình */}
              <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px' }}>
                <h3 style={{ margin: '0 0 14px', fontSize: '17px', color: '#1e293b' }}>
                  Lớp học mở từ chương trình này ({trainingClasses.length} lớp)
                </h3>
                {permission === 'F' && (
                  <form onSubmit={(event) => void createTrainingClass(event)} style={{ display: 'flex', gap: '10px', marginBottom: '16px' }}>
                    <input style={{ flex: '1 1 auto' }} value={className} onChange={(event) => setClassName(event.target.value)} maxLength={200} placeholder="Nhập tên lớp mới (Ví dụ: CNTT-K23A)..." required />
                    <button className={`primary-button catalog-submit-button${savingCatalogAction === 'class' ? ' is-saving' : ''}`} type="submit" disabled={savingCatalogAction !== '' || selectedProgramStatus !== 'active'} aria-busy={savingCatalogAction === 'class'}>
                      {savingCatalogAction === 'class' && <ButtonSpinner />}
                      {savingCatalogAction === 'class' ? 'Đang tạo...' : 'Mở lớp'}
                    </button>
                  </form>
                )}

                {loadingProgramDetails ? (
                  <p className="catalog-loading" role="status"><ButtonSpinner /> Đang tải lớp...</p>
                ) : trainingClasses.length > 0 ? (
                  <div className="list-stack" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {trainingClasses.map((tc) => (
                      <div key={tc.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                        <strong>{tc.name}</strong>
                        {permission === 'F' ? (
                          <select value={tc.status} disabled={savingCatalogAction !== ''} onChange={(event) => void updateTrainingClass(tc.id, event.target.value as TrainingClassRecord['status'])}>
                            <option value="planned">Chuẩn bị</option>
                            <option value="running">Đang diễn ra</option>
                            <option value="completed">Đã kết thúc</option>
                            <option value="cancelled">Đã hủy</option>
                          </select>
                        ) : (
                          <small>{tc.status === 'planned' ? 'Chuẩn bị' : tc.status === 'running' ? 'Đang diễn ra' : tc.status === 'completed' ? 'Đã kết thúc' : 'Đã hủy'}</small>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="muted">Chưa có lớp nào được mở từ chương trình này.</p>
                )}
              </div>
            </div>
          </div>
        )}
      </section>
    )
  }

  if (module === 'leads') {
    return (
      <section className="module-landing stack lead-landing">
        <div className="module-icon">{moduleIcons[module]}</div>
        <p className="eyebrow blue">ĐẦU PHỄU TUYỂN SINH</p>
        <h1>{moduleLabels[module]}</h1>
        <p>Bạn được cấp quyền <strong>{permissionLabel(permission)}</strong> cho chức năng này.</p>
        {leadError && (
          <div className="form-error lead-error-banner" role="alert">
            <span>{leadError}</span>
            {leadError.includes('Không thể kết nối') && (
              <button className="secondary-button" type="button" onClick={() => void retryLeadConnection()} disabled={retryingLeadConnection}>
                {retryingLeadConnection ? 'Đang kết nối...' : 'Thử kết nối lại'}
              </button>
            )}
          </div>
        )}
        {statusMessage && <TransientMessage key={`${statusVersion}-${statusTone}-${statusMessage}`} message={statusMessage} tone={statusTone} />}
        {permission === 'F' && <p><a href="/register" target="_blank" rel="noreferrer">Mở form đăng ký tư vấn công khai ↗</a></p>}
        <div className="lead-workspace-grid">
          {(permission === 'F' || permission === 'W') && <details className="lead-form-disclosure" open={showLeadForm} onToggle={(event) => setShowLeadForm(event.currentTarget.open)}>
            <summary>{editingLeadId ? 'Chỉnh sửa lead' : 'Tạo lead mới'}</summary>
            <form className="card-panel lead-create-form" onSubmit={submitLead}>
            <label>Họ tên<input value={leadForm.full_name} onChange={(event) => setLeadForm({ ...leadForm, full_name: event.target.value })} placeholder="Ví dụ: Nguyễn Văn An" /></label>
            <label>Số điện thoại<input value={leadForm.phone} onChange={(event) => { setLeadForm({ ...leadForm, phone: event.target.value }); setDuplicateWarning('') }} onBlur={() => void checkLeadDuplicate(leadForm.phone, editingLeadId ?? undefined)} placeholder="Ví dụ: 0912345678" /></label>
            {duplicateWarning && <div className="form-error" role="alert">{duplicateWarning}</div>}
            <label>Email<input type="email" value={leadForm.email} onChange={(event) => setLeadForm({ ...leadForm, email: event.target.value })} placeholder="Ví dụ: an@example.com (không bắt buộc)" /></label>
            <label>Chương trình quan tâm<input value={leadForm.program_interest} onChange={(event) => setLeadForm({ ...leadForm, program_interest: event.target.value })} placeholder="Khóa học muốn tìm hiểu, ví dụ: Lập trình Web" /><small className="field-hint">Ghi tên khóa học/lĩnh vực khách muốn tư vấn; chưa rõ thì có thể để trống.</small></label>
            <label>Nguồn<select value={leadForm.source} onChange={(event) => setLeadForm({ ...leadForm, source: event.target.value })}><option value="website">Website</option><option value="facebook">Facebook</option><option value="walkin">Tự đến</option><option value="referral">Giới thiệu</option></select></label>
            <label>Ghi chú<textarea value={leadForm.notes} onChange={(event) => setLeadForm({ ...leadForm, notes: event.target.value })} placeholder="Ví dụ: Thời gian thuận tiện để liên hệ hoặc nội dung cần tư vấn." /></label>
            <div className="inline-row">
              <button className="primary-button" type="submit">{editingLeadId ? 'Lưu chỉnh sửa' : 'Tạo lead'}</button>
              {editingLeadId && <button className="secondary-button" type="button" onClick={() => { setEditingLeadId(null); setShowLeadForm(false); setLeadForm({ full_name: '', phone: '', email: '', source: 'website', program_interest: '', notes: '' }); setDuplicateWarning('') }}>Hủy sửa</button>}
            </div>
            </form>
          </details>}

          <div className="card-panel lead-list-panel">
            <div className="catalog-panel-heading">
              <div><h3>Danh sách lead</h3><p className="muted">{leadTotal.toLocaleString('vi-VN')} khách hàng tiềm năng</p></div>
              <span className="count-badge">Trang {leadPage}</span>
            </div>
            <form className="lead-filters" onSubmit={(event) => { event.preventDefault(); setSelectedLeadIds([]); if (leadPage === 1) void loadLeads(leadFilters, 1).catch((error: Error) => setLeadError(error.message)); else setLeadPage(1) }}>
              <div className="lead-primary-search">
                <label htmlFor="lead-search">Tìm theo tên, số điện thoại hoặc email</label>
                <input id="lead-search" placeholder="Nhập thông tin khách hàng cần tìm" value={leadFilters.q} onChange={(event) => setLeadFilters({ ...leadFilters, q: event.target.value })} />
                <div className="lead-search-actions">
                  <button className="secondary-button" type="submit" disabled={loadingLeads}>{loadingLeads ? <><ButtonSpinner /> Đang tìm...</> : 'Tìm kiếm'}</button>
                  <button className="lead-clear-filters" type="button" onClick={() => {
                  const clearedFilters = { q: '', status: '', source: '', assigned_to: '', from_date: '', to_date: '' }
                  setLeadFilters(clearedFilters)
                  setSelectedLeadIds([])
                  if (leadPage === 1) void loadLeads(clearedFilters, 1).catch((error: Error) => setLeadError(error.message))
                  else setLeadPage(1)
                  }}>Xóa bộ lọc</button>
                </div>
              </div>
              <details className="lead-advanced-filters">
                <summary>Lọc nâng cao · {(leadFilters.status ? 1 : 0) + (leadFilters.source ? 1 : 0) + (leadFilters.assigned_to ? 1 : 0) + (leadFilters.from_date ? 1 : 0) + (leadFilters.to_date ? 1 : 0)} đang áp dụng</summary>
                <div className="lead-advanced-grid">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <span style={{ fontSize: '12.5px', fontWeight: 600 }}>Trạng thái</span>
                    <SearchableSelect
                      value={leadFilters.status}
                      onChange={(val: string) => setLeadFilters({ ...leadFilters, status: val })}
                      placeholder="Tất cả trạng thái"
                      options={[
                        { value: '', label: 'Tất cả trạng thái' },
                        { value: 'new', label: 'Mới' },
                        { value: 'assigned', label: 'Đã phân công' },
                        { value: 'contacted', label: 'Đã liên hệ' },
                        { value: 'qualified', label: 'Tiềm năng' },
                        { value: 'converted', label: 'Đã đăng ký' },
                        { value: 'lost', label: 'Không tiếp tục' },
                      ]}
                      pageSize={5}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <span style={{ fontSize: '12.5px', fontWeight: 600 }}>Nguồn</span>
                    <SearchableSelect
                      value={leadFilters.source}
                      onChange={(val: string) => setLeadFilters({ ...leadFilters, source: val })}
                      placeholder="Tất cả nguồn"
                      options={[
                        { value: '', label: 'Tất cả nguồn' },
                        { value: 'website', label: 'Website' },
                        { value: 'facebook', label: 'Facebook' },
                        { value: 'walkin', label: 'Khách trực tiếp' },
                        { value: 'referral', label: 'Giới thiệu' },
                      ]}
                      pageSize={5}
                    />
                  </div>
                  {permission === 'F' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <span style={{ fontSize: '12.5px', fontWeight: 600 }}>Người phụ trách</span>
                      <SearchableSelect
                        value={leadFilters.assigned_to}
                        onChange={(val: string) => setLeadFilters({ ...leadFilters, assigned_to: val })}
                        placeholder="Tất cả người phụ trách"
                        options={[
                          { value: '', label: 'Tất cả người phụ trách' },
                          ...leadAssignees.map((assignee) => ({ value: String(assignee.id), label: assignee.full_name }))
                        ]}
                        pageSize={5}
                      />
                    </div>
                  )}
                  <label>Từ ngày<input type="date" value={leadFilters.from_date} onChange={(event) => setLeadFilters({ ...leadFilters, from_date: event.target.value })} /></label>
                  <label>Đến ngày<input type="date" value={leadFilters.to_date} onChange={(event) => setLeadFilters({ ...leadFilters, to_date: event.target.value })} /></label>
                  <button className="secondary-button" type="submit" disabled={loadingLeads}>{loadingLeads ? 'Đang lọc...' : 'Áp dụng bộ lọc'}</button>
                </div>
              </details>
            </form>
            {permission === 'F' && <form className="inline-row lead-bulk-assign" onSubmit={(event) => void assignSelectedLeads(event)}>
              <span>{selectedLeadIds.length} lead đã chọn</span>
              <label className="lead-select-checkbox"><input type="checkbox" checked={leads.length > 0 && leads.every((lead) => selectedLeadIds.includes(lead.id))} onChange={(event) => setSelectedLeadIds((current) => event.target.checked ? [...new Set([...current, ...leads.map((lead) => lead.id)])] : current.filter((id) => !leads.some((lead) => lead.id === id)))} />Chọn tất cả ở trang này</label>
              <label>Phân công cho<select value={bulkAssigneeId} onChange={(event) => setBulkAssigneeId(event.target.value)} required><option value="">-- Chọn tư vấn viên --</option>{leadAssignees.map((assignee) => <option key={assignee.id} value={String(assignee.id)}>{assignee.full_name}</option>)}</select></label>
              <button className="secondary-button" type="submit" disabled={selectedLeadIds.length === 0}>Phân công hàng loạt</button>
            </form>}
            {loadingLeads ? <p className="catalog-loading" role="status"><ButtonSpinner /> Đang tải danh sách lead...</p> : leads.length === 0 ? <p className="muted">{leadFilters.q || leadFilters.status || leadFilters.source || leadFilters.assigned_to || leadFilters.from_date || leadFilters.to_date ? 'Không tìm thấy lead phù hợp.' : 'Chưa có lead nào.'}</p> : (
              <div className="list-stack">
                {leads.map((lead) => (
                  <div key={lead.id} className="lead-record-row">
                    {permission === 'F' && <label className="lead-row-checkbox" aria-label={`Chọn ${lead.full_name}`}><input type="checkbox" checked={selectedLeadIds.includes(lead.id)} onChange={(event) => setSelectedLeadIds((current) => event.target.checked ? [...current, lead.id] : current.filter((id) => id !== lead.id))} /></label>}
                    <div className="lead-record">
                      <button className="lead-record-summary" type="button" aria-expanded={expandedLeadId === lead.id} onClick={() => void toggleLeadHistory(lead.id)}>
                        <span className="lead-record-identity"><strong>{lead.full_name}</strong><small>{lead.phone}{lead.email ? ` · ${lead.email}` : ''}</small></span>
                        <span>{lead.source === 'website' ? 'Website' : lead.source === 'facebook' ? 'Facebook' : lead.source === 'walkin' ? 'Khách trực tiếp' : 'Giới thiệu'}</span>
                        <span className={`catalog-status-pill lead-${lead.status}`}>{lead.status === 'new' ? 'Mới' : lead.status === 'assigned' ? 'Đã phân công' : lead.status === 'contacted' ? 'Đã liên hệ' : lead.status === 'qualified' ? 'Tiềm năng' : lead.status === 'converted' ? 'Đã đăng ký' : 'Không tiếp tục'}</span>
                        <span className="lead-record-assignee">{lead.assigned_to_name || 'Chưa phân công'}</span>
                        <span className="lead-record-expand">{expandedLeadId === lead.id ? 'Ẩn chi tiết −' : 'Chi tiết +'}</span>
                      </button>
                      {expandedLeadId === lead.id && <div className="lead-record-details">
                        {lead.program_interest && <p><strong>Chương trình quan tâm:</strong> {lead.program_interest}</p>}
                        {lead.notes && <p><strong>Ghi chú:</strong> {lead.notes}</p>}
                        {(permission === 'F' || permission === 'W') && <div className="inline-row lead-actions">
                          <label>Trạng thái<select value={lead.status} onChange={(event) => void updateLead(lead.id, event.target.value)}><option value="new">Mới</option><option value="assigned">Đã phân công</option><option value="contacted">Đã liên hệ</option><option value="qualified">Tiềm năng</option><option value="converted">Đã đăng ký</option><option value="lost">Không tiếp tục</option></select></label>
                          {permission === 'F' && <label>Người phụ trách<select value={lead.assigned_to_user_id ? String(lead.assigned_to_user_id) : ''} onChange={(event) => void assignLead(lead.id, event.target.value)}><option value="">Chưa phân công</option>{leadAssignees.map((assignee) => <option key={assignee.id} value={String(assignee.id)}>{assignee.full_name}</option>)}</select></label>}
                          <button className="secondary-button" type="button" onClick={() => editLead(lead)}>Sửa lead</button>
                          {canDeleteLeads && <button className="secondary-button" type="button" onClick={() => void removeLead(lead)}>Xóa lead</button>}
                        </div>}
                        <div className="lead-history">
                          <h4>Lịch sử trao đổi</h4>
                          {leadInteractions.length === 0 ? <p className="muted">Chưa có lịch sử.</p> : <div className="list-stack">{leadInteractions.map((item) => <div className="lead-history-item" key={item.id}><strong>{item.user_name}</strong><small>{formatLeadTimestamp(item.created_at)} · {item.action}</small><p>{item.note}</p></div>)}</div>}
                          {(permission === 'F' || permission === 'W') && <form className="lead-history-form" onSubmit={(event) => void addLeadInteraction(event, lead.id)}><label>Ghi chú cuộc gọi / lần trao đổi<textarea value={interactionNote} onChange={(event) => setInteractionNote(event.target.value)} maxLength={2000} required /></label><button className="secondary-button" type="submit">Lưu vào lịch sử</button></form>}
                        </div>
                      </div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <CatalogPagination page={leadPage} total={leadTotal} pageSize={leadPageSize} onChange={(page) => { setSelectedLeadIds([]); setLeadPage(page) }} onPageSizeChange={(size) => { setLeadPageSize(size); setLeadPage(1); setSelectedLeadIds([]) }} label="lead" />
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="module-landing">
      <div className="module-icon">{moduleIcons[module]}</div>
      <p className="eyebrow blue">KHÔNG GIAN NGHIỆP VỤ</p>
      <h1>{moduleLabels[module]}</h1>
      <p>Bạn được cấp quyền <strong>{permissionLabel(permission)}</strong> cho chức năng này.</p>
      <p className="muted">Chức năng nghiệp vụ chi tiết đã được tích hợp trong sprint 2.</p>
    </section>
  )
}

function StatCard({ label, value, detail, icon, tone }: { label: string; value: string | number; detail: string; icon: string; tone: string }) {
  return <article className="stat-card"><div className={`stat-icon ${tone}`}>{icon}</div><div><p>{label}</p><strong>{value}</strong><small>{detail}</small></div><span className="stat-arrow">↗</span></article>
}

function Avatar({ name, avatarUrl }: { name: string; avatarUrl?: string | null }) {
  if (avatarUrl) {
    return <img className="avatar" src={`${API_URL}${avatarUrl}`} alt={`Ảnh đại diện ${name}`} />
  }
  return <span className="avatar">{name.split(' ').map((part) => part[0]).slice(-2).join('').toUpperCase()}</span>
}

function formatDateOfBirth(date: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  return match ? `${match[3]}/${match[2]}/${match[1]}` : ''
}

function parseDateOfBirth(value: string) {
  const trimmedValue = value.trim()
  if (!trimmedValue) return ''

  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmedValue)
    ?? /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmedValue)
  if (!match) return null

  const dayFirst = match[0].includes('/')
  const year = Number(dayFirst ? match[3] : match[1])
  const month = Number(match[2])
  const day = Number(dayFirst ? match[1] : match[3])
  const daysInMonth = [
    31,
    year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
    31, 30, 31, 30, 31, 31, 30, 31, 30, 31,
  ][month - 1]
  if (year < 1 || !daysInMonth || day < 1 || day > daysInMonth) return null

  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`
}

function ProfileView({
  user,
  onUpdate,
  onUploadAvatar,
}: {
  user: User
  onUpdate: (data: { full_name: string; phone: string; date_of_birth: string; address: string }) => Promise<void>
  onUploadAvatar: (file: File) => Promise<void>
}) {
  const [fullName, setFullName] = useState(user.full_name)
  const [phone, setPhone] = useState(user.phone ?? '')
  const [dateOfBirth, setDateOfBirth] = useState(formatDateOfBirth(user.date_of_birth ?? ''))
  const [address, setAddress] = useState(user.address ?? '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [avatarPreviewOpen, setAvatarPreviewOpen] = useState(false)

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsedDateOfBirth = parseDateOfBirth(dateOfBirth)
    if (parsedDateOfBirth === null) {
      setError('Ngày sinh không hợp lệ. Vui lòng nhập theo định dạng dd/mm/yyyy.')
      return
    }
    const savingStartedAt = Date.now()
    setSaving(true)
    setError('')
    try {
      await onUpdate({ full_name: fullName, phone, date_of_birth: parsedDateOfBirth, address })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể cập nhật hồ sơ.')
    } finally {
      const remainingIndicatorTime = 700 - (Date.now() - savingStartedAt)
      if (remainingIndicatorTime > 0) {
        await new Promise((resolve) => setTimeout(resolve, remainingIndicatorTime))
      }
      setSaving(false)
    }
  }

  async function selectAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setUploading(true)
    setError('')
    try {
      await onUploadAvatar(file)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể tải ảnh đại diện.')
    } finally {
      setUploading(false)
      event.target.value = ''
    }
  }

  return (
    <div className="profile-page">
      {avatarPreviewOpen && user.avatar_url && (
        <div className="avatar-preview-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setAvatarPreviewOpen(false) }}>
          <section className="avatar-preview" role="dialog" aria-modal="true" aria-label="Ảnh đại diện kích thước lớn">
            <button className="close-button" type="button" onClick={() => setAvatarPreviewOpen(false)} aria-label="Đóng ảnh">×</button>
            <img src={`${API_URL}${user.avatar_url}`} alt={`Ảnh đại diện ${user.full_name}`} />
          </section>
        </div>
      )}
      <section aria-label="Thông tin tài khoản">
        {error && <TransientMessage key={`profile-error-${error}`} message={error} tone="error" />}
        <form className="profile-form-scroll" id="profile-form" onSubmit={saveProfile}>
          <div className="profile-sections">
            <section className="profile-card">
              <div className="profile-card-heading"><h3>Thông tin tài khoản</h3></div>
              <div className="profile-card-body profile-account-fields">
                <div className="profile-avatar-section">
                  <div className="profile-avatar-picker">
                    {user.avatar_url ? (
                      <button className="profile-avatar-preview" type="button" onClick={() => setAvatarPreviewOpen(true)} aria-label="Xem ảnh đại diện kích thước lớn">
                        <Avatar name={user.full_name} avatarUrl={user.avatar_url} />
                      </button>
                    ) : <div className="profile-avatar-placeholder"><Avatar name={user.full_name} /></div>}
                    <label className="profile-avatar-upload" title="Chọn ảnh đại diện">
                      <input
                        className="profile-avatar-input"
                        type="file"
                        accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
                        aria-label="Chọn ảnh đại diện"
                        onChange={(event) => void selectAvatar(event)}
                        disabled={uploading}
                      />
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M4 7.5h3l1.5-2h7l1.5 2h3A1.5 1.5 0 0 1 21.5 9v9a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 18V9A1.5 1.5 0 0 1 4 7.5Z" />
                        <circle cx="12" cy="13" r="3.5" />
                      </svg>
                    </label>
                  </div>
                </div>
                <div className="profile-readonly-field">
                  <span>Email</span>
                  <div className="profile-value">{user.email}</div>
                </div>
                <div className="profile-readonly-field">
                  <span>Vai trò</span>
                  <div className="profile-value">{user.roles.map((role) => roleLabels[role]).join(', ')}</div>
                </div>
              </div>
            </section>
            <section className="profile-card">
              <div className="profile-card-heading"><h3>Thông tin người dùng</h3></div>
              <div className="profile-card-body profile-user-fields">
                <label>Họ và tên<input value={fullName} onChange={(event) => setFullName(event.target.value)} required minLength={2} /></label>
                <label>Số điện thoại<input value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
                <label>Ngày sinh
                  <div className="profile-date-input">
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="dd/mm/yyyy"
                      value={dateOfBirth}
                      onChange={(event) => setDateOfBirth(event.target.value)}
                      aria-label="Nhập ngày sinh theo định dạng ngày/tháng/năm"
                    />
                    <input
                      type="date"
                      value={parseDateOfBirth(dateOfBirth) ?? ''}
                      onChange={(event) => setDateOfBirth(formatDateOfBirth(event.target.value))}
                      aria-label="Chọn ngày sinh trên lịch"
                    />
                  </div>
                </label>
                <label>Địa chỉ<textarea className="profile-address" value={address} onChange={(event) => setAddress(event.target.value)} maxLength={500} rows={3} placeholder="Nhập địa chỉ của bạn" /></label>
              </div>
            </section>
          </div>
          <div className="profile-page-actions">
            <button
              className={`primary-button profile-save-button${saving ? ' is-saving' : ''}`}
              type="submit"
              disabled={saving}
              aria-busy={saving}
            >
              {saving ? 'Đang lưu...' : 'Lưu hồ sơ'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

function UsersView({
  users,
  page,
  ownerId,
  canManage,
  onQuery,
  onCreate,
  onEditOpen,
  onStatus,
  onImport,
  onPreviewImport,
  onCreateUser,
}: {
  users: User[]
  page: UserPage
  ownerId: number
  canManage: boolean
  onQuery: (filters: UserFilters) => Promise<void>
  onCreate: () => void
  onEditOpen: (id: number) => void
  onStatus: (user: User, active: boolean, reason: string) => Promise<void>
  onImport: (file: File) => Promise<{ imported: number; skipped: number; errors: string[] }>
  onPreviewImport: (file: File) => Promise<ImportPreview>
  onCreateUser?: (data: UserInput) => Promise<void>
}) {
  const [activeTab, setActiveTab] = useState<'list' | 'create' | 'import'>(() => {
    const saved = sessionStorage.getItem(`tms:users-subtab:${ownerId}`)
    return saved === 'create' || saved === 'import' ? saved : 'list'
  })
  const initialFilters = readUserFilters(ownerId)
  const [query, setQuery] = useState(initialFilters.q)
  const [roleFilter, setRoleFilter] = useState(initialFilters.role)
  const [activeFilter, setActiveFilter] = useState(initialFilters.active)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importDragging, setImportDragging] = useState(false)
  const importInput = useRef<HTMLInputElement>(null)
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number; errors: string[] } | null>(null)
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null)
  const [previewFilter, setPreviewFilter] = useState<'all' | 'valid' | 'duplicate' | 'error'>('all')
  const [previewSearch, setPreviewSearch] = useState('')
  const [previewPageSize, setPreviewPageSize] = useState(10)
  const [previewPage, setPreviewPage] = useState(1)
  const [importResultErrorPage, setImportResultErrorPage] = useState(1)
  const [importError, setImportError] = useState('')
  const [importing, setImporting] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [lockingId, setLockingId] = useState<number | null>(() => {
    const value = sessionStorage.getItem(`tms:locking-user:${ownerId}`)
    return value ? Number(value) : null
  })
  const locking = users.find((item) => item.id === lockingId) ?? null
  const pageCount = Math.max(1, Math.ceil(page.total / page.page_size))
  const importHasValidationErrors = Boolean(importError)
    || Boolean(importPreview && (importPreview.valid === 0 || importPreview.skipped > 0))

  const allPreviewRows = useMemo<ImportPreviewRow[]>(() => {
    if (!importPreview) return []
    if (importPreview.all_rows && importPreview.all_rows.length > 0) {
      return importPreview.all_rows
    }
    const rows: ImportPreviewRow[] = importPreview.preview_rows.map((r) => ({
      ...r,
      status: 'valid',
      message: 'Hợp lệ',
    }))
    for (const item of importPreview.errors) {
      const match = item.match(/^Dòng\s+(\d+):\s*(.*)$/i)
      const rowNum = match ? Number(match[1]) : 0
      const msg = match ? match[2] : item
      const isDup = item.toLowerCase().includes('đã tồn tại') || item.toLowerCase().includes('trùng')
      rows.push({
        row_number: rowNum,
        full_name: '—',
        email: '—',
        roles: [],
        phone: null,
        assigned_classes: [],
        status: isDup ? 'duplicate' : 'error',
        message: msg,
      })
    }
    return rows.sort((a, b) => a.row_number - b.row_number)
  }, [importPreview])

  const duplicateCount = importPreview?.duplicates ?? allPreviewRows.filter((r) => r.status === 'duplicate').length
  const errorCount = importPreview?.error_count ?? allPreviewRows.filter((r) => r.status === 'error').length

  const filteredPreviewRows = useMemo(() => {
    let rows = allPreviewRows
    if (previewFilter !== 'all') {
      rows = rows.filter((r) => r.status === previewFilter)
    }
    const q = previewSearch.trim().toLowerCase()
    if (q) {
      rows = rows.filter((r) => {
        const name = (r.full_name || '').toLowerCase()
        const email = (r.email || '').toLowerCase()
        const phone = (r.phone || '').toLowerCase()
        const msg = (r.message || '').toLowerCase()
        const rowStr = String(r.row_number)
        const roles = (r.roles || []).join(' ').toLowerCase()
        return (
          name.includes(q) ||
          email.includes(q) ||
          phone.includes(q) ||
          msg.includes(q) ||
          rowStr.includes(q) ||
          roles.includes(q)
        )
      })
    }
    return rows
  }, [allPreviewRows, previewFilter, previewSearch])

  const previewPageCount = Math.max(1, Math.ceil(filteredPreviewRows.length / previewPageSize))
  const safePreviewPage = Math.max(1, Math.min(previewPage, previewPageCount))
  const visiblePreviewRows = filteredPreviewRows.slice(
    (safePreviewPage - 1) * previewPageSize,
    safePreviewPage * previewPageSize
  )
  const visibleImportResultErrors = importResult?.errors.slice((importResultErrorPage - 1) * IMPORT_PAGE_SIZE, importResultErrorPage * IMPORT_PAGE_SIZE) ?? []

  function changeTab(tab: 'list' | 'create' | 'import') {
    setActiveTab(tab)
    sessionStorage.setItem(`tms:users-subtab:${ownerId}`, tab)
  }

  function parseImportError(errorStr: string) {
    const match = errorStr.match(/^Dòng\s+(\d+):\s*(.*)$/i)
    if (match) {
      return { row: match[1], message: match[2] }
    }
    return { row: null, message: errorStr }
  }

  function selectImportFile(file: File | null) {
    setImportFile(file)
    setImportPreview(null)
    setImportResult(null)
    setPreviewFilter('all')
    setPreviewSearch('')
    setPreviewPage(1)
    setImportResultErrorPage(1)
    setImportError('')
    if (file && !file.name.toLowerCase().endsWith('.xlsx')) {
      setImportError('Vui lòng chọn tệp Excel có định dạng .xlsx.')
      if (importInput.current) importInput.current.value = ''
      return
    }
    if (!file && importInput.current) importInput.current.value = ''
  }

  function dropImportFile(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setImportDragging(false)
    selectImportFile(event.dataTransfer.files[0] ?? null)
    if (importInput.current) importInput.current.value = ''
  }

  async function runQuery(filters: UserFilters) {
    if (searching) return
    setSearching(true)
    setSearchError('')
    const minDelay = new Promise((resolve) => setTimeout(resolve, 1500))
    try {
      await Promise.all([onQuery(filters), minDelay])
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : 'Không thể tìm kiếm tài khoản. Vui lòng thử lại.')
    } finally {
      setSearching(false)
    }
  }

  async function submitImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!importFile || !importPreview || importing || importPreview.valid === 0) return
    setImporting(true)
    setImportError('')
    setImportResult(null)
    try {
      const result = await onImport(importFile)
      setImportResult(result)
      setImportResultErrorPage(1)
      setImportFile(null)
      setImportPreview(null)
      if (importInput.current) importInput.current.value = ''
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Không thể nhập danh sách người dùng.')
    } finally {
      setImporting(false)
    }
  }

  async function previewImport() {
    if (!importFile || previewing || importing) return
    setPreviewing(true)
    setImportError('')
    setImportResult(null)
    try {
      setImportPreview(await onPreviewImport(importFile))
      setPreviewFilter('all')
      setPreviewSearch('')
      setPreviewPage(1)
    } catch (error) {
      setImportPreview(null)
      setImportError(error instanceof Error ? error.message : 'Không thể kiểm tra file Excel.')
    } finally {
      setPreviewing(false)
    }
  }

  async function downloadTemplate() {
    setImportError('')
    try {
      const token = localStorage.getItem('tms_token')
      const response = await fetch(`${API_URL}/users/import-excel/template`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!response.ok) throw new Error(vietnameseApiError((await response.json().catch(() => ({}))).detail, response.status))
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'users-template.xlsx'
      link.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Không thể tải file mẫu.')
    }
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void runQuery({ q: query, role: roleFilter, active: activeFilter, page: 1 })
  }

  function updateFilter(role: string, active: string) {
    setRoleFilter(role)
    setActiveFilter(active)
    saveUserFilters(ownerId, { q: query, role, active, page: 1 })
    void runQuery({ q: query, role, active, page: 1 })
  }

  function updateQuery(value: string) {
    setQuery(value)
    saveUserFilters(ownerId, { q: value, role: roleFilter, active: activeFilter, page: 1 })
  }

  return (
    <div className="view users-workspace-view">
      {/* Thanh chuyển đổi chế độ chuyên biệt cho tài khoản */}
      {/* Thanh chuyển đổi chế độ chuyên biệt cho tài khoản đưa lên topbar */}
      <TopbarNavPortal>
        <div className="users-mode-nav" role="tablist" aria-label="Phân hệ tài khoản">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'list'}
            className={`users-mode-tab${activeTab === 'list' ? ' active' : ''}`}
            onClick={() => changeTab('list')}
          >
            <span className="tab-icon">📋</span>
            <span>Danh sách tài khoản</span>
            <span className="tab-pill-count">{page.total}</span>
          </button>
          {canManage && (
            <>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'create'}
                className={`users-mode-tab${activeTab === 'create' ? ' active' : ''}`}
                onClick={() => changeTab('create')}
              >
                <span className="tab-icon">➕</span>
                <span>Tạo tài khoản mới</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'import'}
                className={`users-mode-tab${activeTab === 'import' ? ' active' : ''}`}
                onClick={() => changeTab('import')}
              >
                <span className="tab-icon">📥</span>
                <span>Nhập từ file Excel</span>
              </button>
            </>
          )}
        </div>
      </TopbarNavPortal>

      {/* 1. TAB TẠO TÀI KHOẢN MỚI */}
      {activeTab === 'create' && canManage ? (
        <UserFormPage
          ownerId={ownerId}
          title="Tạo tài khoản mới"
          onClose={() => changeTab('list')}
          onSave={async (data) => {
            if (onCreateUser) {
              await onCreateUser(data)
            } else {
              onCreate()
            }
            changeTab('list')
          }}
        />
      ) : activeTab === 'import' && canManage ? (
        /* 2. TAB NHẬP HÀNG LOẠT TỪ EXCEL */
        <section className="card-panel import-panel">
          <div className="page-heading" style={{ marginBottom: '18px' }}>
            <div>
              <p className="eyebrow blue">NHẬP TÀI KHOẢN HÀNG LOẠT</p>
              <h2>Nhập tài khoản từ file Excel</h2>
              <p className="muted">
                Tải lên file bảng tính để tạo tài khoản đồng loạt. Cột bắt buộc: <strong>full_name</strong>, <strong>email</strong>, <strong>roles</strong>.
              </p>
            </div>
            <div className="heading-actions">
              <button className="secondary-button" type="button" onClick={() => void downloadTemplate()}>
                📄 Tải file mẫu .xlsx
              </button>
              <button className="secondary-button" type="button" onClick={() => changeTab('list')}>
                ← Quay lại danh sách
              </button>
            </div>
          </div>

          {importPreview ? (
            <div className="import-compact-bar">
              <div className="import-compact-file">
                <span className="import-file-badge">📄 {importFile?.name}</span>
                <span className="import-file-size">({(importFile ? importFile.size / 1024 : 0).toFixed(1)} KB)</span>
                <button
                  type="button"
                  className="import-reselect-btn"
                  onClick={() => { selectImportFile(null); setImportPreview(null) }}
                  title="Chọn file khác"
                >
                  ✕ Đổi file khác
                </button>
              </div>

              <div className="import-compact-filters" role="tablist" aria-label="Lọc kết quả kiểm tra">
                <button
                  type="button"
                  role="tab"
                  className={`preview-filter-chip all${previewFilter === 'all' ? ' active' : ''}`}
                  onClick={() => { setPreviewFilter('all'); setPreviewPage(1) }}
                >
                  Tất cả ({allPreviewRows.length})
                </button>
                <button
                  type="button"
                  role="tab"
                  className={`preview-filter-chip valid${previewFilter === 'valid' ? ' active' : ''}`}
                  onClick={() => { setPreviewFilter('valid'); setPreviewPage(1) }}
                >
                  ✓ Hợp lệ ({importPreview.valid})
                </button>
                {duplicateCount > 0 && (
                  <button
                    type="button"
                    role="tab"
                    className={`preview-filter-chip duplicate${previewFilter === 'duplicate' ? ' active' : ''}`}
                    onClick={() => { setPreviewFilter('duplicate'); setPreviewPage(1) }}
                  >
                    ⚠️ Trùng ({duplicateCount})
                  </button>
                )}
                {errorCount > 0 && (
                  <button
                    type="button"
                    role="tab"
                    className={`preview-filter-chip error${previewFilter === 'error' ? ' active' : ''}`}
                    onClick={() => { setPreviewFilter('error'); setPreviewPage(1) }}
                  >
                    ❌ Lỗi ({errorCount})
                  </button>
                )}
              </div>

              <div className="import-compact-actions">
                {importPreview.valid > 0 ? (
                  <button
                    className="primary-button"
                    type="button"
                    disabled={importing}
                    onClick={(event) => void submitImport(event as unknown as FormEvent<HTMLFormElement>)}
                  >
                    {importing ? 'Đang nhập...' : `✓ Nhập ${importPreview.valid} dòng hợp lệ`}
                  </button>
                ) : (
                  <span className="import-no-valid-hint">Không có dòng hợp lệ</span>
                )}
              </div>
            </div>
          ) : (
            <form className="import-form" onSubmit={(event) => void submitImport(event)}>
              <div
                className={`import-dropzone${importDragging ? ' is-dragging' : ''}${importFile ? ' has-file' : ''}${importFile && !importHasValidationErrors ? ' is-valid' : ''}${importHasValidationErrors ? ' is-invalid' : ''}`}
                onDragEnter={(event) => { event.preventDefault(); setImportDragging(true) }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setImportDragging(false)
                }}
                onDrop={dropImportFile}
                onClick={() => importInput.current?.click()}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    importInput.current?.click()
                  }
                }}
                role="button"
                tabIndex={0}
                aria-label="Chọn hoặc kéo thả file Excel .xlsx"
              >
                <input
                  ref={importInput}
                  className="import-file-input"
                  type="file"
                  accept=".xlsx"
                  aria-label="Chọn file Excel"
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => selectImportFile(event.target.files?.[0] ?? null)}
                />
                <span className="import-file-icon" aria-hidden="true">{importFile ? '✓' : '⇧'}</span>
                <span className="import-dropzone-copy">
                  <strong>{importFile ? importFile.name : 'Kéo thả file Excel vào đây'}</strong>
                  <span>{importFile ? `${(importFile.size / 1024).toFixed(1)} KB · Excel .xlsx` : 'hoặc bấm để chọn file .xlsx từ thiết bị'}</span>
                </span>
                {importFile && (
                  <button
                    className="import-remove-file"
                    type="button"
                    aria-label="Bỏ file đã chọn"
                    onClick={(event) => { event.stopPropagation(); selectImportFile(null) }}
                  >
                    ×
                  </button>
                )}
              </div>

              <div className="import-actions">
                <button
                  className={`secondary-button import-check-button${importFile ? ' is-ready' : ''}${importPreview ? ' is-checked' : ''}${importHasValidationErrors ? ' is-invalid' : ''}`}
                  type="button"
                  onClick={() => void previewImport()}
                  disabled={!importFile || !importFile.name.toLowerCase().endsWith('.xlsx') || previewing || importing}
                >
                  {previewing
                    ? 'Đang kiểm tra...'
                    : importPreview && importHasValidationErrors
                      ? 'Đã kiểm tra · Có lỗi'
                      : importPreview
                        ? '✓ Đã kiểm tra dữ liệu'
                        : '🔍 Kiểm tra dữ liệu file'}
                </button>
              </div>
            </form>
          )}

          {importError && <div className="form-error" role="alert">{importError}</div>}

          {/* BẢNG DỮ LIỆU DUY NHẤT: HIỂN THỊ CẢ HỢP LỆ (XANH), TRÙNG LẶP (VÀNG), LỖI (ĐỎ) */}
          {importPreview && (
            <div className="import-preview unified-view" role="status" aria-live="polite">
              <div className="import-table-wrap">
                <div className="import-table-heading">
                  <div className="import-heading-title">
                    <strong>Bảng kết quả kiểm tra dữ liệu file ({filteredPreviewRows.length} dòng)</strong>
                    <span className="import-heading-filter-note">
                      {previewFilter === 'all' && 'Tất cả các dòng trong file Excel'}
                      {previewFilter === 'valid' && 'Chỉ hiển thị các dòng hợp lệ sẵn sàng nhập'}
                      {previewFilter === 'duplicate' && 'Chỉ hiển thị các dòng bị trùng lặp'}
                      {previewFilter === 'error' && 'Chỉ hiển thị các dòng bị lỗi cấu trúc'}
                    </span>
                  </div>
                  <div className="import-status-legend">
                    <span className="legend-chip valid"><span className="legend-dot" /> Hợp lệ ({importPreview.valid})</span>
                    <span className="legend-chip duplicate"><span className="legend-dot" /> Trùng lặp ({duplicateCount})</span>
                    <span className="legend-chip error"><span className="legend-dot" /> Bị lỗi ({errorCount})</span>
                  </div>
                </div>

                <div className="preview-search-row" style={{ display: 'flex', gap: '10px', alignItems: 'center', padding: '12px 16px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 280px', position: 'relative' }}>
                    <input
                      type="search"
                      value={previewSearch}
                      onChange={(e) => { setPreviewSearch(e.target.value); setPreviewPage(1) }}
                      placeholder="🔍 Tìm kiếm tài khoản, email, SĐT, lý do lỗi / trùng..."
                      style={{ width: '100%', padding: '8px 12px', borderRadius: '7px', border: '1px solid #cbd5e1', fontSize: '13px', background: '#ffffff', boxSizing: 'border-box' }}
                    />
                  </div>
                  {previewSearch && (
                    <button
                      type="button"
                      className="secondary-button"
                      style={{ padding: '6px 12px', fontSize: '12.5px', borderRadius: '7px' }}
                      onClick={() => { setPreviewSearch(''); setPreviewPage(1) }}
                    >
                      ✕ Xóa tìm
                    </button>
                  )}
                  {errorCount > 0 && previewFilter !== 'error' && (
                    <button
                      type="button"
                      className="secondary-button"
                      style={{ padding: '6px 12px', fontSize: '12.5px', borderRadius: '7px', borderColor: '#fca5a5', color: '#dc2626', background: '#fef2f2' }}
                      onClick={() => { setPreviewFilter('error'); setPreviewPage(1) }}
                    >
                      ❌ Lọc nhanh các tài khoản lỗi ({errorCount})
                    </button>
                  )}
                  {duplicateCount > 0 && previewFilter !== 'duplicate' && (
                    <button
                      type="button"
                      className="secondary-button"
                      style={{ padding: '6px 12px', fontSize: '12.5px', borderRadius: '7px', borderColor: '#fed7aa', color: '#c2410c', background: '#fff7ed' }}
                      onClick={() => { setPreviewFilter('duplicate'); setPreviewPage(1) }}
                    >
                      ⚠️ Lọc nhanh tài khoản trùng ({duplicateCount})
                    </button>
                  )}
                </div>

                <table className="import-preview-table unified-preview-table">
                  <thead>
                    <tr>
                      <th style={{ width: '60px', textAlign: 'center' }}>Dòng</th>
                      <th style={{ minWidth: '150px' }}>Họ và tên</th>
                      <th style={{ minWidth: '190px' }}>Email</th>
                      <th style={{ minWidth: '100px' }}>Vai trò</th>
                      <th style={{ minWidth: '110px' }}>Điện thoại</th>
                      <th style={{ minWidth: '100px' }}>Lớp</th>
                      <th style={{ minWidth: '220px' }}>Trạng thái & Ghi chú</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visiblePreviewRows.length === 0 ? (
                      <tr>
                        <td colSpan={7} style={{ textAlign: 'center', padding: '36px', color: '#64748b' }}>
                          Không có dòng nào phù hợp với bộ lọc đã chọn.
                        </td>
                      </tr>
                    ) : (
                      visiblePreviewRows.map((row, index) => {
                        const status = row.status || 'valid'
                        const isValid = status === 'valid'
                        const isDup = status === 'duplicate'
                        const isErr = status === 'error'
                        const rowDisplayNumber = (safePreviewPage - 1) * previewPageSize + index + 1
                        return (
                          <tr
                            key={`preview-row-${row.row_number}-${row.email}-${row.message || ''}`}
                            className={`preview-row-${status}`}
                          >
                            <td style={{ textAlign: 'center' }}>
                              <span className={`row-idx-badge ${status}`}>{rowDisplayNumber}</span>
                            </td>
                            <td style={{ fontWeight: 600 }}>{row.full_name || '—'}</td>
                            <td style={{ fontFamily: 'monospace', fontSize: '13px' }}>{row.email || '—'}</td>
                            <td>
                              {row.roles && row.roles.length > 0
                                ? row.roles.map((r) => roleOptions.find(([v]) => v === r)?.[1] ?? r).join(', ')
                                : '—'}
                            </td>
                            <td>{row.phone || '—'}</td>
                            <td>{row.assigned_classes && row.assigned_classes.length > 0 ? row.assigned_classes.join(', ') : '—'}</td>
                            <td>
                              {isValid && (
                                <span className="import-status-pill pill-valid">
                                  <span className="pill-dot">✓</span> Hợp lệ
                                </span>
                              )}
                              {isDup && (
                                <span className="import-status-pill pill-duplicate" title={row.message || 'Trùng lặp'}>
                                  <span className="pill-dot">⚠️</span> Trùng: {row.message || 'Email đã tồn tại'}
                                </span>
                              )}
                              {isErr && (
                                <span className="import-status-pill pill-error" title={row.message || 'Bị lỗi'}>
                                  <span className="pill-dot">❌</span> Lỗi: {row.message || 'Thiếu thông tin bắt buộc'}
                                </span>
                              )}
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>

                {filteredPreviewRows.length > 0 && (
                  <ImportPagination
                    page={safePreviewPage}
                    total={filteredPreviewRows.length}
                    pageSize={previewPageSize}
                    onChange={setPreviewPage}
                    onPageSizeChange={setPreviewPageSize}
                  />
                )}
              </div>
            </div>
          )}

          {/* KẾT QUẢ NHẬP XONG */}
          {importResult && (
            <div className="form-success" role="status" style={{ marginTop: '18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
                <div>
                  <strong>🎉 Nhập hoàn tất:</strong> Đã tạo thành công <strong>{importResult.imported}</strong> tài khoản; bỏ qua <strong>{importResult.skipped}</strong> dòng lỗi.
                </div>
                <button className="primary-button" type="button" onClick={() => changeTab('list')}>
                  Xem danh sách tài khoản →
                </button>
              </div>
              {importResult.errors.length > 0 && (
                <div style={{ marginTop: '12px' }}>
                  <strong>{importResult.errors.length.toLocaleString('vi-VN')} dòng đã bị bỏ qua:</strong>
                  <div className="import-error-list" style={{ marginTop: '8px' }}>
                    {visibleImportResultErrors.map((item, idx) => {
                      const parsed = parseImportError(item)
                      return (
                        <div className="import-error-card" key={`res-${item}-${idx}`}>
                          <div className="import-error-badge">{parsed.row ? `Dòng ${parsed.row}` : '!'}</div>
                          <div className="import-error-content"><strong>{parsed.message}</strong></div>
                        </div>
                      )
                    })}
                  </div>
                  <ImportPagination page={importResultErrorPage} total={importResult.errors.length} onChange={setImportResultErrorPage} />
                </div>
              )}
            </div>
          )}
        </section>
      ) : (
        /* 3. TAB QUẢN LÝ TÀI KHOẢN (LIST TAB) */
        <>
          <div className="page-heading">
            <div>
              <p className="eyebrow blue">QUẢN TRỊ HỆ THỐNG</p>
              <h1>Quản lý tài khoản</h1>
              <p className="muted">Tìm kiếm, chỉnh sửa, phân quyền, khóa và quản lý tài khoản người dùng.</p>
            </div>
          </div>

          <section className="table-card">
            <div className="table-toolbar">
              <form className="user-filters" onSubmit={submitSearch} noValidate>
                <div className="search-box">
                  ⌕
                  <input
                    placeholder="Tìm theo tên, email hoặc số điện thoại..."
                    value={query}
                    onChange={(event) => updateQuery(event.target.value)}
                    disabled={searching}
                  />
                </div>
                <SearchableSelect
                  value={roleFilter}
                  onChange={(val: string) => updateFilter(val, activeFilter)}
                  placeholder="Tất cả vai trò"
                  options={[
                    { value: '', label: 'Tất cả vai trò' },
                    ...roleOptions.map(([role, label]) => ({ value: role, label }))
                  ]}
                  pageSize={5}
                />
                <SearchableSelect
                  value={activeFilter}
                  onChange={(val: string) => updateFilter(roleFilter, val)}
                  placeholder="Mọi trạng thái"
                  options={[
                    { value: '', label: 'Mọi trạng thái' },
                    { value: 'true', label: 'Đang hoạt động' },
                    { value: 'false', label: 'Đã khóa' },
                  ]}
                  pageSize={5}
                />
                <button
                  className={`secondary-button search-submit${searching ? ' is-loading' : ''}`}
                  type="submit"
                  disabled={searching}
                  aria-busy={searching}
                >
                  {searching ? (
                    <>
                      <ButtonSpinner />
                      <span>Đang tìm...</span>
                    </>
                  ) : (
                    <span>Tìm kiếm</span>
                  )}
                </button>
              </form>
              <span className="table-count">{page.total} tài khoản</span>
            </div>

            {searchError && <div className="form-error search-error" role="alert">{searchError}</div>}

            <div className={`table-scroll${searching ? ' is-searching' : ''}`}>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: '60px', textAlign: 'center' }}>STT</th>
                    <th>Người dùng</th>
                    <th>Vai trò</th>
                    <th>Trạng thái</th>
                    <th>Ngày tạo</th>
                    <th style={{ textAlign: 'right' }}>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((item, index) => (
                    <tr key={item.id}>
                      <td style={{ textAlign: 'center', color: '#64748b', fontWeight: 500 }}>
                        {(page.page - 1) * page.page_size + index + 1}
                      </td>
                      <td>
                        <div className="user-cell">
                          <Avatar name={item.full_name} avatarUrl={item.avatar_url} />
                          <span>
                            <strong>{item.full_name}</strong>
                            <small>{item.email}{item.phone ? ` · ${item.phone}` : ''}</small>
                          </span>
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                          {item.roles.map((role) => (
                            <span key={role} className="role-tag" style={{ padding: '2px 8px', borderRadius: '4px', fontSize: '12px', background: '#e0f2fe', color: '#0369a1', fontWeight: 600 }}>
                              {roleLabels[role]}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td>
                        <span className={item.is_active ? 'status-pill active' : 'status-pill locked'}>
                          <i />
                          {item.is_active ? 'Hoạt động' : 'Đã khóa'}
                        </span>
                        {item.lock_reason && <small className="lock-reason">{item.lock_reason}</small>}
                        {item.handover_required && (
                          <div style={{ color: '#d97706', fontSize: '11px', marginTop: '3px', display: 'flex', alignItems: 'center', gap: '3px' }}>
                            ⚠️ Cần bàn giao lớp ({item.assigned_classes.join(', ')})
                          </div>
                        )}
                      </td>
                      <td className="date-cell">{new Date(item.created_at).toLocaleDateString('vi-VN')}</td>
                      {canManage ? (
                        <td className="row-actions" style={{ textAlign: 'right' }}>
                          <button className="row-action" onClick={() => onEditOpen(item.id)}>
                            ✏️ Sửa
                          </button>
                          {item.is_active ? (
                            <button
                              className="row-action danger"
                              onClick={() => {
                                sessionStorage.setItem(`tms:locking-user:${ownerId}`, String(item.id))
                                setLockingId(item.id)
                              }}
                            >
                              🔒 Khóa
                            </button>
                          ) : (
                            <button
                              className="row-action"
                              style={{ color: '#16a34a' }}
                              onClick={() => void onStatus(item, true, '').catch(() => undefined)}
                            >
                              🔓 Mở khóa
                            </button>
                          )}
                        </td>
                      ) : <td />}
                    </tr>
                  ))}
                  {users.length === 0 && (
                    <tr>
                      <td colSpan={6} className="empty-users">
                        Không tìm thấy tài khoản phù hợp với điều kiện tìm kiếm.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="pagination">
              <nav className="pagination-controls" aria-label="Phân trang tài khoản">
                <div className="catalog-pagination-box">
                  <button
                    className="page-nav-button"
                    aria-label="Trang trước"
                    disabled={page.page <= 1 || searching}
                    onClick={() => void runQuery({ q: query, role: roleFilter, active: activeFilter, page: page.page - 1 })}
                  >‹</button>
                  <strong className="page-indicator">Trang {page.page} / {Math.max(1, pageCount)}</strong>
                  <button
                    className="page-nav-button"
                    aria-label="Trang sau"
                    disabled={page.page >= pageCount || searching}
                    onClick={() => void runQuery({ q: query, role: roleFilter, active: activeFilter, page: page.page + 1 })}
                  >›</button>
                </div>
              </nav>
            </div>
          </section>
        </>
      )}

      {canManage && locking && (
        <LockUserModal
          reasonKey={`tms:lock-reason:${ownerId}:${locking.id}`}
          user={locking}
          onClose={() => {
            sessionStorage.removeItem(`tms:locking-user:${ownerId}`)
            sessionStorage.removeItem(`tms:lock-reason:${ownerId}:${locking.id}`)
            setLockingId(null)
          }}
          onConfirm={async (reason) => {
            await onStatus(locking, false, reason)
            sessionStorage.removeItem(`tms:locking-user:${ownerId}`)
            sessionStorage.removeItem(`tms:lock-reason:${ownerId}:${locking.id}`)
            setLockingId(null)
          }}
        />
      )}
    </div>
  )
}

function RolePicker({ selected, onChange }: { selected: Role[]; onChange: (roles: Role[]) => void }) {
  return (
    <fieldset className="role-picker">
      <legend>Vai trò (có thể chọn nhiều)</legend>
      <div className="role-options">
        {roleOptions.map(([role, label]) => (
          <label className="role-option" key={role}>
            <input type="checkbox" checked={selected.includes(role)} onChange={(event) => {
              onChange(event.target.checked ? [...selected, role] : selected.filter((value) => value !== role))
            }} />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function UserFormPage({ user, ownerId, title, onClose, onSave, onDelete }: { user?: User; ownerId: number; title: string; onClose: () => void; onSave: (data: UserInput) => Promise<void>; onDelete?: () => Promise<void> }) {
  const [error, setError] = useState('')
  const [deleteError, setDeleteError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [nameError, setNameError] = useState('')
  const [emailError, setEmailError] = useState('')
  const [rolesError, setRolesError] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const draftKey = `tms:user-draft:${ownerId}:${user?.id ?? 'new'}`
  const savedDraft = readUserDraft(draftKey)
  const [name, setName] = useState(savedDraft?.full_name ?? user?.full_name ?? '')
  const [email, setEmail] = useState(savedDraft?.email ?? user?.email ?? '')
  const [phone, setPhone] = useState(savedDraft?.phone ?? user?.phone ?? '')
  const [roles, setRoles] = useState<Role[]>(savedDraft?.roles ?? user?.roles ?? ['instructor'])
  const [assignedClasses, setAssignedClasses] = useState((savedDraft?.assigned_classes ?? user?.assigned_classes ?? []).join(', '))

  function saveDraft(update: Partial<UserInput>) {
    sessionStorage.setItem(draftKey, JSON.stringify({
      full_name: name,
      email,
      phone,
      roles,
      assigned_classes: assignedClasses.split(',').map((value) => value.trim()).filter(Boolean),
      ...update,
    }))
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nextNameError = name.trim().length < 2 ? 'Vui lòng nhập họ và tên (ít nhất 2 ký tự).' : ''
    const nextEmailError = !email.trim()
      ? 'Vui lòng nhập email.'
      : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
        ? 'Vui lòng nhập địa chỉ email hợp lệ.'
        : ''
    const nextRolesError = roles.length === 0 ? 'Vui lòng chọn ít nhất một vai trò.' : ''
    setNameError(nextNameError)
    setEmailError(nextEmailError)
    setRolesError(nextRolesError)
    setError('')
    if (nextNameError || nextEmailError || nextRolesError) {
      return
    }
    setSaving(true)
    try {
      await onSave({
        full_name: name.trim(),
        email: email.trim(),
        phone,
        roles,
        assigned_classes: assignedClasses.split(',').map((value) => value.trim()).filter(Boolean),
      })
      sessionStorage.removeItem(draftKey)
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : 'Không thể lưu tài khoản.'
      setError(message)
    } finally {
      setSaving(false)
    }
  }

  async function submitDelete() {
    if (!onDelete || !user) return
    setDeleting(true)
    setDeleteError('')
    try {
      await onDelete()
    } catch (deleteFailure) {
      setDeleteError(deleteFailure instanceof Error ? deleteFailure.message : 'Không thể xóa tài khoản. Vui lòng thử lại.')
    } finally {
      setDeleting(false)
    }
  }

  function close() {
    onClose()
  }

  return (
    <div className="view account-form-view">
      <div className="page-heading">
        <div><p className="eyebrow blue">QUẢN TRỊ HỆ THỐNG · TÀI KHOẢN</p><h1>{title}</h1><p className="muted">{user ? `Đang chỉnh sửa ${user.email}.` : 'Nhập thông tin để tạo tài khoản mới.'}</p></div>
        <button type="button" className="secondary-button" onClick={close}>← Quay lại danh sách</button>
      </div>
      <section className="card-panel account-form-card">
        <form onSubmit={submit} className="create-form" noValidate>
          <label>Họ và tên<input value={name} onChange={(event) => { const value = event.target.value; saveDraft({ full_name: value }); setName(value); if (value.trim().length >= 2) setNameError('') }} onBlur={() => { if (name.trim().length < 2) setNameError('Vui lòng nhập họ và tên (ít nhất 2 ký tự).') }} minLength={2} required aria-invalid={Boolean(nameError)} aria-describedby={nameError ? 'user-name-error' : undefined} />{nameError && <span className="field-error" id="user-name-error">{nameError}</span>}</label>
          <label>Email<input value={email} onChange={(event) => { const value = event.target.value; saveDraft({ email: value }); setEmail(value); if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) setEmailError('') }} onBlur={() => { const value = email.trim(); setEmailError(!value ? 'Vui lòng nhập email.' : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? 'Vui lòng nhập địa chỉ email hợp lệ.' : '') }} type="email" required aria-invalid={Boolean(emailError)} aria-describedby={emailError ? 'user-email-error' : undefined} />{emailError && <span className="field-error" id="user-email-error" role="alert">{emailError}</span>}</label>
          <label>Số điện thoại<input value={phone} onChange={(event) => { saveDraft({ phone: event.target.value }); setPhone(event.target.value) }} type="tel" maxLength={40} /></label>
          <label>Lớp phụ trách (phân cách bằng dấu phẩy)<input value={assignedClasses} onChange={(event) => { const value = event.target.value; saveDraft({ assigned_classes: value.split(',').map((item) => item.trim()).filter(Boolean) }); setAssignedClasses(value) }} placeholder="Ví dụ: TMS-K14, TMS-K15" /></label>
          <RolePicker selected={roles} onChange={(value) => { saveDraft({ roles: value }); setRoles(value); if (value.length > 0) setRolesError('') }} />
          {rolesError && <span className="field-error" role="alert">{rolesError}</span>}
          {!user && <p className="form-hint">Hệ thống sẽ gửi email kích hoạt kèm mật khẩu tạm; người dùng cần đổi mật khẩu ở lần đăng nhập đầu tiên.</p>}
          {error && <TransientMessage key={`user-error-${error}`} message={error} tone="error" />}
          {user && onDelete && user.id !== ownerId && (
            <div className="delete-account">
              {!confirmDelete ? (
                <button type="button" className="row-action danger" onClick={() => { setConfirmDelete(true); setDeleteError('') }}>Xóa tài khoản</button>
              ) : (
                <div className="delete-confirmation" role="alert">
                  <p>Xóa vĩnh viễn tài khoản <strong>{user.email}</strong>? Thao tác này không thể hoàn tác.</p>
                  {deleteError && <TransientMessage key={`user-delete-error-${deleteError}`} message={deleteError} tone="error" />}
                  <div className="modal-actions">
                    <button type="button" className="secondary-button" disabled={deleting} onClick={() => setConfirmDelete(false)}>Hủy</button>
                    <button type="button" className="danger-button" disabled={deleting} onClick={() => void submitDelete()}>{deleting ? 'Đang xóa...' : 'Xác nhận xóa vĩnh viễn'}</button>
                  </div>
                </div>
              )}
            </div>
          )}
          {user && onDelete && user.id === ownerId && <p className="form-hint">Không thể tự xóa tài khoản đang đăng nhập.</p>}
          <div className="modal-actions"><button type="button" className="secondary-button" onClick={close} disabled={saving || deleting}>Hủy</button><button className="primary-button" type="submit" disabled={saving || deleting}>{saving ? 'Đang lưu...' : user ? 'Lưu thay đổi' : 'Tạo tài khoản'}</button></div>
        </form>
      </section>
    </div>
  )
}

function LockUserModal({ user, reasonKey, onClose, onConfirm }: { user: User; reasonKey: string; onClose: () => void; onConfirm: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState(sessionStorage.getItem(reasonKey) ?? '')
  const [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!reason.trim()) {
      setError('Vui lòng nhập lý do khóa tài khoản.')
      return
    }
    try {
      await onConfirm(reason)
      sessionStorage.removeItem(`tms:lock-reason:${user.id}`)
    } catch {
      // updateStatus already reports request failures through the global toast.
    }
  }
  return (
    <div className="modal-backdrop">
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="lock-modal-title">
        <div className="modal-header"><div><p className="eyebrow blue">THU HỒI TRUY CẬP</p><h2 id="lock-modal-title">Khóa tài khoản</h2></div><button className="close-button" onClick={onClose} aria-label="Đóng">×</button></div>
        <form onSubmit={submit} className="create-form" noValidate>
          <p className="muted">Tài khoản của {user.full_name} sẽ bị đăng xuất khỏi mọi phiên đang mở.</p>
          <label>Lý do khóa<textarea value={reason} onChange={(event) => { sessionStorage.setItem(reasonKey, event.target.value); setReason(event.target.value) }} rows={3} maxLength={500} required /></label>
          {error && <TransientMessage key={`lock-error-${error}`} message={error} tone="error" />}
          <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Hủy</button><button className="primary-button" type="submit">Xác nhận khóa</button></div>
        </form>
      </section>
    </div>
  )
}

function ChangePasswordModal({ required, onClose, onChange }: { required: boolean; onClose: () => void; onChange: (data: { current_password: string; new_password: string }) => Promise<void> }) {
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    const data = new FormData(event.currentTarget)
    const currentPassword = String(data.get('current_password') ?? '')
    const nextPassword = String(data.get('new_password') ?? '')
    const confirmPassword = String(data.get('confirm_password') ?? '')
    if (!currentPassword) {
      setError('Vui lòng nhập mật khẩu hiện tại.')
      return
    }
    if (nextPassword.length < 8 || !/[A-Za-z]/.test(nextPassword) || !/\d/.test(nextPassword)) {
      setError('Mật khẩu mới phải có ít nhất 8 ký tự, gồm chữ cái và chữ số.')
      return
    }
    if (nextPassword !== confirmPassword) {
      setError('Mật khẩu xác nhận không khớp với mật khẩu mới.')
      return
    }
    setSaving(true)
    try {
      await onChange({ current_password: currentPassword, new_password: nextPassword })
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Không thể đổi mật khẩu')
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="modal-backdrop">
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="password-modal-title">
        <div className="modal-header"><div><p className="eyebrow blue">BẢO MẬT TÀI KHOẢN</p><h2 id="password-modal-title">Đổi mật khẩu</h2></div>{!required && <button className="close-button" onClick={onClose} aria-label="Đóng">×</button>}</div>
        {required && <p className="form-hint">Đây là mật khẩu tạm. Hãy đổi mật khẩu trước khi tiếp tục sử dụng hệ thống.</p>}
        <form onSubmit={submit} className="create-form" noValidate>
          <label>Mật khẩu hiện tại<PasswordInput name="current_password" autoComplete="current-password" required /></label>
          <label>Mật khẩu mới<PasswordInput name="new_password" minLength={8} autoComplete="new-password" required /></label>
          <label>Xác nhận mật khẩu mới<PasswordInput name="confirm_password" minLength={8} autoComplete="new-password" required /></label>
          <p className="form-hint">Mật khẩu tối thiểu 8 ký tự, bao gồm ít nhất một chữ cái và một chữ số.</p>
          {error && <TransientMessage key={`password-error-${error}`} message={error} tone="error" />}
          <div className="modal-actions">{!required && <button type="button" className="secondary-button" onClick={onClose} disabled={saving}>Hủy</button>}<button className="primary-button" type="submit" disabled={saving}>{saving ? 'Đang cập nhật...' : 'Cập nhật mật khẩu'}</button></div>
        </form>
      </section>
    </div>
  )
}

export default App
