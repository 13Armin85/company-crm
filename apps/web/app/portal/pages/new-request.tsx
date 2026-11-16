/** New support request: subject, description and files. */
import { useState } from "react";
import { useNavigate } from "react-router";
import { portalError } from "../api/client";
import { useCreatePortalRequest, usePortalSession } from "../api/portal";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { Link } from "react-router";
import { ErrorList, FilePicker, PortalCard } from "../components";
import { fileErrors, requestErrors } from "../model";

export default function PortalNewRequest() {
  const create = useCreatePortalRequest();
  const session = usePortalSession();
  const subjectField = session.data?.request_form?.subject;
  const descriptionField = session.data?.request_form?.description;
  const navigate = useNavigate();
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [tried, setTried] = useState(false);
  const errors = requestErrors(subject, description);
  return (
    <PortalCard title="ثبت درخواست پشتیبانی">
      <Link className="portal-back" to="/portal">
        <ArrowRight size={16} /> بازگشت به درخواست‌ها
      </Link>
      <p className="portal-muted">موضوع را کوتاه بنویسید و در شرح، مشکل و نتیجه‌ای را که انتظار دارید توضیح دهید.</p>
      <form
        noValidate
        className="portal-form"
        onSubmit={(event) => {
          event.preventDefault();
          setTried(true);
          if (create.isPending || errors.length || fileErrors(files).length) return;
          create.mutate(
            { subject: subject.trim(), description: description.trim(), files },
            { onSuccess: (data) => navigate(`/portal/requests/${data.id}`, { replace: true }) }
          );
        }}
      >
        <label>
          <span>
            {subjectField?.title || "موضوع"} <b aria-hidden="true">*</b>
          </span>
          <input
            value={subject}
            required
            aria-invalid={tried && subject.trim().length < 3}
            placeholder={subjectField?.placeholder || "مثلاً: خطا هنگام چاپ فاکتور فروش"}
            maxLength={200}
            onChange={(event) => setSubject(event.target.value)}
          />
          {subjectField?.help_text && <small className="portal-muted">{subjectField.help_text}</small>}
        </label>
        <label>
          <span>
            {descriptionField?.title || "شرح درخواست"} <b aria-hidden="true">*</b>
          </span>
          <textarea
            rows={7}
            required
            placeholder={
              descriptionField?.placeholder ||
              "چه کاری انجام می‌دادید؟ چه پیامی نمایش داده شد؟ از چه زمانی این مشکل شروع شده است؟"
            }
            value={description}
            maxLength={5000}
            onChange={(event) => setDescription(event.target.value)}
          />
          {descriptionField?.help_text && <small className="portal-muted">{descriptionField.help_text}</small>}
        </label>
        <FilePicker files={files} onChange={setFiles} disabled={create.isPending} />
        <p className="portal-form-assurance">
          <ShieldCheck size={17} /> درخواست برای تیم پشتیبانی شرکت شما ثبت می‌شود و از همین درگاه قابل پیگیری است.
        </p>
        <ErrorList items={tried ? errors : []} />
        <ErrorList items={create.error ? [portalError(create.error, "ثبت درخواست انجام نشد.")] : []} />
        <button type="submit" className="portal-button is-primary" disabled={create.isPending}>
          {create.isPending ? "در حال ثبت…" : "ثبت درخواست"}
        </button>
      </form>
    </PortalCard>
  );
}
