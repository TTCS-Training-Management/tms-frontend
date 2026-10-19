# Website Quản Lý Bài Nộp & Lịch Sử Phiên Bản (SCRUM-91)

Ứng dụng Frontend React (Vite) phục vụ việc nộp bài, lưu trữ lịch sử các phiên bản nộp và chấm bài / mở lại bài theo yêu cầu đề tài.

## Các chức năng chính
1. **Học viên:**
   - Nộp bài lần đầu (tạo Phiên bản 1) hoặc nộp lại (tự động tăng Phiên bản 2, 3...).
   - Hiển thị danh sách lịch sử từng phiên bản độc lập (thời gian nộp, tên tệp, trạng thái, nút tải về tệp).
   - Khóa chức năng nộp lại khi bài đã được Giảng viên chấm điểm.
   - Nhận thông báo mở lại bài khi Giảng viên yêu cầu sửa đổi.
2. **Giảng viên:**
   - Xem lịch sử nộp bài của học viên.
   - Thao tác "Đánh dấu đã chấm" (khóa quyền nộp lại của học viên).
   - Thao tác "Mở lại bài đã chấm" để học viên tiếp tục nộp phiên bản tiếp theo.

## Cách chạy dự án
```powershell
cd frontend
npm install
npm run dev
```
Truy cập: `http://localhost:5173`
API Backend kết nối: `http://127.0.0.1:8000`
