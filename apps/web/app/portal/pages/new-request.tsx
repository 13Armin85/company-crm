/** New support request: subject, description and files. */
import { useState } from "react";
import { useNavigate } from "react-router";
import { portalError } from "../api/client";
import { useCreatePortalRequest } from "../api/portal";
import { ErrorList, FilePicker, PortalCard } from "../components";
import { fileErrors, requestErrors } from "../model";

export default function PortalNewRequest() {
  const create = useCreatePortalRequest();
  const navigate = useNavigate();
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [tried, setTried] = useState(false);
  const errors = requestErrors(subject, description);
  return (
    <PortalCard title="ثبت درخواست پشتیبانی">
      <form
        className="portal-form"
        onSubmit={(event) => {
          event.preventDefault();
          setTried(true);
          if (errors.length || fileErrors(files).length) return;
          create.mutate(
            { subject: subject.trim(), description: description.trim(), files },
            { onSuccess: (data) => navigate(`/portal/requests/${data.id}`, { replace: true }) }
          );
        }}
      >
        <label>
          <span>موضوع</span>
          <input value={subject} maxLength={200} onChange={(event) => setSubject(event.target.value)} />
        </label>
        <label>
          <span>شرح درخواست</span>
          <textarea
            rows={7}
            value={description}
            maxLength={5000}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <FilePicker files={files} onChange={setFiles} disabled={create.isPending} />
        <ErrorList items={tried ? errors : []} />
        <ErrorList items={create.error ? [portalError(create.error, "ثبت درخواست انجام نشد.")] : []} />
        <button type="submit" className="portal-button is-primary" disabled={create.isPending}>
          {create.isPending ? "در حال ثبت…" : "ثبت درخواست"}
        </button>
      </form>
    </PortalCard>
  );
}
