import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { SearchableSelect } from './SearchableSelect'
import './Operations.css'

const apiBase = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000'
type ModuleKey = 'leads' | 'student_records' | 'classes' | 'attendance'
type Api = <T>(path: string, options?: RequestInit) => Promise<T>
type Props = {
  module: ModuleKey
  permission: 'R' | 'W' | 'F'
  user: { id: number; full_name: string; role: string; roles: string[] }
  request: Api
  notify: (message: string, tone?: 'success' | 'error') => void
}
type Page<T> = { items: T[]; total: number; page: number; page_size: number }
type Lead = {
  id: number; full_name: string; phone: string; email?: string | null; source?: string
  status: string; program_interest?: string | null; notes?: string | null
  assigned_to_name?: string | null; created_at?: string
}
type Interaction = {
  id: number; action: string; interaction_type: string; content: string; follow_up_at?: string | null
  created_at: string; user_name?: string
}
type Student = {
  id: number; full_name: string; email?: string | null; phone?: string | null
  status?: string; current_class?: string | null; class_name?: string | null
  student_code?: string; date_of_birth?: string | null; address?: string | null
  entry_level?: string | null; notes?: string | null
  class_history?: { class_id: number; class_code?: string | null; class_name: string; status: string; enrolled_at: string; effective_from: string; effective_to?: string | null }[]
  status_history?: { id: number; action: string; effective_date: string; reason: string; created_at: string; target_class_id?: number | null }[]
}
type StudentHistoryEntry =
  | { type: 'class'; class_id: number; class_code?: string | null; class_name: string; status: string; enrolled_at: string; effective_from: string; effective_to?: string | null }
  | { type: 'status'; id: number; action: string; effective_date: string; reason: string; created_at: string; target_class_id?: number | null }
type TrainingClass = {
  id: number; code?: string; name: string; program_id: number; program_name?: string
  start_date?: string; capacity?: number; format?: string; status: string
  enrolled_count?: number; enrollment_count?: number; curriculum_progress?: number
  scheduled_lessons?: number; completed_lessons?: number; instructor_ids?: number[]
  subjects?: { subject_id: number; instructor_id?: number; ta_ids?: number[] }[]
}
type TrainingRoom = {
  id: number; name: string; code?: string; room_type?: string; capacity: number | null
  location?: string | null; online_link?: string | null; is_active?: boolean
}
type TrainingSession = {
  id: number; class_id: number; class_name?: string; subject_name?: string
  title?: string; start_at: string; end_at: string; instructor_id?: number
  instructor_name?: string; room_id?: number | null; room_name?: string | null
  status?: string; conflict?: boolean; starts_at?: string; ends_at?: string
  conflicts?: unknown[]
}
type AttendanceEntry = {
  student_id: number; student_name?: string; full_name?: string; status: string | null; note?: string | null
  updated_at?: string | null; updated_by?: string | null
}
type AbsenceRequest = {
  id: number; student_id?: number; student_name?: string; session_id?: number; lesson_id?: number
  session_title?: string; reason: string; evidence_url?: string | null; evidence_ref?: string | null; status: string
  decision_reason?: string | null; starts_at?: string | null; created_at?: string
}
type Program = { id: number; name: string; code?: string }
type Subject = { id: number; name: string; code?: string; session_count?: number }
type Person = { id: number; full_name: string; roles?: string[]; role?: string }
type ClassEnrollmentRecord = {
  student_id: number; student_code: string; full_name: string; status: string
  enrolled_at: string; enrolled_by?: string | null; effective_from: string; effective_to?: string | null
}

