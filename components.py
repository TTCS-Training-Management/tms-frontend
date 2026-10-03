import streamlit as st
from auth import get_current_user, logout_user

def render_header_user_info():
    """Hiển thị thông tin người dùng đăng nhập trên Sidebar"""
    user = get_current_user()

    if user:
        st.sidebar.markdown("---")
        col1, col2 = st.sidebar.columns([1, 3])

        with col1:
            st.image(user["avatar"], width=50)

        with col2:
            st.markdown(f"**{user['name']}**")
            st.caption(f"Quyền: `{user['role']}`")

        if st.sidebar.button("Đăng xuất", key="logout_btn"):
            logout_user()
            st.rerun()
    else:
        st.sidebar.info("Chưa đăng nhập")