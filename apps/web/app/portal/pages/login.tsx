/** Portal login. Wrong username and wrong password share one message on the server. */
import { useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { portalError } from "../api/client";
import { usePortalLogin } from "../api/portal";
import { ErrorList } from "../components";
import { EXPIRED_FLAG } from "../layout";

const readExpired = () => {
  try {
    const flag = sessionStorage.getItem(EXPIRED_FLAG) === "1";
    sessionStorage.removeItem(EXPIRED_FLAG);
    return flag;
  } catch {
    return false;
  }
};

export default function PortalLogin() {
  const login = usePortalLogin();
  const navigate = useNavigate();
  const location = useLocation();
  const [expired] = useState(readExpired);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const from = (location.state as { from?: string } | null)?.from;
  return (
    <form
      className="portal-card portal-login"
      onSubmit={(event) => {
        event.preventDefault();
        login.mutate(
          { username, password },
          { onSuccess: () => navigate(from && from.startsWith("/portal") ? from : "/portal", { replace: true }) }
        );
      }}
    >
      <header>
        <h1>ورود به درگاه مشتریان</h1>
        <p className="portal-muted">برای پیگیری درخواست‌های پشتیبانی وارد شوید.</p>
      </header>
      {expired && (
        <p className="portal-notice" role="status">
          نشست شما به پایان رسیده است؛ دوباره وارد شوید.
        </p>
      )}
      <label>
        <span>نام کاربری</span>
        <input
          name="username"
          autoComplete="username"
          dir="ltr"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          required
        />
      </label>
      <label>
        <span>گذرواژه</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          dir="ltr"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
      </label>
      <ErrorList items={login.error ? [portalError(login.error, "ورود انجام نشد.")] : []} />
      <button type="submit" className="portal-button is-primary" disabled={login.isPending}>
        {login.isPending ? "در حال ورود…" : "ورود"}
      </button>
      <p className="portal-muted">گذرواژه ندارید؟ پیوند تعیین گذرواژه را از کارشناس شرکت دریافت کنید.</p>
    </form>
  );
}
