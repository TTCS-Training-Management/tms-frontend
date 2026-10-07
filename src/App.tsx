import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent, FormEvent, InputHTMLAttributes } from 'react'
import './App.css'

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
type ImportPreviewRow = {
  row_number: number
  full_name: string
  email: string
  roles: string[]
  phone: string | null
  assigned_classes: string[]
}
type ImportPreview = {
  valid: number
  skipped: number
  errors: string[]
  preview_rows: ImportPreviewRow[]
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
    const timer = window.setTimeout(() => setExpired(true), 10_000)
    return () => window.clearTimeout(timer)
  }, [message, tone])

  if (!message || expired) return null
  return <div className={tone === 'success' ? 'form-success' : 'form-error'} role={tone === 'error' ? 'alert' : 'status'}>{message}</div>
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

function saveUserFilters(ownerId: number, filters: UserFilters) {
  sessionStorage.setItem(`tms:users-filter:${ownerId}`, JSON.stringify(filters))
}

const API_URL = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000'
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
  accountant: 'Theo dõi học phí, công nợ và báo cáo doanh thu.',
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
  billing: 'Học phí & công nợ',
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
  const [loginError, setLoginError] = useState('')
  const [loginLock, setLoginLock] = useState<LoginLock | null>(() =>
    readLoginLock(localStorage.getItem('tms_login_email') ?? ''),
  )
  const [loginSuccess, setLoginSuccess] = useState('')
  const [loading, setLoading] = useState(() => Boolean(localStorage.getItem('tms_token')))
  const [view, setView] = useState<AppView>(() => {
    const saved = sessionStorage.getItem('tms:current-view') ?? 'overview'
    return viewKey(saved) ? saved : 'overview'
  })
  const [summary, setSummary] = useState<Summary | null>(null)
  const [users, setUsers] = useState<User[]>([])
  const [userPage, setUserPage] = useState<UserPage | null>(null)
  const [createOpenFor, setCreateOpenFor] = useState<number | null>(() => {
    const owner = sessionStorage.getItem('tms:draft-owner')
    return owner !== null && sessionStorage.getItem(`tms:create-modal:${owner}`) === 'open'
      ? Number(owner)
      : null
  })
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [noticeTone, setNoticeTone] = useState<'success' | 'error'>('error')
  const [noticeVersion, setNoticeVersion] = useState(0)
  const [accessError, setAccessError] = useState('')
  const lastActivityWrite = useRef(0)

  useEffect(() => {
    if (!accountMenuOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAccountMenuOpen(false)
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [accountMenuOpen])

  function showNotice(message: string, tone: 'success' | 'error' = 'error') {
    setNoticeTone(tone)
    setNotice(message)
    setNoticeVersion((version) => version + 1)
  }

  useEffect(() => {
    if (!notice || noticeTone !== 'success') return
    const timer = window.setTimeout(() => setNotice(''), 10_000)
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
      setLoginError(detail)
    }
    window.addEventListener('tms:notice', showEventNotice)
    window.addEventListener('tms:access-denied', showAccessError)
    window.addEventListener('tms:session-expired', expireSession)
    return () => {
      window.removeEventListener('tms:notice', showEventNotice)
      window.removeEventListener('tms:access-denied', showAccessError)
      window.removeEventListener('tms:session-expired', expireSession)
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
        setLoginError(error instanceof Error ? error.message : 'Không thể khôi phục phiên đăng nhập.')
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
    sessionStorage.setItem('tms:current-view', nextView)
    sessionStorage.setItem('tms:view-owner', String(user.id))
    setView(nextView)
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
    setLoginError('')
    setLoginSuccess('')
    const data = new FormData(event.currentTarget)
    const email = String(data.get('email') ?? '').trim()
    const password = String(data.get('password') ?? '')
    if (!email || !password) {
      setLoginError('Vui lòng nhập email và mật khẩu.')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setLoginError('Vui lòng nhập địa chỉ email hợp lệ.')
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
        setLoginError('')
        const retryAfterSeconds = error.retryAfterSeconds ?? 15 * 60
        const lock = { email: email.toLowerCase(), until: Date.now() + retryAfterSeconds * 1000 }
        localStorage.setItem(loginLockKey(lock.email), String(lock.until))
        setLoginLock(lock)
      } else {
        setLoginError(error instanceof Error ? error.message : 'Không thể đăng nhập. Vui lòng thử lại.')
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
    setCreateOpenFor(null)
    setProfileOpen(false)
    setAccountMenuOpen(false)
    setLoginSuccess('Đăng xuất thành công. Phiên đăng nhập đã được thu hồi.')
    setAccessError('')
    clearSessionDrafts()
  }

  async function createUser(data: UserInput) {
    if (!user) throw new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.')
    const ownerId = user.id
    let created: User
    try {
      created = await apiRequest<User>('/users', {
        method: 'POST',
        body: JSON.stringify(data),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Không thể tạo tài khoản.'
      showNotice(`Tạo tài khoản thất bại: ${message}`)
      throw error
    }
    setCreateOpenFor(null)
    sessionStorage.removeItem(`tms:create-modal:${ownerId}`)
    const activationNotice =
      `Đã tạo tài khoản ${created.email}. Máy chủ email đã chấp nhận thư kích hoạt; điều này chưa xác nhận thư đã tới hộp thư. Nếu chưa thấy thư, hãy kiểm tra Thư rác/Quảng cáo hoặc dùng chức năng Quên mật khẩu.`
    showNotice(activationNotice, 'success')
    try {
      await loadUsers({ q: '', role: '', active: '', page: 1 }, ownerId)
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
        showNotice(
          `Đã cập nhật ${savedFields.length ? savedFields.join(', ') : 'thông tin tài khoản'}, nhưng cập nhật vai trò thất bại: ${message}`,
        )
      } else {
        showNotice(`Cập nhật tài khoản thất bại: ${message}`)
      }
      throw error
    }
  }

  async function deleteUser(userToDelete: User) {
    try {
      await apiRequest<void>(`/users/${userToDelete.id}`, { method: 'DELETE' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Không thể xóa tài khoản.'
      showNotice(`Xóa tài khoản ${userToDelete.email} thất bại: ${message}`)
      throw error
    }
    setUsers((current) => current.filter((item) => item.id !== userToDelete.id))
    setUserPage((current) => current ? { ...current, total: Math.max(0, current.total - 1) } : current)
    showNotice(`Đã xóa vĩnh viễn tài khoản ${userToDelete.email}.`, 'success')
    if (user) {
      try {
        await loadUsers({ ...readUserFilters(user.id), page: 1 }, user.id)
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
    let result: {
      message: string
      access_token: string
      user: User
    }
    try {
      result = await apiRequest<{
        message: string
        access_token: string
        user: User
      }>('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify(data),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Không thể đổi mật khẩu.'
      showNotice(`Đổi mật khẩu thất bại: ${message}`)
      throw error
    }
    localStorage.setItem('tms_token', result.access_token)
    setUser(result.user)
    setPasswordOpen(false)
    showNotice(result.message, 'success')
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
  if (loading) return <div className="page-loader">Đang khởi động hệ thống...</div>
  if (!user) return (
    <LoginPage
      error={loginError}
      success={loginSuccess}
      lock={loginLock}
      onEmailChange={(email) => {
        setLoginError('')
        setLoginLock(readLoginLock(email))
      }}
      onSubmit={login}
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
      {notice && (
        <div className={`notice ${noticeTone}`} role={noticeTone === 'error' ? 'alert' : 'status'}>
          {notice}
          <button onClick={() => setNotice('')} aria-label="Đóng thông báo">×</button>
        </div>
      )}
      <aside className="sidebar">
        <div className="brand">
          <img className="institution-logo" src="/ictu-logo.png" alt="Biểu trưng ICTU" />
          <div className="brand-name"><span>Hệ Thống</span><span>Quản Lý Đào Tạo</span></div>
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
        <header className="topbar">
          <div className={profileOpen ? 'breadcrumb profile-breadcrumb' : 'breadcrumb'}>
            {profileOpen ? <strong>THÔNG TIN TÀI KHOẢN</strong> : <>Hệ thống / <strong>{selectedModule && currentView === view ? moduleLabels[selectedModule] : currentView === 'overview' ? 'Tổng quan' : 'Tài khoản'}</strong></>}
          </div>
          <div className="topbar-actions">
            <span className="status-dot" />Hệ thống đang hoạt động
            <div className={`topbar-account${accountMenuOpen ? ' menu-open' : ''}`}>
              <button
                className="topbar-account-toggle"
                type="button"
                aria-label={accountMenuOpen ? 'Đóng menu tài khoản' : 'Mở menu tài khoản'}
                aria-expanded={accountMenuOpen}
                aria-controls="account-menu"
                onClick={() => setAccountMenuOpen((open) => !open)}
              >
                <Avatar name={user.full_name} avatarUrl={user.avatar_url} />
                <span className="topbar-account-label"><strong>{user.full_name}</strong><small>{user.roles.map((role) => roleLabels[role]).join(', ')}</small></span>
                <span className="topbar-account-menu-icon" aria-hidden="true"><i /><i /><i /></span>
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
          </div>
        </header>
        <div className={profileOpen ? 'content-wrap profile-content-wrap' : 'content-wrap'}>
          {profileOpen ? (
            <ProfileView user={user} onUpdate={updateProfile} onUploadAvatar={uploadAvatar} />
          ) : currentView === 'overview' ? (
            <Overview user={user} summary={summary} onUsers={() => navigate('users')} canViewUsers={canViewUsers(user)} onModule={(module) => navigate(`module:${module}`)} />
          ) : currentView === 'users' && userPage ? (
            <UsersView
              users={users}
              page={userPage}
              ownerId={user.id}
              canManage={canManageUsers(user)}
              onQuery={(filters) => loadUsers(filters, user.id)}
              onCreate={() => {
                sessionStorage.setItem(`tms:create-modal:${user.id}`, 'open')
                setCreateOpenFor(user.id)
              }}
              onEdit={saveUser}
              onDelete={deleteUser}
              onStatus={updateStatus}
              onImport={importUsers}
              onPreviewImport={previewUsersImport}
            />
          ) : selectedModule && selectedModulePermission ? (
            <ModuleLanding module={selectedModule} permission={selectedModulePermission} canDeleteLeads={user.roles.includes('training_manager')} />
          ) : (
            <div className="page-loader">Đang tải danh sách tài khoản...</div>
          )}
        </div>
      </main>
      {createOpenFor === user.id &&
        sessionStorage.getItem('tms:draft-owner') === String(user.id) &&
        sessionStorage.getItem(`tms:create-modal:${user.id}`) === 'open' && (
        <UserModal ownerId={user.id} title="Tạo tài khoản" onClose={() => { sessionStorage.removeItem(`tms:create-modal:${user.id}`); setCreateOpenFor(null) }} onSave={createUser} />
      )}
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
  error,
  success,
  lock,
  onEmailChange,
  onSubmit,
}: {
  error: string
  success: string
  lock: LoginLock | null
  onEmailChange: (email: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  const initialResetToken = new URLSearchParams(window.location.search).get('reset_token') ?? ''
  const [forgot, setForgot] = useState(Boolean(initialResetToken))
  const [forgotMessage, setForgotMessage] = useState('')
  const [forgotError, setForgotError] = useState('')
  const [resetToken, setResetToken] = useState(initialResetToken)
  const [newPassword, setNewPassword] = useState('')
  const [email, setEmail] = useState(localStorage.getItem('tms_login_email') ?? '')
  const [now, setNow] = useState(() => Date.now())
  const normalizedEmail = email.trim().toLowerCase()
  const lockRemaining = lock?.email === normalizedEmail
    ? Math.max(0, Math.ceil((lock.until - now) / 1000))
    : 0
  const lockCountdown = `${String(Math.floor(lockRemaining / 60)).padStart(2, '0')}:${String(lockRemaining % 60).padStart(2, '0')}`

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  async function requestReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setForgotMessage('')
    setForgotError('')
    const email = String(new FormData(event.currentTarget).get('email'))
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setForgotError('Vui lòng nhập địa chỉ email hợp lệ.')
      return
    }
    try {
      const result = await apiRequest<{ message: string }>('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email }),
      })
      setForgotMessage(result.message)
    } catch (requestError) {
      setForgotError(requestError instanceof Error ? requestError.message : 'Không thể khôi phục mật khẩu')
    }
  }

  async function submitReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setForgotMessage('')
    setForgotError('')
    if (newPassword.length < 8 || !/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
      setForgotError('Mật khẩu phải có ít nhất 8 ký tự, gồm chữ cái và chữ số.')
      return
    }
    try {
      const result = await apiRequest<{ message: string }>('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token: resetToken, new_password: newPassword }),
      })
      setForgotMessage(result.message)
      setResetToken('')
      setNewPassword('')
      window.history.replaceState({}, '', window.location.pathname)
      setForgot(false)
    } catch (requestError) {
      setForgotError(requestError instanceof Error ? requestError.message : 'Không thể đặt lại mật khẩu')
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
                  <p className="form-intro">Đặt mật khẩu mới cho tài khoản của bạn.</p>
                  <form onSubmit={submitReset} className="login-form" noValidate>
                    <label>Mật khẩu mới<PasswordInput value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={8} autoComplete="new-password" required /></label>
                    <button className="primary-button full" type="submit">Đặt lại mật khẩu</button>
                  </form>
                </>
              ) : (
                <>
                  <p className="form-intro">Nhập email để nhận liên kết đặt lại mật khẩu có hiệu lực trong 30 phút.</p>
                  <form onSubmit={requestReset} className="login-form" noValidate>
                    <label>Email công việc<input name="email" type="email" defaultValue={localStorage.getItem('tms_login_email') ?? ''} onChange={(event) => localStorage.setItem('tms_login_email', event.target.value)} required /></label>
                    <button className="primary-button full" type="submit">Gửi liên kết đặt lại</button>
                  </form>
                </>
              )}
              {forgotMessage && <TransientMessage key={`reset-${forgotMessage}`} message={forgotMessage} />}
              {forgotError && <div className="form-error" role="alert">{forgotError}</div>}
              <button className="link-button back-link" onClick={() => { setForgot(false); setForgotMessage(''); setForgotError(''); setResetToken('') }}>← Quay lại đăng nhập</button>
            </>
          ) : (
            <>
              <p className="eyebrow blue">CHÀO MỪNG QUAY TRỞ LẠI</p>
              <h2>Đăng nhập</h2>
              <p className="form-intro">Đăng nhập để tiếp tục với không gian làm việc của bạn.</p>
              {success && <TransientMessage key={`login-${success}`} message={success} />}
              {forgotMessage && <TransientMessage key={`reset-${forgotMessage}`} message={forgotMessage} />}
              <form onSubmit={onSubmit} className="login-form" noValidate>
                <label>Email công việc<input name="email" type="email" value={email} onChange={(event) => { setEmail(event.target.value); localStorage.setItem('tms_login_email', event.target.value); onEmailChange(event.target.value) }} required /></label>
                <label>Mật khẩu<PasswordInput name="password" autoComplete="current-password" required /></label>
                {error && lockRemaining <= 0 && <div className="form-error" role="alert">{error}</div>}
                {lockRemaining > 0 && <div className="form-error" role="status">Tài khoản này đang bị khóa đăng nhập. Có thể thử lại sau {lockCountdown}.</div>}
                <button className="primary-button full login-submit" type="submit" disabled={lockRemaining > 0}>
                  {lockRemaining > 0 ? `Đang khóa · ${lockCountdown}` : 'Đăng nhập'}
                  {lockRemaining <= 0 && <span>→</span>}
                </button>
              </form>
              <button className="link-button back-link" onClick={() => setForgot(true)}>Quên mật khẩu?</button>
              <a className="link-button back-link" href="/register">Đăng ký tư vấn</a>
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
    <main className="error-screen">
      <section className="modal public-lead-card">
        <p className="eyebrow blue">TƯ VẤN TUYỂN SINH</p>
        <h1>Đăng ký nhận tư vấn</h1>
        <p className="muted">Để lại thông tin, bộ phận tuyển sinh sẽ sớm liên hệ với bạn.</p>
        {message && <TransientMessage key={`${messageVersion}-${message}`} message={message} />}
        {error && <div className="form-error" role="alert">{error}</div>}
        <form className="stack" onSubmit={(event) => void submit(event)}>
          <label>Họ và tên<input value={form.full_name} onChange={(event) => setForm({ ...form, full_name: event.target.value })} placeholder="Ví dụ: Nguyễn Văn An" required /></label>
          <label>Số điện thoại<input type="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="Ví dụ: 0912345678" required /></label>
          <label>Email<input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="Ví dụ: an@example.com (không bắt buộc)" /></label>
          <label>Chương trình quan tâm<input value={form.program_interest} onChange={(event) => setForm({ ...form, program_interest: event.target.value })} placeholder="Tên khóa học muốn tìm hiểu, ví dụ: Lập trình Web" /><small className="field-hint">Nhập lĩnh vực hoặc khóa học bạn muốn được tư vấn; nếu chưa rõ, có thể để trống.</small></label>
          <label>Ghi chú<textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} placeholder="Ví dụ: Thời gian thuận tiện để liên hệ hoặc câu hỏi bạn muốn được giải đáp." /></label>
          <label className="lead-honeypot" aria-hidden="true">Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
          <button className="primary-button" type="submit" disabled={submitting}>{submitting ? 'Đang gửi...' : 'Gửi đăng ký'}</button>
        </form>
        <a className="link-button back-link" href="/">Quay lại đăng nhập</a>
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
  const [selectedProgramId, setSelectedProgramId] = useState<number | null>(null)
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [selectedSubjectId, setSelectedSubjectId] = useState<number | null>(null)
  const [subjectSessions, setSubjectSessions] = useState<SubjectSession[]>([])
  const [programSubjects, setProgramSubjects] = useState<ProgramSubject[]>([])
  const [trainingClasses, setTrainingClasses] = useState<TrainingClassRecord[]>([])
  const [className, setClassName] = useState('')
  const [draggedAssociationId, setDraggedAssociationId] = useState<number | null>(null)
  const [leads, setLeads] = useState<LeadRecord[]>([])
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
  const [programLinkForm, setProgramLinkForm] = useState({ subject_id: '', sequence_order: '1', prerequisite_subject_id: '', is_required: 'true' })
  const [leadForm, setLeadForm] = useState({ full_name: '', phone: '', email: '', source: 'website', program_interest: '', notes: '' })
  const [sessionForm, setSessionForm] = useState({ sequence: '1', title: '', objectives: '' })
  const [cloneSourceSubjectId, setCloneSourceSubjectId] = useState('')
  const [statusMessage, setStatusMessage] = useState('')
  const [statusTone, setStatusTone] = useState<'success' | 'error'>('success')
  const [statusVersion, setStatusVersion] = useState(0)

  function showStatus(message: string, tone: 'success' | 'error' = 'success') {
    setStatusTone(tone)
    setStatusMessage(message)
    setStatusVersion((version) => version + 1)
  }

  async function loadPrograms() {
    const next = await apiRequest<Program[]>('/training/programs', { method: 'GET' })
    setPrograms(next)
    if (!selectedProgramId && next[0]) setSelectedProgramId(next[0].id)
    if (selectedProgramId) {
      const selected = next.find((item) => item.id === selectedProgramId)
      if (!selected && next[0]) setSelectedProgramId(next[0].id)
    }
  }

  async function loadSubjects() {
    const next = await apiRequest<Subject[]>('/training/subjects', { method: 'GET' })
    setSubjects(next)
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

  async function loadLeads(filters = leadFilters) {
    const params = new URLSearchParams()
    if (filters.q.trim()) params.set('q', filters.q.trim())
    if (filters.status) params.set('status', filters.status)
    if (filters.source) params.set('source', filters.source)
    if (filters.assigned_to) params.set('assigned_to', filters.assigned_to)
    if (filters.from_date) params.set('from_date', filters.from_date)
    if (filters.to_date) params.set('to_date', filters.to_date)
    const next = await apiRequest<LeadRecord[]>(`/leads${params.size ? `?${params.toString()}` : ''}`, { method: 'GET' })
    setLeads(next)
    setSelectedLeadIds((current) => current.filter((id) => next.some((lead) => lead.id === id)))
    setLeadError('')
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
    if (module === 'courses') {
      void loadPrograms().catch((error: Error) => showStatus(error.message, 'error'))
      void loadSubjects().catch((error: Error) => showStatus(error.message, 'error'))
    }
    if (module === 'leads') {
      void loadLeads().catch((error: Error) => setLeadError(error.message))
      if (permission === 'F') {
        apiRequest<LeadAssignee[]>('/leads/assignees', { method: 'GET' })
          .then(setLeadAssignees)
          .catch((error: Error) => setLeadError(error.message))
      }
    }
  }, [module, permission])

  useEffect(() => {
    if (module === 'courses' && selectedProgramId) {
      void loadProgramSubjects(selectedProgramId).catch((error: Error) => showStatus(error.message, 'error'))
      void loadTrainingClasses(selectedProgramId).catch((error: Error) => showStatus(error.message, 'error'))
    }
  }, [module, selectedProgramId])

  useEffect(() => {
    if (module === 'courses' && selectedSubjectId) {
      void loadSubjectSessions(selectedSubjectId).catch((error: Error) => showStatus(error.message, 'error'))
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
    try {
      await apiRequest(editingProgramId ? `/training/programs/${editingProgramId}` : '/training/programs', {
        method: editingProgramId ? 'PATCH' : 'POST',
        body: JSON.stringify(payload),
      })
    } catch (error) {
      showStatus(error instanceof Error ? error.message : 'Không thể lưu chương trình.', 'error')
      return
    }
    setProgramForm({ code: '', name: '', description: '', total_duration_hours: '0', standard_fee: '0', status: 'active' })
    showStatus(editingProgramId ? 'Đã cập nhật chương trình đào tạo.' : 'Đã lưu chương trình đào tạo.')
    setEditingProgramId(null)
    void loadPrograms()
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
  }

  async function deleteProgram(program: Program) {
    if (!window.confirm(`Xóa chương trình ${program.name}? Các liên kết môn học và hồ sơ lớp không còn diễn ra sẽ bị xóa. Chương trình đang có lớp diễn ra không thể xóa.`)) return
    try {
      await apiRequest(`/training/programs/${program.id}`, { method: 'DELETE' })
      showStatus('Đã xóa chương trình đào tạo.')
      if (editingProgramId === program.id) {
        setEditingProgramId(null)
        setProgramForm({ code: '', name: '', description: '', total_duration_hours: '0', standard_fee: '0', status: 'active' })
      }
      await loadPrograms()
    } catch (error) {
      showStatus(error instanceof Error ? error.message : 'Không thể xóa chương trình.', 'error')
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
    try {
      await apiRequest(editingSubjectId ? `/training/subjects/${editingSubjectId}` : '/training/subjects', {
        method: editingSubjectId ? 'PATCH' : 'POST',
        body: JSON.stringify(payload),
      })
    } catch (error) {
      showStatus(error instanceof Error ? error.message : 'Không thể lưu môn học.', 'error')
      return
    }
    setSubjectForm({ code: '', name: '', session_count: '0', weight: '1', description: '', learning_outcomes: '' })
    showStatus(editingSubjectId ? 'Đã cập nhật môn học.' : 'Đã lưu môn học.')
    setEditingSubjectId(null)
    void loadSubjects()
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
  }

  async function deleteSubject(subject: Subject) {
    if (!window.confirm(`Xóa môn học ${subject.name}? Môn sẽ được gỡ khỏi tất cả chương trình và không thể xóa khi đang được dùng trong lớp diễn ra.`)) return
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
    }
  }

  async function saveProgramSubject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedProgramId) return
    const payload = {
      subject_id: Number(programLinkForm.subject_id),
      sequence_order: Number(programLinkForm.sequence_order || 1),
      prerequisite_subject_id: programLinkForm.prerequisite_subject_id ? Number(programLinkForm.prerequisite_subject_id) : null,
      is_required: programLinkForm.is_required === 'true',
    }
    try {
      await apiRequest(`/training/programs/${selectedProgramId}/subjects`, { method: 'POST', body: JSON.stringify(payload) })
    } catch (error) {
      showStatus(error instanceof Error ? error.message : 'Không thể gán môn học vào chương trình.', 'error')
      return
    }
    setProgramLinkForm({ subject_id: '', sequence_order: '1', prerequisite_subject_id: '', is_required: 'true' })
    showStatus('Đã gán môn học vào chương trình.')
    void loadProgramSubjects(selectedProgramId)
  }

  async function removeProgramSubject(item: ProgramSubject) {
    if (!selectedProgramId) return
    try {
      await apiRequest(`/training/programs/${selectedProgramId}/subjects/${item.id}`, { method: 'DELETE' })
      await loadProgramSubjects(selectedProgramId)
      showStatus(`Đã gỡ ${item.name} khỏi chương trình.`)
    } catch (error) {
      showStatus(error instanceof Error ? error.message : 'Không thể gỡ môn học.', 'error')
    }
  }

  async function persistProgramSubjectOrder(orderedItems: ProgramSubject[]) {
    if (!selectedProgramId) return
    try {
      await apiRequest(`/training/programs/${selectedProgramId}/subjects/order`, {
        method: 'PUT',
        body: JSON.stringify({ association_ids: orderedItems.map((item) => item.id) }),
      })
      await loadProgramSubjects(selectedProgramId)
      showStatus('Đã lưu thứ tự môn học.')
    } catch (error) {
      showStatus(error instanceof Error ? error.message : 'Không thể lưu thứ tự môn học.', 'error')
    }
  }

  async function createTrainingClass(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedProgramId) return
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
    }
  }

  async function updateTrainingClass(classId: number, status: TrainingClassRecord['status']) {
    try {
      await apiRequest(`/training/classes/${classId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      })
      if (selectedProgramId) await loadTrainingClasses(selectedProgramId)
      showStatus('Đã cập nhật trạng thái lớp.')
    } catch (error) {
      showStatus(error instanceof Error ? error.message : 'Không thể cập nhật trạng thái lớp.', 'error')
    }
  }

  async function saveSubjectSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedSubjectId) return
    try {
      await apiRequest(`/training/subjects/${selectedSubjectId}/sessions`, {
        method: 'POST',
        body: JSON.stringify({
          sequence: Number(sessionForm.sequence),
          title: sessionForm.title,
          objectives: sessionForm.objectives,
        }),
      })
    } catch (error) {
      showStatus(error instanceof Error ? error.message : 'Không thể lưu buổi học.', 'error')
      return
    }
    setSessionForm({ sequence: String(subjectSessions.length + 2), title: '', objectives: '' })
    showStatus('Đã lưu buổi học.')
    void loadSubjectSessions(selectedSubjectId)
  }

  async function cloneSubjectSessions(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedSubjectId || !cloneSourceSubjectId) return
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
    }
  }

  async function submitLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLeadError('')
    setDuplicateWarning('')
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
    showStatus(editingLeadId ? 'Đã cập nhật lead.' : 'Đã tạo lead và ghi nhận thông tin tư vấn.')
    await loadLeads().catch((error: Error) => setLeadError(error.message))
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
    return (
      <section className="module-landing stack courses-landing">
        <div className="module-icon">{moduleIcons[module]}</div>
        <p className="eyebrow blue">CHƯƠNG TRÌNH ĐÀO TẠO</p>
        <h1>{moduleLabels[module]}</h1>
        <p>Bạn được cấp quyền <strong>{permissionLabel(permission)}</strong> cho chức năng này.</p>
        {statusMessage && <TransientMessage key={`${statusVersion}-${statusTone}-${statusMessage}`} message={statusMessage} tone={statusTone} />}
        {permission === 'F' && <div className="two-column-grid">
          <form className="card-panel" onSubmit={saveProgram}>
            <h3>{editingProgramId ? 'Cập nhật chương trình' : 'Thêm chương trình'}</h3>
            <label>Mã chương trình<input value={programForm.code} onChange={(event) => setProgramForm({ ...programForm, code: event.target.value })} required /></label>
            <label>Tên chương trình<input value={programForm.name} onChange={(event) => setProgramForm({ ...programForm, name: event.target.value })} required /></label>
            <label>Mô tả<textarea value={programForm.description} onChange={(event) => setProgramForm({ ...programForm, description: event.target.value })} /></label>
            <div className="inline-row">
              <label>Thời lượng<input type="number" min="0" value={programForm.total_duration_hours} onChange={(event) => setProgramForm({ ...programForm, total_duration_hours: event.target.value })} /></label>
              <label>Học phí chuẩn<input type="number" min="0" value={programForm.standard_fee} onChange={(event) => setProgramForm({ ...programForm, standard_fee: event.target.value })} /></label>
            </div>
            <label>Trạng thái<select value={programForm.status} onChange={(event) => setProgramForm({ ...programForm, status: event.target.value })}><option value="active">Đang áp dụng</option><option value="inactive">Tạm ngưng</option></select></label>
            <div className="inline-row">
              <button className="primary-button" type="submit">{editingProgramId ? 'Lưu thay đổi' : 'Lưu chương trình'}</button>
              {editingProgramId && <button className="secondary-button" type="button" onClick={() => { setEditingProgramId(null); setProgramForm({ code: '', name: '', description: '', total_duration_hours: '0', standard_fee: '0', status: 'active' }) }}>Hủy sửa</button>}
            </div>
          </form>

          <form className="card-panel" onSubmit={saveSubject}>
            <h3>{editingSubjectId ? 'Cập nhật môn học' : 'Thêm môn học'}</h3>
            <label>Mã môn học<input value={subjectForm.code} onChange={(event) => setSubjectForm({ ...subjectForm, code: event.target.value })} required /></label>
            <label>Tên môn học<input value={subjectForm.name} onChange={(event) => setSubjectForm({ ...subjectForm, name: event.target.value })} required /></label>
            <div className="inline-row">
              <label>Số buổi<input type="number" min="0" value={subjectForm.session_count} onChange={(event) => setSubjectForm({ ...subjectForm, session_count: event.target.value })} /></label>
              <label>Trọng số<input type="number" min="1" value={subjectForm.weight} onChange={(event) => setSubjectForm({ ...subjectForm, weight: event.target.value })} /></label>
            </div>
            <label>Mô tả<textarea value={subjectForm.description} onChange={(event) => setSubjectForm({ ...subjectForm, description: event.target.value })} /></label>
            <label>Kết quả đầu ra<textarea value={subjectForm.learning_outcomes} onChange={(event) => setSubjectForm({ ...subjectForm, learning_outcomes: event.target.value })} /></label>
            <div className="inline-row">
              <button className="primary-button" type="submit">{editingSubjectId ? 'Lưu thay đổi' : 'Lưu môn học'}</button>
              {editingSubjectId && <button className="secondary-button" type="button" onClick={() => { setEditingSubjectId(null); setSubjectForm({ code: '', name: '', session_count: '0', weight: '1', description: '', learning_outcomes: '' }) }}>Hủy sửa</button>}
            </div>
          </form>
        </div>}

        <div className="two-column-grid">
          <div className="card-panel">
            <h3>Danh sách chương trình</h3>
            {programs.length === 0 ? <p className="muted">Chưa có chương trình nào.</p> : (
              <div className="list-stack">
                {programs.map((program) => (
                  <div className="management-list-row" key={program.id}>
                    <button className={selectedProgramId === program.id ? 'list-item active' : 'list-item'} type="button" onClick={() => setSelectedProgramId(program.id)}>
                      <strong>{program.code} · {program.name}</strong>
                      <small>{program.status === 'active' ? 'Đang áp dụng' : 'Tạm ngưng'} · {program.total_duration_hours} giờ · {program.standard_fee.toLocaleString('vi-VN')} VNĐ</small>
                    </button>
                    {permission === 'F' && <div className="row-actions"><button className="row-action" type="button" onClick={() => editProgram(program)}>Sửa</button><button className="row-action danger" type="button" onClick={() => void deleteProgram(program)}>Xóa</button></div>}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card-panel">
            <h3>Liên kết môn học với chương trình</h3>
            {selectedProgramId && permission === 'F' ? (
              <form onSubmit={saveProgramSubject}>
                <label>Chọn môn học<select value={programLinkForm.subject_id} onChange={(event) => setProgramLinkForm({ ...programLinkForm, subject_id: event.target.value })}>
                  <option value="">-- Chọn môn học --</option>
                  {subjects.filter((subject) => !programSubjects.some((link) => link.subject_id === subject.id)).map((subject) => <option key={subject.id} value={String(subject.id)}>{subject.code} · {subject.name}</option>)}
                </select></label>
                <div className="inline-row"><label>Thứ tự<input type="number" min="1" value={programLinkForm.sequence_order} onChange={(event) => setProgramLinkForm({ ...programLinkForm, sequence_order: event.target.value })} /></label><label>Tiên quyết<select value={programLinkForm.prerequisite_subject_id} onChange={(event) => setProgramLinkForm({ ...programLinkForm, prerequisite_subject_id: event.target.value })}><option value="">Không có</option>{programSubjects.filter((item) => String(item.subject_id) !== programLinkForm.subject_id).map((item) => <option key={item.id} value={String(item.subject_id)}>{item.name}</option>)}</select></label></div>
                <label>Bắt buộc<select value={programLinkForm.is_required} onChange={(event) => setProgramLinkForm({ ...programLinkForm, is_required: event.target.value })}><option value="true">Có</option><option value="false">Không</option></select></label>
                <button className="primary-button" type="submit">Gán môn học</button>
              </form>
            ) : <p className="muted">{selectedProgramId ? 'Bạn chỉ có quyền xem chương trình này.' : 'Chọn một chương trình để gán môn học.'}</p>}
            <div className="space-top">
              {programSubjects.length > 0 ? [...programSubjects].sort((a, b) => a.sequence_order - b.sequence_order).map((item) => (
                <div
                  key={item.id}
                  className="curriculum-row"
                  draggable={permission === 'F'}
                  onDragStart={(event) => { setDraggedAssociationId(item.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', String(item.id)) }}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault()
                    const draggedId = draggedAssociationId ?? Number(event.dataTransfer.getData('text/plain'))
                    setDraggedAssociationId(null)
                    if (!draggedId || draggedId === item.id) return
                    const ordered = [...programSubjects].sort((a, b) => a.sequence_order - b.sequence_order)
                    const from = ordered.findIndex((entry) => entry.id === draggedId)
                    const to = ordered.findIndex((entry) => entry.id === item.id)
                    if (from < 0 || to < 0) return
                    const [moved] = ordered.splice(from, 1)
                    ordered.splice(to, 0, moved)
                    void persistProgramSubjectOrder(ordered)
                  }}
                  onDragEnd={() => setDraggedAssociationId(null)}
                >
                  <span className="curriculum-grip" aria-hidden="true">⠿</span>
                  <div className="curriculum-description">
                    <strong>{item.sequence_order}. {item.name}</strong>
                    <small>{item.is_required ? 'Bắt buộc' : 'Tự chọn'}{item.prerequisite_name ? ` · Tiên quyết: ${item.prerequisite_name}` : ''}</small>
                  </div>
                  {permission === 'F' && <button className="row-action danger" type="button" onClick={() => void removeProgramSubject(item)}>Gỡ</button>}
                </div>
              )) : <p className="muted">Chưa có môn nào được gắn cho chương trình này.</p>}
            </div>
          </div>
        </div>
        <div className="card-panel">
          <h3>Lớp thuộc chương trình</h3>
          {selectedProgramId ? (
            <>
              {permission === 'F' && <form className="inline-row class-create-form" onSubmit={(event) => void createTrainingClass(event)}>
                <label>Tên lớp<input value={className} onChange={(event) => setClassName(event.target.value)} maxLength={200} required /></label>
                <button className="primary-button" type="submit" disabled={programs.find((item) => item.id === selectedProgramId)?.status !== 'active'}>Tạo lớp</button>
              </form>}
              {trainingClasses.length > 0 ? <div className="list-stack space-top">
                {trainingClasses.map((trainingClass) => <div className="class-row" key={trainingClass.id}>
                  <strong>{trainingClass.name}</strong>
                  {permission === 'F' ? <select aria-label={`Trạng thái lớp ${trainingClass.name}`} value={trainingClass.status} onChange={(event) => void updateTrainingClass(trainingClass.id, event.target.value as TrainingClassRecord['status'])}>
                    <option value="planned">Chuẩn bị</option><option value="running">Đang diễn ra</option><option value="completed">Đã kết thúc</option><option value="cancelled">Đã hủy</option>
                  </select> :                   <small>{trainingClass.status === 'planned' ? 'Chuẩn bị' : trainingClass.status === 'running' ? 'Đang diễn ra' : trainingClass.status === 'completed' ? 'Đã kết thúc' : 'Đã hủy'}</small>}
                </div>)}
              </div> : <p className="muted">Chưa có lớp nào được mở từ chương trình này.</p>}
            </>
          ) : <p className="muted">Chọn chương trình để quản lý các lớp.</p>}
        </div>
        <div className="two-column-grid">
          <div className="card-panel">
            <h3>Danh sách môn học</h3>
            {subjects.length === 0 ? <p className="muted">Chưa có môn học nào.</p> : (
              <div className="list-stack">
                {subjects.map((subject) => (
                  <div className="management-list-row" key={subject.id}>
                    <button className={selectedSubjectId === subject.id ? 'list-item active' : 'list-item'} type="button" onClick={() => setSelectedSubjectId(subject.id)}>
                      <strong>{subject.code} · {subject.name}</strong>
                      <small>{subject.session_count} buổi · Trọng số {subject.weight}</small>
                    </button>
                    {permission === 'F' && <div className="row-actions"><button className="row-action" type="button" onClick={() => editSubject(subject)}>Sửa</button><button className="row-action danger" type="button" onClick={() => void deleteSubject(subject)}>Xóa</button></div>}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="card-panel">
            <h3>Buổi học theo môn</h3>
            {!selectedSubjectId ? <p className="muted">Chọn một môn học để xem hoặc thêm buổi học.</p> : (
              <>
                {permission === 'F' && <form onSubmit={(event) => void saveSubjectSession(event)}>
                  <div className="inline-row">
                    <label>Thứ tự buổi<input type="number" min="1" value={sessionForm.sequence} onChange={(event) => setSessionForm({ ...sessionForm, sequence: event.target.value })} required /></label>
                    <label>Tên buổi<input value={sessionForm.title} onChange={(event) => setSessionForm({ ...sessionForm, title: event.target.value })} required /></label>
                  </div>
                  <label>Mục tiêu<textarea value={sessionForm.objectives} onChange={(event) => setSessionForm({ ...sessionForm, objectives: event.target.value })} /></label>
                  <button className="primary-button" type="submit">Thêm buổi học</button>
                </form>}
                {permission === 'F' && <form className="inline-row session-clone-form" onSubmit={(event) => void cloneSubjectSessions(event)}>
                  <label>Sao chép buổi từ môn<select value={cloneSourceSubjectId} onChange={(event) => setCloneSourceSubjectId(event.target.value)} required>
                    <option value="">-- Chọn môn nguồn --</option>
                    {subjects.filter((subject) => subject.id !== selectedSubjectId).map((subject) => <option key={subject.id} value={String(subject.id)}>{subject.code} · {subject.name}</option>)}
                  </select></label>
                  <button className="secondary-button" type="submit">Sao chép buổi</button>
                </form>}
                <div className="space-top">
                  {subjectSessions.length > 0 ? subjectSessions.map((session) => <div className="list-row" key={session.id}><span>{session.sequence}. {session.title}</span><small>{session.objectives}</small></div>) : <p className="muted">Chưa có buổi học nào.</p>}
                </div>
              </>
            )}
          </div>
        </div>
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
        <div className="two-column-grid lead-workspace-grid">
          {(permission === 'F' || permission === 'W') && <form className="card-panel lead-create-form" onSubmit={submitLead}>
            <h3>{editingLeadId ? 'Chỉnh sửa lead' : 'Tạo lead'}</h3>
            <label>Họ tên<input value={leadForm.full_name} onChange={(event) => setLeadForm({ ...leadForm, full_name: event.target.value })} placeholder="Ví dụ: Nguyễn Văn An" /></label>
            <label>Số điện thoại<input value={leadForm.phone} onChange={(event) => { setLeadForm({ ...leadForm, phone: event.target.value }); setDuplicateWarning('') }} onBlur={() => void checkLeadDuplicate(leadForm.phone, editingLeadId ?? undefined)} placeholder="Ví dụ: 0912345678" /></label>
            {duplicateWarning && <div className="form-error" role="alert">{duplicateWarning}</div>}
            <label>Email<input type="email" value={leadForm.email} onChange={(event) => setLeadForm({ ...leadForm, email: event.target.value })} placeholder="Ví dụ: an@example.com (không bắt buộc)" /></label>
            <label>Chương trình quan tâm<input value={leadForm.program_interest} onChange={(event) => setLeadForm({ ...leadForm, program_interest: event.target.value })} placeholder="Khóa học muốn tìm hiểu, ví dụ: Lập trình Web" /><small className="field-hint">Ghi tên khóa học/lĩnh vực khách muốn tư vấn; chưa rõ thì có thể để trống.</small></label>
            <label>Nguồn<select value={leadForm.source} onChange={(event) => setLeadForm({ ...leadForm, source: event.target.value })}><option value="website">Website</option><option value="facebook">Facebook</option><option value="walkin">Tự đến</option><option value="referral">Giới thiệu</option></select></label>
            <label>Ghi chú<textarea value={leadForm.notes} onChange={(event) => setLeadForm({ ...leadForm, notes: event.target.value })} placeholder="Ví dụ: Thời gian thuận tiện để liên hệ hoặc nội dung cần tư vấn." /></label>
            <div className="inline-row">
              <button className="primary-button" type="submit">{editingLeadId ? 'Lưu chỉnh sửa' : 'Tạo lead'}</button>
              {editingLeadId && <button className="secondary-button" type="button" onClick={() => { setEditingLeadId(null); setLeadForm({ full_name: '', phone: '', email: '', source: 'website', program_interest: '', notes: '' }); setDuplicateWarning('') }}>Hủy sửa</button>}
            </div>
          </form>}

          <div className="card-panel lead-list-panel">
            <h3>Danh sách lead</h3>
            <form className="lead-filters" onSubmit={(event) => { event.preventDefault(); void loadLeads().catch((error: Error) => setLeadError(error.message)) }}>
              <label>Tìm kiếm<input placeholder="Tên, điện thoại hoặc email" value={leadFilters.q} onChange={(event) => setLeadFilters({ ...leadFilters, q: event.target.value })} /></label>
              <div className="inline-row">
                <label>Trạng thái<select value={leadFilters.status} onChange={(event) => setLeadFilters({ ...leadFilters, status: event.target.value })}><option value="">Tất cả</option><option value="new">Mới</option><option value="assigned">Đã phân công</option><option value="contacted">Đã liên hệ</option><option value="qualified">Tiềm năng</option><option value="converted">Đã đăng ký</option><option value="lost">Không tiếp tục</option></select></label>
                <label>Nguồn<select value={leadFilters.source} onChange={(event) => setLeadFilters({ ...leadFilters, source: event.target.value })}><option value="">Tất cả</option><option value="website">Website</option><option value="facebook">Facebook</option><option value="walkin">Tự đến</option><option value="referral">Giới thiệu</option></select></label>
              </div>
              {permission === 'F' && <label>Người phụ trách<select value={leadFilters.assigned_to} onChange={(event) => setLeadFilters({ ...leadFilters, assigned_to: event.target.value })}><option value="">Tất cả người phụ trách</option>{leadAssignees.map((assignee) => <option key={assignee.id} value={String(assignee.id)}>{assignee.full_name}</option>)}</select></label>}
              <div className="inline-row">
                <label>Từ ngày<input type="date" value={leadFilters.from_date} onChange={(event) => setLeadFilters({ ...leadFilters, from_date: event.target.value })} /></label>
                <label>Đến ngày<input type="date" value={leadFilters.to_date} onChange={(event) => setLeadFilters({ ...leadFilters, to_date: event.target.value })} /></label>
              </div>
              <button className="secondary-button" type="submit">Lọc danh sách</button>
            </form>
            {permission === 'F' && <form className="inline-row lead-bulk-assign" onSubmit={(event) => void assignSelectedLeads(event)}>
              <span>{selectedLeadIds.length} lead đã chọn</span>
              <label>Phân công cho<select value={bulkAssigneeId} onChange={(event) => setBulkAssigneeId(event.target.value)} required><option value="">-- Chọn tư vấn viên --</option>{leadAssignees.map((assignee) => <option key={assignee.id} value={String(assignee.id)}>{assignee.full_name}</option>)}</select></label>
              <button className="secondary-button" type="submit" disabled={selectedLeadIds.length === 0}>Phân công hàng loạt</button>
            </form>}
            {leads.length === 0 ? <p className="muted">Chưa có lead nào.</p> : (
              <div className="list-stack">
                {leads.map((lead) => (
                  <div key={lead.id} className="list-item compact">
                    {permission === 'F' && <label className="lead-select-checkbox"><input type="checkbox" checked={selectedLeadIds.includes(lead.id)} onChange={(event) => setSelectedLeadIds((current) => event.target.checked ? [...current, lead.id] : current.filter((id) => id !== lead.id))} />Chọn để phân công</label>}
                    <strong>{lead.full_name}</strong>
                    <small>
                      {lead.phone}{lead.email ? ` · ${lead.email}` : ''} · {
                        lead.source === 'website' ? 'Website' :
                          lead.source === 'facebook' ? 'Facebook' :
                            lead.source === 'walkin' ? 'Khách đến trực tiếp' : 'Được giới thiệu'
                      } · {
                        lead.status === 'new' ? 'Mới' :
                          lead.status === 'assigned' ? 'Đã phân công' :
                            lead.status === 'contacted' ? 'Đã liên hệ' :
                              lead.status === 'qualified' ? 'Tiềm năng' :
                                lead.status === 'converted' ? 'Đã đăng ký' : 'Không tiếp tục'
                      }{lead.assigned_to_name ? ` · Phụ trách: ${lead.assigned_to_name}` : ''}
                    </small>
                    {(permission === 'F' || permission === 'W') && <div className="inline-row lead-actions">
                      <label>Trạng thái<select value={lead.status} onChange={(event) => void updateLead(lead.id, event.target.value)}><option value="new">Mới</option><option value="assigned">Đã phân công</option><option value="contacted">Đã liên hệ</option><option value="qualified">Tiềm năng</option><option value="converted">Đã đăng ký</option><option value="lost">Không tiếp tục</option></select></label>
                      {permission === 'F' && <label>Người phụ trách<select value={lead.assigned_to_user_id ? String(lead.assigned_to_user_id) : ''} onChange={(event) => void assignLead(lead.id, event.target.value)}><option value="">Chưa phân công</option>{leadAssignees.map((assignee) => <option key={assignee.id} value={String(assignee.id)}>{assignee.full_name}</option>)}</select></label>}
                      <button className="secondary-button" type="button" onClick={() => editLead(lead)}>Sửa lead</button>
                      {canDeleteLeads && <button className="secondary-button" type="button" onClick={() => void removeLead(lead)}>Xóa lead</button>}
                      <button className="secondary-button" type="button" onClick={() => void toggleLeadHistory(lead.id)}>{expandedLeadId === lead.id ? 'Ẩn lịch sử' : 'Lịch sử trao đổi'}</button>
                    </div>}
                    {expandedLeadId === lead.id && <div className="lead-history">
                      <h4>Lịch sử trao đổi</h4>
                      {leadInteractions.length === 0 ? <p className="muted">Chưa có lịch sử.</p> : <div className="list-stack">{leadInteractions.map((item) => <div className="lead-history-item" key={item.id}><strong>{item.user_name}</strong><small>{new Date(item.created_at).toLocaleString('vi-VN')} · {item.action}</small><p>{item.note}</p></div>)}</div>}
                      {(permission === 'F' || permission === 'W') && <form className="lead-history-form" onSubmit={(event) => void addLeadInteraction(event, lead.id)}><label>Ghi chú cuộc gọi / lần trao đổi<textarea value={interactionNote} onChange={(event) => setInteractionNote(event.target.value)} maxLength={2000} required /></label><button className="secondary-button" type="submit">Lưu vào lịch sử</button></form>}
                    </div>}
                  </div>
                ))}
              </div>
            )}
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
    setSaving(true)
    setError('')
    try {
      const parsedDateOfBirth = parseDateOfBirth(dateOfBirth)
      if (parsedDateOfBirth === null) {
        setError('Ngày sinh không hợp lệ. Vui lòng nhập theo định dạng dd/mm/yyyy.')
        return
      }
      await onUpdate({ full_name: fullName, phone, date_of_birth: parsedDateOfBirth, address })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể cập nhật hồ sơ.')
    } finally {
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
        {error && <div className="form-error" role="alert">{error}</div>}
        <form className="profile-form-scroll" id="profile-form" onSubmit={saveProfile}>
          <div className="profile-sections">
            <section className="profile-card">
              <div className="profile-card-heading"><h3>Thông tin tài khoản</h3></div>
              <div className="profile-card-body profile-account-fields">
                <div className="profile-avatar-section">
                  {user.avatar_url ? (
                    <button className="profile-avatar-button" type="button" onClick={() => setAvatarPreviewOpen(true)} aria-label="Xem ảnh đại diện kích thước lớn">
                      <Avatar name={user.full_name} avatarUrl={user.avatar_url} />
                    </button>
                  ) : <Avatar name={user.full_name} />}
                  <label>Ảnh đại diện<input type="file" accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp" onChange={(event) => void selectAvatar(event)} disabled={uploading} /></label>
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
            <button className="primary-button" type="submit" disabled={saving}>{saving ? 'Đang lưu...' : 'Lưu hồ sơ'}</button>
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
  onEdit,
  onDelete,
  onStatus,
  onImport,
  onPreviewImport,
}: {
  users: User[]
  page: UserPage
  ownerId: number
  canManage: boolean
  onQuery: (filters: UserFilters) => Promise<void>
  onCreate: () => void
  onEdit: (id: number, data: UserInput) => Promise<void>
  onDelete: (user: User) => Promise<void>
  onStatus: (user: User, active: boolean, reason: string) => Promise<void>
  onImport: (file: File) => Promise<{ imported: number; skipped: number; errors: string[] }>
  onPreviewImport: (file: File) => Promise<ImportPreview>
}) {
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
  const [importError, setImportError] = useState('')
  const [importing, setImporting] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(() => {
    const value = sessionStorage.getItem(`tms:editing-user:${ownerId}`)
    return value ? Number(value) : null
  })
  const [lockingId, setLockingId] = useState<number | null>(() => {
    const value = sessionStorage.getItem(`tms:locking-user:${ownerId}`)
    return value ? Number(value) : null
  })
  const editing = users.find((item) => item.id === editingId) ?? null
  const locking = users.find((item) => item.id === lockingId) ?? null
  const pageCount = Math.max(1, Math.ceil(page.total / page.page_size))
  const importHasValidationErrors = Boolean(importError)
    || Boolean(importPreview && (importPreview.valid === 0 || importPreview.skipped > 0))

  function selectImportFile(file: File | null) {
    setImportFile(file)
    setImportPreview(null)
    setImportResult(null)
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
    try {
      await onQuery(filters)
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
      setImportResult(await onImport(importFile))
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
    <div className="view">
      <div className="page-heading">
        <div><p className="eyebrow blue">QUẢN TRỊ HỆ THỐNG</p><h1>Tài khoản</h1><p className="muted">Quản lý thành viên và quyền truy cập vào hệ thống.</p></div>
        {canManage && <button className="primary-button" onClick={onCreate}>＋ Tạo tài khoản</button>}
      </div>
      {canManage && (
        <section className="card-panel import-panel">
          <div className="section-title">
            <div><h2>Nhập tài khoản từ Excel</h2><p className="muted">Cột bắt buộc: full_name, email, roles. Nhiều vai trò phân tách bằng dấu phẩy; nếu chưa cấu hình email, cần nhập initial_password tối thiểu 8 ký tự.</p></div>
            <button className="secondary-button" type="button" onClick={() => void downloadTemplate()}>Tải file mẫu</button>
          </div>
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
                      : 'Kiểm tra dữ liệu'}
              </button>
              <button className="primary-button" type="submit" disabled={!importPreview || importPreview.valid === 0 || importing}>
                {importing ? 'Đang nhập...' : `Nhập ${importPreview?.valid ?? ''} dòng hợp lệ`}
              </button>
            </div>
          </form>
          {importError && <div className="form-error" role="alert">{importError}</div>}
          {importPreview && (
            <div className={`import-preview${importPreview.valid > 0 ? ' has-valid-rows' : ' has-no-valid-rows'}`} role="status" aria-live="polite">
              <div className="import-preview-summary">
                <span className="import-summary-icon" aria-hidden="true">{importPreview.valid > 0 ? '✓' : '!'}</span>
                <div>
                  <strong>{importPreview.valid > 0 ? 'Kiểm tra dữ liệu hoàn tất' : 'Không có dòng hợp lệ để nhập'}</strong>
                  <p>{importPreview.valid} dòng hợp lệ <span>·</span> {importPreview.skipped} dòng cần bỏ qua</p>
                </div>
              </div>
              {importPreview.preview_rows.length > 0 && (
                <div className="import-table-wrap">
                  <div className="import-table-heading">
                    <strong>Xem trước dữ liệu</strong>
                    <span>{Math.min(importPreview.preview_rows.length, 20)} / {importPreview.valid} dòng đầu tiên</span>
                  </div>
                  <table className="import-preview-table">
                    <thead><tr><th>Dòng</th><th>Họ và tên</th><th>Email</th><th>Vai trò</th><th>Điện thoại</th><th>Lớp</th></tr></thead>
                    <tbody>
                      {importPreview.preview_rows.map((row) => (
                        <tr key={`${row.row_number}-${row.email}`}>
                          <td>{row.row_number}</td>
                          <td>{row.full_name}</td>
                          <td>{row.email}</td>
                          <td>{row.roles.map((role) => roleOptions.find(([value]) => value === role)?.[1] ?? role).join(', ')}</td>
                          <td>{row.phone || '—'}</td>
                          <td>{row.assigned_classes.join(', ') || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {importPreview.errors.length > 0 && (
                <details className="import-validation-errors">
                  <summary>Xem {importPreview.errors.length} dòng có lỗi</summary>
                  <ul>{importPreview.errors.map((item) => <li key={item}>{item}</li>)}</ul>
                </details>
              )}
            </div>
          )}
          {importResult && (
            <div className="form-success" role="status">
              Đã nhập {importResult.imported} tài khoản; bỏ qua {importResult.skipped} dòng lỗi.
              {importResult.errors.length > 0 && <ul>{importResult.errors.map((item) => <li key={item}>{item}</li>)}</ul>}
            </div>
          )}
        </section>
      )}
      <section className="table-card">
        <div className="table-toolbar">
          <form className="user-filters" onSubmit={submitSearch} noValidate>
            <div className="search-box">⌕<input placeholder="Tên, email hoặc số điện thoại" value={query} onChange={(event) => updateQuery(event.target.value)} disabled={searching} /></div>
            <select aria-label="Lọc theo vai trò" value={roleFilter} onChange={(event) => updateFilter(event.target.value, activeFilter)} disabled={searching}>
              <option value="">Tất cả vai trò</option>
              {roleOptions.map(([role, label]) => <option key={role} value={role}>{label}</option>)}
            </select>
            <select aria-label="Lọc theo trạng thái" value={activeFilter} onChange={(event) => updateFilter(roleFilter, event.target.value)} disabled={searching}>
              <option value="">Mọi trạng thái</option><option value="true">Đang hoạt động</option><option value="false">Đã khóa</option>
            </select>
            <button className="secondary-button search-submit" type="submit" disabled={searching} aria-busy={searching}>
              {searching ? 'Đang tìm...' : 'Tìm kiếm'}
            </button>
          </form>
          <span className="table-count">{page.total} tài khoản</span>
        </div>
        {searchError && <div className="form-error search-error" role="alert">{searchError}</div>}
        <div className="table-scroll">
          <table>
            <thead><tr><th>Người dùng</th><th>Vai trò</th><th>Trạng thái</th><th>Ngày tạo</th><th /></tr></thead>
            <tbody>
              {users.map((item) => (
                <tr key={item.id}>
                  <td><div className="user-cell"><Avatar name={item.full_name} avatarUrl={item.avatar_url} /><span><strong>{item.full_name}</strong><small>{item.email}{item.phone ? ` · ${item.phone}` : ''}</small></span></div></td>
                  <td>{item.roles.map((role) => roleLabels[role]).join(', ')}</td>
                  <td><span className={item.is_active ? 'status-pill active' : 'status-pill locked'}><i />{item.is_active ? 'Hoạt động' : 'Đã khóa'}</span>{item.lock_reason && <small className="lock-reason">{item.lock_reason}</small>}</td>
                  <td className="date-cell">{new Date(item.created_at).toLocaleDateString('vi-VN')}</td>
                  {canManage ? (
                    <td className="row-actions">
                      <button className="row-action" onClick={() => { sessionStorage.setItem(`tms:editing-user:${ownerId}`, String(item.id)); setEditingId(item.id) }}>Sửa</button>
                      {item.is_active
                        ? <button className="row-action danger" onClick={() => { sessionStorage.setItem(`tms:locking-user:${ownerId}`, String(item.id)); setLockingId(item.id) }}>Khóa</button>
                        : <button className="row-action" onClick={() => void onStatus(item, true, '').catch(() => undefined)}>Mở khóa</button>}
                    </td>
                  ) : <td />}
                </tr>
              ))}
              {users.length === 0 && <tr><td colSpan={5} className="empty-users">Không tìm thấy tài khoản phù hợp.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="pagination">
          <span>Trang {page.page} / {pageCount} · Hiển thị tối đa 20 tài khoản</span>
          <div>
            <button className="secondary-button" disabled={page.page <= 1 || searching} onClick={() => void runQuery({ q: query, role: roleFilter, active: activeFilter, page: page.page - 1 })}>Trước</button>
            <button className="secondary-button" disabled={page.page >= pageCount || searching} onClick={() => void runQuery({ q: query, role: roleFilter, active: activeFilter, page: page.page + 1 })}>Sau</button>
          </div>
        </div>
      </section>
      {canManage && editing && <UserModal ownerId={ownerId} user={editing} title="Chỉnh sửa tài khoản" onClose={() => { sessionStorage.removeItem(`tms:editing-user:${ownerId}`); setEditingId(null) }} onSave={async (data) => { await onEdit(editing.id, data); sessionStorage.removeItem(`tms:editing-user:${ownerId}`); setEditingId(null) }} onDelete={async () => { await onDelete(editing); sessionStorage.removeItem(`tms:editing-user:${ownerId}`); setEditingId(null) }} />
      }
      {canManage && locking && <LockUserModal reasonKey={`tms:lock-reason:${ownerId}:${locking.id}`} user={locking} onClose={() => { sessionStorage.removeItem(`tms:locking-user:${ownerId}`); sessionStorage.removeItem(`tms:lock-reason:${ownerId}:${locking.id}`); setLockingId(null) }} onConfirm={async (reason) => { await onStatus(locking, false, reason); sessionStorage.removeItem(`tms:locking-user:${ownerId}`); sessionStorage.removeItem(`tms:lock-reason:${ownerId}:${locking.id}`); setLockingId(null) }} />}
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

function UserModal({ user, ownerId, title, onClose, onSave, onDelete }: { user?: User; ownerId: number; title: string; onClose: () => void; onSave: (data: UserInput) => Promise<void>; onDelete?: () => Promise<void> }) {
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
      if (message.toLocaleLowerCase('vi').includes('email')) {
        setEmailError(message)
      } else {
        setError(message)
      }
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
    sessionStorage.removeItem(draftKey)
    onClose()
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) close() }}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="user-modal-title">
        <div className="modal-header"><div><p className="eyebrow blue">THÔNG TIN TÀI KHOẢN</p><h2 id="user-modal-title">{title}</h2></div><button className="close-button" onClick={close} aria-label="Đóng">×</button></div>
        <form onSubmit={submit} className="create-form" noValidate>
          <label>Họ và tên<input value={name} onChange={(event) => { const value = event.target.value; saveDraft({ full_name: value }); setName(value); if (value.trim().length >= 2) setNameError('') }} onBlur={() => { if (name.trim().length < 2) setNameError('Vui lòng nhập họ và tên (ít nhất 2 ký tự).') }} minLength={2} required aria-invalid={Boolean(nameError)} aria-describedby={nameError ? 'user-name-error' : undefined} />{nameError && <span className="field-error" id="user-name-error">{nameError}</span>}</label>
          <label>Email<input value={email} onChange={(event) => { const value = event.target.value; saveDraft({ email: value }); setEmail(value); if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) setEmailError('') }} onBlur={() => { const value = email.trim(); setEmailError(!value ? 'Vui lòng nhập email.' : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? 'Vui lòng nhập địa chỉ email hợp lệ.' : '') }} type="email" required aria-invalid={Boolean(emailError)} aria-describedby={emailError ? 'user-email-error' : undefined} />{emailError && <span className="field-error" id="user-email-error" role="alert">{emailError}</span>}</label>
          <label>Số điện thoại<input value={phone} onChange={(event) => { saveDraft({ phone: event.target.value }); setPhone(event.target.value) }} type="tel" maxLength={40} /></label>
          <label>Lớp phụ trách (phân cách bằng dấu phẩy)<input value={assignedClasses} onChange={(event) => { const value = event.target.value; saveDraft({ assigned_classes: value.split(',').map((item) => item.trim()).filter(Boolean) }); setAssignedClasses(value) }} placeholder="Ví dụ: TMS-K14, TMS-K15" /></label>
          <RolePicker selected={roles} onChange={(value) => { saveDraft({ roles: value }); setRoles(value); if (value.length > 0) setRolesError('') }} />
          {rolesError && <span className="field-error" role="alert">{rolesError}</span>}
          {!user && <p className="form-hint">Hệ thống sẽ gửi email kích hoạt kèm mật khẩu tạm; người dùng cần đổi mật khẩu ở lần đăng nhập đầu tiên.</p>}
          {error && <div className="form-error" role="alert">{error}</div>}
          {user && onDelete && user.id !== ownerId && (
            <div className="delete-account">
              {!confirmDelete ? (
                <button type="button" className="row-action danger" onClick={() => { setConfirmDelete(true); setDeleteError('') }}>Xóa tài khoản</button>
              ) : (
                <div className="delete-confirmation" role="alert">
                  <p>Xóa vĩnh viễn tài khoản <strong>{user.email}</strong>? Thao tác này không thể hoàn tác.</p>
                  {deleteError && <span className="field-error">{deleteError}</span>}
                  <div className="modal-actions">
                    <button type="button" className="secondary-button" disabled={deleting} onClick={() => setConfirmDelete(false)}>Hủy</button>
                    <button type="button" className="danger-button" disabled={deleting} onClick={() => void submitDelete()}>{deleting ? 'Đang xóa...' : 'Xác nhận xóa vĩnh viễn'}</button>
                  </div>
                </div>
              )}
            </div>
          )}
          {user && onDelete && user.id === ownerId && <p className="form-hint">Không thể tự xóa tài khoản đang đăng nhập.</p>}
          <div className="modal-actions"><button type="button" className="secondary-button" onClick={close}>Hủy</button><button className="primary-button" type="submit" disabled={saving || deleting}>{saving ? 'Đang lưu...' : user ? 'Lưu thay đổi' : 'Tạo tài khoản'}</button></div>
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
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Không thể khóa tài khoản')
    }
  }
  return (
    <div className="modal-backdrop">
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="lock-modal-title">
        <div className="modal-header"><div><p className="eyebrow blue">THU HỒI TRUY CẬP</p><h2 id="lock-modal-title">Khóa tài khoản</h2></div><button className="close-button" onClick={onClose} aria-label="Đóng">×</button></div>
        <form onSubmit={submit} className="create-form" noValidate>
          <p className="muted">Tài khoản của {user.full_name} sẽ bị đăng xuất khỏi mọi phiên đang mở.</p>
          <label>Lý do khóa<textarea value={reason} onChange={(event) => { sessionStorage.setItem(reasonKey, event.target.value); setReason(event.target.value) }} rows={3} maxLength={500} required /></label>
          {error && <div className="form-error" role="alert">{error}</div>}
          <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Hủy</button><button className="primary-button" type="submit">Xác nhận khóa</button></div>
        </form>
      </section>
    </div>
  )
}

function ChangePasswordModal({ required, onClose, onChange }: { required: boolean; onClose: () => void; onChange: (data: { current_password: string; new_password: string }) => Promise<void> }) {
  const [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const currentPassword = String(data.get('current_password') ?? '')
    const nextPassword = String(data.get('new_password') ?? '')
    if (!currentPassword) {
      setError('Vui lòng nhập mật khẩu hiện tại.')
      return
    }
    if (nextPassword.length < 8 || !/[A-Za-z]/.test(nextPassword) || !/\d/.test(nextPassword)) {
      setError('Mật khẩu mới phải có ít nhất 8 ký tự, gồm chữ cái và chữ số.')
      return
    }
    try {
      await onChange({ current_password: currentPassword, new_password: nextPassword })
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Không thể đổi mật khẩu')
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
          <p className="form-hint">Mật khẩu tối thiểu 8 ký tự, bao gồm ít nhất một chữ cái và một chữ số.</p>
          {error && <div className="form-error" role="alert">{error}</div>}
          <div className="modal-actions">{!required && <button type="button" className="secondary-button" onClick={onClose}>Hủy</button>}<button className="primary-button" type="submit">Cập nhật mật khẩu</button></div>
        </form>
      </section>
    </div>
  )
}

export default App
