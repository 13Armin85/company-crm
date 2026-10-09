import { useEffect, useState } from "react";
import { ArrowLeft, LockKeyhole } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router";
import { BrandLogo } from "@plane/ui";

const authErrors: Record<string, string> = {
  USER_DOES_NOT_EXIST: "حساب کاربری پیدا نشد.",
  AUTHENTICATION_FAILED_SIGN_IN: "نام کاربری یا رمز عبور درست نیست.",
  INVALID_EMAIL_SIGN_IN: "شناسه ورود معتبر وارد کنید.",
  REQUIRED_EMAIL_PASSWORD_SIGN_IN: "شناسه ورود و رمز عبور الزامی است.",
  EMAIL_PASSWORD_AUTHENTICATION_DISABLED: "ورود با رمز عبور غیرفعال است.",
  RATE_LIMIT_EXCEEDED: "تعداد تلاش‌ها زیاد است؛ کمی بعد دوباره امتحان کنید.",
};

export default function AuthPage() {
  const [params] = useSearchParams();
  const errorKey = params.get("error_message") ?? "";
  const [csrf, setCsrf] = useState("");
  const [failed, setFailed] = useState(false);
  const [checking, setChecking] = useState(true);
  const navigate = useNavigate();
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/users/me/", { credentials: "include", cache: "no-store", signal: controller.signal })
      .then((response) => {
        if (response.ok) navigate("/", { replace: true });
        return undefined;
      })
      .catch(() => undefined)
      .finally(() => {
        if (!controller.signal.aborted) setChecking(false);
      });
    fetch("/auth/get-csrf-token/", { credentials: "include", cache: "no-store", signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error();
        return response.json();
      })
      .then((data: { csrf_token?: string }) => {
        setCsrf(data.csrf_token ?? "");
        setFailed(!data.csrf_token);
        return undefined;
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [navigate]);
  if (checking)
    return (
      <main className="access-loading" role="status">
        در حال بررسی حساب…
      </main>
    );
  return (
    <main className="auth-page">
      <section className="auth-showcase">
        <BrandLogo variant="full" className="auth-brand-mark" />
        <div>
          <p>مدیریت یکپارچه کار و تیم</p>
          <h1>هم‌کار؛ فضای کاری روشن، سریع و متمرکز</h1>
          <span>تمام پروژه‌ها و اعضای تیم شما در یک محیط فارسی و امن.</span>
        </div>
      </section>
      <section className="auth-form-side">
        <LoginForm csrf={csrf} errorKey={errorKey} failed={failed} />
      </section>
    </main>
  );
}

export function LoginForm({
  csrf,
  errorKey = "",
  failed = false,
}: {
  csrf: string;
  errorKey?: string;
  failed?: boolean;
}) {
  return (
    <form method="post" action="/auth/sign-in/" className="auth-card">
      <input type="hidden" name="csrfmiddlewaretoken" value={csrf} />
      <input type="hidden" name="next_path" value="/login" />
      <header>
        <span>
          <LockKeyhole size={22} />
        </span>
        <div>
          <h2>ورود به هم‌کار</h2>
          <p>برای ادامه وارد فضای کاری خود شوید.</p>
        </div>
      </header>
      {errorKey && (
        <div className="auth-message error" role="alert">
          {authErrors[errorKey] ?? "ورود انجام نشد."}
        </div>
      )}
      {failed && (
        <div className="auth-message error" role="alert">
          اتصال به سامانه برقرار نشد. صفحه را دوباره بارگذاری کنید.
        </div>
      )}
      <label>
        <span>ایمیل یا نام کاربری</span>
        <input name="email" dir="ltr" autoComplete="username" required />
      </label>
      <label>
        <span>رمز عبور</span>
        <input name="password" type="password" dir="ltr" autoComplete="current-password" required />
      </label>
      <button className="button button-primary auth-submit" type="submit" disabled={!csrf}>
        ورود به حساب <ArrowLeft size={17} />
      </button>
    </form>
  );
}
