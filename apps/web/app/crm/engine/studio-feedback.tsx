import { AlertCircle, RefreshCw } from "lucide-react";
import { errorMessage } from "../api";
import { localizeError } from "../error-messages";

export interface StudioIssue {
  path: string;
  label: string;
  message: string;
}
export function studioIssues(error: unknown): StudioIssue[] {
  const data = (error as { response?: { data?: { errors?: unknown } } })?.response?.data;
  if (!Array.isArray(data?.errors)) return [];
  return data.errors.flatMap((value: unknown) => {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>;
    return typeof item.path === "string" && typeof item.message === "string"
      ? [
          {
            path: item.path,
            label: typeof item.label === "string" ? localizeError(item.label, "تنظیمات") : "تنظیمات",
            message: localizeError(item.message, "این مقدار معتبر نیست؛ ورودی را اصلاح کنید."),
          },
        ]
      : [];
  });
}
export const studioInputError = (error: unknown, path: string) =>
  studioIssues(error).find((issue) => issue.path === path)?.message;
export function StudioError({
  error,
  fallback,
  retry,
  preservesDraft = false,
}: {
  error: unknown;
  fallback: string;
  retry?: () => void;
  preservesDraft?: boolean;
}) {
  const code = (error as { code?: string })?.code;
  const message =
    code === "ECONNABORTED" || code === "ETIMEDOUT"
      ? "دریافت پاسخ بیش از حد طول کشید؛ اتصال را بررسی و دوباره تلاش کنید."
      : errorMessage(error, fallback);
  const issues = studioIssues(error).filter((issue) => issue.message !== message);
  return (
    <div className="studio-error" role="alert">
      <AlertCircle size={20} aria-hidden="true" />
      <div>
        <strong>{message}</strong>
        {issues.length > 0 && (
          <ul>
            {issues.map((issue) => (
              <li key={`${issue.path}:${issue.message}`}>
                {issue.label}: {issue.message}
              </li>
            ))}
          </ul>
        )}
        {preservesDraft && <p>تغییرات ذخیره‌نشده شما حفظ شده است.</p>}
        {retry && (
          <button type="button" onClick={retry}>
            <RefreshCw size={14} /> تلاش دوباره
          </button>
        )}
      </div>
    </div>
  );
}
