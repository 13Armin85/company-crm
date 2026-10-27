import { Link } from "react-router";

export type DuplicateDetail = { message: string; record_url?: string | null; inactive?: boolean };

export function duplicateDetails(error: unknown): DuplicateDetail[] {
  const duplicates = (error as { response?: { data?: { duplicates?: unknown } } })?.response?.data?.duplicates;
  return Array.isArray(duplicates)
    ? duplicates.filter((item): item is DuplicateDetail =>
        Boolean(item && typeof item === "object" && typeof item.message === "string")
      )
    : [];
}

export function DuplicateFeedback({ details }: { details: DuplicateDetail[] }) {
  if (!details.length) return null;
  return (
    <div role="alert">
      {details.map((detail) => (
        <p key={`${detail.record_url || ""}:${detail.message}`}>
          {detail.message}{" "}
          {detail.record_url?.startsWith("/entities/") && <Link to={detail.record_url}>مشاهده رکورد موجود</Link>}
        </p>
      ))}
    </div>
  );
}
