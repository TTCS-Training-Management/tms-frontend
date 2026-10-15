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
  /** @deprecated Pagination is replaced by continuous scrolling as requested */
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
  const CHUNK_SIZE = Math.max(1, pageSize || 5)
  const [isOpen, setIsOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1)
  const [visibleCount, setVisibleCount] = useState<number>(CHUNK_SIZE)
  const containerRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

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

  // Reset highlight & visible count on search change
  useEffect(() => {
    setHighlightedIndex(-1)
    setVisibleCount(CHUNK_SIZE)
  }, [searchTerm, CHUNK_SIZE])

  // Focus search input and init visible count when opening
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        searchInputRef.current?.focus()
      }, 50)
      // Highlight currently selected option if present and ensure it's in visible count
      const curIdx = filteredOptions.findIndex((opt) => String(opt.value) === String(value))
      if (curIdx >= 0) {
        setVisibleCount(Math.max(CHUNK_SIZE, Math.ceil((curIdx + 1) / CHUNK_SIZE) * CHUNK_SIZE))
        setHighlightedIndex(curIdx)
      } else {
        setVisibleCount(CHUNK_SIZE)
        setHighlightedIndex(filteredOptions.length > 0 ? 0 : -1)
      }
    } else {
      setSearchTerm('')
      setHighlightedIndex(-1)
      setVisibleCount(CHUNK_SIZE)
    }
  }, [isOpen, value, filteredOptions, CHUNK_SIZE])

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightedIndex >= 0 && listRef.current) {
      const activeEl = listRef.current.children[highlightedIndex] as HTMLElement | undefined
      if (activeEl) {
        activeEl.scrollIntoView({ block: 'nearest' })
      }
    }
  }, [highlightedIndex])

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

  // Infinite scroll trigger: load next 5 items when approaching bottom
  function handleListScroll(e: React.UIEvent<HTMLDivElement>) {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget
    if (scrollTop + clientHeight >= scrollHeight - 30) {
      if (visibleCount < filteredOptions.length) {
        setVisibleCount((prev) => Math.min(prev + CHUNK_SIZE, filteredOptions.length))
      }
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      setIsOpen(false)
    } else if (e.key === 'ArrowDown') {
      if (!isOpen) {
        setIsOpen(true)
      } else {
        e.preventDefault()
        setHighlightedIndex((prev) => {
          const next = prev < filteredOptions.length - 1 ? prev + 1 : 0
          if (next >= visibleCount && visibleCount < filteredOptions.length) {
            setVisibleCount((cur) => Math.min(cur + CHUNK_SIZE, filteredOptions.length))
          }
          return next
        })
      }
    } else if (e.key === 'ArrowUp') {
      if (isOpen) {
        e.preventDefault()
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : filteredOptions.length - 1))
      }
    } else if (e.key === 'Enter') {
      if (isOpen && highlightedIndex >= 0 && highlightedIndex < filteredOptions.length) {
        e.preventDefault()
        handleSelect(filteredOptions[highlightedIndex].value)
      }
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

          <div className="searchable-select-list" ref={listRef} onScroll={handleListScroll}>
            {filteredOptions.length === 0 ? (
              <div className="searchable-select-empty">
                <span>Không tìm thấy kết quả phù hợp</span>
              </div>
            ) : (
              <>
                {filteredOptions.slice(0, visibleCount).map((opt, idx) => {
                  const isSelected = String(opt.value) === String(value)
                  const isHighlighted = idx === highlightedIndex
                  return (
                    <div
                      key={String(opt.value)}
                      role="option"
                      aria-selected={isSelected}
                      className={`searchable-select-option ${isSelected ? 'is-selected' : ''} ${isHighlighted ? 'is-highlighted' : ''}`}
                      onClick={() => handleSelect(opt.value)}
                      onMouseEnter={() => setHighlightedIndex(idx)}
                    >
                      <div className="option-text-group">
                        <span className="option-label">{opt.label}</span>
                        {opt.subLabel && <span className="option-sublabel">{opt.subLabel}</span>}
                      </div>
                      {opt.badge && <span className="option-badge">{opt.badge}</span>}
                      {isSelected && <span className="option-check">✓</span>}
                    </div>
                  )
                })}

                {visibleCount < filteredOptions.length && (
                  <div
                    className="searchable-select-load-more"
                    onClick={(e) => {
                      e.stopPropagation()
                      setVisibleCount((prev) => Math.min(prev + CHUNK_SIZE, filteredOptions.length))
                    }}
                    title="Cuộn chuột hoặc bấm để tải thêm"
                  >
                    <span>↓ Cuộn xuống để xem tiếp 5 lựa chọn (còn {filteredOptions.length - visibleCount})</span>
                  </div>
                )}
              </>
            )}
          </div>

          {filteredOptions.length > 0 && (
            <div className="searchable-select-footer">
              <span className="footer-count">
                Đang hiện {Math.min(visibleCount, filteredOptions.length)} / {filteredOptions.length} lựa chọn{searchTerm ? ' phù hợp' : ''}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default SearchableSelect