const statusLabels: Record<string, string> = {
  new: 'Mới', contacted: 'Đã liên hệ', consulting: 'Đang tư vấn',
  trial: 'Hẹn học thử', won: 'Chốt', converted: 'Đã nhập học',
  planned: 'Đã lên kế hoạch', running: 'Đang học', completed: 'Hoàn thành',
  cancelled: 'Đã hủy', active: 'Đang hoạt động', deferred: 'Bảo lưu',
  transferred: 'Chuyển lớp', withdrawn: 'Đã thôi học', present: 'Có mặt',
  absent: 'Vắng', unexcused: 'Vắng không phép', late: 'Đi muộn', excused: 'Có phép', pending: 'Chờ duyệt',
  approved: 'Đã duyệt', rejected: 'Từ chối',
  conflict: 'Xung đột lịch',
}
const leadStages = ['new', 'contacted', 'consulting', 'trial', 'won', 'rejected', 'converted']
const leadTransitionStages = leadStages.filter((stage) => stage !== 'converted')
const localDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const localDateTime = (date: Date = new Date()) => {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
const today = () => localDate(new Date())
const dateTime = (value?: string | null) => value ? new Date(value).toLocaleString('vi-VN', { dateStyle: 'medium', timeStyle: 'short' }) : '—'
const displayDate = (value?: string | null) => value ? new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString('vi-VN') : '—'
const qs = (entries: Record<string, string | number | undefined>) => {
  const params = new URLSearchParams()
  Object.entries(entries).forEach(([key, value]) => { if (value !== undefined && String(value).trim()) params.set(key, String(value)) })
  return params.toString()
}
const asPage = <T,>(value: Page<T> | T[]): Page<T> => Array.isArray(value)
  ? { items: value, total: value.length, page: 1, page_size: value.length || 20 } : value
const normalizeSession = (value: TrainingSession) => ({
  ...value,
  start_at: value.start_at || value.starts_at || '',
  end_at: value.end_at || value.ends_at || '',
})
const normalizeClass = (value: TrainingClass): TrainingClass => ({
  ...value,
  enrolled_count: value.enrolled_count ?? value.enrollment_count ?? 0,
  curriculum_progress: value.status === 'completed'
    ? 100
    : (value.curriculum_progress ?? (value.scheduled_lessons ? Math.round(((value.completed_lessons ?? 0) / value.scheduled_lessons) * 100) : 0)),
})
const normalizeStudent = (value: Student): Student => ({
  ...value,
  current_class: value.current_class ?? value.class_history?.find((item) => item.status === 'active')?.class_name ?? null,
})

export function TopbarNavPortal({ children }: { children: React.ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(() => {
    if (typeof document !== 'undefined') {
      return document.getElementById('topbar-nav-slot')
    }
    return null
  })

  useEffect(() => {
    if (!target) {
      setTarget(document.getElementById('topbar-nav-slot'))
    }
  }, [target])

  if (!target) return <div className="ops-tabs-fallback">{children}</div>
  return createPortal(children, target)
}

function OpsHeader({ eyebrow, title, subtitle, action }: { eyebrow?: string; title?: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="ops-header">
      <div>
        {eyebrow && <span className="ops-eyebrow">{eyebrow}</span>}
        {title && <h2 className="ops-header-title">{title}</h2>}
        {subtitle && <p className="ops-header-subtitle">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}
export type TabDef = [string, string, (number | string)?]
export function OpsTabs({ tabs, value, onChange }: { tabs: TabDef[]; value: string; onChange: (tab: string) => void }) {
  const tabsRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  useEffect(() => {
    const element = tabsRef.current
    if (!element) return
    const updateScrollButtons = () => {
      setCanScrollLeft(element.scrollLeft > 0)
      setCanScrollRight(element.scrollLeft + element.clientWidth < element.scrollWidth - 1)
    }
    updateScrollButtons()
    element.addEventListener('scroll', updateScrollButtons, { passive: true })
    const observer = new ResizeObserver(updateScrollButtons)
    observer.observe(element)
    return () => {
      element.removeEventListener('scroll', updateScrollButtons)
      observer.disconnect()
    }
  }, [tabs.length])

  return (
    <TopbarNavPortal>
      <div className="ops-tabs-control">
        {canScrollLeft && <button className="ops-tabs-arrow" type="button" aria-label="Cuộn tab sang trái" onClick={() => tabsRef.current?.scrollBy({ left: -220, behavior: 'smooth' })}>‹</button>}
        <div className="ops-tabs" role="tablist" ref={tabsRef}>
          {tabs.map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              className={key === value ? 'selected active' : ''}
              role="tab"
              aria-selected={key === value}
              onClick={() => onChange(key)}
            >
              <span>{label}</span>
              {count !== undefined && <span className="tab-pill-count">{count}</span>}
            </button>
          ))}
        </div>
        {canScrollRight && <button className="ops-tabs-arrow" type="button" aria-label="Cuộn tab sang phải" onClick={() => tabsRef.current?.scrollBy({ left: 220, behavior: 'smooth' })}>›</button>}
      </div>
    </TopbarNavPortal>
  )
}
function StateBox({ loading, error, empty, retry }: { loading: boolean; error: string; empty: boolean; retry?: () => void }) {
  if (loading) return <div className="ops-state"><span className="ops-spinner" />Đang tải dữ liệu…</div>
  if (error) return <div className="ops-state ops-error"><strong>Không thể tải dữ liệu</strong><span>{error}</span>{retry && <button className="ops-button" onClick={retry}>Thử lại</button>}</div>
  if (empty) return <div className="ops-state"><strong>Chưa có dữ liệu</strong><span>Điều chỉnh bộ lọc hoặc thêm thông tin mới để bắt đầu.</span></div>
  return null
}
function Pager({ page, pageSize, total, onChange }: { page: number; pageSize: number; total: number; onChange: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / (pageSize || 20)))
  const safePage = Math.min(Math.max(1, page), pages)
  return (
    <div className="ops-pager">
      <div className="pagination-center">
        <button type="button" disabled={safePage <= 1} onClick={() => onChange(safePage - 1)}>‹</button>
        <strong className="page-current-info">Trang {safePage} / {pages}</strong>
        <button type="button" disabled={safePage >= pages} onClick={() => onChange(safePage + 1)}>›</button>
      </div>
    </div>
  )
}
function Dialog({ title, onClose, children, className = '' }: { title: string; onClose: () => void; children: React.ReactNode; className?: string }) {
  return (
    <div className="ops-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className={`ops-dialog ${className}`.trim()} role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <button aria-label="Đóng" onClick={onClose}>×</button>
        </header>
        {children}
      </section>
    </div>
  )
}
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="ops-field"><span>{label}</span>{children}</label> }
function PaginationTable<T>({ columns, rows, keyFor, startIndex = 1 }: { columns: { name: string; render: (row: T, index?: number) => React.ReactNode }[]; rows: T[]; keyFor: (row: T) => string | number; startIndex?: number }) {
  const hasSTT = columns.some((c) => c.name === 'STT')
  return (
    <div className="ops-table-wrap">
      <table className="ops-table">
        <thead>
          <tr>
            {!hasSTT && <th style={{ width: '60px', textAlign: 'center' }}>STT</th>}
            {columns.map((column) => <th key={column.name}>{column.name}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={keyFor(row)}>
              {!hasSTT && <td style={{ textAlign: 'center', color: '#64748b', fontWeight: 500 }}>{startIndex + rowIndex}</td>}
              {columns.map((column) => <td key={column.name}>{column.render(row, rowIndex)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
function StatusPill({ value }: { value?: string }) { return <span className={`ops-pill state-${value ?? 'unknown'}`}>{statusLabels[value ?? ''] ?? value ?? 'Chưa cập nhật'}</span> }

export default function Operations({ module, permission, user, request, notify }: Props) {
  if (module === 'leads') return <LeadsOps request={request} notify={notify} canEdit={permission !== 'R'} canDelete={user.roles.includes('training_manager')} />
  if (module === 'student_records') return <StudentsOps request={request} notify={notify} user={user} canEdit={permission !== 'R'} canManage={permission === 'F'} />
  if (module === 'classes') return <ClassesOps request={request} notify={notify} canEdit={permission === 'F'} />
  return <AttendanceOps request={request} notify={notify} user={user} canEdit={permission !== 'R'} canManage={permission === 'F'} />
}

const leadSourceLabels: Record<string, string> = {
  website: 'Website trung tâm',
  facebook: 'Mạng xã hội / FB',
  walkin: 'Trực tiếp',
  referral: 'Giới thiệu',
  other: 'Khác',
}

function LeadsOps({ request, notify, canEdit, canDelete }: { request: Api; notify: Props['notify']; canEdit: boolean; canDelete?: boolean }) {
  const [tab, setTab] = useState<'board' | 'list' | 'create'>('board')
  const [leads, setLeads] = useState<Lead[]>([])
  const [leadPage, setLeadPage] = useState({ total: 0, page: 1, page_size: 20 })
  const [leadPageNo, setLeadPageNo] = useState(1)
  const [leadPageSize, setLeadPageSize] = useState(20)
  const [lanePages, setLanePages] = useState<Record<string, number>>({})
  const [counselors, setCounselors] = useState<Person[]>([])
  const [assigneeFilter, setAssigneeFilter] = useState('')
  const [summary, setSummary] = useState<Record<string, number>>({})
  const [overdueLeadIds, setOverdueLeadIds] = useState<Set<number>>(() => new Set())
  const [draggedLeadId, setDraggedLeadId] = useState<number | null>(null)
  const [dragOverLane, setDragOverLane] = useState<string | null>(null)
  const [collapsedStages, setCollapsedStages] = useState<Set<string>>(() => new Set())
  const [loading, setLoading] = useState(true)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [lead, setLead] = useState<Lead | null>(null)
  const [rejectionLead, setRejectionLead] = useState<Lead | null>(null)
  const [rejectionReason, setRejectionReason] = useState('')
  const [timeline, setTimeline] = useState<Interaction[]>([])
  const [timelinePage, setTimelinePage] = useState(1)
  const [timelineSort, setTimelineSort] = useState<'logged_desc' | 'occurred_desc' | 'occurred_asc'>('logged_desc')
  const [now] = useState(() => Date.now())
  const [interaction, setInteraction] = useState({
    interaction_type: 'call',
    content: '',
    follow_up_at: '',
    occurred_at: localDateTime(new Date()),
  })
  const [busy, setBusy] = useState(false)
  const [stageFilter, setStageFilter] = useState('')
  const [convertingId, setConvertingId] = useState<number | null>(null)
  const [convertModalLead, setConvertModalLead] = useState<Lead | null>(null)
  const [justConvertedIds, setJustConvertedIds] = useState<Set<number>>(() => new Set())

  const TIMELINE_PAGE_SIZE = 20

  useEffect(() => {
    request<Page<Person> | Person[]>('/users?page=1&page_size=100')
      .then((res) => {
        const items = asPage(res).items
        setCounselors(items)
      })
      .catch(() => {})
  }, [request])

  const visibleTimeline = useMemo(() => {
    const list = timeline.filter((item) => !(item.action === 'updated' && item.content === 'Đã cập nhật: status'))
    if (timelineSort === 'occurred_desc') {
      return [...list].sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime() || b.id - a.id)
    }
    if (timelineSort === 'occurred_asc') {
      return [...list].sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime() || a.id - b.id)
    }
    // Default 'logged_desc': newly recorded interactions first
    return [...list].sort((a, b) => b.id - a.id)
  }, [timeline, timelineSort])

  const timelineTotalPages = Math.max(1, Math.ceil(visibleTimeline.length / TIMELINE_PAGE_SIZE))
  const currentTimelinePage = Math.min(timelinePage, timelineTotalPages)
  const paginatedTimeline = useMemo(() => {
    const start = (currentTimelinePage - 1) * TIMELINE_PAGE_SIZE
    return visibleTimeline.slice(start, start + TIMELINE_PAGE_SIZE)
  }, [visibleTimeline, currentTimelinePage])

  // Full-page lead creation state
  const [createForm, setCreateForm] = useState({
    full_name: '',
    phone: '',
    email: '',
    source: 'website',
    program_interest: '',
    notes: '',
  })
  const [duplicateWarning, setDuplicateWarning] = useState('')

  function toggleCollapseStage(stageKey: string) {
    setCollapsedStages((prev) => {
      const next = new Set(prev)
      if (next.has(stageKey)) next.delete(stageKey)
      else next.add(stageKey)
      return next
    })
  }

  const load = useCallback(async (pageNo = 1, currentStage = stageFilter, currentAssignee = assigneeFilter) => {
    setLoading(true); setError('')
    try {
      const isBoard = tab === 'board'
      const actualPageSize = isBoard ? 100 : leadPageSize
      const statusParam = (!isBoard && currentStage) ? currentStage : undefined
      const [response, counts, overdue] = await Promise.all([
        request<Page<Lead> | Lead[]>(`/leads?${qs({
          q: query.trim(),
          status: statusParam,
          assigned_to: currentAssignee || undefined,
          page: isBoard ? 1 : pageNo,
          page_size: actualPageSize,
        })}`),
        request<{ counts: Record<string, number>; total: number }>(`/leads/summary?${qs({ q: query.trim() })}`),
        request<{ lead_id: number }[]>(`/leads/follow-ups/overdue?${qs({ q: query.trim() })}`),
      ])
      const result = asPage(response)
      const hasServerPagination = !Array.isArray(response)
      setLeads(hasServerPagination ? result.items : result.items.slice((pageNo - 1) * actualPageSize, pageNo * actualPageSize))
      setLeadPage({ total: result.total, page: pageNo, page_size: actualPageSize })
      setLeadPageNo(pageNo)
      setSummary(counts.counts)
      setOverdueLeadIds(new Set(overdue.map((item) => item.lead_id)))
    } catch (e) { setError(e instanceof Error ? e.message : 'Không thể tải tuyển sinh.') }
    finally { setLoading(false) }
  }, [request, query, leadPageSize, tab, stageFilter, assigneeFilter])

  useEffect(() => { void load(1, stageFilter, assigneeFilter) }, [tab, stageFilter, assigneeFilter])
  const stages = useMemo(() => leadStages.map((key) => {
    let rows = leads.filter((item) => item.status === key)
    if (key === 'won' && stageFilter === 'won') {
      const convertedInSession = leads.filter((item) => justConvertedIds.has(item.id) && item.status === 'converted')
      rows = [...rows, ...convertedInSession]
    }
    return { key, rows }
  }), [leads, justConvertedIds, stageFilter])

  async function handleSearch() {
    setSearching(true)
    await Promise.all([
      load(1),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ])
    setSearching(false)
  }

  async function handleRefresh() {
    setLoading(true)
    const start = Date.now()
    try {
      await load(leadPageNo)
      const elapsed = Date.now() - start
      if (elapsed < 1000) await new Promise((resolve) => setTimeout(resolve, 1000 - elapsed))
      if (leads.length === 0) {
        notify('Không có dữ liệu', 'error')
      } else {
        notify('Tải thành công', 'success')
      }
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Tải lại thất bại.', 'error')
    } finally {
      setLoading(false)
    }
  }

  async function checkPhoneDuplicate(phone: string) {
    if (!phone.trim()) { setDuplicateWarning(''); return }
    try {
      const res = await request<{ duplicate: boolean }>(`/leads/duplicate-check?phone=${encodeURIComponent(phone.trim())}`)
      setDuplicateWarning(res.duplicate ? '⚠️ Số điện thoại này đã tồn tại trong danh sách lead.' : '')
    } catch {
      // duplicate check is best-effort
    }
  }

  async function submitCreateLead(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    try {
      await request('/leads', {
        method: 'POST',
        body: JSON.stringify({
          full_name: createForm.full_name,
          phone: createForm.phone,
          email: createForm.email || null,
          source: createForm.source,
          program_interest: createForm.program_interest || null,
          notes: createForm.notes || null,
          website: '',
        }),
      })
      notify('Đã tạo lead mới và đưa vào phễu tư vấn.', 'success')
      setCreateForm({ full_name: '', phone: '', email: '', source: 'website', program_interest: '', notes: '' })
      setDuplicateWarning('')
      setTab('board')
      await load(1)
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Không thể tạo lead mới.', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function deleteLead(item: Lead) {
    if (!window.confirm(`Xóa lead của "${item.full_name}"? Thao tác này không thể hoàn tác.`)) return
    try {
      await request(`/leads/${item.id}`, { method: 'DELETE' })
      notify('Đã xóa lead.', 'success')
      await load(leadPageNo)
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Không thể xóa lead.', 'error')
    }
  }

  async function openLead(item: Lead) {
    setLead(item); setTimeline([]); setTimelinePage(1)
    setInteraction({
      interaction_type: 'call',
      content: '',
      follow_up_at: '',
      occurred_at: localDateTime(new Date()),
    })
    try { setTimeline(await request<Interaction[]>(`/leads/${item.id}/interactions`)) }
    catch (e) { notify(e instanceof Error ? e.message : 'Không thể tải lịch sử.', 'error') }
  }

  async function updateStatus(item: Lead, next: string, reason = ''): Promise<boolean> {
    if (next === 'rejected' && !reason) { setRejectionLead(item); setRejectionReason(''); return false }
    try {
      await request(`/leads/${item.id}`, { method: 'PATCH', body: JSON.stringify({ status: next, ...(reason ? { loss_reason: reason } : {}) }) })
      notify('Đã cập nhật giai đoạn lead.', 'success'); await load()
      if (lead && lead.id === item.id) {
        setLead({ ...lead, status: next })
        try {
          const refreshed = await request<Interaction[]>(`/leads/${item.id}/interactions`)
          setTimeline(refreshed)
          setTimelinePage(1)
        } catch { /* ignore */ }
      }
      return true
    } catch (e) { notify(e instanceof Error ? e.message : 'Không thể cập nhật lead.', 'error'); return false }
  }

  async function submitRejection(event: FormEvent) {
    event.preventDefault()
    if (!rejectionLead || !rejectionReason.trim()) return
    if (await updateStatus(rejectionLead, 'rejected', rejectionReason.trim())) {
      setRejectionLead(null)
      setRejectionReason('')
    }
  }

  async function addInteraction(event: FormEvent) {
    event.preventDefault(); if (!lead) return
    setBusy(true)
    try {
      const occurredDate = interaction.occurred_at ? new Date(interaction.occurred_at) : new Date()
      const followUpDate = interaction.follow_up_at ? new Date(interaction.follow_up_at) : null
      await request(`/leads/${lead.id}/interactions`, {
        method: 'POST', body: JSON.stringify({
          interaction_type: interaction.interaction_type, content: interaction.content,
          created_at: (isNaN(occurredDate.getTime()) ? new Date() : occurredDate).toISOString(),
          follow_up_at: followUpDate && !isNaN(followUpDate.getTime()) ? followUpDate.toISOString() : null,
        }),
      })
      const refreshed = await request<Interaction[]>(`/leads/${lead.id}/interactions`)
      setTimeline(refreshed)
      setTimelinePage(1)
      setInteraction({
        interaction_type: 'call',
        content: '',
        follow_up_at: '',
        occurred_at: localDateTime(new Date()),
      })
      notify('Đã ghi nhận tương tác mới vào dòng thời gian.', 'success')
    } catch (e) { notify(e instanceof Error ? e.message : 'Không thể lưu trao đổi.', 'error') }
    finally { setBusy(false) }
  }

  async function executeConvert(item: Lead) {
    if (convertingId === item.id) return
    setConvertingId(item.id)
    try {
      const result = await request<{ student: Student; message?: string }>(`/leads/${item.id}/convert`, { method: 'POST' })
      setJustConvertedIds((prev) => new Set([...prev, item.id]))
      // Optimistically update leads list so the card changes immediately to 'Đã nhập học'
      setLeads((prev) => prev.map((l) => (l.id === item.id ? { ...l, status: 'converted' } : l)))
      setSummary((prev) => ({
        ...prev,
        won: Math.max(0, (prev.won || 1) - 1),
        converted: (prev.converted || 0) + 1,
      }))
      if (lead && lead.id === item.id) {
        setLead((prev) => (prev ? { ...prev, status: 'converted' } : null))
        try {
          const refreshed = await request<Interaction[]>(`/leads/${item.id}/interactions`)
          setTimeline(refreshed)
          setTimelinePage(1)
        } catch { /* ignore */ }
      }
      setConvertModalLead(null)
      const studentCode = result.student?.student_code ? ` (Mã HV: ${result.student.student_code})` : ''
      notify(result.message || `Đã chuyển đổi thành công! ${item.full_name} đã chuyển sang "Đã nhập học"${studentCode}.`, 'success')
      await load(leadPageNo, stageFilter)
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Không thể chuyển đổi lead.', 'error')
    } finally {
      setConvertingId(null)
    }
  }

  const overdue = (item: Interaction) => item.follow_up_at && new Date(item.follow_up_at).getTime() < now

  const leadTabs: TabDef[] = [
    ['board', '📊 Pipeline phễu tư vấn', summary.total ?? leadPage.total],
    ['list', '📋 Danh sách lead'],
    ...(canEdit ? [['create', '➕ Thêm lead mới'] as TabDef] : []),
  ]

  function renderLeadCard(item: Lead) {
    const isConverted = item.status === 'converted'
    const isJustConverted = justConvertedIds.has(item.id)
    const isConverting = convertingId === item.id
    const currentStageIdx = leadStages.indexOf(item.status)
    const canMovePrev = canEdit && currentStageIdx > 0 && !isConverted
    const canMoveNext = canEdit && currentStageIdx < leadStages.length - 1 && !isConverted

    return (
      <article
        className={`lead-card${overdueLeadIds.has(item.id) ? ' is-overdue' : ''}${draggedLeadId === item.id ? ' is-dragging' : ''}${isConverted ? ' is-converted' : ''}`}
        key={item.id}
        draggable={canEdit && !isConverted}
        onDragStart={(event) => {
          if (!canEdit || isConverted) return
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/plain', String(item.id))
          setDraggedLeadId(item.id)
        }}
        onDragEnd={() => setDraggedLeadId(null)}
      >
        <div className="lead-card-header">
          <button
            type="button"
            className="lead-card-title-btn"
            onClick={() => void openLead(item)}
            title="Bấm để xem lịch sử chăm sóc"
          >
            <strong>{item.full_name}</strong>
          </button>
          <span className="lead-source-badge">{item.source || 'website'}</span>
        </div>

        <div className="lead-card-contact">
          <span className="lead-phone-pill">📞 {item.phone}</span>
          {item.email && <span className="lead-email-text" title={item.email}>{item.email}</span>}
        </div>

        {item.program_interest && (
          <div className="lead-interest-badge" title={item.program_interest}>
            <span>🎓</span> {item.program_interest}
          </div>
        )}

        {overdueLeadIds.has(item.id) && !isConverted && (
          <div className="lead-overdue-alert">
            <span>⚠️ Quá hạn chăm sóc!</span>
          </div>
        )}

        {item.assigned_to_name && (
          <div className="lead-assigned-row">
            <small>👤 {item.assigned_to_name}</small>
          </div>
        )}

        <div className="lead-card-actions" onClick={(e) => e.stopPropagation()}>
          <div className="lead-step-arrows">
            {canMovePrev && (
              <button
                type="button"
                className="step-arrow-btn prev"
                title={`Lùi về: ${statusLabels[leadStages[currentStageIdx - 1]]}`}
                onClick={() => void updateStatus(item, leadStages[currentStageIdx - 1])}
              >
                ◀
              </button>
            )}
            {canMoveNext && (
              <button
                type="button"
                className="step-arrow-btn next"
                title={`Tiến tới: ${statusLabels[leadStages[currentStageIdx + 1]]}`}
                onClick={() => void updateStatus(item, leadStages[currentStageIdx + 1])}
              >
                ▶
              </button>
            )}
          </div>

          {isConverted ? (
            <div className="lead-converted-actions">
              <span className="lead-converted-pill">
                ✓ Đã nhập học {isJustConverted && <small className="just-badge">(Vừa xong)</small>}
              </span>
              <button
                type="button"
                className="btn-card-history"
                onClick={() => void openLead(item)}
                title="Xem chi tiết lịch sử và hồ sơ"
              >
                Lịch sử ↗
              </button>
            </div>
          ) : (
            <>
              <select
                className="lead-stage-select"
                aria-label={`Chuyển giai đoạn ${item.full_name}`}
                value={item.status}
                disabled={!canEdit || isConverting}
                onChange={(e) => void updateStatus(item, e.target.value)}
              >
                {leadTransitionStages.map((stage) => (
                  <option key={stage} value={stage}>
                    ➔ {statusLabels[stage]}
                  </option>
                ))}
              </select>

              {item.status === 'won' && (
                <button
                  type="button"
                  className="btn-convert-student"
                  disabled={isConverting}
                  onClick={() => setConvertModalLead(item)}
                  title="Chuyển đổi thành học viên chính thức"
                >
                  {isConverting ? '⏳ Đang xử lý...' : '🎓 Nhập học'}
                </button>
              )}
            </>
          )}
        </div>
      </article>
    )
  }

  return (
    <section className="ops-page lead-ops-page">
      <OpsHeader
        eyebrow="SPRINT 3 · TUYỂN SINH"
        subtitle="Theo dõi cơ hội, lịch chăm sóc, quản lý khách hàng tiềm năng và chuyển đổi thành học viên."
      />

      <OpsTabs value={tab} onChange={(k) => setTab(k as 'board' | 'list' | 'create')} tabs={leadTabs} />

      {tab === 'create' ? (
        <div className="ops-panel ops-full-form">
          <div className="ops-panel-heading">
            <div>
              <span className="ops-eyebrow">TIẾN TRÌNH TUYỂN SINH · SPRINT 3</span>
              <h3>Thêm khách hàng tiềm năng vào phễu</h3>
              <p className="ops-muted">Nhập thông tin người quan tâm để hệ thống tạo hồ sơ tư vấn và hỗ trợ xếp lịch chăm sóc.</p>
            </div>
          </div>
          <form className="ops-form" onSubmit={(e) => void submitCreateLead(e)}>
            <div className="ops-form-grid">
              <Field label="Họ và tên (bắt buộc)">
                <input required placeholder="Ví dụ: Nguyễn Văn An" value={createForm.full_name} onChange={(e) => setCreateForm({ ...createForm, full_name: e.target.value })} />
              </Field>
              <Field label="Số điện thoại (bắt buộc)">
                <input required placeholder="Ví dụ: 0912345678" value={createForm.phone} onChange={(e) => { setCreateForm({ ...createForm, phone: e.target.value }); setDuplicateWarning('') }} onBlur={() => void checkPhoneDuplicate(createForm.phone)} />
              </Field>
            </div>
            {duplicateWarning && <div className="ops-warning-banner" role="alert">{duplicateWarning}</div>}
            <div className="ops-form-grid">
              <Field label="Email liên hệ (nếu có)">
                <input type="email" placeholder="an@example.com" value={createForm.email} onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })} />
              </Field>
              <Field label="Nguồn tiếp nhận">
                <select value={createForm.source} onChange={(e) => setCreateForm({ ...createForm, source: e.target.value })}>
                  <option value="website">Website trung tâm</option>
                  <option value="facebook">Mạng xã hội / Facebook</option>
                  <option value="walkin">Trực tiếp đến trung tâm</option>
                  <option value="referral">Được học viên giới thiệu</option>
                  <option value="other">Nguồn khác</option>
                </select>
              </Field>
              <Field label="Chương trình quan tâm">
                <input placeholder="Khóa học muốn tìm hiểu (ví dụ: Lập trình Web Fullstack)" value={createForm.program_interest} onChange={(e) => setCreateForm({ ...createForm, program_interest: e.target.value })} />
              </Field>
              <Field label="Ghi chú tư vấn ban đầu">
                <textarea placeholder="Khung giờ gọi tiện nhất, trình độ hiện tại hoặc nguyện vọng học viên..." value={createForm.notes} onChange={(e) => setCreateForm({ ...createForm, notes: e.target.value })} />
              </Field>
            </div>
            <div className="ops-form-actions">
              <button type="button" className="ops-button" onClick={() => setTab('board')}>Hủy bỏ</button>
              <button type="submit" className="ops-primary" disabled={busy}>
                {busy && <span className="ops-spinner-sm" />}
                {busy ? 'Đang tạo...' : '✓ Xác nhận thêm lead'}
              </button>
            </div>
          </form>
        </div>
      ) : (
        <>
          {/* Thanh lọc nhanh trạng thái linh hoạt theo giai đoạn (hỗ trợ cả dạng bảng và pipeline) */}
          <div className="lead-quick-filters">
            <button
              type="button"
              className={`lead-filter-chip${!stageFilter ? ' active' : ''}`}
              onClick={() => {
                setStageFilter('')
                setLeadPageNo(1)
                void load(1, '', assigneeFilter)
              }}
            >
              <span>Tất cả các bước</span>
              <span className="count-pill">{summary.total ?? leadPage.total}</span>
            </button>
            {leadStages.map((key) => {
              const count = summary[key] ?? leads.filter((l) => l.status === key).length
              return (
                <button
                  key={key}
                  type="button"
                  className={`lead-filter-chip chip-${key}${stageFilter === key ? ' active' : ''}`}
                  onClick={() => {
                    const next = stageFilter === key ? '' : key
                    setStageFilter(next)
                    setLeadPageNo(1)
                    void load(1, next, assigneeFilter)
                  }}
                >
                  <span className={`status-dot dot-${key}`} />
                  <span>{statusLabels[key]}</span>
                  <span className="count-pill">{count}</span>
                </button>
              )
            })}
          </div>

          <div className="ops-toolbar">
            <input
              aria-label="Tìm lead"
              placeholder="Tìm theo họ tên, số điện thoại, email…"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setLeadPageNo(1) }}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleSearch() }}
            />
            <div style={{ minWidth: '220px' }}>
              <SearchableSelect
                options={[
                  { value: '', label: 'Tất cả người phụ trách' },
                  ...counselors.map((c) => ({
                    value: String(c.id),
                    label: c.full_name,
                    badge: c.role || c.roles?.[0],
                  })),
                ]}
                value={assigneeFilter}
                onChange={(val) => {
                  setAssigneeFilter(val)
                  setLeadPageNo(1)
                  void load(1, stageFilter, val)
                }}
                placeholder="Người phụ trách / Vai trò"
              />
            </div>
            <div className="ops-toolbar-actions">
              <button className="ops-primary" type="button" onClick={() => void handleSearch()} disabled={loading || searching}>
                {searching && <span className="ops-spinner-sm" />}
                {searching ? 'Đang tìm…' : 'Tìm kiếm'}
              </button>
              <button className="secondary-button ops-button" type="button" onClick={() => void handleRefresh()} disabled={loading} aria-busy={loading}>
                {loading ? <span className="ops-spinner-sm" style={{ marginRight: '4px' }} /> : <span className="ops-refresh-icon" aria-hidden="true">↻</span>}
                {loading ? 'Đang tải…' : 'Làm lại'}
              </button>
              {tab === 'board' && collapsedStages.size > 0 && (
                <button
                  className="secondary-button ops-button"
                  type="button"
                  onClick={() => setCollapsedStages(new Set())}
                  title="Mở lại tất cả các cột đang bị thu gọn"
                >
                  Mở lại tất cả {collapsedStages.size} cột
                </button>
              )}
            </div>
          </div>

          {error && <StateBox loading={false} error={error} empty={false} retry={() => void load()} />}

          {loading ? (
            <StateBox loading error="" empty={false} />
            ) : leads.length === 0 ? (
            <StateBox loading={false} error="" empty />
          ) : tab === 'board' ? (
            stageFilter ? (
              /* CHẾ ĐỘ XEM TẬP TRUNG GIAI ĐOẠN ĐÃ CHỌN */
              <div className="lead-focused-stage-view">
                <div className="focused-stage-banner">
                  <div className="focused-stage-info">
                    <span className={`status-dot dot-${stageFilter}`} style={{ width: 12, height: 12 }} />
                    <div>
                      <strong>Giai đoạn: {statusLabels[stageFilter]}</strong>
                      <span>Đang có {(stages.find((s) => s.key === stageFilter)?.rows ?? []).length} khách hàng tiềm năng</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="ops-button secondary-button"
                    onClick={() => setStageFilter('')}
                  >
                    ← Xem toàn bộ bảng 7 cột kéo thả
                  </button>
                </div>

                <div className="focused-stage-grid">
                  {(stages.find((s) => s.key === stageFilter)?.rows ?? []).length === 0 ? (
                    <div className="focused-empty-box">
                      <p>Hiện chưa có khách hàng tiềm năng nào ở giai đoạn <strong>{statusLabels[stageFilter]}</strong>.</p>
                      <button type="button" className="ops-primary" onClick={() => setStageFilter('')}>
                        Quay lại toàn bộ quy trình 7 cột
                      </button>
                    </div>
                  ) : (
                    (stages.find((s) => s.key === stageFilter)?.rows ?? []).map((item) => renderLeadCard(item))
                  )}
                </div>
              </div>
            ) : (
              /* BẢNG KANBAN PHỄU 7 CỘT HIỆN ĐẠI CHO DỮ LIỆU LỚN */
              <div className="lead-board-wrapper">
                <div className="lead-board">
                  {stages.map(({ key, rows }) => {
                    const isCollapsed = collapsedStages.has(key)
                    const isAcceptingDrop = draggedLeadId !== null
                    const isDropActive = dragOverLane === key

                    if (isCollapsed) {
                      return (
                        <div
                          key={key}
                          className={`lead-lane-rail${isAcceptingDrop ? ' accepts-drop' : ''}${isDropActive ? ' drop-active' : ''}`}
                          onDragOver={(event) => {
                            if (canEdit) {
                              event.preventDefault()
                              setDragOverLane(key)
                            }
                          }}
                          onDragLeave={() => {
                            if (dragOverLane === key) setDragOverLane(null)
                          }}
                          onDrop={(event) => {
                            event.preventDefault()
                            setDragOverLane(null)
                            const dragged = leads.find((item) => item.id === draggedLeadId)
                            setDraggedLeadId(null)
                            if (canEdit && dragged && dragged.status !== key) void updateStatus(dragged, key)
                          }}
                          onClick={() => toggleCollapseStage(key)}
                          title={`Bấm để mở rộng cột: ${statusLabels[key]} (${summary[key] ?? rows.length} lead)`}
                        >
                          <div className="rail-expand-btn">▶</div>
                          <span className={`status-dot dot-${key}`} />
                          <span className="rail-title">{statusLabels[key]}</span>
                          <span className="rail-count">{summary[key] ?? rows.length}</span>
                        </div>
                      )
                    }

                    return (
                      <section
                        key={key}
                        className={`lead-lane lane-${key}${isAcceptingDrop ? ' accepts-drop' : ''}${isDropActive ? ' drop-active' : ''}`}
                        onDragOver={(event) => {
                          if (canEdit) {
                            event.preventDefault()
                            setDragOverLane(key)
                          }
                        }}
                        onDragLeave={() => {
                          if (dragOverLane === key) setDragOverLane(null)
                        }}
                        onDrop={(event) => {
                          event.preventDefault()
                          setDragOverLane(null)
                          const dragged = leads.find((item) => item.id === draggedLeadId)
                          setDraggedLeadId(null)
                          if (canEdit && dragged && dragged.status !== key) void updateStatus(dragged, key)
                        }}
                      >
                        <header className="lane-header">
                          <div className="lane-title-group">
                            <span className={`status-dot dot-${key}`} />
                            <strong>{statusLabels[key]}</strong>
                            <span className="lane-count-badge">{summary[key] ?? rows.length}</span>
                          </div>
                          <button
                            type="button"
                            className="lane-collapse-toggle"
                            onClick={() => toggleCollapseStage(key)}
                            title="Thu gọn cột này"
                          >
                            ◀
                          </button>
                        </header>

                        {(() => {
                          const LANE_PAGE_SIZE = 5
                          const lanePage = lanePages[key] ?? 1
                          const laneTotal = rows.length
                          const laneTotalPages = Math.max(1, Math.ceil(laneTotal / LANE_PAGE_SIZE))
                          const safeLanePage = Math.min(lanePage, laneTotalPages)
                          const visibleLaneRows = rows.slice((safeLanePage - 1) * LANE_PAGE_SIZE, safeLanePage * LANE_PAGE_SIZE)

                          return (
                            <>
                              <div className="lead-lane-cards">
                                {rows.length === 0 ? (
                                  <div className="lane-empty-placeholder">
                                    <span>Chưa có lead ở bước này</span>
                                    {canEdit && <small>Kéo thả lead vào đây</small>}
                                  </div>
                                ) : (
                                  visibleLaneRows.map((item) => renderLeadCard(item))
                                )}
                              </div>
                              {laneTotal > LANE_PAGE_SIZE && (
                                <div className="lane-pagination-bar">
                                  <span className="lane-pagination-info">
                                    Trang {safeLanePage}/{laneTotalPages} ({laneTotal} lead)
                                  </span>
                                  <div className="lane-pagination-controls">
                                    <button
                                      type="button"
                                      className="lane-page-nav-btn"
                                      disabled={safeLanePage <= 1}
                                      onClick={() => setLanePages((prev) => ({ ...prev, [key]: safeLanePage - 1 }))}
                                      title="5 lead trước"
                                    >
                                      ‹
                                    </button>
                                    <button
                                      type="button"
                                      className="lane-page-nav-btn"
                                      disabled={safeLanePage >= laneTotalPages}
                                      onClick={() => setLanePages((prev) => ({ ...prev, [key]: safeLanePage + 1 }))}
                                      title="5 lead tiếp theo"
                                    >
                                      ›
                                    </button>
                                  </div>
                                </div>
                              )}
                            </>
                          )
                        })()}
                      </section>
                    )
                  })}
                </div>
              </div>
            )
          ) : (
            <PaginationTable
              startIndex={(leadPage.page - 1) * leadPage.page_size + 1}
              rows={leads}
              keyFor={(row) => row.id}
              columns={[
                { name: 'Học viên tiềm năng', render: (row) => <button className="ops-link" onClick={() => void openLead(row)}>{row.full_name}</button> },
                { name: 'Liên hệ', render: (row) => <>{row.phone}<small>{row.email}</small></> },
                { name: 'Quan tâm', render: (row) => row.program_interest || '—' },
                { name: 'Nguồn', render: (row) => row.source || '—' },
                { name: 'Giai đoạn', render: (row) => <StatusPill value={row.status} /> },
                { name: 'Phụ trách', render: (row) => row.assigned_to_name || 'Chưa phân công' },
                {
                  name: 'Thao tác',
                  render: (row) => (
                    <div className="ops-actions">
                      <button type="button" onClick={() => void openLead(row)}>Lịch sử ↗</button>
                      {canDelete && <button type="button" className="danger" onClick={() => void deleteLead(row)}>Xóa</button>}
                    </div>
                  ),
                },
              ]}
            />
          )}

          {!loading && !error && tab === 'list' && leadPage.total > 0 && (
            <div className="ops-pager lead-pager">
              <div className="ops-pager-size-select">
                <span>Hiển thị:</span>
                <select
                  value={leadPageSize}
                  onChange={(e) => {
                    const s = Number(e.target.value)
                    setLeadPageSize(s)
                    setLeadPageNo(1)
                  }}
                >
                  <option value={5}>5 lead / trang</option>
                  <option value={10}>10 lead / trang</option>
                  <option value={20}>20 lead / trang</option>
                  <option value={50}>50 lead / trang</option>
                </select>
              </div>
              <div className="pagination-center">
                <button type="button" disabled={loading || leadPage.page <= 1} onClick={() => void load(leadPage.page - 1, stageFilter, assigneeFilter)}>‹</button>
                <strong className="page-current-info">Trang {leadPage.page} / {Math.max(1, Math.ceil(leadPage.total / leadPage.page_size))}</strong>
                <button type="button" disabled={loading || leadPage.page >= Math.ceil(leadPage.total / leadPage.page_size)} onClick={() => void load(leadPage.page + 1, stageFilter, assigneeFilter)}>›</button>
              </div>
            </div>
          )}
        </>
      )}

      {lead && (
        <Dialog title={`Hồ sơ lead · ${lead.full_name}`} className="lead-detail-dialog" onClose={() => setLead(null)}>
          <div className="lead-detail-ribbon">
            <div className="lead-ribbon-item">
              <span>Điện thoại</span>
              <strong>{lead.phone || '—'}</strong>
            </div>
            <div className="lead-ribbon-item">
              <span>Email</span>
              <strong>{lead.email || '—'}</strong>
            </div>
            <div className="lead-ribbon-item">
              <span>Chương trình quan tâm</span>
              <strong>{lead.program_interest || '—'}</strong>
            </div>
            <div className="lead-ribbon-item">
              <span>Người phụ trách</span>
              <strong>{lead.assigned_to_name || 'Chưa phân công'}</strong>
            </div>
            <div className="lead-ribbon-item">
              <span>Nguồn tiếp nhận</span>
              <strong>{leadSourceLabels[lead.source || ''] || lead.source || '—'}</strong>
            </div>
            <div className="lead-ribbon-item">
              <span>Giai đoạn</span>
              <div><StatusPill value={lead.status} /></div>
            </div>
            {lead.status === 'converted' && (
              <div className="lead-ribbon-action">
                <span className="ribbon-badge-converted">✓ Đã nhập học</span>
              </div>
            )}
            {lead.status === 'won' && (
              <div className="lead-ribbon-action">
                <button
                  type="button"
                  className="btn-ribbon-convert"
                  disabled={convertingId === lead.id}
                  onClick={() => setConvertModalLead(lead)}
                >
                  {convertingId === lead.id ? '⏳ Đang nhập học...' : '🎓 Nhập học'}
                </button>
              </div>
            )}
          </div>

          <div className="lead-detail-layout">
            <div className="lead-detail-sidebar">
              {canEdit ? (
                <form className="lead-log-form" onSubmit={(e) => void addInteraction(e)}>
                  <div className="lead-sidebar-heading">
                    <h4>📝 Ghi nhận trao đổi mới</h4>
                    <span className="ops-muted">Tự động thêm vào dòng thời gian</span>
                  </div>
                  <Field label="Hình thức tương tác">
                    <select
                      value={interaction.interaction_type}
                      onChange={(e) => setInteraction({ ...interaction, interaction_type: e.target.value })}
                    >
                      <option value="call">📞 Cuộc gọi</option>
                      <option value="message">💬 Tin nhắn</option>
                      <option value="meeting">🤝 Cuộc gặp</option>
                    </select>
                  </Field>
                  <Field label="Thời gian tương tác thực tế (Quá khứ / Hiện tại)">
                    <div className="datetime-input-with-quick">
                      <input
                        type="datetime-local"
                        value={interaction.occurred_at}
                        onChange={(e) => setInteraction({ ...interaction, occurred_at: e.target.value })}
                      />
                      <div className="interaction-quick-buttons">
                        <button
                          type="button"
                          className="quick-time-btn"
                          onClick={() => setInteraction({ ...interaction, occurred_at: localDateTime(new Date()) })}
                          title="Cập nhật giờ thực tế ngay bây giờ"
                        >
                          ⏱️ Bây giờ
                        </button>
                        <button
                          type="button"
                          className="quick-time-btn"
                          onClick={() => {
                            const d = new Date()
                            d.setHours(9, 0, 0, 0)
                            setInteraction({ ...interaction, occurred_at: localDateTime(d) })
                          }}
                          title="Sáng nay lúc 09:00"
                        >
                          🌅 Sáng nay (09:00)
                        </button>
                        <button
                          type="button"
                          className="quick-time-btn"
                          onClick={() => {
                            const d = new Date()
                            d.setDate(d.getDate() - 1)
                            d.setHours(14, 30, 0, 0)
                            setInteraction({ ...interaction, occurred_at: localDateTime(d) })
                          }}
                          title="Ghi nhận cho ngày hôm qua lúc 14:30"
                        >
                          📅 Hôm qua
                        </button>
                        <button
                          type="button"
                          className="quick-time-btn"
                          onClick={() => {
                            const d = new Date()
                            d.setDate(d.getDate() - 2)
                            d.setHours(10, 0, 0, 0)
                            setInteraction({ ...interaction, occurred_at: localDateTime(d) })
                          }}
                          title="Ghi nhận cho 2 ngày trước lúc 10:00"
                        >
                          🗓️ 2 ngày trước
                        </button>
                      </div>
                    </div>
                    <small className="ops-muted" style={{ fontSize: '11px', display: 'block', marginTop: '3px' }}>
                      Cho phép ghi nhận lùi về hôm qua, tuần trước hoặc thời điểm hiện tại thực tế.
                    </small>
                  </Field>
                  <Field label="Ngày nhắc hẹn lại (nếu có - tương lai)">
                    <input
                      type="datetime-local"
                      value={interaction.follow_up_at}
                      onChange={(e) => setInteraction({ ...interaction, follow_up_at: e.target.value })}
                    />
                    <small className="ops-muted" style={{ fontSize: '11px', display: 'block', marginTop: '3px' }}>
                      Lịch hẹn chăm sóc tiếp theo trong tương lai (để trống nếu chưa có lịch hẹn mới).
                    </small>
                  </Field>
                  <Field label="Nội dung trao đổi (bắt buộc)">
                    <textarea
                      required
                      rows={5}
                      maxLength={2000}
                      placeholder="Ghi lại nội dung cuộc gọi, tư vấn, giải đáp thắc mắc..."
                      value={interaction.content}
                      onChange={(e) => setInteraction({ ...interaction, content: e.target.value })}
                    />
                  </Field>
                  <div className="lead-log-actions">
                    <button type="submit" className="ops-primary" disabled={busy}>
                      {busy ? 'Đang lưu...' : '+ Lưu vào dòng thời gian'}
                    </button>
                  </div>
                </form>
              ) : (
                <div className="lead-readonly-box">
                  <p className="ops-muted">Tài khoản có quyền xem hồ sơ và lịch sử chăm sóc.</p>
                </div>
              )}
            </div>

            <div className="lead-detail-timeline-pane">
              <div className="timeline-pane-header">
                <div>
                  <h3>Dòng thời gian chăm sóc</h3>
                  <p className="ops-muted">Nhật ký các lần tư vấn, cuộc gọi, tin nhắn và tiến trình chuyển đổi.</p>
                  <div className="timeline-sort-bar">
                    <span className="ops-muted" style={{ fontSize: '11.5px' }}>Sắp xếp:</span>
                    <button
                      type="button"
                      className={`timeline-sort-btn ${timelineSort === 'logged_desc' ? 'active' : ''}`}
                      onClick={() => setTimelineSort('logged_desc')}
                      title="Hiển thị theo thứ tự mới ghi nhận lên đầu"
                    >
                      ⚡ Mới ghi nhận trước
                    </button>
                    <button
                      type="button"
                      className={`timeline-sort-btn ${timelineSort === 'occurred_desc' ? 'active' : ''}`}
                      onClick={() => setTimelineSort('occurred_desc')}
                      title="Hiển thị theo thời điểm diễn ra tương tác từ mới đến cũ"
                    >
                      📅 Thời điểm diễn ra
                    </button>
                  </div>
                </div>
                <div className="timeline-meta-tags">
                  <span className="timeline-badge-count">Tổng: {visibleTimeline.length} dòng</span>
                  <span className="timeline-badge-pagesize">20 dòng / trang</span>
                </div>
              </div>

              <div className="timeline-scroll-container">
                {visibleTimeline.length === 0 ? (
                  <div className="timeline-empty-notice">
                    <span>🕒</span>
                    <p>Chưa có tương tác nào trong dòng thời gian của lead này.</p>
                  </div>
                ) : (
                  <div className="timeline-list">
                    {paginatedTimeline.map((item, index) => {
                      const isOverdue = overdue(item)
                      const typeLabel =
                        item.action === 'status_transition' ? 'Đổi trạng thái' :
                        item.action === 'updated' ? 'Cập nhật hồ sơ' :
                        item.action === 'assignment' ? 'Thay đổi người phụ trách' :
                        item.action === 'created' ? 'Tạo lead' :
                        item.action === 'converted' ? 'Đã nhập học' :
                        item.action === 'note' ? 'Ghi chú lead' :
                        item.interaction_type === 'call' ? 'Cuộc gọi' :
                        item.interaction_type === 'message' ? 'Tin nhắn' :
                        item.interaction_type === 'meeting' ? 'Cuộc gặp' : (item.interaction_type || 'Tương tác')

                      const typeClass =
                        item.action === 'status_transition' ? 'type-status' :
                        item.action === 'created' ? 'type-created' :
                        item.action === 'converted' ? 'type-converted' :
                        item.interaction_type === 'call' ? 'type-call' :
                        item.interaction_type === 'message' ? 'type-message' :
                        item.interaction_type === 'meeting' ? 'type-meeting' : 'type-default'

                      const isNewlyAdded = currentTimelinePage === 1 && index === 0

                      return (
                        <article className={`timeline-entry ${typeClass} ${isOverdue ? 'overdue' : ''}`} key={item.id}>
                          <div className="timeline-entry-rail">
                            <span className="timeline-entry-dot" />
                          </div>
                          <div className="timeline-entry-card">
                            <div className="timeline-entry-header">
                              <span className="timeline-entry-type">{typeLabel}</span>
                              {isNewlyAdded && <span className="timeline-tag-new">Mới nhất</span>}
                              <span className="timeline-entry-time">
                                {dateTime(item.created_at)}
                                {item.user_name ? ` · ${item.user_name}` : ''}
                              </span>
                            </div>
                            <p className="timeline-entry-content">{item.content}</p>
                            {item.follow_up_at && (
                              <div className={`timeline-reminder-pill ${isOverdue ? 'pill-overdue' : 'pill-upcoming'}`}>
                                {isOverdue ? '⚠️ Quá hạn · ' : '🔔 Nhắc lại · '}
                                {dateTime(item.follow_up_at)}
                              </div>
                            )}
                          </div>
                        </article>
                      )
                    })}
                  </div>
                )}
              </div>

              <div className="timeline-pager">
                <div className="timeline-pager-info">
                  <span>
                    Trang <strong>{currentTimelinePage}</strong> / {timelineTotalPages}
                    {visibleTimeline.length > 0 && (
                      <small>
                        {' '}(dòng {(currentTimelinePage - 1) * TIMELINE_PAGE_SIZE + 1}–{Math.min(currentTimelinePage * TIMELINE_PAGE_SIZE, visibleTimeline.length)} trên tổng {visibleTimeline.length} dòng)
                      </small>
                    )}
                  </span>
                </div>

                <div className="timeline-pager-nav">
                  <button
                    type="button"
                    disabled={currentTimelinePage <= 1}
                    onClick={() => setTimelinePage(1)}
                    title="Trang đầu tiên"
                  >
                    « Đầu
                  </button>
                  <button
                    type="button"
                    disabled={currentTimelinePage <= 1}
                    onClick={() => setTimelinePage((p) => Math.max(1, p - 1))}
                    title="Trang trước"
                  >
                    ‹ Trước
                  </button>

                  {Array.from({ length: timelineTotalPages }, (_, i) => i + 1)
                    .filter((p) => p === 1 || p === timelineTotalPages || Math.abs(p - currentTimelinePage) <= 1)
                    .reduce<(number | string)[]>((acc, p, idx, arr) => {
                      if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push('...')
                      acc.push(p)
                      return acc
                    }, [])
                    .map((item, idx) =>
                      typeof item === 'string' ? (
                        <span key={`dots-${idx}`} className="pager-dots">…</span>
                      ) : (
                        <button
                          key={item}
                          type="button"
                          className={item === currentTimelinePage ? 'active' : ''}
                          onClick={() => setTimelinePage(item)}
                        >
                          {item}
                        </button>
                      )
                    )}

                  <button
                    type="button"
                    disabled={currentTimelinePage >= timelineTotalPages}
                    onClick={() => setTimelinePage((p) => Math.min(timelineTotalPages, p + 1))}
                    title="Trang kế tiếp"
                  >
                    Sau ›
                  </button>
                  <button
                    type="button"
                    disabled={currentTimelinePage >= timelineTotalPages}
                    onClick={() => setTimelinePage(timelineTotalPages)}
                    title="Trang cuối cùng"
                  >
                    Cuối »
                  </button>
                </div>
              </div>
            </div>
          </div>
        </Dialog>
      )}

      {convertModalLead && (
        <Dialog
          title="Xác nhận chuyển thành học viên chính thức"
          className="convert-confirm-dialog"
          onClose={() => { if (!convertingId) setConvertModalLead(null) }}
        >
          <div className="convert-confirm-content">
            <div className="convert-lead-card">
              <div className="convert-avatar">🎓</div>
              <div className="convert-lead-details">
                <h4>{convertModalLead.full_name}</h4>
                <div className="convert-info-row">
                  <span>📞 {convertModalLead.phone}</span>
                  <span>✉️ {convertModalLead.email || <strong style={{ color: '#ef4444' }}>Chưa có email!</strong>}</span>
                </div>
                {convertModalLead.program_interest && (
                  <p className="convert-program">Khóa học quan tâm: <strong>{convertModalLead.program_interest}</strong></p>
                )}
              </div>
            </div>

            {!convertModalLead.email && (
              <div className="ops-warning-banner" role="alert" style={{ margin: '12px 0' }}>
                ⚠️ <strong>Cần có email:</strong> Hệ thống yêu cầu email học viên để khởi tạo tài khoản và gửi thông tin kích hoạt. Vui lòng cập nhật email cho lead này trước khi nhập học.
              </div>
            )}

            <div className="convert-steps-box">
              <h5>Tiến trình xử lý tự động của hệ thống:</h5>
              <ul>
                <li>Tạo hồ sơ học viên chính thức trong hệ thống đào tạo</li>
                <li>Tự động cấp mã học viên mới (định dạng <code>STU-YYYYMMDD-...</code>)</li>
                <li>Tạo tài khoản người dùng và gửi email kích hoạt mật khẩu cho học viên</li>
                <li>Chuyển trạng thái lead sang <strong>Đã nhập học</strong> và khóa để chống trùng lặp / chống spam</li>
              </ul>
            </div>

            <div className="ops-dialog-actions" style={{ justifyContent: 'flex-end', marginTop: 18 }}>
              <button
                type="button"
                className="ops-button"
                disabled={convertingId === convertModalLead.id}
                onClick={() => setConvertModalLead(null)}
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                className="ops-primary btn-confirm-convert"
                disabled={convertingId === convertModalLead.id || !convertModalLead.email}
                onClick={() => void executeConvert(convertModalLead)}
              >
                {convertingId === convertModalLead.id ? '⏳ Đang xử lý nhập học...' : '🎓 Xác nhận nhập học ngay'}
              </button>
            </div>
          </div>
        </Dialog>
      )}

      {rejectionLead && (
        <Dialog title={`Từ chối lead · ${rejectionLead.full_name}`} onClose={() => setRejectionLead(null)}>
          <form className="ops-form" onSubmit={(e) => void submitRejection(e)}>
            <p className="ops-muted">Ghi rõ lý do từ chối để lưu vào hồ sơ tuyển sinh.</p>
            <Field label="Lý do từ chối">
              <textarea required autoFocus maxLength={1000} value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)} />
            </Field>
            <div className="ops-dialog-actions">
              <button type="button" className="ops-button" onClick={() => setRejectionLead(null)}>Hủy</button>
              <button className="ops-primary">Xác nhận từ chối</button>
            </div>
          </form>
        </Dialog>
      )}
    </section>
  )
}

