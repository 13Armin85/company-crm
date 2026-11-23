import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { CornerDownLeft, MessageSquareText, Send, X } from "lucide-react";
import { api, errorMessage } from "../api";
import { useUIStore } from "../store";
import { persianDate } from "../utils";

interface TaskNote {
  id: string;
  body: string;
  parent_id: string | null;
  author: { id: string; name: string };
  created_at: string;
}

export function TaskNotes({ id }: { id: string }) {
  const slug = useUIStore((state) => state.workspaceSlug);
  const client = useQueryClient();
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<TaskNote | null>(null);
  const key = ["task-notes", slug, id];
  const path = `/api/workspaces/${slug}/tasks/${id}/notes/`;
  const notes = useQuery({
    queryKey: key,
    enabled: Boolean(slug && id),
    queryFn: async () => (await api.get<{ results: TaskNote[] }>(path)).data.results,
    refetchInterval: 15_000,
  });
  const post = useMutation({
    mutationFn: async () => api.post(path, { body: body.trim(), ...(replyTo ? { parent_id: replyTo.id } : {}) }),
    onSuccess: async () => {
      setBody("");
      setReplyTo(null);
      await client.invalidateQueries({ queryKey: key });
    },
  });
  const rows = notes.data ?? [];
  return (
    <section className="task-notes" aria-label="یادداشت‌های کار">
      <header className="task-notes-heading">
        <span className="task-notes-heading-icon">
          <MessageSquareText size={20} aria-hidden="true" />
        </span>
        <span>
          <h3>گفت‌وگوی کار</h3>
          <small>یادداشت‌ها و پاسخ‌ها برای همهٔ افراد این کار دیده می‌شود.</small>
        </span>
        <span className="task-notes-count" aria-label={`${rows.length.toLocaleString("fa-IR")} یادداشت`}>
          {rows.length.toLocaleString("fa-IR")}
        </span>
      </header>
      {notes.isLoading && <p className="task-notes-state">در حال دریافت یادداشت‌ها…</p>}
      {notes.error && (
        <p className="task-notes-state" role="alert">
          {errorMessage(notes.error, "دریافت یادداشت‌ها انجام نشد.")}
        </p>
      )}
      {!notes.isLoading && !notes.error && rows.length === 0 && (
        <p className="task-notes-state">هنوز گفت‌وگویی ثبت نشده است. اولین یادداشت را بنویسید.</p>
      )}
      <div className="task-notes-thread">
        {rows.map((item) => (
          <article className={item.parent_id ? "task-note task-note-reply" : "task-note"} key={item.id}>
            <span className="task-note-avatar" aria-hidden="true">
              {item.author.name.trim().slice(0, 1) || "؟"}
            </span>
            <div className="task-note-content">
              <header>
                <strong>{item.author.name}</strong>
                <time dateTime={item.created_at}>
                  {persianDate(item.created_at, { hour: "2-digit", minute: "2-digit" })}
                </time>
              </header>
              {item.parent_id && (
                <small className="task-note-context">
                  <CornerDownLeft size={13} aria-hidden="true" /> پاسخ به{" "}
                  {rows.find((row) => row.id === item.parent_id)?.author.name || "یادداشت قبلی"}
                </small>
              )}
              <p>{item.body}</p>
              <button className="task-note-reply-button" type="button" onClick={() => setReplyTo(item)}>
                <CornerDownLeft size={14} aria-hidden="true" /> پاسخ دادن
              </button>
            </div>
          </article>
        ))}
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (body.trim() && !post.isPending) post.mutate();
        }}
      >
        {replyTo && (
          <div className="task-note-reply-target">
            <span>
              <CornerDownLeft size={14} aria-hidden="true" /> پاسخ به {replyTo.author.name}
            </span>
            <button type="button" aria-label="لغو پاسخ" onClick={() => setReplyTo(null)}>
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        )}
        <label htmlFor={`task-note-${id}`}>{replyTo ? "پاسخ خود را بنویسید" : "یادداشت جدید"}</label>
        <textarea
          id={`task-note-${id}`}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          maxLength={10000}
          placeholder="متن یادداشت را اینجا بنویسید…"
          required
        />
        {post.error && <p role="alert">{errorMessage(post.error, "ثبت یادداشت انجام نشد.")}</p>}
        <button className="task-notes-submit" type="submit" disabled={!body.trim() || post.isPending}>
          <Send size={15} aria-hidden="true" /> {post.isPending ? "در حال ثبت…" : replyTo ? "ثبت پاسخ" : "ثبت یادداشت"}
        </button>
      </form>
    </section>
  );
}
