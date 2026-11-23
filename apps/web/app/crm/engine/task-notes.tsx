import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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
      <h3>یادداشت‌ها</h3>
      {notes.isLoading && <p>در حال دریافت یادداشت‌ها…</p>}
      {notes.error && <p role="alert">{errorMessage(notes.error, "دریافت یادداشت‌ها انجام نشد.")}</p>}
      {!notes.isLoading && !notes.error && rows.length === 0 && <p>هنوز یادداشتی ثبت نشده است.</p>}
      {rows.map((item) => (
        <article className={item.parent_id ? "task-note task-note-reply" : "task-note"} key={item.id}>
          <header>
            <strong>{item.author.name}</strong>
            <time dateTime={item.created_at}>
              {persianDate(item.created_at, { hour: "2-digit", minute: "2-digit" })}
            </time>
          </header>
          {item.parent_id && (
            <small>در پاسخ به {rows.find((row) => row.id === item.parent_id)?.author.name || "یادداشت قبلی"}</small>
          )}
          <p>{item.body}</p>
          <button type="button" onClick={() => setReplyTo(item)}>
            پاسخ
          </button>
        </article>
      ))}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (body.trim() && !post.isPending) post.mutate();
        }}
      >
        {replyTo && (
          <div className="task-note-reply-target">
            پاسخ به {replyTo.author.name}
            <button type="button" onClick={() => setReplyTo(null)}>
              لغو پاسخ
            </button>
          </div>
        )}
        <label htmlFor={`task-note-${id}`}>یادداشت جدید</label>
        <textarea
          id={`task-note-${id}`}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          maxLength={10000}
          required
        />
        {post.error && <p role="alert">{errorMessage(post.error, "ثبت یادداشت انجام نشد.")}</p>}
        <button type="submit" disabled={!body.trim() || post.isPending}>
          ثبت یادداشت
        </button>
      </form>
    </section>
  );
}
