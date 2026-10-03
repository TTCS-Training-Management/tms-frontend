import streamlit as st
from auth import init_auth_state, login_user, get_current_user
from components import render_header_user_info

# Khởi tạo state
init_auth_state()

st.set_page_config(page_title="Hệ thống Quản lý", layout="wide")

# Render Sidebar chứa thông tin người dùng
render_header_user_info()

user = get_current_user()

if not user:
    st.title("🔑 Đăng nhập Hệ thống")

    # Đổi key thành unique để không bị trùng lặp
    with st.form("main_login_form"):
        username = st.text_input("Tên tài khoản")
        password = st.text_input("Mật khẩu", type="password")
        submit = st.form_submit_button("Đăng nhập")

        if submit:
            if username and password:
                login_user(
                    name="Lữ Chinh",
                    avatar_url="https://api.dicebear.com/7.x/bottts/svg?seed=LuChinh",
                    role="Admin"
                )
                st.success("Đăng nhập thành công!")
                st.rerun()
            else:
                st.error("Vui lòng nhập đầy đủ tài khoản và mật khẩu!")
else:
    st.title(f"👋 Chào mừng {user['name']} quay trở lại!")
    st.write("Thông tin người dùng đang lưu trữ trong hệ thống:")
    st.json(user)