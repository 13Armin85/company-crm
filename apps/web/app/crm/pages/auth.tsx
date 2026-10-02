import { useEffect, useState } from "react";
import { ArrowLeft, LockKeyhole, UserPlus } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router";

const authErrors: Record<string, string> = {
  USER_DOES_NOT_EXIST: "حسابی با این ایمیل پیدا نشد.",
  USER_ALREADY_EXIST: "این ایمیل قبلاً ثبت شده است؛ وارد حساب شوید.",
  AUTHENTICATION_FAILED_SIGN_IN: "ایمیل یا رمز عبور درست نیست.",
  INVALID_EMAIL_SIGN_IN: "ایمیل معتبر وارد کنید.",
  INVALID_EMAIL_SIGN_UP: "ایمیل معتبر وارد کنید.",
  REQUIRED_EMAIL_PASSWORD_SIGN_IN: "ایمیل و رمز عبور الزامی است.",
  REQUIRED_EMAIL_PASSWORD_SIGN_UP: "ایمیل و رمز عبور الزامی است.",
  PASSWORD_TOO_WEAK: "رمز عبور ضعیف است؛ از حروف بزرگ و کوچک، عدد و نماد استفاده کنید.",
  SIGNUP_DISABLED: "ثبت‌نام عمومی غیرفعال است. از مدیر فضای کاری دسترسی بگیرید.",
  EMAIL_PASSWORD_AUTHENTICATION_DISABLED: "ورود و ثبت‌نام با رمز عبور غیرفعال است.",
  INSTANCE_NOT_CONFIGURED: "سامانه هنوز برای ثبت‌نام آماده نشده است.",
  RATE_LIMIT_EXCEEDED: "تعداد تلاش‌ها زیاد است؛ کمی بعد دوباره امتحان کنید.",
  USERNAME_REQUIRED: "نام کاربری الزامی است.",
  INVALID_USERNAME: "نام کاربری باید ۳ تا ۳۲ نویسه و فقط شامل حروف انگلیسی، عدد، نقطه، خط تیره یا زیرخط باشد.",
  USERNAME_ALREADY_EXIST: "این نام کاربری قبلاً انتخاب شده است.",
};

const signupErrors = new Set([
  "USER_ALREADY_EXIST",
  "AUTHENTICATION_FAILED_SIGN_UP",
  "INVALID_EMAIL_SIGN_UP",
  "REQUIRED_EMAIL_PASSWORD_SIGN_UP",
  "PASSWORD_TOO_WEAK",
  "SIGNUP_DISABLED",
  "USERNAME_REQUIRED",
  "INVALID_USERNAME",
  "USERNAME_ALREADY_EXIST",
]);

export default function AuthPage() {
  const [params] = useSearchParams();
  const errorKey = params.get("error_message") ?? "";
  const [mode, setMode] = useState<"login" | "signup">(() => (signupErrors.has(errorKey) ? "signup" : "login"));
  const [csrf, setCsrf] = useState("");
  const navigate = useNavigate();
  useEffect(() => {
    if (signupErrors.has(errorKey)) setMode("signup");
  }, [errorKey]);
  useEffect(() => {
    fetch("/api/users/me/", { credentials: "include" }).then((response) => {
      if (response.ok) navigate("/", { replace: true });
      return response;
    });
    fetch("/auth/get-csrf-token/", { credentials: "include" })
      .then((response) => response.json())
      .then((data: { csrf_token?: string }) => setCsrf(data.csrf_token ?? ""))
      .catch(() => setCsrf(""));
  }, [navigate]);
  return (
    <main className="auth-page">
      <section className="auth-showcase">
        <span className="brand-mark auth-brand-mark">
          <i />
          <i />
          <i />
        </span>
        <div>
          <p>مدیریت یکپارچه کار و تیم</p>
          <h1>هم‌کار؛ فضای کاری روشن، سریع و متمرکز</h1>
          <span>تمام پروژه‌ها، موعدها و اعضای تیم شما در یک محیط فارسی و امن.</span>
        </div>
      </section>
      <section className="auth-form-side">
        <form method="post" action={mode === "login" ? "/auth/sign-in/" : "/auth/sign-up/"} className="auth-card">
          <input type="hidden" name="csrfmiddlewaretoken" value={csrf} />
          <input type="hidden" name="next_path" value="/login" />
          <header>
            <span>{mode === "login" ? <LockKeyhole size={22} /> : <UserPlus size={22} />}</span>
            <div>
              <h2>{mode === "login" ? "ورود به هم‌کار" : "ساخت حساب جدید"}</h2>
              <p>{mode === "login" ? "برای ادامه وارد فضای کاری خود شوید." : "با ایمیل و رمز عبور حساب بسازید."}</p>
            </div>
          </header>
          {errorKey && <div className="auth-message error">{authErrors[errorKey] ?? "ورود یا ثبت‌نام انجام نشد."}</div>}
          {mode === "signup" && (
            <label>
              <span>نام کاربری</span>
              <input
                name="username"
                type="text"
                dir="ltr"
                minLength={3}
                maxLength={32}
                pattern="[A-Za-z0-9_.-]{3,32}"
                autoComplete="username"
                placeholder="armin.tavakoli"
                required
              />
            </label>
          )}
          <label>
            <span>ایمیل</span>
            <input name="email" type="email" dir="ltr" autoComplete="email" required />
          </label>
          <label>
            <span>رمز عبور</span>
            <input
              name="password"
              type="password"
              dir="ltr"
              minLength={8}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
            />
          </label>
          {mode === "signup" && (
            <small className="auth-password-hint">
              حداقل ۸ نویسه و ترکیبی از حروف بزرگ و کوچک، عدد و نماد وارد کنید.
            </small>
          )}
          <button className="button button-primary auth-submit" type="submit" disabled={!csrf}>
            {mode === "login" ? "ورود به حساب" : "ساخت حساب"}
            <ArrowLeft size={17} />
          </button>
          <footer>
            {mode === "login" ? "حساب ندارید؟" : "قبلاً حساب ساخته‌اید؟"}
            <button type="button" onClick={() => setMode(mode === "login" ? "signup" : "login")}>
              {mode === "login" ? "ثبت‌نام" : "ورود"}
            </button>
          </footer>
        </form>
      </section>
    </main>
  );
}
