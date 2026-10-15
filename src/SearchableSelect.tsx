import { useState, useRef, useEffect, useMemo, type KeyboardEvent } from 'react'

export interface SelectOption {
  value: string
  label: string
  subLabel?: string
  badge?: string
}

export interface SearchableSelectProps {
  options: SelectOption[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  pageSize?: number
  ariaLabel?: string
  id?: string
  required?: boolean
  allowClear?: boolean
  style?: React.CSSProperties
}

function normalizeSearchText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .trim()
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'Chọn một tùy chọn...',
  disabled = false,
  className = '',
  pageSize = 5,
  ariaLabel,
  id,
  allowClear = true,
  style,
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [page, setPage] = useState(1)
  const containerRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Current selected option
  const selectedOption = useMemo(
    () => options.find((opt) => String(opt.value) === String(value)),
    [options, value]
  )

  // Filtered options
  const filteredOptions = useMemo(() => {
    if (!searchTerm.trim()) return options
    const norm = normalizeSearchText(searchTerm)
    return options.filter((opt) => {
      const matchLabel = normalizeSearchText(opt.label).includes(norm)
      const matchSub = opt.subLabel ? normalizeSearchText(opt.subLabel).includes(norm) : false
      const matchVal = normalizeSearchText(String(opt.value)).includes(norm)
      return matchLabel || matchSub || matchVal
    })
  }, [options, searchTerm])

  const totalPages = Math.max(1, Math.ceil(filteredOptions.length / pageSize))
  const currentPage = Math.min(page, totalPages)

  const visibleOptions = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return filteredOptions.slice(start, start + pageSize)
  }, [filteredOptions, currentPage, pageSize])

  // Reset page when search term changes
  useEffect(() => {
    setPage(1)
  }, [searchTerm])

  // Focus search input when opening
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        searchInputRef.current?.focus()
      }, 50)
    } else {
      setSearchTerm('')
      setPage(1)
    }
  }, [isOpen])

  // Click outside listener
  useEffect(() => {
    if (!isOpen) return
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  function handleSelect(val: string) {
    onChange(val)
    setIsOpen(false)
  }

  function handleClear(e: React.MouseEvent) {
    e.stopPropagation()
    onChange('')
    setIsOpen(false)
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      setIsOpen(false)
    } else if (e.key === 'ArrowDown' && !isOpen) {
      setIsOpen(true)
    }
  }

  return (
    <div
      ref={containerRef}
      id={id}
      className={`searchable-select-container ${isOpen ? 'is-open' : ''} ${disabled ? 'is-disabled' : ''} ${className}`.trim()}
      style={style}
      onKeyDown={handleKeyDown}
    >
      <button
        type="button"
        className={`searchable-select-trigger ${!selectedOption && !value ? 'is-placeholder' : ''}`}
        onClick={() => {
          if (!disabled) setIsOpen(!isOpen)
        }}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={ariaLabel || placeholder}
      >
        <span className="searchable-select-label">
          {selectedOption ? (
            <span className="selected-item">
              <span className="selected-text">{selectedOption.label}</span>
              {selectedOption.badge && <span className="selected-badge">{selectedOption.badge}</span>}
            </span>
          ) : value ? (
            <span className="selected-text">{value}</span>
          ) : (
            <span className="placeholder-text">{placeholder}</span>
          )}
        </span>

        <span className="searchable-select-icons">
          {allowClear && (selectedOption || value) && !disabled && (
            <span
              role="button"
              tabIndex={0}
              className="searchable-select-clear"
              onClick={handleClear}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation()
                  onChange('')
                }
              }}
              title="Xóa lựa chọn"
              aria-label="Xóa lựa chọn"
            >
              ×
            </span>
          )}
          <span className={`searchable-select-arrow ${isOpen ? 'open' : ''}`}>▾</span>
        </span>
      </button>

      {isOpen && (
        <div className="searchable-select-dropdown" role="listbox">
          <div className="searchable-select-search-wrap">
            <span className="search-icon" aria-hidden="true">🔍</span>
            <input
              ref={searchInputRef}
              type="text"
              className="searchable-select-search-input"
              placeholder="Tìm kiếm..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onClick={(e) => e.stopPropagation()}
            />
            {searchTerm && (
              <button
                type="button"
                className="search-clear-btn"
                onClick={() => setSearchTerm('')}
                title="Xóa tìm kiếm"
              >
                ×
              </button>
            )}
          </div>

          <div className="searchable-select-list">
            {visibleOptions.length === 0 ? (
              <div className="searchable-select-empty">
                <span>Không tìm thấy kết quả phù hợp</span>
              </div>
            ) : (
              visibleOptions.map((opt) => {
                const isSelected = String(opt.value) === String(value)
                return (
                  <div
                    key={String(opt.value)}
                    role="option"
                    aria-selected={isSelected}
                    className={`searchable-select-option ${isSelected ? 'is-selected' : ''}`}
                    onClick={() => handleSelect(opt.value)}
                  >
                    <div className="option-text-group">
                      <span className="option-label">{opt.label}</span>
                      {opt.subLabel && <span className="option-sublabel">{opt.subLabel}</span>}
                    </div>
                    {opt.badge && <span className="option-badge">{opt.badge}</span>}
                    {isSelected && <span className="option-check">✓</span>}
                  </div>
                )
              })
            )}
          </div>

          {filteredOptions.length > pageSize && (
            <div className="searchable-select-pagination">
              <span className="pagination-info">
                {filteredOptions.length} kết quả · Trang {currentPage}/{totalPages}
              </span>
              <div className="pagination-buttons">
                <button
                  type="button"
                  className="page-btn"
                  disabled={currentPage <= 1}
                  onClick={(e) => {
                    e.stopPropagation()
                    setPage((p) => Math.max(1, p - 1))
                  }}
                  title="5 mục trước"
                >
                  ‹
                </button>
                <button
                  type="button"
                  className="page-btn"
                  disabled={currentPage >= totalPages}
                  onClick={(e) => {
                    e.stopPropagation()
                    setPage((p) => Math.min(totalPages, p + 1))
                  }}
                  title="5 mục tiếp theo"
                >
                  ›
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default SearchableSelect
