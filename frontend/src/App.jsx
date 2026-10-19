import { useEffect, useState } from "react";
import "./App.css";

const API = "http://127.0.0.1:8000";

function App() {
  // Vai trò: 'student' (Học viên) hoặc 'teacher' (Giảng viên)
  const [currentUserRole, setCurrentUserRole] = useState("student");

  const [studentId, setStudentId] = useState("HV001");
  const [assignmentId, setAssignmentId] = useState("BT001");
  const [file, setFile] = useState(null);
  const [history, setHistory] = useState([]);
  const [message, setMessage] = useState({ text: "", type: "info" });
  const [loading, setLoading] = useState(false);

  // Xác định trạng thái của phiên bản mới nhất
  const latestSubmission = history.length > 0 ? history[0] : null;
  const isLatestGraded = latestSubmission && latestSubmission.status === "graded";
  const isLatestReopened = latestSubmission && latestSubmission.status === "reopened";

  async function loadHistory() {
    try {
      const params = new URLSearchParams({
        student_id: studentId,
        assignment_id: assignmentId,
      });
      const response = await fetch(`${API}/api/submissions?${params}`);
      if (!response.ok) throw new Error("Không tải được lịch sử bài nộp");
      const data = await response.json();
      setHistory(data);
    } catch (error) {
      setMessage({
        text: `${error.message}. Hãy chắc chắn Backend đang chạy tại cổng 8000.`,
        type: "error",
      });
    }
  }

  useEffect(() => {
    loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId, assignmentId]);

  // 1 & 3. Nộp bài (Chỉ cho Học viên, bị khóa khi đã chấm)
  async function submitAssignment(event) {
    event.preventDefault();

    if (currentUserRole !== "student") {
      setMessage({
        text: "Chỉ tài khoản Học viên mới có thể nộp bài. Vui lòng chuyển sang vai trò Học viên.",
        type: "error",
      });
      return;
    }

    if (isLatestGraded) {
      setMessage({
        text: "Bài tập đã được chấm điểm và đang bị KHÓA. Bạn không thể tự ý nộp lại trừ khi Giảng viên mở lại bài.",
        type: "error",
      });
      return;
    }

    if (!file) {
      setMessage({ text: "Vui lòng chọn một tệp bài làm trước khi nộp.", type: "warning" });
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    const params = new URLSearchParams({
      student_id: studentId,
      assignment_id: assignmentId,
    });

    setLoading(true);
    setMessage({ text: "", type: "info" });

    try {
      const response = await fetch(`${API}/api/submissions?${params}`, {
        method: "POST",
        headers: {
          "X-User-Role": currentUserRole,
        },
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.detail || "Nộp bài thất bại");
      }

      setMessage({
        text: `${result.message} (Tệp: ${result.filename})`,
        type: "success",
      });
      setFile(null);
      event.target.reset();
      await loadHistory();
    } catch (error) {
      setMessage({ text: error.message, type: "error" });
    } finally {
      setLoading(false);
    }
  }

  // 4. Thao tác của Giảng viên (Đánh dấu đã chấm & Mở lại bài)
  async function teacherAction(action) {
    if (currentUserRole !== "teacher") {
      setMessage({
        text: "Từ chối truy cập: Bạn đang ở vai trò Học viên, không có quyền thực hiện thao tác này!",
        type: "error",
      });
      return;
    }

    const actionText =
      action === "grade"
        ? `Đánh dấu bài Phiên bản ${latestSubmission?.version || ""} là ĐÃ CHẤM và KHÓA nộp lại?`
        : `MỞ LẠI bài Phiên bản ${latestSubmission?.version || ""} để học viên nộp phiên bản tiếp theo?`;

    const confirmed = window.confirm(actionText);
    if (!confirmed) return;

    setLoading(true);
    setMessage({ text: "", type: "info" });

    try {
      const response = await fetch(
        `${API}/api/submissions/${action === "grade" ? "grade" : "reopen"}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-User-Role": currentUserRole,
          },
          body: JSON.stringify({
            student_id: studentId,
            assignment_id: assignmentId,
          }),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.detail || "Thao tác thất bại");
      }

      setMessage({ text: result.message, type: "success" });
      await loadHistory();
    } catch (error) {
      setMessage({ text: error.message, type: "error" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="container">
      {/* KHU VỰC CHỌN VAI TRÒ (RBAC) */}
      <section className="role-switcher-bar">
        <div className="role-indicator">
          <span>Đang đăng nhập với vai trò:</span>
          <div className="role-pills">
            <button
              type="button"
              className={`role-btn ${currentUserRole === "student" ? "active" : ""}`}
              onClick={() => {
                setCurrentUserRole("student");
                setMessage({ text: "Đã chuyển sang vai trò Học viên.", type: "info" });
              }}
            >
              🎓 Học viên (Student)
            </button>
            <button
              type="button"
              className={`role-btn ${currentUserRole === "teacher" ? "active" : ""}`}
              onClick={() => {
                setCurrentUserRole("teacher");
                setMessage({ text: "Đã chuyển sang vai trò Giảng viên.", type: "info" });
              }}
            >
              👨‍🏫 Giảng viên (Teacher)
            </button>
          </div>
        </div>
        <div className="role-badge-tag">
          {currentUserRole === "student" ? "Quyền: Nộp bài & Xem lịch sử" : "Quyền: Chấm bài & Mở lại bài"}
        </div>
      </section>

      {/* HEADER TRANG */}
      <header className="page-header">
        <div>
          <p className="eyebrow">
            {currentUserRole === "student" ? "STUDENT PORTAL" : "TEACHER MANAGEMENT PORTAL"}
          </p>
          <h1>Hệ Thống Nộp Bài & Quản Lý Phiên Bản</h1>
          <p className="subtitle">
            Lưu trữ độc lập các phiên bản, theo dõi lịch sử nộp và quản lý mở lại bài đã chấm.
          </p>
        </div>
        <span className="count">{history.length} phiên bản đã lưu</span>
      </header>

      {/* THÔNG BÁO HỆ THỐNG */}
      {message.text && (
        <div className={`alert-banner ${message.type}`}>
          <span>{message.text}</span>
          <button
            type="button"
            className="alert-close"
            onClick={() => setMessage({ text: "", type: "info" })}
          >
            ✕
          </button>
        </div>
      )}

      {/* BẢNG ĐIỀU KHIỂN CHỌN BÀI TẬP */}
      <section className="panel">
        <h2>Thông tin bài tập & Đối tượng</h2>
        <div className="fields">
          <label>
            Mã học viên:
            <input
              type="text"
              value={studentId}
              onChange={(e) => setStudentId(e.target.value.trim().toUpperCase())}
              placeholder="VD: HV001"
            />
          </label>
          <label>
            Mã bài tập:
            <input
              type="text"
              value={assignmentId}
              onChange={(e) => setAssignmentId(e.target.value.trim().toUpperCase())}
              placeholder="VD: BT001"
            />
          </label>
        </div>
        <p className="hint">
          💡 Bạn có thể đổi mã học viên (ví dụ: HV001, HV002) hoặc mã bài tập (BT001, BT002) để quản lý từng bài riêng biệt.
        </p>
      </section>

      {/* 3. KHU VỰC NỘP BÀI DÀNH CHO HỌC VIÊN */}
      {currentUserRole === "student" && (
        <section className={`panel submission-panel ${isLatestGraded ? "is-locked" : ""}`}>
          <div className="section-heading">
            <div>
              <h2>Nộp bài hoặc nộp lại</h2>
              <p className="subtitle">
                {history.length === 0
                  ? "Bạn chưa có bài nộp nào. Hãy nộp Phiên bản 1."
                  : `Bài nộp mới sẽ được lưu thành Phiên bản ${history.length + 1} (bài cũ được giữ nguyên).`}
              </p>
            </div>
            {isLatestGraded && (
              <span className="badge-locked">🔒 ĐANG KHÓA NỘP LẠI</span>
            )}
            {isLatestReopened && (
              <span className="badge-reopened">🔓 ĐÃ ĐƯỢC MỞ LẠI</span>
            )}
          </div>

          {/* CẢNH BÁO NẾU BÀI ĐÃ CHẤM */}
          {isLatestGraded && (
            <div className="lock-notice">
              <strong>⛔ Bài nộp gần nhất (Phiên bản {latestSubmission?.version}) đã được chấm điểm.</strong>
              <p>Chức năng nộp lại hiện đang bị khóa để bảo đảm tính toàn vẹn. Vui lòng liên hệ Giảng viên để được mở lại khi cần sửa bài.</p>
            </div>
          )}

          {isLatestReopened && (
            <div className="reopen-notice">
              <strong>✅ Giảng viên đã mở lại bài cho bạn!</strong>
              <p>Bạn có thể chọn tệp đã sửa và bấm &quot;Nộp bài&quot; để gửi Phiên bản {history.length + 1}.</p>
            </div>
          )}

          <form onSubmit={submitAssignment}>
            <label className={`upload-box ${isLatestGraded ? "disabled-upload" : ""}`}>
              <span className="upload-icon">{isLatestGraded ? "🔒" : "⬆"}</span>
              <strong>{file ? file.name : (isLatestGraded ? "Nộp bài đang bị khóa" : "Bấm vào đây để chọn tệp bài làm")}</strong>
              <span>Hỗ trợ tệp: PDF, DOC, DOCX, ZIP, TXT, PY, JS · Lưu trữ độc lập</span>
              <input
                type="file"
                disabled={isLatestGraded || loading}
                accept=".pdf,.doc,.docx,.zip,.txt,.py,.js,.rar"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            </label>

            <button
              type="submit"
              className="primary"
              disabled={isLatestGraded || loading}
            >
              {loading
                ? "Đang tải lên..."
                : isLatestGraded
                ? "Đã khóa (Không thể nộp)"
                : history.length === 0
                ? "Nộp bài lần đầu (Phiên bản 1)"
                : `Nộp lại (Tạo Phiên bản ${history.length + 1})`}
            </button>
          </form>
        </section>
      )}

      {/* 4. KHU VỰC THAO TÁC CỦA GIẢNG VIÊN */}
      {currentUserRole === "teacher" && (
        <section className="panel teacher-panel">
          <div className="section-heading">
            <div>
              <h2>👨‍🏫 Bảng điều khiển Giảng viên</h2>
              <p className="subtitle">
                Đang quản lý bài nộp của học viên <strong>{studentId}</strong> — Mã bài: <strong>{assignmentId}</strong>
              </p>
            </div>
            <span className="teacher-badge">Chế độ Giảng viên</span>
          </div>

          <div className="teacher-status-box">
            <p>
              <strong>Trạng thái phiên bản mới nhất: </strong>
              {!latestSubmission ? (
                <span className="empty-text">Chưa có bài nộp nào</span>
              ) : latestSubmission.status === "graded" ? (
                <span className="status graded">Đã chấm (Học viên đang bị khóa nộp lại)</span>
              ) : latestSubmission.status === "reopened" ? (
                <span className="status reopened">Đã mở lại (Học viên được phép nộp bản sửa)</span>
              ) : (
                <span className="status submitted">Mới nộp (Chờ chấm điểm)</span>
              )}
            </p>
          </div>

          <div className="actions">
            <button
              type="button"
              className="secondary btn-grade"
              disabled={loading || !latestSubmission || latestSubmission.status === "graded"}
              onClick={() => teacherAction("grade")}
            >
              {latestSubmission?.status === "graded"
                ? "✓ Phiên bản mới nhất đã chấm"
                : "✍️ Đánh dấu đã chấm (Khóa nộp lại)"}
            </button>

            <button
              type="button"
              className="primary btn-reopen"
              disabled={loading || !latestSubmission || latestSubmission.status !== "graded"}
              onClick={() => teacherAction("reopen")}
            >
              🔓 Mở lại bài đã chấm (Cho phép học viên sửa)
            </button>
          </div>
        </section>
      )}

      {/* 1 & 2. HIỂN THỊ LỊCH SỬ TỪNG PHIÊN BẢN (KHÔNG BỊ GHI ĐÈ) */}
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>Lịch sử các phiên bản đã nộp</h2>
            <p className="subtitle">
              Mỗi lần nộp được lưu thành 1 bản ghi riêng biệt với tệp vật lý độc lập, không bị ghi đè.
            </p>
          </div>
          <button type="button" className="secondary refresh-btn" onClick={loadHistory}>
            🔄 Làm mới danh sách
          </button>
        </div>

        {history.length === 0 ? (
          <div className="empty-state">
            <p>Chưa có phiên bản nào được nộp cho học viên <strong>{studentId}</strong> ở bài tập <strong>{assignmentId}</strong>.</p>
          </div>
        ) : (
          <div className="history-list">
            {history.map((item, index) => (
              <article
                className={`history-item ${index === 0 ? "is-latest" : ""}`}
                key={item.id}
              >
                <div className="version-pill">
                  <span>v{item.version}</span>
                </div>

                <div className="file-info">
                  <div className="file-title-row">
                    <strong>Phiên bản {item.version}</strong>
                    {index === 0 && <span className="latest-tag">Mới nhất</span>}
                  </div>
                  <span className="filename">📄 {item.filename}</span>
                  <small className="timestamp">
                    🕒 Nộp lúc: {new Date(item.submitted_at).toLocaleString("vi-VN", {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                      day: "2-digit",
                      month: "2-digit",
                      year: "numeric",
                    })}
                  </small>
                </div>

                <div className="item-actions">
                  <span className={`status ${item.status}`}>
                    {{
                      submitted: "Đã nộp",
                      graded: "Đã chấm (Khóa)",
                      reopened: "Được mở lại",
                    }[item.status] || item.status}
                  </span>

                  {/* Nút tải về từng phiên bản độc lập */}
                  <a
                    href={`${API}/api/submissions/${item.id}/download`}
                    target="_blank"
                    rel="noreferrer"
                    className="download-link"
                    title={`Tải về file của phiên bản ${item.version}`}
                  >
                    ⬇ Tải về
                  </a>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

export default App;
