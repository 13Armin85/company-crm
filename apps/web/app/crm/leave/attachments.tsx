/** Leave request attachments: drop zone, upload progress and file cards.
 * Files are private on the server; the client pre-checks type, size and count only for quick feedback. */
import { useId, useRef, useState } from "react";
import type { DragEvent } from "react";
import {
  File as FileIcon,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType2,
  Loader2,
  Paperclip,
  UploadCloud,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useUploadLeaveAttachment } from "../api/leave";
import type { LeaveAttachment } from "../api/leave";
import {
  MAX_ATTACHMENTS,
  acceptAttribute,
  attachmentHint,
  attachmentKind,
  checkAttachments,
  fileExtension,
  fileSize,
} from "./model";
import type { AttachmentConfig, AttachmentKind } from "./model";

const KIND_ICONS: Record<AttachmentKind, LucideIcon> = {
  pdf: FileType2,
  image: FileImage,
  sheet: FileSpreadsheet,
  doc: FileText,
  text: FileText,
  other: FileIcon,
};

export interface PendingUpload {
  key: number;
  name: string;
  size: number;
}

/** Uploads files one by one; each finished file is reported through ``onUploaded``. */
export function useAttachmentUploads(onUploaded: (item: LeaveAttachment) => void) {
  const upload = useUploadLeaveAttachment();
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const counter = useRef(0);
  const add = (files: File[]) => {
    for (const file of files) {
      counter.current += 1;
      const key = counter.current;
      setPending((rows) => [...rows, { key, name: file.name, size: file.size }]);
      upload
        .mutateAsync(file)
        .then(onUploaded)
        .catch(() => undefined) // the hook already shows the server's message
        .finally(() => setPending((rows) => rows.filter((row) => row.key !== key)));
    }
  };
  return { pending, add };
}

function FileCard({
  name,
  size,
  href,
  busy,
  onRemove,
}: {
  name: string;
  size: number;
  href?: string;
  busy?: boolean;
  onRemove?: () => void;
}) {
  const kind = attachmentKind(name);
  const Icon = busy ? Loader2 : KIND_ICONS[kind];
  const ext = fileExtension(name).toUpperCase();
  return (
    <li className={`leave-file${busy ? " leave-file-busy" : ""}`} aria-busy={busy || undefined}>
      <span className={`leave-file-icon leave-file-icon-${busy ? "busy" : kind}`} aria-hidden="true">
        <Icon size={18} />
      </span>
      <span className="leave-file-meta">
        {href ? (
          <a className="leave-file-name" href={href} dir="auto" title={name}>
            {name}
          </a>
        ) : (
          <span className="leave-file-name" dir="auto" title={name}>
            {name}
          </span>
        )}
        <small>
          {busy ? (
            "در حال بارگذاری…"
          ) : (
            <>
              {fileSize(size)}
              {ext && (
                <>
                  {" · "}
                  {/* Isolated so the Latin format name never reorders the Persian size. */}
                  <bdi>{ext}</bdi>
                </>
              )}
            </>
          )}
        </small>
      </span>
      {onRemove && !busy && (
        <button
          type="button"
          className="leave-file-remove"
          aria-label={`حذف «${name}» از درخواست`}
          title="حذف از درخواست"
          onClick={onRemove}
        >
          <X size={16} />
        </button>
      )}
    </li>
  );
}

/** Read-only list (summary, signed versions). */
export function AttachmentList({ items, hrefFor }: { items: LeaveAttachment[]; hrefFor?: (id: string) => string }) {
  if (!items.length) return <span className="workflow-muted">بدون پیوست</span>;
  return (
    <ul className="leave-files">
      {items.map((item) => (
        <FileCard key={item.id} name={item.name} size={item.size} href={hrefFor?.(item.id)} />
      ))}
    </ul>
  );
}

export function LeaveAttachments({
  items,
  pending = [],
  config,
  disabled,
  hrefFor,
  onAdd,
  onRemove,
}: {
  items: LeaveAttachment[];
  pending?: PendingUpload[];
  config?: AttachmentConfig;
  disabled?: boolean;
  hrefFor?: (id: string) => string | undefined;
  onAdd?: (files: File[]) => void;
  onRemove?: (id: string) => void;
}) {
  const inputId = useId();
  const hintId = useId();
  const [dragging, setDragging] = useState(false);
  const [rejected, setRejected] = useState<string[]>([]);
  const used = items.length + pending.length;
  const full = used >= MAX_ATTACHMENTS;
  const editable = Boolean(onAdd) && !disabled;
  const take = (list: FileList | null) => {
    if (!list?.length || !onAdd) return;
    const { accepted, rejected: reasons } = checkAttachments(Array.from(list), used, config);
    setRejected(reasons);
    if (accepted.length) onAdd(accepted);
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (editable && !full) take(event.dataTransfer.files);
  };
  return (
    <div className="leave-attachments-field">
      <div className="leave-attachments-head">
        <label htmlFor={editable ? inputId : undefined}>
          <Paperclip size={15} aria-hidden="true" /> پیوست‌ها
        </label>
        <small aria-live="polite">
          {used.toLocaleString("fa-IR")} از {MAX_ATTACHMENTS.toLocaleString("fa-IR")}
        </small>
      </div>
      {editable && (
        <div
          className={`leave-dropzone${dragging ? " is-dragging" : ""}${full ? " is-full" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            if (!full) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <UploadCloud size={26} aria-hidden="true" />
          <strong>{full ? "به سقف تعداد پیوست رسیده‌اید" : "فایل را اینجا رها کنید یا برای انتخاب کلیک کنید"}</strong>
          <small id={hintId}>{attachmentHint(config)}</small>
          <input
            id={inputId}
            type="file"
            multiple
            accept={acceptAttribute(config)}
            disabled={full}
            aria-describedby={hintId}
            onChange={(event) => {
              take(event.target.files);
              event.target.value = "";
            }}
          />
        </div>
      )}
      {rejected.length > 0 && (
        <ul className="leave-blockers" role="alert">
          {rejected.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
      )}
      {items.length + pending.length > 0 ? (
        <ul className="leave-files">
          {items.map((item) => (
            <FileCard
              key={item.id}
              name={item.name}
              size={item.size}
              href={hrefFor?.(item.id)}
              onRemove={editable && onRemove ? () => onRemove(item.id) : undefined}
            />
          ))}
          {pending.map((row) => (
            <FileCard key={`pending-${row.key}`} name={row.name} size={row.size} busy />
          ))}
        </ul>
      ) : (
        !editable && <span className="workflow-muted">بدون پیوست</span>
      )}
      {editable && items.length > 0 && (
        <small className="workflow-muted">
          حذف فقط پیوند فایل با این نسخه را برمی‌دارد؛ فایل‌های نسخه‌های امضاشده دست نمی‌خورند.
        </small>
      )}
    </div>
  );
}
