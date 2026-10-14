import { useEffect, useState } from "react";
import "./App.css";

const API = "http://127.0.0.1:8000/api";

const initialFilters = {
  status: "",
  program_id: "",
  instructor_id: "",
  start_date: "",
  end_date: "",
};

export default function App() {
  const [classes, setClasses] = useState([]);
  const [stats, setStats] = useState({});
  const [meta, setMeta] = useState({ programs: [], instructors: [] });
  const [filters, setFilters] = useState(initialFilters);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Phân trang
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  // Tải thống kê
  async function fetchStats() {
    try {
      const response = await fetch(`${API}/classes/stats`);
      if (!response.ok) throw new Error("Không tải được dữ liệu thống kê");
      setStats(await response.json());
    } catch (err) {
      setError(err.message);
    }
  }

  // Tải metadata (chương trình & giảng viên từ database thật)
  async function fetchMeta() {
    try {
      const response = await fetch(`${API}/meta`);
      if (response.ok) {
        setMeta(await response.json());
      }
    } catch {
      // Fallback nếu chưa có API meta
    }
  }

  // Tải danh sách lớp với bộ lọc và phân trang
  async function fetchClasses(filterValues = filters, targetPage = page, targetPageSize = pageSize) {
    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams();

      Object.entries(filterValues).forEach(([key, value]) => {
        if (value) params.set(key, value);
      });

      params.set("page", targetPage);
      params.set("page_size", targetPageSize);

      const response = await fetch(`${API}/classes?${params.toString()}`);

      if (!response.ok) {
        throw new Error("Không tải được danh sách lớp học");
      }

      const data = await response.json();
      setClasses(data.items || []);
      setTotal(data.total || 0);
      setPage(data.page || 1);
      setTotalPages(data.total_pages || 1);
    } catch (err) {
      setError(
        err.message === "Failed to fetch"
          ? "Không thể kết nối đến Backend (http://127.0.0.1:8000). Vui lòng kiểm tra lại server Backend."
          : err.message
      );
      setClasses([]);
      setTotal(0);
      setTotalPages(1);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchMeta();
    fetchStats();
    fetchClasses(initialFilters, 1, 5);
  }, []);

  function handleChange(event) {
    const { name, value } = event.target;
    setFilters((previous) => ({
      ...previous,
      [name]: value,
    }));
  }

  // Xử lý tìm kiếm với kết hợp nhiều bộ lọc
  function handleSearch(event) {
    event.preventDefault();

    if (
      filters.start_date &&
      filters.end_date &&
      filters.start_date > filters.end_date
    ) {
      setLoading(false);
      setError("Khoảng thời gian không hợp lệ: Từ ngày phải nhỏ hơn hoặc bằng Đến ngày");
      return;
    }

    // Reset về trang 1 khi lọc
    setPage(1);
    fetchClasses(filters, 1, pageSize);
  }

  // Xóa toàn bộ bộ lọc
  function handleReset() {
    setFilters(initialFilters);
    setError("");
    setPage(1);
    fetchClasses(initialFilters, 1, pageSize);
  }

  // Chuyển trang
  function handlePageChange(newPage) {
    if (newPage >= 1 && newPage <= totalPages && newPage !== page) {
      setPage(newPage);
      fetchClasses(filters, newPage, pageSize);
    }
  }

  // Thay đổi số dòng trên mỗi trang
  function handlePageSizeChange(event) {
    const newSize = Number(event.target.value);
    setPageSize(newSize);
    setPage(1);
    fetchClasses(filters, 1, newSize);
  }

  const startRecord = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const endRecord = Math.min(page * pageSize, total);

  return (
    <main className="container">
      <header className="header">
        <h1>Quản lý đào tạo</h1>
        <p>Danh sách và tình hình các lớp học (Dữ liệu thời gian thực từ Database)</p>
      </header>

      {/* Chỉ số nhanh */}
      <section className="stats">
        <Stat title="Tổng số lớp" value={stats.total_classes ?? 0} />
        <Stat title="Lớp đang học" value={stats.active_classes ?? 0} />
        <Stat title="Tổng học viên" value={stats.total_students ?? 0} />
        <Stat title="Sắp khai giảng" value={stats.upcoming_classes ?? 0} />
      </section>

      {/* Bộ lọc nâng cao */}
      <section className="panel">
        <div className="panel-header">
          <h2>Bộ lọc tìm kiếm</h2>
          <span className="badge-count">
            Đang tìm thấy: <strong>{total}</strong> lớp
          </span>
        </div>

        <form className="filters" onSubmit={handleSearch}>
          <label>
            Trạng thái
            <select
              name="status"
              value={filters.status}
              onChange={handleChange}
            >
              <option value="">Tất cả trạng thái</option>
              <option value="Đang học">Đang học</option>
              <option value="Sắp khai giảng">Sắp khai giảng</option>
              <option value="Đã kết thúc">Đã kết thúc</option>
            </select>
          </label>

          <label>
            Chương trình
            <select
              name="program_id"
              value={filters.program_id}
              onChange={handleChange}
            >
              <option value="">Tất cả chương trình</option>
              {meta.programs.length > 0 ? (
                meta.programs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))
              ) : (
                <>
                  <option value="1">Java</option>
                  <option value="2">Python</option>
                  <option value="3">Frontend</option>
                </>
              )}
            </select>
          </label>

          <label>
            Giảng viên
            <select
              name="instructor_id"
              value={filters.instructor_id}
              onChange={handleChange}
            >
              <option value="">Tất cả giảng viên</option>
              {meta.instructors.length > 0 ? (
                meta.instructors.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))
              ) : (
                <>
                  <option value="1">Nguyễn Văn An</option>
                  <option value="2">Trần Văn Bình</option>
                  <option value="3">Lê Thị Mai</option>
                </>
              )}
            </select>
          </label>

          <label>
            Từ ngày
            <input
              type="date"
              name="start_date"
              value={filters.start_date}
              onChange={handleChange}
            />
          </label>

          <label>
            Đến ngày
            <input
              type="date"
              name="end_date"
              value={filters.end_date}
              onChange={handleChange}
            />
          </label>

          <div className="actions">
            <button type="submit" className="btn-search">
              Tìm kiếm
            </button>
            <button
              type="button"
              className="reset"
              onClick={handleReset}
            >
              Xóa bộ lọc
            </button>
          </div>
        </form>
      </section>

      {/* Danh sách lớp học và phân trang */}
      <section className="panel">
        <div className="panel-header">
          <h2>Danh sách lớp học</h2>
          <div className="page-size-selector">
            <label>
              Hiển thị:
              <select value={pageSize} onChange={handlePageSizeChange}>
                <option value={5}>5 lớp / trang</option>
                <option value={10}>10 lớp / trang</option>
                <option value={20}>20 lớp / trang</option>
              </select>
            </label>
          </div>
        </div>

        {error && <p className="error">{error}</p>}
        {loading && !error && <p className="loading">Đang tải dữ liệu từ database...</p>}

        {!loading && !error && classes.length === 0 && (
          <div className="empty-state">
            <p>Không tìm thấy lớp học nào phù hợp với điều kiện lọc.</p>
            <button type="button" onClick={handleReset} className="btn-search">
              Bỏ lọc để xem tất cả
            </button>
          </div>
        )}

        {!loading && classes.length > 0 && (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>STT</th>
                    <th>Tên lớp</th>
                    <th>Chương trình</th>
                    <th>Giảng viên</th>
                    <th>Trạng thái</th>
                    <th>Sĩ số</th>
                    <th>Tiến độ buổi học</th>
                    <th>Thời gian</th>
                  </tr>
                </thead>

                <tbody>
                  {classes.map((cls, idx) => (
                    <tr key={cls.id}>
                      <td>{(page - 1) * pageSize + idx + 1}</td>
                      <td>
                        <strong>{cls.name}</strong>
                      </td>
                      <td>
                        <span className="badge-program">{cls.program}</span>
                      </td>
                      <td>{cls.instructor}</td>
                      <td>
                        <span className={`status status-${cls.status.toLowerCase().replace(/\s+/g, "-")}`}>
                          {cls.status}
                        </span>
                      </td>
                      <td>
                        <strong>{cls.current_students}</strong>/{cls.max_students}
                      </td>
                      <td>
                        <span>
                          {cls.completed_sessions}/{cls.total_sessions} buổi ({cls.progress}%)
                        </span>
                        <div className="progress">
                          <div
                            className="progress-bar"
                            style={{ width: `${cls.progress}%` }}
                          />
                        </div>
                      </td>
                      <td className="text-muted">
                        {cls.start_date} ~ {cls.end_date}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Thanh điều khiển phân trang */}
            <div className="pagination-bar">
              <span className="pagination-info">
                Hiển thị <strong>{startRecord}</strong> - <strong>{endRecord}</strong> trong tổng số <strong>{total}</strong> lớp học
              </span>

              <div className="pagination-controls">
                <button
                  type="button"
                  className="page-btn"
                  disabled={page <= 1}
                  onClick={() => handlePageChange(page - 1)}
                >
                  &laquo; Trước
                </button>

                {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={`page-btn ${p === page ? "active" : ""}`}
                    onClick={() => handlePageChange(p)}
                  >
                    {p}
                  </button>
                ))}

                <button
                  type="button"
                  className="page-btn"
                  disabled={page >= totalPages}
                  onClick={() => handlePageChange(page + 1)}
                >
                  Sau &raquo;
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </main>
  );
}

function Stat({ title, value }) {
  return (
    <article className="stat-card">
      <p>{title}</p>
      <strong>{value}</strong>
    </article>
  );
}
