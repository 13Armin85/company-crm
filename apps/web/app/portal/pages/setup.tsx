/** One-time password set-up / reset from the link the company handed over (no e-mail is sent). */
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { portalError } from "../api/client";
import { usePortalSetup } from "../api/portal";
import { ErrorList } from "../components";

export const passwordErrors = (password: string, repeat: string) => {
  const errors: string[] = [];
  if (password.length < 10) errors.push("گذرواژه باید دست‌کم ۱۰ نویسه باشد.");
  if (password !== repeat) errors.push("تکرار گذرواژه یکسان نیست.");
  return errors;
};

export default function PortalSetup() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const setup = usePortalSetup();
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [tried, setTried] = useState(false);
  const errors = passwordErrors(password, repeat);
  if (setup.isSuccess)
    return (
      <section className="portal-card portal-login">
        <h1>گذرواژه ثبت شد</h1>
        <p>اکنون با نام کاربری «{setup.data.username}» وارد شوید.</p>
        <Link className="portal-button is-primary" to="/portal/login">
          ورود به درگاه
        </Link>
      </section>
    );
  return (
    <form
      className="portal-card portal-login"
      onSubmit={(event) => {
        event.preventDefault();
        setTried(true);
        if (!errors.length) setup.mutate({ token, password });
      }}
    >
      <h1>تعیین گذرواژهٔ درگاه</h1>
      {!token && <p className="portal-notice">پیوند ناقص است؛ پیوند کامل را از کارشناس شرکت بگیرید.</p>}
      <label>
        <span>گذرواژهٔ جدید</span>
        <input
          type="password"
          dir="ltr"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      <label>
        <span>تکرار گذرواژه</span>
        <input
          type="password"
          dir="ltr"
          autoComplete="new-password"
          value={repeat}
          onChange={(e) => setRepeat(e.target.value)}
        />
      </label>
      <ErrorList items={tried ? errors : []} />
      <ErrorList items={setup.error ? [portalError(setup.error, "ثبت گذرواژه انجام نشد.")] : []} />
      <button type="submit" className="portal-button is-primary" disabled={setup.isPending || !token}>
        ثبت گذرواژه
      </button>
    </form>
  );
}
