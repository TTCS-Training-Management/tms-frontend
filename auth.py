import streamlit as st

def init_auth_state():
    """Khởi tạo state thông tin người dùng nếu chưa có"""
    if "user_info" not in st.session_state:
        st.session_state["user_info"] = None
    if "is_authenticated" not in st.session_state:
        st.session_state["is_authenticated"] = False

def login_user(name: str, avatar_url: str, role: str):
    """Lưu trữ thông tin người dùng vào Session State"""
    st.session_state["user_info"] = {
        "name": name,
        "avatar": avatar_url,
        "role": role
    }
    st.session_state["is_authenticated"] = True

def logout_user():
    """Xóa thông tin đăng nhập"""
    st.session_state["user_info"] = None
    st.session_state["is_authenticated"] = False

def get_current_user():
    """Lấy thông tin người dùng hiện tại"""
    return st.session_state.get("user_info")
    import requests
import streamlit as st

# URL API Backend của bạn (ví dụ: ASP.NET Core API / FastAPI)
BACKEND_API_URL = "http://localhost:5000/api/auth/login"

def init_auth_state():
    if "user_info" not in st.session_state:
        st.session_state["user_info"] = None
    if "access_token" not in st.session_state:
        st.session_state["access_token"] = None

def login_with_api(username, password):
    """Gọi API Backend để đăng nhập và lưu trữ thông tin"""
    try:
        payload = {"username": username, "password": password}
        response = requests.post(BACKEND_API_URL, json=payload, timeout=5)

        if response.status_code == 200:
            data = response.json()

            # Lưu token và thông tin người dùng vào Session State
            st.session_state["access_token"] = data.get("token")
            st.session_state["user_info"] = {
                "name": data.get("user", {}).get("fullName", username),
                "avatar": data.get("user", {}).get("avatarUrl", "https://api.dicebear.com/7.x/bottts/svg?seed=User"),
                "role": data.get("user", {}).get("roleName", "User")
            }
            return True, "Đăng nhập thành công!"
        else:
            return False, f"Đăng nhập thất bại: {response.json().get('message', 'Thông tin không chính xác')}"
    except Exception as e:
        return False, f"Không thể kết nối tới Server API: {str(e)}"

def logout_user():
    st.session_state["user_info"] = None
    st.session_state["access_token"] = None

def get_current_user():
    return st.session_state.get("user_info")

def get_auth_header():
    """Hàm lấy Header chứa Bearer Token cho các request API khác"""
    token = st.session_state.get("access_token")
    if token:
        return {"Authorization": f"Bearer {token}"}
    return {}