function StudentsOps({ request, notify, user, canEdit, canManage }: { request: Api; notify: Props['notify']; user: Props['user']; canEdit: boolean; canManage: boolean }) {
  const isStudent = user.roles.includes('student')
  const isStaff = canEdit || canManage || user.roles.some((r) => ['admin', 'training_manager', 'academic_affairs', 'accountant', 'instructor', 'admissions'].includes(r))
  const [tab, setTab] = useState<'students' | 'guide' | 'my-schedule' | 'my-profile'>(isStaff ? 'students' : 'my-schedule')
  const [page, setPage] = useState<Page<Student>>({ items: [], total: 0, page: 1, page_size: 20 })
  const [query, setQuery] = useState('')
  const [classes, setClasses] = useState<TrainingClass[]>([])
  const [classFilter, setClassFilter] = useState('')
  const [studentPageSize, setStudentPageSize] = useState(20)
  const [loading, setLoading] = useState(false)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<Student | null>(null)
  const [profile, setProfile] = useState<Student | null>(null)
  const [history, setHistory] = useState<StudentHistoryEntry[]>([])
  const [historyPage, setHistoryPage] = useState(1)
  const [statusForm, setStatusForm] = useState({ action: 'defer', effective_date: today(), reason: '', target_class_id: '' })
  const [mySchedule, setMySchedule] = useState<TrainingSession[]>([])
  const [ownProfile, setOwnProfile] = useState<Student | null>(null)
  const [personalLoading, setPersonalLoading] = useState(true)
  const [ownProfileLoading, setOwnProfileLoading] = useState(true)
  const [ownProfileError, setOwnProfileError] = useState('')
  const [scheduleError, setScheduleError] = useState('')
  const [edit, setEdit] = useState({ full_name: '', phone: '', date_of_birth: '', address: '', entry_level: '', notes: '' })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    request<Page<TrainingClass> | TrainingClass[]>('/training/classes?page=1&page_size=100')
      .then((res) => setClasses(asPage(res).items))
      .catch(() => {})
  }, [request])

  const load = useCallback(async (pageNo = 1, currentClass = classFilter) => {
    setLoading(true); setError('')
    try {
      const result = asPage(await request<Page<Student>>(`/students?${qs({
        q: query,
        class_id: currentClass || undefined,
        page: pageNo,
        page_size: studentPageSize,
      })}`))
      setPage({ ...result, items: result.items.map(normalizeStudent) })
    }
    catch (e) { setError(e instanceof Error ? e.message : 'Không thể tải hồ sơ học viên.') }
    finally { setLoading(false) }
  }, [request, query, classFilter, studentPageSize])

  useEffect(() => { if (tab === 'students') void load(1, classFilter) }, [load, tab, classFilter])

  useEffect(() => {
    if (tab !== 'my-schedule' && tab !== 'my-profile') return
    let active = true
    request<Student>('/students/me')
      .then((value) => {
        if (active) {
          setOwnProfile(normalizeStudent(value))
          setOwnProfileError('')
        }
      })
      .catch((e: unknown) => {
        if (active) setOwnProfileError(e instanceof Error ? e.message : 'Không thể tải hồ sơ học viên.')
      })
      .finally(() => { if (active) setOwnProfileLoading(false) })

    const from = today()
    const through = new Date(`${from}T00:00:00`)
    through.setDate(through.getDate() + 90)
    request<TrainingSession[]>(`/students/me/schedule?${qs({ start: from, end: localDate(through) })}`)
      .then((value) => {
        if (active) {
          setMySchedule(value.map(normalizeSession))
          setScheduleError('')
        }
      })
      .catch((e: unknown) => {
        if (active) setScheduleError(e instanceof Error ? e.message : 'Không thể tải thời khóa biểu.')
      })
      .finally(() => { if (active) setPersonalLoading(false) })
    return () => { active = false }
  }, [request, tab, isStudent])

  async function reloadOwnProfile() {
    setOwnProfileLoading(true)
    setOwnProfileError('')
    const start = Date.now()
    try {
      const data = await request<Student>('/students/me')
      setOwnProfile(normalizeStudent(data))
      const elapsed = Date.now() - start
      if (elapsed < 1000) await new Promise((r) => setTimeout(r, 1000 - elapsed))
      notify('Tải thành công', 'success')
    } catch (e) {
      setOwnProfileError(e instanceof Error ? e.message : 'Không thể tải hồ sơ học viên.')
      notify(e instanceof Error ? e.message : 'Không thể tải hồ sơ học viên.', 'error')
    } finally {
      setOwnProfileLoading(false)
    }
  }

  async function reloadMySchedule() {
    setPersonalLoading(true)
    setScheduleError('')
    const start = Date.now()
    const from = today()
    const through = new Date(`${from}T00:00:00`)
    through.setDate(through.getDate() + 90)
    try {
      const value = await request<TrainingSession[]>(`/students/me/schedule?${qs({ start: from, end: localDate(through) })}`)
      const list = value.map(normalizeSession)
      setMySchedule(list)
      const elapsed = Date.now() - start
      if (elapsed < 1000) await new Promise((r) => setTimeout(r, 1000 - elapsed))
      if (list.length === 0) {
        notify('Không có dữ liệu', 'error')
      } else {
        notify('Tải thành công', 'success')
      }
    } catch (e) {
      setScheduleError(e instanceof Error ? e.message : 'Không thể tải thời khóa biểu.')
      notify(e instanceof Error ? e.message : 'Không thể tải thời khóa biểu.', 'error')
    } finally {
      setPersonalLoading(false)
    }
  }

  async function handleSearch() {
    setSearching(true)
    await Promise.all([
      load(1),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ])
    setSearching(false)
  }

  async function openProfile(row: Student) {
    setSelected(row); setProfile(null); setHistory([]); setHistoryPage(1)
    try {
      const value = await request<Student & { history?: unknown[]; activities?: unknown[] }>(`/students/${row.id}`)
      const normalized = normalizeStudent(value)
      setProfile(normalized)
      setHistory([
        ...(value.class_history ?? []).map((entry) => ({ type: 'class' as const, ...entry })),
        ...(value.status_history ?? []).map((entry) => ({ type: 'status' as const, ...entry })),
      ].sort((left, right) => {
        const leftDate = left.type === 'class' ? left.enrolled_at : left.created_at
        const rightDate = right.type === 'class' ? right.enrolled_at : right.created_at
        return rightDate.localeCompare(leftDate)
      }))
      setEdit({
        full_name: value.full_name, phone: value.phone ?? '',
        date_of_birth: value.date_of_birth ?? '', address: value.address ?? '',
        entry_level: value.entry_level ?? '', notes: value.notes ?? '',
      })
    } catch (e) { notify(e instanceof Error ? e.message : 'Không thể mở hồ sơ.', 'error') }
  }

  async function saveProfile(event: FormEvent) {
    event.preventDefault(); if (!selected) return
    setBusy(true)
    try {
      const payload = {
        full_name: edit.full_name, phone: edit.phone,
        date_of_birth: edit.date_of_birth || null, address: edit.address || null,
        ...(canManage ? { entry_level: edit.entry_level || null, notes: edit.notes || null } : {}),
      }
      const updated = normalizeStudent(await request<Student>(`/students/${selected.id}`, { method: 'PATCH', body: JSON.stringify(payload) }))
      setProfile(updated); notify('Đã cập nhật hồ sơ học viên.', 'success'); await load(page.page)
    } catch (e) { notify(e instanceof Error ? e.message : 'Không thể lưu hồ sơ.', 'error') }
    finally { setBusy(false) }
  }

  async function changeStatus(event: FormEvent) {
    event.preventDefault(); if (!selected) return
    if (statusForm.action === 'withdraw' && !window.confirm('Xác nhận thôi học? Trạng thái sẽ có hiệu lực theo ngày đã chọn.')) return
    setBusy(true)
    try {
      await request(`/students/${selected.id}/status`, { method: 'POST', body: JSON.stringify({
        action: statusForm.action, effective_date: statusForm.effective_date, reason: statusForm.reason,
        ...(statusForm.target_class_id ? { target_class_id: Number(statusForm.target_class_id) } : {}),
      }) })
      notify('Đã ghi nhận thay đổi trạng thái học viên.', 'success'); setStatusForm({ ...statusForm, reason: '' }); await openProfile(selected)
    } catch (e) { notify(e instanceof Error ? e.message : 'Không thể cập nhật trạng thái.', 'error') }
    finally { setBusy(false) }
  }

  const studentTabs: TabDef[] = [
    ...(isStaff ? [
      ['students', '📋 Danh sách học viên', page.total],
      ['guide', 'ℹ️ Quy định trạng thái học tập'],
    ] as TabDef[] : []),
    ['my-schedule', '📅 Lịch học 90 ngày tới', mySchedule.length],
    ['my-profile', '👤 Thông tin cá nhân'],
  ]

  return (
    <section className="ops-page">
      <OpsHeader
        eyebrow="SPRINT 3–4 · HỒ SƠ"
        subtitle={isStaff ? 'Tìm kiếm hồ sơ, theo dõi sĩ số và quản lý thay đổi tình trạng học tập.' : 'Theo dõi lịch học cá nhân và thông tin học viên được cập nhật theo lớp.'}
      />

      {studentTabs.length > 0 && (
        <OpsTabs value={tab} onChange={(k) => setTab(k as 'students' | 'guide' | 'my-schedule' | 'my-profile')} tabs={studentTabs} />
      )}

      {/* 1. Phân trang riêng cho Lịch học 90 ngày tới (Hình 1) */}
      {tab === 'my-schedule' ? (
        <div className="ops-panel">
          <div className="ops-panel-heading">
            <div>
              <span className="ops-eyebrow">SPRINT 4 · THỜI KHÓA BIỂU</span>
              <h3>Lịch học 90 ngày tới</h3>
            </div>
            <button className="ops-button secondary-button" disabled={personalLoading} onClick={() => void reloadMySchedule()}>
              {personalLoading && <span className="ops-spinner-sm" style={{ marginRight: '4px' }} />}
              {personalLoading ? 'Đang tải…' : 'Làm lại'}
            </button>
          </div>
          <StateBox loading={personalLoading} error={scheduleError} empty={!personalLoading && !scheduleError && mySchedule.length === 0} retry={() => void reloadMySchedule()} />
          {!personalLoading && !scheduleError && mySchedule.length === 0 && (
            <p className="ops-muted">Chưa có lịch học để hiển thị. Lịch sẽ xuất hiện sau khi bạn được ghi danh và lớp được xếp thời khóa biểu.</p>
          )}
          {mySchedule.map((item) => (
            <article className="schedule-row" key={item.id}>
              <time>{dateTime(item.start_at)}</time>
              <div>
                <strong>{item.class_name} · {item.subject_name || item.title}</strong>
                <small>{item.room_name || 'Phòng chưa xếp'} · {item.instructor_name || 'Giảng viên chưa phân công'}</small>
              </div>
              <StatusPill value={item.status} />
            </article>
          ))}
        </div>
      ) : tab === 'my-profile' ? (
        /* 2. Phân trang riêng cho Thông tin cá nhân (Hình 1) */
        <div className="ops-panel">
          <div className="ops-panel-heading">
            <div>
              <span className="ops-eyebrow">HỒ SƠ HỌC VIÊN</span>
              <h3>Thông tin cá nhân</h3>
            </div>
            <button className="ops-button secondary-button" disabled={ownProfileLoading} onClick={() => void reloadOwnProfile()}>
              {ownProfileLoading && <span className="ops-spinner-sm" style={{ marginRight: '4px' }} />}
              {ownProfileLoading ? 'Đang tải…' : 'Làm lại'}
            </button>
          </div>
          {ownProfileError ? (
            <StateBox loading={false} error={ownProfileError} empty={false} retry={() => void reloadOwnProfile()} />
          ) : ownProfileLoading && !ownProfile ? (
            <StateBox loading error="" empty={false} />
          ) : ownProfile ? (
            <>
              <div className="ops-profile-grid">
                <span>Mã học viên<strong>{ownProfile.student_code || `HV-${ownProfile.id}`}</strong></span>
                <span>Họ và tên<strong>{ownProfile.full_name}</strong></span>
                <span>Trạng thái<strong><StatusPill value={ownProfile.status} /></strong></span>
                <span>Lớp hiện tại<strong>{ownProfile.current_class || 'Chưa được xếp lớp'}</strong></span>
                <span>Email<strong>{ownProfile.email || '—'}</strong></span>
                <span>Điện thoại<strong>{ownProfile.phone || '—'}</strong></span>
                <span>Ngày sinh<strong>{displayDate(ownProfile.date_of_birth)}</strong></span>
                <span>Trình độ đầu vào<strong>{ownProfile.entry_level || 'Chưa cập nhật'}</strong></span>
                <span>Địa chỉ<strong>{ownProfile.address || 'Chưa cập nhật'}</strong></span>
                <span>Ghi chú<strong>{ownProfile.notes || 'Không có ghi chú'}</strong></span>
              </div>
              <div className="ops-dialog-section">
                <h3>Lịch sử lớp học</h3>
                {ownProfile.class_history?.length ? ownProfile.class_history.map((entry) => (
                  <article className="history-row" key={`${entry.class_id}-${entry.enrolled_at}`}>
                    <strong>{entry.class_code ? `${entry.class_code} · ` : ''}{entry.class_name}</strong>
                    <StatusPill value={entry.status} />
                    <small>Hiệu lực từ {displayDate(entry.effective_from)}{entry.effective_to ? ` đến ${displayDate(entry.effective_to)}` : ''}</small>
                  </article>
                )) : <p className="ops-muted">Chưa có lịch sử ghi danh lớp. Bộ phận đào tạo cần ghi danh bạn vào lớp trước khi lịch học xuất hiện.</p>}
              </div>
            </>
          ) : <StateBox loading={false} error="" empty />}
        </div>
      ) : tab === 'guide' ? (
        <div className="ops-panel">
          <div className="ops-panel-heading">
            <div>
              <span className="ops-eyebrow">HƯỚNG DẪN QUY CHẾ · SPRINT 3–4</span>
              <h3>Vòng đời và quy định tình trạng học viên</h3>
              <p className="ops-muted">Hệ thống TMS quản lý trạng thái học viên chặt chẽ theo 4 giai đoạn, tự động liên kết với sĩ số lớp học và bảng điểm.</p>
            </div>
          </div>
          <div className="ops-guide-grid">
            <article className="ops-guide-card">
              <header>
                <h4>1. Đang hoạt động</h4>
                <StatusPill value="active" />
              </header>
              <p>Học viên đang học bình thường tại lớp được phân công, có tên trong danh sách điểm danh và sổ điểm.</p>
              <ul>
                <li>Chiếm 1 suất sĩ số thực tế của lớp học.</li>
                <li>Được phép nộp bài tập, điểm danh và đánh giá khảo sát cuối môn.</li>
              </ul>
            </article>
            <article className="ops-guide-card">
              <header>
                <h4>2. Bảo lưu</h4>
                <StatusPill value="deferred" />
              </header>
              <p>Học viên tạm ngừng học tập từ ngày có hiệu lực được ghi nhận.</p>
              <ul>
                <li>Hệ thống kết thúc ghi danh đang hoạt động tại ngày hiệu lực.</li>
                <li>Lý do và ngày hiệu lực được lưu trong lịch sử hồ sơ.</li>
              </ul>
            </article>
            <article className="ops-guide-card">
              <header>
                <h4>3. Chuyển lớp</h4>
                <StatusPill value="transferred" />
              </header>
              <p>Học viên được chuyển từ lớp đang học sang một lớp chưa kết thúc.</p>
              <ul>
                <li>Hệ thống kiểm tra lớp đích còn chỗ và chưa có ghi danh trước đó của học viên.</li>
                <li>Lưu vết lịch sử học tập tại cả lớp cũ và lớp mới.</li>
              </ul>
            </article>
            <article className="ops-guide-card">
              <header>
                <h4>4. Thôi học</h4>
                <StatusPill value="withdrawn" />
              </header>
              <p>Học viên chính thức rút lui hoặc bị buộc thôi học do vi phạm quy chế đào tạo.</p>
              <ul>
                <li>Khóa quyền tham gia các buổi học tương lai.</li>
                <li>Lưu trữ hồ sơ vĩnh viễn với đầy đủ ngày hiệu lực và lý do.</li>
              </ul>
            </article>
          </div>
        </div>
      ) : (
        <>
          <div className="ops-toolbar">
            <input
              placeholder="Tìm theo tên, mã HV hoặc số điện thoại…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void handleSearch() }}
            />
            <div style={{ minWidth: '240px' }}>
              <SearchableSelect
                options={[
                  { value: '', label: 'Tất cả lớp học' },
                  ...classes.map((c) => ({
                    value: String(c.id),
                    label: `${c.code ? c.code + ' · ' : ''}${c.name}`,
                    subLabel: c.program_name,
                    badge: c.capacity ? `${c.capacity} chỗ` : undefined,
                  })),
                ]}
                value={classFilter}
                onChange={(val) => {
                  setClassFilter(val)
                  void load(1, val)
                }}
                placeholder="Lọc theo lớp có sẵn..."
              />
            </div>
            <button className="ops-primary" disabled={loading || searching} onClick={() => void handleSearch()}>
              {searching && <span className="ops-spinner-sm" />}
              {searching ? 'Đang tìm…' : 'Tìm học viên'}
            </button>
          </div>
          <div className="ops-panel">
            <StateBox loading={loading} error={error} empty={!loading && !error && page.items.length === 0} retry={() => void load(page.page)} />
            {page.items.length > 0 && (
              <>
                <PaginationTable
                  rows={page.items}
                  keyFor={(row) => row.id}
                  startIndex={(page.page - 1) * page.page_size + 1}
                  columns={[
                    { name: 'Mã / Học viên', render: (row) => <button className="ops-link" onClick={() => void openProfile(row)}>{row.student_code || `HV-${row.id}`} · {row.full_name}</button> },
                    { name: 'Liên hệ', render: (row) => <>{row.phone || '—'}<small>{row.email || ''}</small></> },
                    { name: 'Lớp hiện tại', render: (row) => row.current_class || row.class_name || 'Chưa xếp lớp' },
                    { name: 'Trạng thái', render: (row) => <StatusPill value={row.status} /> },
                    { name: 'Hồ sơ', render: (row) => <button className="ops-button" onClick={() => void openProfile(row)}>Chi tiết</button> },
                  ]}
                />
                <div className="student-records-pagination">
                  <div className="pagination-range-text">
                    Đang xem <strong>{page.items.length > 0 ? (page.page - 1) * page.page_size + 1 : 0}–{Math.min(page.page * page.page_size, page.total)}</strong> trong tổng số <strong>{page.total.toLocaleString('vi-VN')}</strong> học viên
                  </div>
                  <div className="pagination-action-cluster">
                    <div className="page-size-picker">
                      <span className="ops-muted">Số dòng:</span>
                      <select
                        value={studentPageSize}
                        onChange={(e) => {
                          const s = Number(e.target.value)
                          setStudentPageSize(s)
                          void load(1, classFilter)
                        }}
                      >
                        <option value={10}>10 / trang</option>
                        <option value={20}>20 / trang</option>
                        <option value={50}>50 / trang</option>
                      </select>
                    </div>
                    <div className="pagination-nav-buttons">
                      <button
                        type="button"
                        className="pagination-nav-btn"
                        disabled={page.page <= 1 || loading}
                        onClick={() => void load(page.page - 1)}
                      >
                        ‹ Trang trước
                      </button>
                      <span className="pagination-indicator-chip">
                        Trang <strong>{page.page}</strong> / {Math.max(1, Math.ceil(page.total / page.page_size))}
                      </span>
                      <button
                        type="button"
                        className="pagination-nav-btn"
                        disabled={page.page >= Math.ceil(page.total / page.page_size) || loading}
                        onClick={() => void load(page.page + 1)}
                      >
                        Trang sau ›
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {selected && (
        <Dialog title={`Hồ sơ học viên · ${profile?.full_name ?? selected.full_name}`} className="ops-dialog-wide" onClose={() => setSelected(null)}>
          {!profile ? (
            <StateBox loading error="" empty={false} />
          ) : (
            <div className="ops-profile">
              <div className="ops-profile-grid">
                <span>Mã học viên<strong>{profile.student_code || `HV-${profile.id}`}</strong></span>
                <span>Tình trạng<strong><StatusPill value={profile.status} /></strong></span>
                <span>Lớp hiện tại<strong>{profile.current_class || profile.class_name || 'Chưa xếp lớp'}</strong></span>
                <span>Email<strong>{profile.email || '—'}</strong></span>
              </div>
              {canEdit && (
                <form className="ops-form" onSubmit={(e) => void saveProfile(e)}>
                  <h3>Thông tin liên hệ</h3>
                  <div className="ops-form-grid">
                    <Field label="Họ và tên"><input required value={edit.full_name} onChange={(e) => setEdit({ ...edit, full_name: e.target.value })} /></Field>
                    <Field label="Điện thoại"><input required value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
                    <Field label="Ngày sinh"><input type="date" value={edit.date_of_birth} onChange={(e) => setEdit({ ...edit, date_of_birth: e.target.value })} /></Field>
                    <Field label="Địa chỉ"><input value={edit.address} onChange={(e) => setEdit({ ...edit, address: e.target.value })} /></Field>
                    {canManage && (
                      <>
                        <Field label="Trình độ đầu vào"><input value={edit.entry_level} onChange={(e) => setEdit({ ...edit, entry_level: e.target.value })} /></Field>
                        <Field label="Ghi chú"><textarea value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
                      </>
                    )}
                  </div>
                  <button className="ops-primary" disabled={busy}>Lưu hồ sơ</button>
                </form>
              )}
              <div className="ops-dialog-section">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <h3 style={{ margin: 0 }}>Lịch sử hồ sơ ({history.length} bản ghi)</h3>
                  {history.length > 5 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12.5px' }}>
                      <span style={{ color: '#64748b' }}>Trang {historyPage} / {Math.ceil(history.length / 5)}</span>
                      <button
                        type="button"
                        className="ops-button"
                        style={{ padding: '3px 8px', minHeight: '28px' }}
                        disabled={historyPage <= 1}
                        onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                      >
                        ‹
                      </button>
                      <button
                        type="button"
                        className="ops-button"
                        style={{ padding: '3px 8px', minHeight: '28px' }}
                        disabled={historyPage >= Math.ceil(history.length / 5)}
                        onClick={() => setHistoryPage((p) => Math.min(Math.ceil(history.length / 5), p + 1))}
                      >
                        ›
                      </button>
                    </div>
                  )}
                </div>
                {history.length ? history.slice((historyPage - 1) * 5, historyPage * 5).map((entry) => entry.type === 'class' ? (
                  <article className="history-row" key={`class-${entry.class_id}-${entry.enrolled_at}`}>
                    <strong>{entry.class_code ? `${entry.class_code} · ` : ''}{entry.class_name}</strong>
                    <StatusPill value={entry.status} />
                    <small>Ghi danh: {dateTime(entry.enrolled_at)} · Hiệu lực từ {displayDate(entry.effective_from)}{entry.effective_to ? ` đến ${displayDate(entry.effective_to)}` : ''}</small>
                  </article>
                ) : (
                  <article className="history-row" key={`status-${entry.id}`}>
                    <strong>{statusLabels[entry.action] ?? entry.action} · {displayDate(entry.effective_date)}</strong>
                    <small>{entry.reason}{entry.target_class_id ? ` · Lớp đích #${entry.target_class_id}` : ''}</small>
                  </article>
                )) : <p className="ops-muted">Chưa có lịch sử lớp học hoặc thay đổi trạng thái.</p>}
              </div>
              {canManage && (
                <form className="ops-form" onSubmit={(e) => void changeStatus(e)}>
                  <h3>Bảo lưu · chuyển lớp · thôi học</h3>
                  <div className="ops-form-grid">
                    <Field label="Thao tác">
                      <select value={statusForm.action} onChange={(e) => setStatusForm({ ...statusForm, action: e.target.value })}>
                        <option value="defer">Bảo lưu</option>
                        <option value="transfer">Chuyển lớp</option>
                        <option value="withdraw">Thôi học</option>
                      </select>
                    </Field>
                    <Field label="Ngày có hiệu lực">
                      <input type="date" required value={statusForm.effective_date} onChange={(e) => setStatusForm({ ...statusForm, effective_date: e.target.value })} />
                    </Field>
                    {statusForm.action === 'transfer' && (
                      <Field label="Chọn lớp chuyển đến (tìm kiếm theo mã hoặc tên lớp)">
                        <SearchableSelect
                          options={classes
                            .filter((c) => c.status !== 'completed' && c.status !== 'cancelled')
                            .map((c) => ({
                              value: String(c.id),
                              label: `${c.code ? c.code + ' · ' : ''}${c.name}`,
                              subLabel: c.program_name,
                              badge: c.capacity ? `${c.capacity} chỗ` : undefined,
                            }))}
                          value={statusForm.target_class_id}
                          onChange={(val) => setStatusForm({ ...statusForm, target_class_id: val })}
                          placeholder="Tìm mã hoặc tên lớp đích..."
                        />
                      </Field>
                    )}
                    <Field label="Lý do">
                      <textarea required value={statusForm.reason} onChange={(e) => setStatusForm({ ...statusForm, reason: e.target.value })} />
                    </Field>
                  </div>
                  <button className="ops-primary" disabled={busy}>Ghi nhận thay đổi</button>
                </form>
              )}
            </div>
          )}
        </Dialog>
      )}
    </section>
  )
}

function ClassesOps({ request, notify, canEdit }: { request: Api; notify: Props['notify']; canEdit: boolean }) {
  const [tab, setTab] = useState<'classes' | 'create' | 'calendar' | 'assignments' | 'rooms' | 'create-room' | 'enroll' | 'schedule'>('classes')
  const [page, setPage] = useState<Page<TrainingClass>>({ items: [], total: 0, page: 1, page_size: 20 })
  const [filters, setFilters] = useState({ q: '', program_id: '', status: '', instructor_id: '', date_from: '', date_to: '' })
  const [pageNo, setPageNo] = useState(1)
  const [programs, setPrograms] = useState<Program[]>([])
  const [rooms, setRooms] = useState<TrainingRoom[]>([])
  const [classesLoading, setClassesLoading] = useState(false)
  const [searching, setSearching] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<TrainingClass | null>(null)
  const [sessionToEdit, setSessionToEdit] = useState<TrainingSession | null>(null)
  const [sessionChange, setSessionChange] = useState({ action: 'reschedule', start_at: '', end_at: '', reason: '' })
  const [students, setStudents] = useState<Student[]>([])
  const [studentPage, setStudentPage] = useState<Page<Student>>({ items: [], total: 0, page: 1, page_size: 20 })
  const [studentSearch, setStudentSearch] = useState('')
  const [studentLoading, setStudentLoading] = useState(false)
  const [studentError, setStudentError] = useState('')
  const [chosen, setChosen] = useState<number[]>([])
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [instructors, setInstructors] = useState<Person[]>([])
  const [teachingAssistants, setTeachingAssistants] = useState<Person[]>([])
  const [classSubjects, setClassSubjects] = useState<Record<number, { instructor_id?: number; ta_ids?: number[] }>>({})
  const [assignmentLoading, setAssignmentLoading] = useState(false)
  const [assignmentError, setAssignmentError] = useState('')
  const [existingEnrollmentIds, setExistingEnrollmentIds] = useState<Set<number>>(new Set())
  const [classEnrollments, setClassEnrollments] = useState<ClassEnrollmentRecord[]>([])
  const [enrollmentLoading, setEnrollmentLoading] = useState(false)
  const [enrollmentError, setEnrollmentError] = useState('')
  const [schedule, setSchedule] = useState({ recurrence: 'weekly', weekdays: ['0', '2', '4'], start_date: today(), count: '1', start_time: '18:00', end_time: '20:00', room_id: '', instructor_id: '', holidays: '' })
  const [scheduleLimit, setScheduleLimit] = useState(120)
  const [preview, setPreview] = useState<TrainingSession[]>([])
  const [conflicts, setConflicts] = useState<unknown[]>([])
  const [override, setOverride] = useState(false)
  const [form, setForm] = useState({ program_id: '', code: '', name: '', start_date: today(), capacity: '20', format: 'in_person', status: 'planned' })
  const [roomForm, setRoomForm] = useState({ name: '', code: '', room_type: 'physical', capacity: '20', location: '', online_link: '' })
  const [editingRoom, setEditingRoom] = useState<TrainingRoom | null>(null)
  const [busy, setBusy] = useState(false)
  const [sessions, setSessions] = useState<TrainingSession[]>([])
  const [calendarStart, setCalendarStart] = useState(() => {
    const date = new Date(); date.setDate(date.getDate() - ((date.getDay() + 6) % 7)); return localDate(date)
  })
  const [viewMode, setViewMode] = useState<'week' | 'month' | 'agenda'>('week')
  const [currentDay] = useState(today)
  const [calendarFilters, setCalendarFilters] = useState({ class_id: '', instructor_id: '', room_id: '' })

  const loadClasses = useCallback(async (p = 1) => {
    setClassesLoading(true); setError('')
    try {
      const result = await request<Page<TrainingClass> | TrainingClass[]>(`/training/classes?${qs({ ...filters, page: p, page_size: 20 })}`)
      const data = asPage(result)
      setPage({ ...data, items: data.items.map(normalizeClass) }); setPageNo(p)
    } catch (e) { setError(e instanceof Error ? e.message : 'Không thể tải danh sách lớp.') }
    finally { setClassesLoading(false) }
  }, [request, filters])

  const loadRooms = useCallback(async () => {
    try { setRooms(asPage(await request<Page<TrainingRoom> | TrainingRoom[]>('/training/rooms?page=1&page_size=100')).items) }
    catch (e) { notify(e instanceof Error ? e.message : 'Không thể tải phòng học.', 'error') }
  }, [request, notify])

  useEffect(() => {
    request<Program[]>('/training/programs').then(setPrograms).catch((e: unknown) => notify(e instanceof Error ? e.message : 'Không thể tải chương trình.', 'error'))
    loadRooms()
    Promise.all([
      request<Page<Person> | Person[]>('/users?role=instructor&page=1&page_size=100'),
      request<Page<Person> | Person[]>('/users?role=ta&page=1&page_size=100'),
    ]).then(([instructorResponse, taResponse]) => {
      setInstructors(asPage(instructorResponse).items)
      setTeachingAssistants(asPage(taResponse).items)
    }).catch((e: unknown) => notify(e instanceof Error ? e.message : 'Không thể tải danh sách giảng viên và trợ giảng.', 'error'))
  }, [request, notify, loadRooms])

  useEffect(() => { if (tab === 'classes' || tab === 'assignments') void loadClasses(1) }, [tab, filters, loadClasses])

  const loadSessions = useCallback(async () => {
    const start = new Date(`${calendarStart}T00:00:00`)
    if (viewMode === 'month') start.setDate(1)
    const end = new Date(start)
    if (viewMode === 'month') { end.setMonth(end.getMonth() + 1); end.setDate(0) } else end.setDate(end.getDate() + 6)
    try {
      const result = asPage(await request<Page<TrainingSession> | TrainingSession[]>(`/training/sessions?${qs({ start: localDate(start), end: localDate(end), ...calendarFilters })}`))
      setSessions(result.items.map(normalizeSession))
    } catch (e) { setError(e instanceof Error ? e.message : 'Không thể tải lịch.') }
  }, [request, calendarStart, viewMode, calendarFilters])

  useEffect(() => { if (tab === 'calendar') void loadSessions() }, [tab, loadSessions])

  async function handleFilterSearch() {
    setSearching(true)
    setClassesLoading(true)
    setError('')
    const start = Date.now()
    try {
      const result = await request<Page<TrainingClass> | TrainingClass[]>(`/training/classes?${qs({ ...filters, page: 1, page_size: 20 })}`)
      const data = asPage(result)
      const items = data.items.map(normalizeClass)
      setPage({ ...data, items })
      setPageNo(1)
      const elapsed = Date.now() - start
      if (elapsed < 1000) await new Promise((r) => setTimeout(r, 1000 - elapsed))
      if (items.length === 0) {
        notify('Không có dữ liệu', 'error')
      } else {
        notify('Tải thành công', 'success')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không thể tải danh sách lớp.')
      notify(e instanceof Error ? e.message : 'Không thể tải danh sách lớp.', 'error')
    } finally {
      setClassesLoading(false)
      setSearching(false)
    }
  }

  async function handleResetFilters() {
    setResetting(true)
    const resetValues = { q: '', program_id: '', status: '', instructor_id: '', date_from: '', date_to: '' }
    setFilters(resetValues)
    setClassesLoading(true)
    setError('')
    const start = Date.now()
    try {
      const result = await request<Page<TrainingClass> | TrainingClass[]>(`/training/classes?${qs({ ...resetValues, page: 1, page_size: 20 })}`)
      const data = asPage(result)
      const items = data.items.map(normalizeClass)
      setPage({ ...data, items })
      setPageNo(1)
      const elapsed = Date.now() - start
      if (elapsed < 1000) await new Promise((r) => setTimeout(r, 1000 - elapsed))
      if (items.length === 0) {
        notify('Không có dữ liệu', 'error')
      } else {
        notify('Tải thành công', 'success')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không thể tải danh sách lớp.')
      notify(e instanceof Error ? e.message : 'Không thể tải danh sách lớp.', 'error')
    } finally {
      setClassesLoading(false)
      setResetting(false)
    }
  }

  const [studentPageSize, setStudentPageSize] = useState<number>(20)

  async function loadStudentPage(p = 1, size = studentPageSize) {
    setStudentLoading(true); setStudentError('')
    try {
      const result = asPage(await request<Page<Student> | Student[]>(`/students?${qs({ q: studentSearch, page: p, page_size: size })}`))
      setStudents(result.items)
      setStudentPage(result)
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Không thể tìm học viên.'
      setStudentError(message); notify(message, 'error')
    } finally {
      setStudentLoading(false)
    }
  }

  const [editingClass, setEditingClass] = useState<TrainingClass | null>(null)
  const [viewingClass, setViewingClass] = useState<TrainingClass | null>(null)
  const [activeActionMenuId, setActiveActionMenuId] = useState<number | null>(null)
  const [enrollSubTab, setEnrollSubTab] = useState<'in_class' | 'new_enroll'>('in_class')
  const [enrolledSearch, setEnrolledSearch] = useState('')

  async function submitCreateClass(event: FormEvent) {
    event.preventDefault(); setBusy(true)
    try {
      if (editingClass) {
        await request(`/training/classes/${editingClass.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            code: form.code,
            name: form.name,
            start_date: form.start_date,
            capacity: Number(form.capacity),
            format: form.format,
            status: form.status,
          }),
        })
        notify('Đã cập nhật thông tin lớp học thành công.', 'success')
        setEditingClass(null)
      } else {
        await request('/training/classes', {
          method: 'POST',
          body: JSON.stringify({
            program_id: Number(form.program_id),
            code: form.code,
            name: form.name,
            start_date: form.start_date,
            capacity: Number(form.capacity),
            format: form.format,
            status: form.status,
          }),
        })
        notify('Đã tạo lớp và sao chép toàn bộ chương trình môn học thành công.', 'success')
      }
      setForm({ program_id: '', code: '', name: '', start_date: today(), capacity: '20', format: 'in_person', status: 'planned' })
      setTab('classes')
      await loadClasses(pageNo)
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Không thể lưu lớp học.', 'error')
    } finally {
      setBusy(false)
    }
  }

  function openEditClass(row: TrainingClass) {
    setEditingClass(row)
    setForm({
      program_id: String(row.program_id),
      code: row.code || '',
      name: row.name || '',
      start_date: row.start_date ? row.start_date.slice(0, 10) : today(),
      capacity: String(row.capacity ?? 20),
      format: row.format || 'in_person',
      status: row.status || 'planned',
    })
    setTab('create')
  }

  async function deleteClassAction(row: TrainingClass) {
    if (!window.confirm(`Xác nhận xóa hoặc hủy lớp "${row.name}" (${row.code})?`)) return
    setBusy(true)
    try {
      const res = await request<{ message: string; status?: string }>(`/training/classes/${row.id}`, { method: 'DELETE' })
      notify(res.message || 'Đã xử lý xóa lớp học.', 'success')
      await loadClasses(pageNo)
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Không thể xóa lớp học.', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function openEnroll(row: TrainingClass) {
    setSelected(row); setChosen([]); setStudents([]); setTab('enroll'); setEnrollSubTab('in_class'); setEnrolledSearch('')
    setExistingEnrollmentIds(new Set()); setClassEnrollments([]); setEnrollmentError(''); setEnrollmentLoading(true)
    try {
      const firstPage = await request<Page<ClassEnrollmentRecord>>(`/training/classes/${row.id}/enrollments?page=1&page_size=100`)
      const pages = await Promise.all(Array.from(
        { length: Math.max(0, Math.ceil(firstPage.total / firstPage.page_size) - 1) },
        (_, index) => request<Page<ClassEnrollmentRecord>>(`/training/classes/${row.id}/enrollments?page=${index + 2}&page_size=100`),
      ))
      const enrollments = [...firstPage.items, ...pages.flatMap((page) => page.items)]
      setClassEnrollments(enrollments)
      setExistingEnrollmentIds(new Set(enrollments.map((item) => item.student_id)))
    } catch (e) {
      setClassEnrollments([])
      const message = e instanceof Error ? e.message : 'Không thể tải danh sách học viên đã ghi danh.'
      setEnrollmentError(message)
      notify(message, 'error')
    } finally {
      setEnrollmentLoading(false)
    }
    await loadStudentPage(1)
  }
  async function updateClassCapacity(newCap: number) {
    if (!selected) return
    try {
      await request(`/training/classes/${selected.id}`, { method: 'PATCH', body: JSON.stringify({ capacity: newCap }) })
      notify(`Đã cập nhật sức chứa lớp lên ${newCap} học viên.`, 'success')
      setSelected({ ...selected, capacity: newCap })
      void loadClasses(pageNo)
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Không thể sửa sức chứa.', 'error')
    }
  }
  async function findStudents() {
    await loadStudentPage(1)
  }
  async function enroll() {
    if (!selected || !chosen.length) { notify('Chọn ít nhất một học viên để ghi danh.', 'error'); return }
    if (enrollmentLoading || enrollmentError) { notify('Chưa thể kiểm tra danh sách ghi danh của lớp. Hãy tải lại trước khi tiếp tục.', 'error'); return }
    if (selected.enrolled_count !== undefined && chosen.length + selected.enrolled_count > (selected.capacity ?? Infinity)) {
      notify(`Lớp chỉ còn ${Math.max(0, (selected.capacity ?? 0) - selected.enrolled_count)} chỗ trống.`, 'error')
      return
    }
    setBusy(true)
    try {
      await request(`/training/classes/${selected.id}/enrollments`, { method: 'POST', body: JSON.stringify({ student_ids: chosen }) })
      notify(`Đã ghi danh thành công ${chosen.length} học viên vào lớp.`, 'success')
      setChosen([])
      // Tải lại danh sách học viên trong lớp và chuyển về tab in_class
      const firstPage = await request<Page<ClassEnrollmentRecord>>(`/training/classes/${selected.id}/enrollments?page=1&page_size=100`)
      setClassEnrollments(firstPage.items)
      setExistingEnrollmentIds(new Set(firstPage.items.map((item) => item.student_id)))
      setEnrollSubTab('in_class')
      await loadClasses(pageNo)
      await loadStudentPage(1)
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Không thể ghi danh. Kiểm tra trùng lớp và sức chứa.', 'error')
    } finally {
      setBusy(false)
    }
  }
  async function openAssignments(row: TrainingClass) {
    setSelected(row); setTab('assignments'); setAssignmentLoading(true); setAssignmentError('')
    try {
      const [curriculum, assignments] = await Promise.all([
        request<Subject[]>(`/training/programs/${row.program_id}/subjects`),
        request<{ subject_id: number; instructor?: { id: number } | null; tas: { id: number }[] }[]>(`/training/classes/${row.id}/subjects`),
      ])
      setSubjects(curriculum)
      setClassSubjects(Object.fromEntries(assignments.map((subject) => [subject.subject_id, {
        instructor_id: subject.instructor?.id, ta_ids: subject.tas.map((person) => person.id),
      }])))
    } catch (e) {
      setSubjects([])
      const message = e instanceof Error ? e.message : 'Không thể tải phân công môn học.'
      setAssignmentError(message); notify(message, 'error')
    } finally {
      setAssignmentLoading(false)
    }
  }
  async function assignSubject(subjectId: number) {
    if (!selected) return
    const entry = classSubjects[subjectId] ?? {}
    try {
      await request(`/training/classes/${selected.id}/subjects/${subjectId}/staff`, { method: 'PUT', body: JSON.stringify({ instructor_id: entry.instructor_id || null, ta_ids: entry.ta_ids || [] }) })
      notify('Đã lưu phân công giảng viên và trợ giảng.', 'success')
    } catch (e) { notify(e instanceof Error ? e.message : 'Không thể phân công nhân sự.', 'error') }
  }
  function schedulePayload(includeOverride = false) {
    const [startHour, startMinute] = schedule.start_time.split(':').map(Number)
    const [endHour, endMinute] = schedule.end_time.split(':').map(Number)
    const duration = endHour * 60 + endMinute - startHour * 60 - startMinute
    if (!schedule.weekdays.length || duration <= 0) {
      notify('Chọn ít nhất một ngày học và giờ kết thúc phải sau giờ bắt đầu.', 'error')
      return null
    }
    return {
      recurrence: schedule.recurrence,
      weekdays: schedule.weekdays.map(Number),
      start_date: schedule.start_date,
      count: Number(schedule.count),
      session_time: `${schedule.start_time}:00`,
      session_duration_minutes: duration,
      skip_holidays: true,
      holidays: schedule.holidays.split('\n').map((value) => value.trim()).filter(Boolean),
      room_id: schedule.room_id ? Number(schedule.room_id) : null,
      instructor_id: schedule.instructor_id ? Number(schedule.instructor_id) : null,
      ...(includeOverride ? { override_conflicts: override } : {}),
    }
  }
  async function getSchedulePreview(event: FormEvent) {
    event.preventDefault(); if (!selected) return
    const payload = schedulePayload()
    if (!payload) return
    setBusy(true); setConflicts([]); setOverride(false)
    try {
      const result = await request<{ sessions: TrainingSession[]; conflicts: unknown[] }>(`/training/classes/${selected.id}/schedule/preview`, { method: 'POST', body: JSON.stringify(payload) })
      setPreview(result.sessions.map((item) => ({
        ...normalizeSession(item),
        room_name: rooms.find((room) => room.id === item.room_id)?.name,
        instructor_name: instructors.find((person) => person.id === item.instructor_id)?.full_name,
        conflict: Boolean(item.conflicts?.length),
      })))
      setConflicts(result.conflicts)
    } catch (e) { notify(e instanceof Error ? e.message : 'Không thể xem trước lịch.', 'error') }
    finally { setBusy(false) }
  }
  async function saveSchedule() {
    if (!selected) return
    const payload = schedulePayload(true)
    if (!payload) return
    if (conflicts.length && !override) { notify('Có xung đột lịch. Hãy xác nhận ghi đè sau khi kiểm tra.', 'error'); return }
    if (conflicts.length && !window.confirm(`Có ${conflicts.length} xung đột. Xác nhận ghi đè và lưu lịch?`)) return
    setBusy(true)
    try {
      await request(`/training/classes/${selected.id}/schedule`, { method: 'POST', body: JSON.stringify(payload) })
      notify('Đã lưu lịch học định kỳ.', 'success'); setTab('calendar'); setPreview([]); await loadSessions()
    } catch (e) { notify(e instanceof Error ? e.message : 'Không thể lưu lịch.', 'error') }
    finally { setBusy(false) }
  }
  async function saveRoom(event: FormEvent) {
    event.preventDefault(); setBusy(true)
    try {
      const payload = {
        ...roomForm,
        capacity: roomForm.room_type === 'physical' ? Number(roomForm.capacity) : null,
        location: roomForm.room_type === 'physical' ? roomForm.location : null,
        online_link: roomForm.room_type === 'online' ? roomForm.online_link : null,
      }
      await request(editingRoom ? `/training/rooms/${editingRoom.id}` : '/training/rooms', { method: editingRoom ? 'PATCH' : 'POST', body: JSON.stringify(payload) })
      notify(editingRoom ? 'Đã cập nhật phòng.' : 'Đã thêm phòng / không gian học.', 'success'); setEditingRoom(null); setTab('rooms'); await loadRooms()
    } catch (e) { notify(e instanceof Error ? e.message : 'Không thể lưu phòng.', 'error') }
    finally { setBusy(false) }
  }
  async function saveSessionChange(event: FormEvent) {
    event.preventDefault()
    if (!sessionToEdit) return
    if (sessionToEdit.start_at.slice(0, 10) < currentDay) { notify('Chỉ có thể đổi hoặc hủy buổi học trong tương lai.', 'error'); return }
    if (!window.confirm(sessionChange.action === 'cancel' ? 'Xác nhận hủy buổi học trong tương lai?' : 'Xác nhận thay đổi thời gian của buổi học?')) return
    setBusy(true)
    try {
      if (sessionChange.action === 'cancel') {
        await request(`/training/sessions/${sessionToEdit.id}/cancel`, { method: 'POST', body: JSON.stringify({ reason: sessionChange.reason }) })
        notify('Đã hủy buổi học.', 'success')
      } else {
        await request(`/training/sessions/${sessionToEdit.id}`, { method: 'PATCH', body: JSON.stringify({ starts_at: sessionChange.start_at, ends_at: sessionChange.end_at, reason: sessionChange.reason }) })
        notify('Đã đổi lịch buổi học.', 'success')
      }
      setSessionToEdit(null); await loadSessions()
    } catch (e) { notify(e instanceof Error ? e.message : 'Không thể cập nhật buổi học.', 'error') }
    finally { setBusy(false) }
  }
  async function deleteRoom(room: TrainingRoom) {
    if (!window.confirm(`Xóa ${room.name}? Các lịch đã xếp phòng có thể bị ảnh hưởng.`)) return
    try { await request(`/training/rooms/${room.id}`, { method: 'DELETE' }); notify('Đã xóa phòng.', 'success'); await loadRooms() }
    catch (e) { notify(e instanceof Error ? e.message : 'Không thể xóa phòng đang được sử dụng.', 'error') }
  }
  async function openSchedule(row: TrainingClass) {
    setSelected(row); setPreview([]); setConflicts([]); setTab('schedule')
    setScheduleLimit(120)
    setSchedule((current) => ({ ...current, count: '1' }))
    try {
      const curriculum = await request<Subject[]>(`/training/programs/${row.program_id}/subjects`)
      const templateLists = await Promise.all(curriculum.map((subject) =>
        request<{ id: number }[]>(`/training/subjects/${subject.id}/sessions`),
      ))
      const totalSessions = templateLists.reduce((total, templates) => total + templates.length, 0)
      const limit = totalSessions ? Math.min(120, totalSessions) : 120
      setScheduleLimit(limit)
      setSchedule((current) => ({ ...current, count: String(totalSessions ? limit : 1) }))
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Không thể tải số buổi của chương trình.', 'error')
    }
  }
  function moveCalendar(delta: number) { const next = new Date(`${calendarStart}T00:00:00`); if (viewMode === 'week') next.setDate(next.getDate() + delta * 7); else { next.setDate(1); next.setMonth(next.getMonth() + delta) }; setCalendarStart(localDate(next)) }
  const [enrollReturnTab, setEnrollReturnTab] = useState<'classes' | 'rooms'>('classes')

  const calendarDates = useMemo(() => {
    const first = new Date(`${calendarStart}T00:00:00`)
    if (viewMode === 'month') first.setDate(1)
    const count = viewMode === 'week' ? 7 : new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
    return Array.from({ length: count }, (_, index) => {
      const date = new Date(first)
      if (viewMode === 'week') date.setDate(date.getDate() + index)
      else date.setDate(index + 1)
      return localDate(date)
    })
  }, [calendarStart, viewMode])
  const calendarOffset = viewMode === 'month' ? (new Date(`${calendarDates[0]}T00:00:00`).getDay() + 6) % 7 : 0

  const classTabs: TabDef[] = [
    ['classes', '🏫 Danh sách lớp học', page.total],
    ...(tab === 'enroll' && selected ? [['enroll', `👥 Ghi danh: ${selected.code || selected.name}`] as TabDef] : []),
    ...(tab === 'schedule' && selected ? [['schedule', `📅 Xếp lịch: ${selected.code || selected.name}`] as TabDef] : []),
    ...(tab === 'assignments' && selected ? [['assignments', `👨‍🏫 Phân công: ${selected.code || selected.name}`] as TabDef] : []),
    ...(canEdit ? [['create', '➕ Mở lớp học mới'] as TabDef] : []),
    ['calendar', '📅 Thời khóa biểu & Lịch'],
    ['rooms', '🏢 Phòng học & trực tuyến', rooms.length],
  ]

  return (
    <section className="ops-page">
      <OpsHeader
        eyebrow="SPRINT 3–4 · VẬN HÀNH ĐÀO TẠO"
        subtitle="Quản lý lớp, ghi danh học viên, phân công đội ngũ, phòng học và thời khóa biểu định kỳ."
      />

      <OpsTabs
        value={tab === 'create-room' ? 'rooms' : tab}
        onChange={(k) => { setEditingRoom(null); setTab(k as any) }}
        tabs={classTabs}
      />

      {tab === 'create' ? (
        <div className="ops-panel ops-full-form">
          <div className="ops-panel-heading">
            <div>
              <span className="ops-eyebrow">{editingClass ? 'CHỈNH SỬA THÔNG TIN LỚP HỌC' : 'MỞ LỚP HỌC MỚI · SPRINT 3'}</span>
              <h3>{editingClass ? `Chỉnh sửa lớp học · ${editingClass.name}` : 'Mở lớp học từ chương trình đào tạo (CTĐT)'}</h3>
              <p className="ops-muted">
                {editingClass
                  ? 'Cập nhật mã lớp, tên lớp, ngày bắt đầu, sức chứa tối đa và trạng thái của lớp.'
                  : 'Khi tạo lớp, hệ thống sẽ tự động sao chép toàn bộ danh mục môn học, số buổi và chuẩn bị tiến độ đào tạo từ CTĐT đã chọn.'}
              </p>
            </div>
          </div>
          <form className="ops-form" onSubmit={(e) => void submitCreateClass(e)}>
            <div className="ops-form-grid">
              <Field label="Chương trình đào tạo (bắt buộc)">
                <select required disabled={Boolean(editingClass)} value={form.program_id} onChange={(e) => setForm({ ...form, program_id: e.target.value })}>
                  <option value="">-- Chọn chương trình đào tạo --</option>
                  {programs.map((p) => (
                    <option key={p.id} value={p.id}>{p.code ? `${p.code} · ` : ''}{p.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Mã lớp học (bắt buộc)">
                <input required placeholder="Ví dụ: FE-2026-01" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
              </Field>
              <Field label="Tên lớp học (bắt buộc)">
                <input required placeholder="Ví dụ: Lập trình Frontend React K26" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
              <Field label="Ngày khai giảng (bắt buộc)">
                <input type="date" required value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
              </Field>
              <Field label="Sức chứa tối đa (học viên)">
                <input type="number" required min="1" max="500" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value })} />
              </Field>
              <Field label="Hình thức đào tạo">
                <select value={form.format} onChange={(e) => setForm({ ...form, format: e.target.value })}>
                  <option value="in_person">Trực tiếp tại trung tâm</option>
                  <option value="online">Trực tuyến (Online)</option>
                  <option value="hybrid">Kết hợp (Hybrid)</option>
                </select>
              </Field>
              <Field label="Trạng thái">
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  <option value="planned">Dự kiến / Chuẩn bị</option>
                  <option value="running">Đang học / Khai giảng</option>
                  <option value="completed">Đã kết thúc</option>
                  <option value="cancelled">Đã hủy</option>
                </select>
              </Field>
            </div>
            <div className="ops-form-actions" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '24px' }}>
              <button type="button" className="secondary-button btn-cancel ops-button" onClick={() => { setEditingClass(null); setTab('classes') }}>Hủy & Quay lại</button>
              <button type="submit" className="ops-primary" disabled={busy}>
                {busy && <span className="ops-spinner-sm" />}
                {busy ? 'Đang lưu...' : editingClass ? '✓ Lưu thay đổi' : '✓ Xác nhận mở lớp học'}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {tab === 'classes' && (
        <>
          <div className="classes-filter-bar">
            <div className="classes-filter-main">
              <input
                className="classes-search-input"
                placeholder="Tìm theo tên, mã lớp học…"
                value={filters.q}
                onChange={(e) => setFilters({ ...filters, q: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleFilterSearch() }}
              />
              <div style={{ minWidth: '200px' }}>
                <SearchableSelect
                  options={[
                    { value: '', label: 'Tất cả chương trình' },
                    ...programs.map((p) => ({ value: String(p.id), label: `${p.code ? p.code + ' · ' : ''}${p.name}` })),
                  ]}
                  value={filters.program_id}
                  onChange={(val) => setFilters({ ...filters, program_id: val })}
                  placeholder="Lọc chương trình..."
                />
              </div>
              <div style={{ minWidth: '170px' }}>
                <SearchableSelect
                  options={[
                    { value: '', label: 'Tất cả trạng thái' },
                    { value: 'planned', label: 'Đã lên kế hoạch' },
                    { value: 'running', label: 'Đang học' },
                    { value: 'completed', label: 'Hoàn thành' },
                    { value: 'cancelled', label: 'Đã hủy' },
                  ]}
                  value={filters.status}
                  onChange={(val) => setFilters({ ...filters, status: val })}
                  placeholder="Lọc trạng thái..."
                />
              </div>
              <div style={{ minWidth: '190px' }}>
                <SearchableSelect
                  options={[
                    { value: '', label: 'Tất cả giảng viên' },
                    ...instructors.map((p) => ({ value: String(p.id), label: p.full_name })),
                  ]}
                  value={filters.instructor_id}
                  onChange={(val) => setFilters({ ...filters, instructor_id: val })}
                  placeholder="Lọc giảng viên..."
                />
              </div>
            </div>
            <div className="classes-filter-actions">
              <button
                type="button"
                className="ops-primary filter-submit-btn"
                disabled={classesLoading || searching || resetting}
                onClick={() => void handleFilterSearch()}
              >
                {searching ? (
                  <span className="ops-spinner-sm" />
                ) : (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ marginRight: '3px' }}>
                    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                  </svg>
                )}
                <span>Lọc</span>
              </button>
              <button
                type="button"
                className="secondary-button ops-button"
                disabled={classesLoading || searching || resetting}
                onClick={() => void handleResetFilters()}
              >
                {resetting && <span className="ops-spinner-sm" style={{ marginRight: '4px' }} />}
                {resetting ? 'Đang tải…' : 'Làm lại'}
              </button>
            </div>
          </div>

          <div className="ops-panel">
            <StateBox loading={classesLoading} error={error} empty={!classesLoading && !error && page.items.length === 0} retry={() => void loadClasses(pageNo)} />
            {page.items.length > 0 && (
              <>
                <PaginationTable
                  rows={page.items}
                  keyFor={(row) => row.id}
                  startIndex={(pageNo - 1) * 20 + 1}
                  columns={[
                    {
                      name: 'Lớp / chương trình',
                      render: (row) => (
                        <div style={{ cursor: 'pointer' }} onClick={() => setViewingClass(row)} title="Bấm vào để xem chi tiết lớp học">
                          <strong style={{ color: '#4f46e5', textDecoration: 'underline' }}>{row.code || row.name}</strong>
                          <small style={{ display: 'block' }}>{row.name} · {row.program_name || `Chương trình #${row.program_id}`}</small>
                        </div>
                      ),
                    },
                    { name: 'Bắt đầu', render: (row) => row.start_date ? new Date(row.start_date).toLocaleDateString('vi-VN') : '—' },
                    { name: 'Quy mô', render: (row) => <>{row.enrolled_count ?? 0}{row.capacity ? ` / ${row.capacity} học viên` : ' học viên'}<small>{row.capacity ? `${Math.round(((row.enrolled_count ?? 0) / row.capacity) * 100)}% sức chứa` : ''}</small></> },
                    {
                      name: 'Tiến độ CTĐT',
                      render: (row) => {
                        const pct = Math.min(100, Math.max(0, row.curriculum_progress ?? 0))
                        return (
                          <div className="ops-progress-track" title={`Tiến độ hoàn thành: ${pct}%`}>
                            <div className="ops-progress-fill" style={{ width: `${pct}%` }} />
                            <span className="ops-progress-text">{pct}%</span>
                          </div>
                        )
                      },
                    },
                    { name: 'Tình trạng', render: (row) => <StatusPill value={row.status} /> },
                    {
                      name: 'Tác vụ',
                      render: (row, index) => {
                        const isOpen = activeActionMenuId === row.id
                        const isNearBottom = (index ?? 0) >= Math.max(0, page.items.length - 4)
                        return (
                          <div style={{ position: 'relative', display: 'inline-block' }}>
                            <button
                              type="button"
                              className="secondary-button"
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '6px',
                                padding: '5px 12px',
                                fontSize: '13px',
                                fontWeight: 500,
                                borderRadius: '7px',
                                background: isOpen ? '#eef2ff' : '#fff',
                                borderColor: isOpen ? '#6366f1' : '#cbd5e1',
                                color: isOpen ? '#4f46e5' : '#334155',
                                cursor: 'pointer',
                              }}
                              onClick={(e) => {
                                e.stopPropagation()
                                setActiveActionMenuId(isOpen ? null : row.id)
                              }}
                            >
                              <span>⚙️ Tác vụ</span>
                              <span style={{ fontSize: '10px', transform: isOpen ? (isNearBottom ? 'rotate(0deg)' : 'rotate(180deg)') : (isNearBottom ? 'rotate(180deg)' : 'none'), transition: 'transform 0.15s' }}>
                                {isNearBottom ? '▲' : '▼'}
                              </span>
                            </button>

                            {isOpen && (
                              <>
                                <div
                                  style={{ position: 'fixed', inset: 0, zIndex: 999 }}
                                  onClick={() => setActiveActionMenuId(null)}
                                />
                                <div
                                  style={{
                                    position: 'absolute',
                                    right: 0,
                                    ...(isNearBottom ? { bottom: 'calc(100% + 4px)' } : { top: 'calc(100% + 4px)' }),
                                    background: '#fff',
                                    borderRadius: '8px',
                                    boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.15), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
                                    border: '1px solid #cbd5e1',
                                    padding: '6px',
                                    minWidth: '190px',
                                    zIndex: 1000,
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '2px',
                                  }}
                                  onClick={() => setActiveActionMenuId(null)}
                                >
                                  <button
                                    type="button"
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '8px',
                                      padding: '7px 10px',
                                      width: '100%',
                                      textAlign: 'left',
                                      background: 'none',
                                      border: 'none',
                                      borderRadius: '6px',
                                      fontSize: '13px',
                                      color: '#1e293b',
                                      cursor: 'pointer',
                                    }}
                                    onMouseEnter={(e) => (e.currentTarget.style.background = '#f1f5f9')}
                                    onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                                    onClick={() => setViewingClass(row)}
                                  >
                                    <span>👁️</span> Xem chi tiết
                                  </button>

                                  {canEdit && (
                                    <>
                                      <button
                                        type="button"
                                        style={{
                                          display: 'flex',
                                          alignItems: 'center',
                                          gap: '8px',
                                          padding: '7px 10px',
                                          width: '100%',
                                          textAlign: 'left',
                                          background: 'none',
                                          border: 'none',
                                          borderRadius: '6px',
                                          fontSize: '13px',
                                          color: '#4f46e5',
                                          fontWeight: 500,
                                          cursor: 'pointer',
                                        }}
                                        onMouseEnter={(e) => (e.currentTarget.style.background = '#eef2ff')}
                                        onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                                        onClick={() => void openEnroll(row)}
                                      >
                                        <span>👥</span> Ghi danh học viên
                                      </button>

                                      <button
                                        type="button"
                                        style={{
                                          display: 'flex',
                                          alignItems: 'center',
                                          gap: '8px',
                                          padding: '7px 10px',
                                          width: '100%',
                                          textAlign: 'left',
                                          background: 'none',
                                          border: 'none',
                                          borderRadius: '6px',
                                          fontSize: '13px',
                                          color: '#7c3aed',
                                          cursor: 'pointer',
                                        }}
                                        onMouseEnter={(e) => (e.currentTarget.style.background = '#f5f3ff')}
                                        onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                                        onClick={() => openAssignments(row)}
                                      >
                                        <span>👨‍🏫</span> Phân công giảng dạy
                                      </button>

                                      <button
                                        type="button"
                                        style={{
                                          display: 'flex',
                                          alignItems: 'center',
                                          gap: '8px',
                                          padding: '7px 10px',
                                          width: '100%',
                                          textAlign: 'left',
                                          background: 'none',
                                          border: 'none',
                                          borderRadius: '6px',
                                          fontSize: '13px',
                                          color: '#0891b2',
                                          cursor: 'pointer',
                                        }}
                                        onMouseEnter={(e) => (e.currentTarget.style.background = '#ecfeff')}
                                        onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                                        onClick={() => openSchedule(row)}
                                      >
                                        <span>📅</span> Lịch học & TKB
                                      </button>

                                      <div style={{ height: '1px', background: '#e2e8f0', margin: '4px 0' }} />

                                      <button
                                        type="button"
                                        style={{
                                          display: 'flex',
                                          alignItems: 'center',
                                          gap: '8px',
                                          padding: '7px 10px',
                                          width: '100%',
                                          textAlign: 'left',
                                          background: 'none',
                                          border: 'none',
                                          borderRadius: '6px',
                                          fontSize: '13px',
                                          color: '#0369a1',
                                          cursor: 'pointer',
                                        }}
                                        onMouseEnter={(e) => (e.currentTarget.style.background = '#f0f9ff')}
                                        onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                                        onClick={() => openEditClass(row)}
                                      >
                                        <span>✏️</span> Chỉnh sửa lớp
                                      </button>

                                      <button
                                        type="button"
                                        style={{
                                          display: 'flex',
                                          alignItems: 'center',
                                          gap: '8px',
                                          padding: '7px 10px',
                                          width: '100%',
                                          textAlign: 'left',
                                          background: 'none',
                                          border: 'none',
                                          borderRadius: '6px',
                                          fontSize: '13px',
                                          color: '#ef4444',
                                          cursor: 'pointer',
                                        }}
                                        onMouseEnter={(e) => (e.currentTarget.style.background = '#fef2f2')}
                                        onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                                        onClick={() => void deleteClassAction(row)}
                                      >
                                        <span>🗑️</span> Xóa lớp học
                                      </button>
                                    </>
                                  )}
                                </div>
                              </>
                            )}
                          </div>
                        )
                      },
                    },
                  ]}
                />
                <Pager page={page.page} pageSize={page.page_size} total={page.total} onChange={(p) => void loadClasses(p)} />
              </>
            )}
          </div>
        </>
      )}

      {viewingClass && (
        <Dialog title={`Chi tiết lớp học · ${viewingClass.name}`} className="ops-dialog-wide" onClose={() => setViewingClass(null)}>
          <div style={{ padding: '8px 4px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px', marginBottom: '20px' }}>
              <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <span className="ops-muted" style={{ fontSize: '12px', display: 'block' }}>Mã lớp học</span>
                <strong style={{ fontSize: '16px', color: '#0f172a' }}>{viewingClass.code || 'Chưa có mã'}</strong>
              </div>
              <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <span className="ops-muted" style={{ fontSize: '12px', display: 'block' }}>Chương trình đào tạo</span>
                <strong style={{ fontSize: '15px', color: '#0f172a' }}>{viewingClass.program_name || `CTĐT #${viewingClass.program_id}`}</strong>
              </div>
              <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <span className="ops-muted" style={{ fontSize: '12px', display: 'block' }}>Sĩ số / Sức chứa</span>
                <strong style={{ fontSize: '15px', color: '#0f172a' }}>
                  {viewingClass.enrolled_count ?? 0} / {viewingClass.capacity ?? '∞'} học viên
                </strong>
              </div>
              <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <span className="ops-muted" style={{ fontSize: '12px', display: 'block' }}>Trạng thái lớp</span>
                <div style={{ marginTop: '4px' }}><StatusPill value={viewingClass.status} /></div>
              </div>
              <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <span className="ops-muted" style={{ fontSize: '12px', display: 'block' }}>Ngày khai giảng</span>
                <strong style={{ fontSize: '15px', color: '#0f172a' }}>
                  {viewingClass.start_date ? new Date(viewingClass.start_date).toLocaleDateString('vi-VN') : 'Chưa xếp'}
                </strong>
              </div>
              <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <span className="ops-muted" style={{ fontSize: '12px', display: 'block' }}>Hình thức học</span>
                <strong style={{ fontSize: '15px', color: '#0f172a' }}>
                  {viewingClass.format === 'online' ? '🌐 Trực tuyến (Online)' : viewingClass.format === 'hybrid' ? '🔄 Kết hợp (Hybrid)' : '🏫 Trực tiếp'}
                </strong>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', flexWrap: 'wrap', borderTop: '1px solid #e2e8f0', paddingTop: '16px' }}>
              <button
                type="button"
                className="class-action-btn btn-enroll"
                onClick={() => { const target = viewingClass; setViewingClass(null); void openEnroll(target) }}
              >
                <span>👥</span> Ghi danh học viên
              </button>
              <button
                type="button"
                className="class-action-btn btn-assign"
                onClick={() => { const target = viewingClass; setViewingClass(null); openAssignments(target) }}
              >
                <span>👨‍🏫</span> Phân công giảng dạy
              </button>
              <button
                type="button"
                className="class-action-btn btn-schedule"
                onClick={() => { const target = viewingClass; setViewingClass(null); openSchedule(target) }}
              >
                <span>📅</span> Cấu hình thời khóa biểu
              </button>
              {canEdit && (
                <button
                  type="button"
                  className="secondary-button"
                  style={{ color: '#0369a1' }}
                  onClick={() => { const target = viewingClass; setViewingClass(null); openEditClass(target) }}
                >
                  ✏️ Sửa lớp
                </button>
              )}
              <button type="button" className="secondary-button" onClick={() => setViewingClass(null)}>
                Đóng
              </button>
            </div>
          </div>
        </Dialog>
      )}

      {tab === 'calendar' && (
        <div className="ops-panel">
          <div className="calendar-toolbar">
            <div className="calendar-nav-group">
              <div className="calendar-btn-group">
                <button type="button" className="cal-nav-btn" onClick={() => moveCalendar(-1)} title="Khoảng thời gian trước">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
                <button type="button" className="cal-nav-btn" onClick={() => moveCalendar(1)} title="Khoảng thời gian tiếp theo">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              </div>
              <button
                type="button"
                className={`cal-today-action-btn${calendarStart.slice(0, 7) === today().slice(0, 7) ? ' is-current-month' : ''}`}
                onClick={() => setCalendarStart(today())}
                title="Quay về ngày hôm nay"
              >
                📍 Về hôm nay
              </button>
              <label className="calendar-title-badge" title="Bấm để chọn tháng/năm">
                <span className="cal-title-icon" aria-hidden="true">📅</span>
                <span className="cal-title-text">{new Date(calendarStart).toLocaleDateString('vi-VN', { month: 'long', year: 'numeric' })}</span>
                <span className="cal-dropdown-arrow" aria-hidden="true" style={{ fontSize: '11px', opacity: 0.6, marginLeft: '2px' }}>▾</span>
                <input
                  type="month"
                  className="cal-month-hidden-input"
                  aria-label="Chọn tháng và năm"
                  value={calendarStart.slice(0, 7)}
                  onChange={(e) => {
                    if (e.target.value) {
                      setCalendarStart(`${e.target.value}-01`)
                    }
                  }}
                />
              </label>
            </div>

            <div className="calendar-filter-controls">
              <div className="calendar-selects">
                <select value={calendarFilters.class_id} onChange={(e) => setCalendarFilters({ ...calendarFilters, class_id: e.target.value })}>
                  <option value="">Tất cả lớp học</option>
                  {page.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <select value={calendarFilters.instructor_id} onChange={(e) => setCalendarFilters({ ...calendarFilters, instructor_id: e.target.value })}>
                  <option value="">Tất cả giảng viên</option>
                  {instructors.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                </select>
                <select value={calendarFilters.room_id} onChange={(e) => setCalendarFilters({ ...calendarFilters, room_id: e.target.value })}>
                  <option value="">Tất cả phòng học</option>
                  {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>

              <div className="calendar-segmented-view">
                <button
                  type="button"
                  className={`cal-segment-item${viewMode === 'week' ? ' is-active' : ''}`}
                  onClick={() => setViewMode('week')}
                >
                  Tuần
                </button>
                <button
                  type="button"
                  className={`cal-segment-item${viewMode === 'month' ? ' is-active' : ''}`}
                  onClick={() => setViewMode('month')}
                >
                  Tháng
                </button>
                <button
                  type="button"
                  className={`cal-segment-item${viewMode === 'agenda' ? ' is-active' : ''}`}
                  onClick={() => setViewMode('agenda')}
                >
                  Lịch trình
                </button>
              </div>
            </div>
          </div>

          {viewMode === 'agenda' ? (
            <div className="calendar-agenda-view">
              {calendarDates.map((date) => {
                const daySessions = sessions.filter((item) => item.start_at.slice(0, 10) === date)
                if (daySessions.length === 0) return null
                return (
                  <section className="agenda-day-card" key={date}>
                    <header className="agenda-day-header">
                      <strong>{new Date(`${date}T00:00:00`).toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</strong>
                      <span className="agenda-count-badge">{daySessions.length} buổi học</span>
                    </header>
                    <div className="agenda-sessions-list">
                      {daySessions.map((item) => (
                        <div key={item.id} className="agenda-session-row" onClick={() => { setSessionToEdit(item); setSessionChange({ action: 'reschedule', start_at: item.start_at.slice(0, 16), end_at: item.end_at.slice(0, 16), reason: '' }) }}>
                          <time className="agenda-time-pill">{new Date(item.start_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} - {new Date(item.end_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</time>
                          <div className="agenda-session-info">
                            <strong>{item.class_name || `Lớp #${item.class_id}`} · {item.subject_name || item.title || 'Buổi học'}</strong>
                            <small>📍 {item.room_name || 'Chưa xếp phòng'} &nbsp;|&nbsp; 👨‍🏫 {item.instructor_name || 'Chưa phân công'}</small>
                          </div>
                          <button type="button" className="secondary-button ops-button agenda-edit-btn">Chi tiết / Đổi lịch</button>
                        </div>
                      ))}
                    </div>
                  </section>
                )
              })}
              {sessions.length === 0 && <StateBox loading={false} error={error} empty />}
            </div>
          ) : (
            <div className="calendar-grid">
              {viewMode === 'month' && ['T2','T3','T4','T5','T6','T7','CN'].map((day) => <strong className="calendar-weekday" key={day}>{day}</strong>)}
              {viewMode === 'month' && Array.from({ length: calendarOffset }, (_, i) => <span className="calendar-blank" key={`blank-${i}`} />)}
              {calendarDates.map((date) => (
                <section className="calendar-day" key={date}>
                  <header>{new Date(`${date}T00:00:00`).toLocaleDateString('vi-VN', { weekday: 'short', day: 'numeric', month: 'short' })}</header>
                  {sessions.filter((item) => item.start_at.slice(0, 10) === date).map((item) => (
                    <button key={item.id} className="calendar-cell-event" onClick={() => { setSessionToEdit(item); setSessionChange({ action: 'reschedule', start_at: item.start_at.slice(0, 16), end_at: item.end_at.slice(0, 16), reason: '' }) }}>
                      <time>{new Date(item.start_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</time>
                      <strong>{item.class_name || `Lớp #${item.class_id}`}</strong>
                      <small>{item.subject_name || item.title || 'Buổi học'} · {item.room_name || 'Chưa xếp phòng'}</small>
                    </button>
                  ))}
                </section>
              ))}
            </div>
          )}
          {sessions.length === 0 && viewMode !== 'agenda' && <StateBox loading={false} error={error} empty />}
        </div>
      )}

      {tab === 'assignments' && (
        <div className="ops-panel">
          {!selected ? (
            <div className="assignments-class-selection">
              <div className="ops-panel-heading">
                <div>
                  <span className="ops-eyebrow">PHÂN CÔNG GIẢNG DẠY · SPRINT 4</span>
                  <h3>Chọn lớp học để phân công giảng viên & trợ giảng</h3>
                  <p className="ops-muted">Chọn một lớp đang chuẩn bị hoặc đang học để phân công đội ngũ giảng dạy cho từng môn trong chương trình đào tạo.</p>
                </div>
              </div>
              <div className="class-selection-cards-grid">
                {page.items.map((row) => (
                  <article key={row.id} className="class-assignment-card">
                    <div className="class-assignment-header">
                      <span className="class-badge-code">{row.code || `LỚP #${row.id}`}</span>
                      <StatusPill value={row.status} />
                    </div>
                    <h4>{row.name}</h4>
                    <p className="class-prog-name">📚 {row.program_name || `Chương trình #${row.program_id}`}</p>
                    <div className="class-assignment-meta">
                      <span>👥 {row.enrolled_count ?? 0}{row.capacity ? ` / ${row.capacity} HV` : ' HV'}</span>
                      <span>📅 Khai giảng: {row.start_date ? new Date(row.start_date).toLocaleDateString('vi-VN') : '—'}</span>
                    </div>
                    <button type="button" className="ops-primary" style={{ marginTop: '14px', width: '100%' }} onClick={() => void openAssignments(row)}>
                      👉 Phân công giảng dạy lớp này
                    </button>
                  </article>
                ))}
                {page.items.length === 0 && <StateBox loading={classesLoading} error={error} empty />}
              </div>
            </div>
          ) : (
            <div className="assignments-class-detail">
              <div className="ops-panel-heading" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <span className="ops-eyebrow">ĐANG PHÂN CÔNG GIẢNG DẠY</span>
                  <h3>{selected.name} {selected.code ? `(${selected.code})` : ''}</h3>
                  <p className="ops-muted">Chương trình: {selected.program_name || `CTĐT #${selected.program_id}`} · Sĩ số: {selected.enrolled_count ?? 0} học viên</p>
                </div>
                <button type="button" className="secondary-button btn-back ops-button" onClick={() => setSelected(null)}>
                  ← Chọn lớp học khác
                </button>
              </div>
              {assignmentLoading ? (
                <StateBox loading error="" empty={false} />
              ) : assignmentError ? (
                <StateBox loading={false} error={assignmentError} empty={false} retry={() => void openAssignments(selected)} />
              ) : subjects.length ? (
                <div className="assignment-grid">
                  {subjects.map((subject) => (
                    <article key={subject.id}>
                      <div>
                        <strong>{subject.name}</strong>
                        <small>{subject.session_count ?? '—'} buổi · {subject.code || `Môn #${subject.id}`}</small>
                      </div>
                      <Field label="Giảng viên chính">
                        <select disabled={!canEdit} value={classSubjects[subject.id]?.instructor_id ?? ''} onChange={(e) => setClassSubjects({ ...classSubjects, [subject.id]: { ...classSubjects[subject.id], instructor_id: Number(e.target.value) || undefined } })}>
                          <option value="">Chọn giảng viên</option>
                          {instructors.map((person) => <option key={person.id} value={person.id}>{person.full_name}</option>)}
                        </select>
                      </Field>
                      <Field label="Trợ giảng (chọn nhiều)">
                        <select disabled={!canEdit} multiple value={(classSubjects[subject.id]?.ta_ids ?? []).map(String)} onChange={(e) => setClassSubjects({ ...classSubjects, [subject.id]: { ...classSubjects[subject.id], ta_ids: Array.from(e.target.selectedOptions).map((option) => Number(option.value)) } })}>
                          {teachingAssistants.map((person) => <option key={person.id} value={person.id}>{person.full_name}</option>)}
                        </select>
                      </Field>
                      {canEdit && <button className="ops-primary" onClick={() => void assignSubject(subject.id)}>Lưu phân công</button>}
                    </article>
                  ))}
                </div>
              ) : (
                <StateBox loading={false} error="" empty />
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'rooms' && (
        <div className="ops-panel">
          <div className="ops-toolbar">
            <p>Danh mục phòng học vật lý và không gian lớp trực tuyến với giới hạn sức chứa tương ứng.</p>
            {canEdit && (
              <button className="ops-primary" onClick={() => { setEditingRoom(null); setRoomForm({ name: '', code: '', room_type: 'physical', capacity: '20', location: '', online_link: '' }); setTab('create-room') }}>
                ➕ Thêm phòng
              </button>
            )}
          </div>
          {rooms.length ? (
            <PaginationTable
              rows={rooms}
              keyFor={(r) => r.id}
              columns={[
                { name: 'Phòng / không gian', render: (r) => <><strong>{r.name}</strong><small>{r.code || '—'} · {r.location || r.online_link || 'Chưa có vị trí'}</small></> },
                { name: 'Loại', render: (r) => r.room_type === 'online' ? <span style={{ color: '#0284c7', fontWeight: 600 }}>🌐 Trực tuyến</span> : 'Phòng vật lý' },
                { name: 'Sức chứa', render: (r) => r.capacity ? `${r.capacity} người` : 'Không giới hạn' },
                { name: 'Trạng thái', render: (r) => <StatusPill value={r.is_active === false ? 'cancelled' : 'active'} /> },
                {
                  name: 'Tác vụ',
                  render: (r) => (
                    <div className="ops-actions" style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      {canEdit && (
                        <button
                          type="button"
                          className="secondary-button"
                          style={{
                            fontSize: '12px',
                            padding: '4px 10px',
                            height: '28px',
                            background: '#f8fafc',
                            borderColor: '#cbd5e1',
                            color: '#1e293b',
                            fontWeight: 500,
                          }}
                          title="Thêm / ghi danh học viên vào lớp sử dụng phòng này"
                          onClick={() => {
                            setEnrollReturnTab('rooms')
                            const matchedClass = page.items.find((c) => c.name.toLowerCase().includes(r.name.toLowerCase()) || r.name.toLowerCase().includes(c.name.toLowerCase())) || page.items[0]
                            if (matchedClass) {
                              void openEnroll(matchedClass)
                            } else {
                              setTab('classes')
                            }
                          }}
                        >
                          👥 Ghi danh
                        </button>
                      )}
                      {canEdit && (
                        <>
                          <button
                            type="button"
                            className="secondary-button"
                            style={{ fontSize: '12px', padding: '4px 10px', height: '28px', color: '#0369a1' }}
                            onClick={() => { setEditingRoom(r); setRoomForm({ name: r.name, code: r.code || '', room_type: r.room_type || 'physical', capacity: String(r.capacity ?? 20), location: r.location || '', online_link: r.online_link || '' }); setTab('create-room') }}
                          >
                            ✏️ Sửa
                          </button>
                          <button
                            type="button"
                            className="danger"
                            style={{ fontSize: '12px', padding: '4px 10px', height: '28px' }}
                            onClick={() => void deleteRoom(r)}
                          >
                            🗑️ Xóa
                          </button>
                        </>
                      )}
                    </div>
                  ),
                },
              ]}
            />
          ) : (
            <StateBox loading={false} error="" empty />
          )}
        </div>
      )}

      {tab === 'create-room' && (
        <div className="ops-panel ops-full-form">
          <div className="ops-panel-heading">
            <div>
              <span className="ops-eyebrow">QUẢN LÝ PHÒNG HỌC & TRỰC TUYẾN</span>
              <h3>{editingRoom ? 'Chỉnh sửa phòng / không gian học' : 'Thêm mới phòng học / không gian trực tuyến'}</h3>
              <p className="ops-muted">Khai báo mã phòng, sức chứa học viên và liên kết giảng dạy trực tuyến.</p>
            </div>
          </div>
          <form className="ops-form" onSubmit={(e) => void saveRoom(e)}>
            <div className="ops-form-grid">
              <Field label="Tên phòng / không gian (bắt buộc)">
                <input required placeholder="Ví dụ: Phòng Lab 302 / Lớp Zoom A" value={roomForm.name} onChange={(e) => setRoomForm({ ...roomForm, name: e.target.value })} />
              </Field>
              <Field label="Mã phòng (bắt buộc)">
                <input required placeholder="Ví dụ: LAB-302 / ZOOM-01" value={roomForm.code} onChange={(e) => setRoomForm({ ...roomForm, code: e.target.value })} />
              </Field>
              <Field label="Loại không gian">
                <select value={roomForm.room_type} onChange={(e) => setRoomForm({ ...roomForm, room_type: e.target.value })}>
                  <option value="physical">Phòng học trực tiếp (Vật lý)</option>
                  <option value="online">Không gian học trực tuyến (Online)</option>
                </select>
              </Field>
              {roomForm.room_type === 'physical' ? (
                <>
                  <Field label="Sức chứa tối đa (học viên)">
                    <input type="number" min="1" max="500" required value={roomForm.capacity} onChange={(e) => setRoomForm({ ...roomForm, capacity: e.target.value })} />
                  </Field>
                  <Field label="Vị trí phòng (Tòa nhà, tầng)">
                    <input required placeholder="Ví dụ: Tòa nhà A, Tầng 3" value={roomForm.location} onChange={(e) => setRoomForm({ ...roomForm, location: e.target.value })} />
                  </Field>
                </>
              ) : (
                <Field label="Liên kết phòng trực tuyến (URL Google Meet / Zoom / MS Teams)">
                  <input type="url" required placeholder="https://meet.google.com/..." value={roomForm.online_link} onChange={(e) => setRoomForm({ ...roomForm, online_link: e.target.value })} />
                </Field>
              )}
            </div>
            <div className="ops-form-actions" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '24px' }}>
              <button type="button" className="secondary-button btn-cancel ops-button" onClick={() => { setEditingRoom(null); setTab('rooms') }}>Hủy & Quay lại</button>
              <button type="submit" className="ops-primary" disabled={busy}>
                {busy && <span className="ops-spinner-sm" />}
                {busy ? 'Đang lưu...' : editingRoom ? '✓ Lưu thay đổi' : '✓ Lưu phòng học'}
              </button>
            </div>
          </form>
        </div>
      )}

      {tab === 'enroll' && selected && (
        <div className="ops-panel">
          <div className="ops-panel-heading" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <span className="ops-eyebrow">QUẢN LÝ HỌC VIÊN CỦA LỚP · {selected.code || `LỚP #${selected.id}`}</span>
              <h3 style={{ margin: '4px 0 6px', fontSize: '20px' }}>Lớp học: {selected.name}</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginTop: '4px' }}>
                <span className="ops-muted">Chương trình: <strong>{selected.program_name || `CTĐT #${selected.program_id}`}</strong></span>
                <span style={{ color: '#cbd5e1' }}>•</span>
                <span>
                  Sĩ số: <strong style={{ fontSize: '13px', color: '#0f172a' }}>{classEnrollments.length}</strong> / <strong style={{ fontSize: '13px', color: '#0f172a' }}>{selected.capacity ?? '∞'}</strong> học viên
                </span>
                <span style={{ color: '#cbd5e1' }}>•</span>
                <span>
                  Chỗ trống: <strong style={{ fontSize: '13px', color: (selected.capacity ?? 0) - classEnrollments.length <= 0 ? '#ef4444' : '#16a34a' }}>
                    {Math.max(0, (selected.capacity ?? 0) - classEnrollments.length)} chỗ
                  </strong>
                </span>
                {canEdit && (
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', marginLeft: '6px', background: '#f8fafc', padding: '2px 8px', borderRadius: '7px', border: '1px solid #e2e8f0' }}>
                    <span style={{ fontSize: '11.5px', color: '#64748b', fontWeight: 600 }}>Tăng/sửa sức chứa:</span>
                    {[20, 25, 30, 35].map((cap) => (
                      <button
                        key={cap}
                        type="button"
                        style={{
                          padding: '2px 7px',
                          fontSize: '11.5px',
                          fontWeight: selected.capacity === cap ? 700 : 500,
                          background: selected.capacity === cap ? '#4f46e5' : '#fff',
                          color: selected.capacity === cap ? '#fff' : '#1e293b',
                          border: selected.capacity === cap ? '1px solid #4f46e5' : '1px solid #cbd5e1',
                          borderRadius: '4px',
                          cursor: 'pointer',
                        }}
                        title={`Đặt sức chứa tối đa thành ${cap} học viên`}
                        onClick={() => void updateClassCapacity(cap)}
                      >
                        {cap}
                      </button>
                    ))}
                    <button
                      type="button"
                      style={{
                        padding: '2px 7px',
                        fontSize: '11.5px',
                        background: '#fff',
                        color: '#0369a1',
                        border: '1px solid #bae6fd',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontWeight: 500,
                      }}
                      title="Nhập số sức chứa tùy chỉnh"
                      onClick={() => {
                        const val = window.prompt(`Nhập sức chứa tối đa mới cho lớp ${selected.name}:`, String(selected.capacity ?? 20))
                        if (val && Number(val) > 0) void updateClassCapacity(Number(val))
                      }}
                    >
                      ✏️ Tự nhập...
                    </button>
                  </div>
                )}
              </div>
            </div>
            <button
              type="button"
              className="secondary-button ops-button"
              style={{ padding: '6px 14px', fontSize: '13px', height: '34px', borderRadius: '7px' }}
              onClick={() => setTab(enrollReturnTab)}
            >
              ← Quay lại {enrollReturnTab === 'rooms' ? 'danh mục phòng' : 'danh sách lớp'}
            </button>
          </div>

          {(selected.capacity ?? 0) - classEnrollments.length <= 0 && (
            <div style={{ padding: '10px 16px', margin: '14px 0 6px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '16px' }}>⚠️</span>
                <span style={{ fontSize: '13px', color: '#92400e', fontWeight: 500 }}>
                  Lớp đã đạt sĩ số tối đa <strong>({classEnrollments.length}/{selected.capacity} học viên)</strong>. Để ghi danh thêm học viên mới, hãy nâng sức chứa:
                </span>
              </div>
              {canEdit && (
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <button
                    type="button"
                    style={{ fontSize: '12px', padding: '4px 10px', background: '#fff', border: '1px solid #d97706', color: '#b45309', fontWeight: 600, borderRadius: '6px', cursor: 'pointer' }}
                    onClick={() => void updateClassCapacity(25)}
                  >
                    ⚡ Mở rộng lên 25
                  </button>
                  <button
                    type="button"
                    style={{ fontSize: '12px', padding: '4px 10px', background: '#fff', border: '1px solid #d97706', color: '#b45309', fontWeight: 600, borderRadius: '6px', cursor: 'pointer' }}
                    onClick={() => void updateClassCapacity(30)}
                  >
                    ⚡ Mở rộng lên 30
                  </button>
                  <button
                    type="button"
                    style={{ fontSize: '12px', padding: '4px 10px', background: '#fff', border: '1px solid #d97706', color: '#b45309', borderRadius: '6px', cursor: 'pointer' }}
                    onClick={() => {
                      const val = window.prompt(`Sửa sức chứa tối đa của lớp ${selected.name}:`, String(selected.capacity ?? 20))
                      if (val && Number(val) > 0) void updateClassCapacity(Number(val))
                    }}
                  >
                    ✏️ Nhập số khác...
                  </button>
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'flex', gap: '8px', borderBottom: '2px solid #e2e8f0', margin: '18px 0 20px' }}>
            <button
              type="button"
              style={{
                padding: '9px 18px',
                fontSize: '14px',
                fontWeight: 600,
                background: 'none',
                border: 'none',
                borderBottom: enrollSubTab === 'in_class' ? '3px solid #4f46e5' : '3px solid transparent',
                color: enrollSubTab === 'in_class' ? '#4f46e5' : '#64748b',
                cursor: 'pointer',
                marginBottom: '-2px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
              onClick={() => setEnrollSubTab('in_class')}
            >
              <span>👥 Danh sách học viên đang học trong lớp</span>
              <span style={{ padding: '2px 7px', background: enrollSubTab === 'in_class' ? '#e0e7ff' : '#f1f5f9', color: enrollSubTab === 'in_class' ? '#4338ca' : '#64748b', borderRadius: '12px', fontSize: '12px', fontWeight: 700 }}>
                {classEnrollments.length}
              </span>
            </button>

            <button
              type="button"
              style={{
                padding: '9px 18px',
                fontSize: '14px',
                fontWeight: 600,
                background: 'none',
                border: 'none',
                borderBottom: enrollSubTab === 'new_enroll' ? '3px solid #4f46e5' : '3px solid transparent',
                color: enrollSubTab === 'new_enroll' ? '#4f46e5' : '#64748b',
                cursor: 'pointer',
                marginBottom: '-2px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
              onClick={() => setEnrollSubTab('new_enroll')}
            >
              <span>➕ Ghi danh thêm học viên mới</span>
              <span style={{ padding: '2px 7px', background: enrollSubTab === 'new_enroll' ? '#e0e7ff' : '#f1f5f9', color: enrollSubTab === 'new_enroll' ? '#4338ca' : '#64748b', borderRadius: '12px', fontSize: '12px' }}>
                {studentPage.total}
              </span>
            </button>
          </div>

          {enrollSubTab === 'in_class' && (
            <div style={{ background: '#fff', borderRadius: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <h4 style={{ margin: 0, fontSize: '16px', color: '#1e293b' }}>
                    👥 Toàn bộ học viên đã ghi danh ({classEnrollments.length} / {selected.capacity ?? '∞'})
                  </h4>
                  {classEnrollments.length > 0 && (
                    <input
                      type="search"
                      placeholder="Lọc trong lớp theo tên, mã..."
                      style={{ padding: '4px 10px', fontSize: '12.5px', borderRadius: '6px', border: '1px solid #cbd5e1', width: '200px' }}
                      value={enrolledSearch}
                      onChange={(e) => setEnrolledSearch(e.target.value)}
                    />
                  )}
                </div>
                {canEdit && (
                  <button
                    type="button"
                    className="ops-primary"
                    style={{ fontSize: '13px', padding: '7px 16px', display: 'flex', alignItems: 'center', gap: '6px' }}
                    onClick={() => setEnrollSubTab('new_enroll')}
                  >
                    <span>➕</span> Ghi danh thêm học viên mới
                  </button>
                )}
              </div>

              {enrollmentLoading ? (
                <p className="ops-muted">Đang tải danh sách học viên trong lớp...</p>
              ) : classEnrollments.length > 0 ? (
                <div className="ops-table-wrap">
                  <table className="ops-table">
                    <thead>
                      <tr>
                        <th style={{ width: '60px', textAlign: 'center' }}>STT</th>
                        <th>Mã học viên</th>
                        <th>Họ và tên</th>
                        <th>Trạng thái học tập</th>
                        <th>Ngày ghi danh</th>
                        <th>Người thực hiện</th>
                      </tr>
                    </thead>
                    <tbody>
                      {classEnrollments
                        .filter((item) => !enrolledSearch || item.student_code.toLowerCase().includes(enrolledSearch.toLowerCase()) || item.full_name.toLowerCase().includes(enrolledSearch.toLowerCase()))
                        .map((item, idx) => (
                          <tr key={item.student_id}>
                            <td style={{ textAlign: 'center', color: '#64748b', fontWeight: 500 }}>{idx + 1}</td>
                            <td><strong style={{ color: '#0369a1' }}>{item.student_code}</strong></td>
                            <td><strong>{item.full_name}</strong></td>
                            <td><StatusPill value={item.status} /></td>
                            <td>{dateTime(item.enrolled_at)}</td>
                            <td>{item.enrolled_by || 'Hệ thống'}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={{ padding: '36px', textAlign: 'center', background: '#f8fafc', borderRadius: '8px', border: '1px dashed #cbd5e1' }}>
                  <p className="ops-muted" style={{ margin: '0 0 12px' }}>Lớp này hiện chưa có học viên nào được ghi danh.</p>
                  <button type="button" className="ops-primary" onClick={() => setEnrollSubTab('new_enroll')}>
                    👉 Bấm vào đây để chọn và thêm học viên vào lớp ngay
                  </button>
                </div>
              )}
            </div>
          )}

          {enrollSubTab === 'new_enroll' && (
            <div style={{ marginTop: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '14px' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
                    <button
                      type="button"
                      className="secondary-button"
                      style={{ fontSize: '12px', padding: '3px 10px', height: '28px', color: '#4f46e5', fontWeight: 600 }}
                      onClick={() => setEnrollSubTab('in_class')}
                    >
                      ← Quay lại danh sách học viên trong lớp ({classEnrollments.length})
                    </button>
                    <h4 style={{ margin: 0, fontSize: '16px', color: '#0f172a' }}>Danh mục học viên để chọn ghi danh (S3-06)</h4>
                  </div>
                  <p className="ops-muted" style={{ margin: 0 }}>
                    Tìm thấy {studentPage.total.toLocaleString('vi-VN')} học viên · Đang chọn: <strong style={{ color: '#4f46e5' }}>{chosen.length}</strong> học viên · Chỗ trống còn lại của lớp: <strong style={{ color: (selected.capacity ?? 0) - classEnrollments.length <= 0 ? '#ef4444' : '#16a34a' }}>{Math.max(0, (selected.capacity ?? 0) - classEnrollments.length)}</strong> chỗ
                  </p>
                </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}>
                  <span className="ops-muted">Hiển thị:</span>
                  <select
                    value={studentPageSize}
                    style={{ padding: '4px 8px', borderRadius: '6px', fontSize: '13px', border: '1px solid #cbd5e1' }}
                    onChange={(e) => {
                      const newSize = Number(e.target.value)
                      setStudentPageSize(newSize)
                      void loadStudentPage(1, newSize)
                    }}
                  >
                    <option value={20}>20 học viên / trang</option>
                    <option value={50}>50 học viên / trang</option>
                    <option value={100}>100 học viên / trang</option>
                    <option value={500}>Tất cả ({studentPage.total})</option>
                  </select>
                </div>

                <input
                  type="search"
                  style={{ minWidth: '220px' }}
                  placeholder="Tìm theo tên, mã HV, SĐT..."
                  value={studentSearch}
                  onChange={(e) => setStudentSearch(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void findStudents() }}
                />
                <button className="ops-button" disabled={studentLoading} onClick={() => void findStudents()}>
                  {studentLoading ? 'Đang tìm…' : '🔍 Tìm kiếm'}
                </button>
              </div>
            </div>

            {studentLoading && <StateBox loading error="" empty={false} />}
            {studentError && <StateBox loading={false} error={studentError} empty={false} retry={() => void loadStudentPage(studentPage.page)} />}

            {!studentLoading && !studentError && (
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th style={{ width: '45px', textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          title="Chọn tất cả học viên hợp lệ trên trang này"
                          checked={
                            students.filter((s) => !existingEnrollmentIds.has(s.id) && s.status === 'active').length > 0 &&
                            students
                              .filter((s) => !existingEnrollmentIds.has(s.id) && s.status === 'active')
                              .every((s) => chosen.includes(s.id))
                          }
                          onChange={(e) => {
                            const validStudents = students.filter((s) => !existingEnrollmentIds.has(s.id) && s.status === 'active')
                            if (e.target.checked) {
                              const remainingSlots = Math.max(0, (selected.capacity ?? 9999) - classEnrollments.length)
                              const toAdd = validStudents.map((s) => s.id)
                              const combined = Array.from(new Set([...chosen, ...toAdd])).slice(0, remainingSlots)
                              setChosen(combined)
                            } else {
                              const pageIds = new Set(validStudents.map((s) => s.id))
                              setChosen(chosen.filter((id) => !pageIds.has(id)))
                            }
                          }}
                        />
                      </th>
                      <th style={{ width: '60px', textAlign: 'center' }}>STT</th>
                      <th>Mã học viên</th>
                      <th>Họ và tên</th>
                      <th>Số điện thoại / Email</th>
                      <th>Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((student, idx) => {
                      const isEnrolled = existingEnrollmentIds.has(student.id)
                      const isInactive = student.status !== 'active'
                      const isMaxCapacity = !chosen.includes(student.id) && selected?.capacity !== undefined && (chosen.length + classEnrollments.length) >= selected.capacity
                      const isDisabled = isEnrolled || isInactive || enrollmentLoading || Boolean(enrollmentError) || isMaxCapacity

                      return (
                        <tr key={student.id} style={{ opacity: isDisabled ? 0.6 : 1 }}>
                          <td style={{ textAlign: 'center' }}>
                            <input
                              type="checkbox"
                              checked={chosen.includes(student.id)}
                              disabled={isDisabled}
                              onChange={(e) => setChosen(e.target.checked ? [...chosen, student.id] : chosen.filter((id) => id !== student.id))}
                            />
                          </td>
                          <td style={{ textAlign: 'center', color: '#64748b', fontWeight: 500 }}>
                            {(studentPage.page - 1) * studentPage.page_size + idx + 1}
                          </td>
                          <td><strong>{student.student_code || `HV-${student.id}`}</strong></td>
                          <td>
                            <strong>{student.full_name}</strong>
                            {isEnrolled && <small style={{ display: 'block', color: '#0284c7' }}>✓ Đã có trong lớp</small>}
                            {isInactive && <small style={{ display: 'block', color: '#ef4444' }}>Không ở trạng thái đang học</small>}
                          </td>
                          <td>{student.phone || '—'}<small style={{ display: 'block', color: '#64748b' }}>{student.email}</small></td>
                          <td><StatusPill value={student.status} /></td>
                        </tr>
                      )
                    })}
                    {students.length === 0 && (
                      <tr>
                        <td colSpan={6} style={{ textAlign: 'center', padding: '24px', color: '#64748b' }}>
                          Không tìm thấy học viên nào phù hợp.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Pager page={studentPage.page} pageSize={studentPage.page_size} total={studentPage.total} onChange={(p) => void loadStudentPage(p)} />
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                {chosen.length > 0 && (
                  <button
                    type="button"
                    className="secondary-button"
                    style={{ fontSize: '13px', height: '38px' }}
                    onClick={() => setChosen([])}
                  >
                    Bỏ chọn ({chosen.length})
                  </button>
                )}
                <button
                  className="ops-primary"
                  style={{ minHeight: '40px', padding: '0 20px', fontWeight: 600 }}
                  disabled={busy || !chosen.length || enrollmentLoading || studentLoading || Boolean(enrollmentError) || Boolean(studentError)}
                  onClick={() => void enroll()}
                >
                  {busy ? 'Đang xử lý...' : `✓ Xác nhận ghi danh ${chosen.length} học viên đã chọn`}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    )}

      {tab === 'schedule' && selected && (
        <div className="ops-panel">
          <div className="ops-panel-heading" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <span className="ops-eyebrow">XẾP LỊCH HỌC ĐỊNH KỲ · {selected.code || `LỚP #${selected.id}`}</span>
              <h3 style={{ margin: '4px 0 6px', fontSize: '20px' }}>Cấu hình thời khóa biểu định kỳ · {selected.name}</h3>
              <p className="ops-muted" style={{ margin: 0 }}>Thiết lập chu kỳ học, phòng học và kiểm tra xung đột thời khóa biểu cho cả khóa học.</p>
            </div>
            <button
              type="button"
              className="secondary-button ops-button"
              style={{ padding: '5px 12px', fontSize: '13px', height: '32px', borderRadius: '7px' }}
              onClick={() => setTab('classes')}
            >
              ← Quay lại danh sách lớp
            </button>
          </div>

          <form className="ops-form" onSubmit={(e) => void getSchedulePreview(e)}>
            <div className="ops-form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
              <Field label="Chu kỳ lặp lại">
                <select value={schedule.recurrence} onChange={(e) => setSchedule({ ...schedule, recurrence: e.target.value })}>
                  <option value="weekly">Hàng tuần</option>
                  <option value="biweekly">Hai tuần một lần</option>
                </select>
              </Field>
              <Field label="Ngày bắt đầu khóa">
                <input type="date" required value={schedule.start_date} onChange={(e) => setSchedule({ ...schedule, start_date: e.target.value })} />
              </Field>
              <Field label={`Số buổi học (tối đa ${scheduleLimit})`}>
                <input type="number" min="1" max={scheduleLimit} required value={schedule.count} onChange={(e) => setSchedule({ ...schedule, count: e.target.value })} />
              </Field>
              <Field label="Giờ bắt đầu">
                <input type="time" required value={schedule.start_time} onChange={(e) => setSchedule({ ...schedule, start_time: e.target.value })} />
              </Field>
              <Field label="Giờ kết thúc">
                <input type="time" required value={schedule.end_time} onChange={(e) => setSchedule({ ...schedule, end_time: e.target.value })} />
              </Field>
              <Field label="Phòng học mặc định">
                <select value={schedule.room_id} onChange={(e) => setSchedule({ ...schedule, room_id: e.target.value })}>
                  <option value="">Chọn sau</option>
                  {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}{r.capacity ? ` · ${r.capacity} chỗ` : ''}</option>)}
                </select>
              </Field>
              <Field label="Giảng viên phụ trách">
                <select value={schedule.instructor_id} onChange={(e) => setSchedule({ ...schedule, instructor_id: e.target.value })}>
                  <option value="">Phân công sau</option>
                  {instructors.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                </select>
              </Field>
            </div>

            <Field label="Các thứ trong tuần học">
              <div className="weekday-selector" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '6px' }}>
                {[
                  ['0', 'Thứ 2'], ['1', 'Thứ 3'], ['2', 'Thứ 4'], ['3', 'Thứ 5'],
                  ['4', 'Thứ 6'], ['5', 'Thứ 7'], ['6', 'Chủ nhật'],
                ].map(([val, label]) => (
                  <label key={val} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '6px 12px', background: schedule.weekdays.includes(val) ? '#eff6ff' : '#f8fafc', border: `1px solid ${schedule.weekdays.includes(val) ? '#3b82f6' : '#cbd5e1'}`, borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: schedule.weekdays.includes(val) ? 600 : 400 }}>
                    <input
                      type="checkbox"
                      checked={schedule.weekdays.includes(val)}
                      onChange={(e) => {
                        const next = e.target.checked
                          ? [...schedule.weekdays, val]
                          : schedule.weekdays.filter((w) => w !== val)
                        setSchedule({ ...schedule, weekdays: next })
                      }}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </Field>

            <div style={{ marginTop: '16px', display: 'flex', gap: '10px' }}>
              <button className="ops-primary" type="submit" disabled={busy}>
                {busy ? 'Đang tạo lịch mẫu...' : '🔍 Xem trước thời khóa biểu'}
              </button>
            </div>
          </form>

          {preview.length > 0 && (
            <div style={{ marginTop: '28px' }}>
              <h4 style={{ margin: '0 0 10px', fontSize: '16px', color: '#0f172a' }}>
                Danh sách {preview.length} buổi học dự kiến sinh ra
              </h4>
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th style={{ width: '60px', textAlign: 'center' }}>STT</th>
                      <th>Ngày & Giờ học</th>
                      <th>Môn học / Tiêu đề</th>
                      <th>Phòng học</th>
                      <th>Giảng viên</th>
                      <th>Tình trạng xung đột</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((item, idx) => (
                      <tr key={`${item.start_at}-${idx}`} style={{ background: item.conflict ? '#fff1f2' : undefined }}>
                        <td style={{ textAlign: 'center', color: '#64748b', fontWeight: 500 }}>{idx + 1}</td>
                        <td><strong>{dateTime(item.start_at)} — {dateTime(item.end_at)}</strong></td>
                        <td>{item.subject_name || item.title || 'Buổi học'}</td>
                        <td>{item.room_name || 'Chưa xếp'}</td>
                        <td>{item.instructor_name || 'Chưa phân công'}</td>
                        <td>
                          {item.conflict ? (
                            <span style={{ color: '#dc2626', fontWeight: 600 }}>⚠️ Có xung đột phòng/giảng viên</span>
                          ) : (
                            <span style={{ color: '#16a34a' }}>✓ Hợp lệ</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {conflicts.length > 0 && (
                <div style={{ marginTop: '14px', padding: '12px 16px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px' }}>
                  <p style={{ color: '#b91c1c', margin: '0 0 8px', fontWeight: 600 }}>
                    Phát hiện {conflicts.length} xung đột lịch trong thời gian chọn!
                  </p>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13.5px' }}>
                    <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
                    <strong>Xác nhận ghi đè các xung đột để tiếp tục lưu lịch</strong>
                  </label>
                </div>
              )}

              <div style={{ marginTop: '16px', display: 'flex', gap: '10px' }}>
                <button
                  type="button"
                  className="ops-primary"
                  disabled={busy || (conflicts.length > 0 && !override)}
                  onClick={() => void saveSchedule()}
                >
                  {busy ? 'Đang lưu...' : '💾 Xác nhận lưu thời khóa biểu'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}



      {sessionToEdit && (
        <Dialog title={`${sessionToEdit.class_name || 'Buổi học'} · ${sessionToEdit.subject_name || sessionToEdit.title || ''}`} onClose={() => setSessionToEdit(null)}>
          <form className="ops-form" onSubmit={(e) => void saveSessionChange(e)}>
            <p className="ops-muted">{dateTime(sessionToEdit.start_at)} — {dateTime(sessionToEdit.end_at)} · {sessionToEdit.room_name || 'Chưa xếp phòng'} · {sessionToEdit.instructor_name || 'Chưa phân công'}</p>
            {sessionToEdit.start_at.slice(0, 10) < currentDay && <p className="ops-muted">Buổi đã diễn ra. Chỉ có thể xem chi tiết; thao tác thay đổi bị khóa.</p>}
            <div className="ops-form-grid">
              <Field label="Thao tác">
                <select disabled={sessionToEdit.start_at.slice(0, 10) < currentDay} value={sessionChange.action} onChange={(e) => setSessionChange({ ...sessionChange, action: e.target.value })}>
                  <option value="reschedule">Đổi lịch</option>
                  <option value="cancel">Hủy buổi</option>
                </select>
              </Field>
              {sessionChange.action === 'reschedule' && (
                <>
                  <Field label="Bắt đầu mới"><input disabled={sessionToEdit.start_at.slice(0, 10) < currentDay} type="datetime-local" required value={sessionChange.start_at} onChange={(e) => setSessionChange({ ...sessionChange, start_at: e.target.value })} /></Field>
                  <Field label="Kết thúc mới"><input disabled={sessionToEdit.start_at.slice(0, 10) < currentDay} type="datetime-local" required value={sessionChange.end_at} onChange={(e) => setSessionChange({ ...sessionChange, end_at: e.target.value })} /></Field>
                </>
              )}
              <Field label="Lý do (bắt buộc)">
                <textarea disabled={sessionToEdit.start_at.slice(0, 10) < currentDay} required value={sessionChange.reason} onChange={(e) => setSessionChange({ ...sessionChange, reason: e.target.value })} />
              </Field>
            </div>
            <div className="ops-dialog-actions">
              <button className="ops-primary" disabled={busy || sessionToEdit.start_at.slice(0, 10) < currentDay}>{sessionChange.action === 'cancel' ? 'Xác nhận hủy' : 'Lưu thay đổi lịch'}</button>
            </div>
          </form>
        </Dialog>
      )}
    </section>
  )
}

function AttendanceOps({ request, notify, user, canEdit, canManage }: { request: Api; notify: Props['notify']; user: Props['user']; canEdit: boolean; canManage: boolean }) {
  const [tab, setTab] = useState(user.roles.includes('student') ? 'request' : 'roster')
  const [currentDay] = useState(today)
  const [sessions, setSessions] = useState<TrainingSession[]>([])
  const [selectedSession, setSelectedSession] = useState('')
  const [roster, setRoster] = useState<AttendanceEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [absenceLoading, setAbsenceLoading] = useState(false)
  const [error, setError] = useState('')
  const [absences, setAbsences] = useState<AbsenceRequest[]>([])
  const [absencePage, setAbsencePage] = useState<Page<AbsenceRequest>>({ items: [], total: 0, page: 1, page_size: 20 })
  const [decisionRequest, setDecisionRequest] = useState<{ item: AbsenceRequest; decision: 'approve' | 'reject'; reason: string } | null>(null)
  const [status, setStatus] = useState<Record<number, string>>({})
  const [requestForm, setRequestForm] = useState({ session_id: '', reason: '', evidence_url: '', evidence_file: null as File | null })
  const [start, setStart] = useState(today())
  const [end, setEnd] = useState(today())
  const [busy, setBusy] = useState(false)
  const session = sessions.find((item) => item.id === Number(selectedSession))
  const canEditRoster = canEdit && (!session || session.start_at.slice(0, 10) >= currentDay || canManage)
  const loadSessions = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const values = asPage(await request<Page<TrainingSession> | TrainingSession[]>(`/training/sessions?${qs({ start, end })}`)).items.map(normalizeSession)
      setSessions(values)
      if (!values.some((item) => item.id === Number(selectedSession))) setSelectedSession(values[0] ? String(values[0].id) : '')
    } catch (e) { setError(e instanceof Error ? e.message : 'Không thể tải buổi học.') }
    finally { setLoading(false) }
  }, [request, start, end, selectedSession])
  const loadRoster = useCallback(async () => {
    if (!selectedSession) return
    setLoading(true); setError('')
    try {
      const response = await request<{ items: AttendanceEntry[] }>(`/training/sessions/${selectedSession}/attendance`)
      const values = response.items.map((item) => ({
        ...item, student_name: item.full_name ?? item.student_name, status: item.status ?? 'unexcused',
      }))
      setRoster(values); setStatus(Object.fromEntries(values.map((item) => [item.student_id, item.status ?? 'unexcused'])))
    } catch (e) { setError(e instanceof Error ? e.message : 'Không thể tải danh sách điểm danh.') }
    finally { setLoading(false) }
  }, [request, selectedSession])
  const loadAbsences = useCallback(async (pageNo = 1) => {
    setAbsenceLoading(true)
    setError('')
    try {
      const response = await request<Page<AbsenceRequest> | AbsenceRequest[]>(`/attendance/absence-requests?${qs({ page: pageNo, page_size: 20 })}`)
      const result = asPage(response)
      const values = result.items.map((item) => ({ ...item, session_id: item.lesson_id, evidence_url: item.evidence_ref }))
      setAbsencePage({ ...result, items: values })
      setAbsences(values)
    }
    catch (e) { setError(e instanceof Error ? e.message : 'Không thể tải đơn xin phép.') }
    finally { setAbsenceLoading(false) }
  }, [request])
  useEffect(() => { if (tab === 'roster' || tab === 'request') void loadSessions() }, [tab, loadSessions])
  useEffect(() => { if (tab === 'roster' && selectedSession) void loadRoster() }, [tab, selectedSession, loadRoster])
  useEffect(() => { if (tab === 'requests') void loadAbsences() }, [tab, loadAbsences])
  async function saveRoster() {
    if (!selectedSession) return
    if (!canEditRoster) { notify('Chỉ quản lý được hiệu chỉnh lịch sử điểm danh.', 'error'); return }
    setBusy(true)
    try {
      await request(`/training/sessions/${selectedSession}/attendance`, { method: 'PUT', body: JSON.stringify({ items: roster.map((item) => ({ student_id: item.student_id, status: status[item.student_id] || 'unexcused', note: item.note ?? null })) }) })
      notify('Đã lưu điểm danh.', 'success'); await loadRoster()
    } catch (e) { notify(e instanceof Error ? e.message : 'Không thể lưu điểm danh.', 'error') }
    finally { setBusy(false) }
  }
  async function bulkPresent() {
    if (!selectedSession) return
    if (!canEditRoster) { notify('Không thể điểm danh hàng loạt cho buổi đã qua.', 'error'); return }
    if (!window.confirm(`Đánh dấu có mặt cho toàn bộ ${roster.length} học viên trong danh sách?`)) return
    setBusy(true)
    try { await request(`/training/sessions/${selectedSession}/attendance/bulk-present`, { method: 'POST', body: JSON.stringify({}) }); notify('Đã đánh dấu có mặt hàng loạt.', 'success'); await loadRoster() }
    catch (e) { notify(e instanceof Error ? e.message : 'Không thể điểm danh hàng loạt.', 'error') }
    finally { setBusy(false) }
  }
  async function sendAbsence(event: FormEvent) {
    event.preventDefault()
    if (requestForm.evidence_file && requestForm.evidence_url.trim()) {
      notify('Chọn tải tệp hoặc dùng liên kết ngoài, không gửi đồng thời cả hai.', 'error')
      return
    }
    setBusy(true)
    try {
      if (requestForm.evidence_file) {
        const body = new FormData()
        body.append('lesson_id', requestForm.session_id)
        body.append('reason', requestForm.reason)
        body.append('file', requestForm.evidence_file)
        await request('/attendance/absence-requests/upload', { method: 'POST', body })
      } else {
        await request('/attendance/absence-requests', { method: 'POST', body: JSON.stringify({ lesson_id: Number(requestForm.session_id), reason: requestForm.reason, evidence_ref: requestForm.evidence_url || null }) })
      }
      notify('Đã gửi đơn xin vắng, chờ giảng viên duyệt.', 'success'); setRequestForm({ session_id: '', reason: '', evidence_url: '', evidence_file: null })
      await loadAbsences(1)
    } catch (e) { notify(e instanceof Error ? e.message : 'Không thể gửi đơn xin phép.', 'error') }
    finally { setBusy(false) }
  }
  async function downloadAbsenceEvidence(item: AbsenceRequest) {
    const token = localStorage.getItem('tms_token')
    if (!token) { notify('Phiên đăng nhập không còn hiệu lực.', 'error'); return }
    try {
      const response = await fetch(`${apiBase}/attendance/absence-requests/${item.id}/evidence`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { detail?: string }
        throw new Error(payload.detail || 'Không thể tải minh chứng.')
      }
      const objectUrl = URL.createObjectURL(await response.blob())
      const link = document.createElement('a')
      link.href = objectUrl
      const extension = item.evidence_url?.match(/\.(pdf|jpg|jpeg|png)$/i)?.[1] || 'pdf'
      link.download = `minh-chung-${item.id}.${extension}`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
    } catch (e) { notify(e instanceof Error ? e.message : 'Không thể tải minh chứng.', 'error') }
  }
  async function decideAbsence(item: AbsenceRequest, decision: 'approve' | 'reject') {
    setDecisionRequest({ item, decision, reason: '' })
  }
  async function submitDecision(event: FormEvent) {
    event.preventDefault()
    if (!decisionRequest) return
    if (decisionRequest.decision === 'reject' && !decisionRequest.reason.trim()) return
    try {
      await request(`/attendance/absence-requests/${decisionRequest.item.id}/decision`, { method: 'POST', body: JSON.stringify({ decision: decisionRequest.decision, reason: decisionRequest.reason.trim() || null }) })
      notify(decisionRequest.decision === 'approve' ? 'Đã duyệt đơn xin vắng.' : 'Đã từ chối đơn xin vắng.', 'success'); setDecisionRequest(null); await loadAbsences(absencePage.page)
    } catch (e) { notify(e instanceof Error ? e.message : 'Không thể xử lý đơn.', 'error') }
  }
  return <section className="ops-page">
    <OpsHeader eyebrow="SPRINT 4 · ĐIỂM DANH" subtitle="Chốt sĩ số theo buổi, xem lịch sử cập nhật và xử lý đơn xin vắng có minh chứng." />
    <OpsTabs value={tab} onChange={setTab} tabs={user.roles.includes('student') ? [['request', 'Xin phép vắng'], ['requests', 'Đơn của tôi'], ['roster', 'Lịch điểm danh']] : [['roster', 'Danh sách điểm danh'], ['requests', 'Duyệt đơn xin vắng']]} />
    {tab === 'roster' && <><div className="ops-filter-grid"><Field label="Từ ngày"><input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field><Field label="Đến ngày"><input type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></Field><Field label="Buổi học"><select value={selectedSession} onChange={(e) => setSelectedSession(e.target.value)}><option value="">Chọn buổi học</option>{sessions.map((item) => <option key={item.id} value={item.id}>{dateTime(item.start_at)} · {item.class_name} · {item.subject_name}</option>)}</select></Field><button className="ops-button" onClick={() => void loadSessions()}>Tải buổi học</button></div>{session && <div className="ops-panel"><div className="session-banner"><div><strong>{session.class_name} · {session.subject_name || session.title}</strong><span>{dateTime(session.start_at)} — {dateTime(session.end_at)} · {session.room_name || 'Chưa xếp phòng'}</span></div>{canEditRoster && <div><button className="ops-button" disabled={busy || roster.length === 0} onClick={() => void bulkPresent()}>Tất cả có mặt</button><button className="ops-primary" disabled={busy} onClick={() => void saveRoster()}>Lưu điểm danh</button></div>}</div>{session.start_at.slice(0, 10) < currentDay && !canManage && <p className="ops-muted">Buổi học đã qua: chỉ quản lý được hiệu chỉnh lịch sử điểm danh.</p>}<StateBox loading={loading} error={error} empty={!loading && !error && roster.length === 0} retry={() => void loadRoster()} />{roster.length > 0 && <><PaginationTable rows={roster} keyFor={(row) => row.student_id} columns={[
      { name: 'Học viên', render: (row) => <><strong>{row.student_name || `HV-${row.student_id}`}</strong><small>ID {row.student_id}</small></> },
      { name: 'Trạng thái', render: (row) => <select disabled={!canEditRoster} value={status[row.student_id] || row.status || 'unexcused'} onChange={(e) => setStatus({ ...status, [row.student_id]: e.target.value })}>{['present', 'unexcused', 'late', 'excused'].map((s) => <option key={s} value={s}>{statusLabels[s]}</option>)}</select> },
      { name: 'Lý do / ghi chú', render: (row) => row.note || '—' },
      { name: 'Cập nhật', render: (row) => <>{row.updated_at ? dateTime(row.updated_at) : '—'}<small>{row.updated_by || ''}</small></> },
    ]} /><p className="ops-muted">{canManage ? 'Quản lý có thể lưu cập nhật lịch sử điểm danh; thao tác sẽ được ghi vết bởi hệ thống.' : 'Chỉ giảng viên / trợ giảng được phân công mới có thể cập nhật.'}</p></>}</div>}</>}
    {tab === 'request' && <div className="ops-panel"><h2>Gửi đơn xin vắng buổi học</h2><form className="ops-form" onSubmit={(e) => void sendAbsence(e)}><div className="ops-form-grid"><Field label="Buổi học"><select required value={requestForm.session_id} onChange={(e) => setRequestForm({ ...requestForm, session_id: e.target.value })}><option value="">Chọn buổi trong lịch</option>{sessions.map((item) => <option key={item.id} value={item.id}>{dateTime(item.start_at)} · {item.class_name} · {item.subject_name}</option>)}</select></Field><Field label="Lý do"><textarea required value={requestForm.reason} onChange={(e) => setRequestForm({ ...requestForm, reason: e.target.value })} /></Field><Field label="Tệp minh chứng (PDF/JPG/PNG, tối đa 10 MB)"><input type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" onChange={(e) => setRequestForm({ ...requestForm, evidence_file: e.target.files?.[0] ?? null })} /></Field><Field label="Hoặc liên kết ngoài"><input type="url" placeholder="https://…" value={requestForm.evidence_url} onChange={(e) => setRequestForm({ ...requestForm, evidence_url: e.target.value })} /></Field></div><p className="ops-muted">Tệp tải lên được lưu riêng tư; chỉ bạn và người có quyền duyệt được tải xuống. Không gửi đồng thời tệp và liên kết.</p><button className="ops-primary" disabled={busy}>Gửi đơn xin phép</button></form></div>}
    {tab === 'requests' && <div className="ops-panel"><StateBox loading={absenceLoading} error={error} empty={!absenceLoading && !error && absences.length === 0} retry={() => void loadAbsences(absencePage.page)} />{absences.length > 0 && <><PaginationTable rows={absences} keyFor={(row) => row.id} startIndex={(absencePage.page - 1) * absencePage.page_size + 1} columns={user.roles.includes('student') ? [
      { name: 'Buổi học', render: (row) => <><strong>{row.session_title || `Buổi #${row.session_id}`}</strong><small>{row.starts_at ? dateTime(row.starts_at) : ''}</small></> },
      { name: 'Lý do', render: (row) => row.reason },
      { name: 'Minh chứng', render: (row) => row.evidence_url?.startsWith('private:') ? <button className="ops-link" onClick={() => void downloadAbsenceEvidence(row)}>Tải tệp</button> : row.evidence_url ? <a href={row.evidence_url} target="_blank" rel="noreferrer">Mở liên kết ↗</a> : '—' },
      { name: 'Trạng thái', render: (row) => <StatusPill value={row.status} /> },
      { name: 'Kết quả xử lý', render: (row) => row.decision_reason || 'Chưa có phản hồi' },
    ] : [
      { name: 'Học viên / buổi học', render: (row) => <><strong>{row.student_name || `HV-${row.student_id}`}</strong><small>{row.session_title || `Buổi #${row.session_id}`}</small></> },
      { name: 'Lý do', render: (row) => row.reason },
      { name: 'Minh chứng', render: (row) => row.evidence_url?.startsWith('private:') ? <button className="ops-link" onClick={() => void downloadAbsenceEvidence(row)}>Tải tệp</button> : row.evidence_url ? <a href={row.evidence_url} target="_blank" rel="noreferrer">Mở liên kết ↗</a> : 'Không đính kèm' },
      { name: 'Trạng thái', render: (row) => <StatusPill value={row.status} /> },
      { name: 'Quyết định', render: (row) => canEdit && row.status === 'pending' ? <div className="ops-actions"><button onClick={() => void decideAbsence(row, 'approve')}>Duyệt</button><button className="danger" onClick={() => void decideAbsence(row, 'reject')}>Từ chối</button></div> : row.decision_reason || '—' },
    ]} /><Pager page={absencePage.page} pageSize={absencePage.page_size} total={absencePage.total} onChange={(p) => void loadAbsences(p)} /></>}</div>}
    {decisionRequest && <Dialog title={decisionRequest.decision === 'approve' ? 'Xác nhận duyệt đơn' : 'Từ chối đơn xin vắng'} onClose={() => setDecisionRequest(null)}><form className="ops-form" onSubmit={(e) => void submitDecision(e)}><div className="ops-profile-grid"><span>Học viên<strong>{decisionRequest.item.student_name || `HV-${decisionRequest.item.student_id}`}</strong></span><span>Buổi học<strong>{decisionRequest.item.session_title || `Buổi #${decisionRequest.item.session_id}`}</strong></span></div><p className="ops-muted">Lý do xin phép: {decisionRequest.item.reason}</p>{decisionRequest.decision === 'reject' && <Field label="Lý do từ chối"><textarea required value={decisionRequest.reason} onChange={(e) => setDecisionRequest({ ...decisionRequest, reason: e.target.value })} /></Field>}<div className="ops-dialog-actions"><button type="button" className="ops-button" onClick={() => setDecisionRequest(null)}>Hủy</button><button className="ops-primary">{decisionRequest.decision === 'approve' ? 'Xác nhận duyệt' : 'Xác nhận từ chối'}</button></div></form></Dialog>}
  </section>
}
