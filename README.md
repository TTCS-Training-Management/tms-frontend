# TMS Frontend

React + TypeScript + Vite frontend for the Training Management System.

## Run locally

Start the backend first at `http://127.0.0.1:8000`, then run:

```powershell
cd "G:\Hệ Thống Đào Tạo\tms-frontend"
npm install
npm run dev
```

Open the URL printed by Vite, usually `http://localhost:5173`.

## Login

- Email: `admin@tms.local`
- Password: `Admin@123`

The other seeded accounts are `lecturer@tms.local` / `Lecturer@123` and `accountant@tms.local` / `Accountant@123`.

## Sprint 1

The interface supports all eight account roles, multiple roles per user, permission-aware navigation, server-paged account search/filtering, account activation, lock reasons and class handover warnings. Newly created accounts receive a generated temporary password by email and must change it after the first login.

Set `VITE_API_URL` at build/dev time to override the API address (defaults to `http://127.0.0.1:8000`). Password reset links open the frontend with a `reset_token` query parameter. The login hero currently uses `public/nendep.png`.

## Sprint 2 account workflows

Administrators can open **Tài khoản** to download the Excel template, preview row-level validation, import valid rows, and read the import summary. The signed-in user's profile dialog supports profile edits and avatar upload; its action buttons stay visible while long profile forms scroll within the dialog.

## Sprint 2 training and admissions workflows

Users with full training permissions can open **Chương trình đào tạo** to create/edit programs and reusable subjects, link subjects into the selected program, choose prerequisites only from that program, drag curriculum rows to persist their sequence, and remove links. The same screen manages each program's class lifecycle records (planned, running, completed, cancelled); deleting a program with a running class is blocked, while changing its status to inactive remains available. Subject sessions can be added within the declared count or copied from another subject; copied sessions append after the target's existing sessions.

Users with admissions permissions can manage leads from **Đầu phễu tuyển sinh**. The public consultation form is available at `/register`; successful submissions are saved as new leads, spam-trap submissions are rejected, and the backend applies a per-IP submission limit.
