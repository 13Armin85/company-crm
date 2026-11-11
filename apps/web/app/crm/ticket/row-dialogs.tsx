/** Ticket dialogs opened from a list/kanban row menu (۶.۶ «حل در تماس», ۶.۷ «ارجاع»).
 * The ticket card is fetched only when a dialog opens; the server re-checks every action. */
import { ModalCore } from "@plane/ui";
import { useTicketCard } from "../api/ticket";
import { errorMessage } from "../api";
import { Button, Skeleton } from "../components";
import { ContactDialog, ReferDialog } from "./ticket-panel";

export type RowDialog = "contact" | "refer";

export function TicketRowDialog({ issueId, kind, onClose }: { issueId: string; kind: RowDialog; onClose: () => void }) {
  const card = useTicketCard(issueId);
  if (card.isLoading || card.error || !card.data)
    return (
      <ModalCore isOpen className="create-modal ticket-modal" handleClose={onClose}>
        <div className="ticket-dialog">
          {card.isLoading ? (
            <Skeleton rows={3} />
          ) : (
            <>
              <p className="ticket-error-text" role="alert">
                {errorMessage(card.error, "اطلاعات تیکت دریافت نشد.")}
              </p>
              <footer>
                <Button variant="secondary" onClick={onClose}>
                  بستن
                </Button>
                <Button onClick={() => void card.refetch()}>تلاش دوباره</Button>
              </footer>
            </>
          )}
        </div>
      </ModalCore>
    );
  if (kind === "contact") return <ContactDialog id={issueId} card={card.data} onClose={onClose} />;
  return <ReferDialog id={issueId} card={card.data} mode="refer" onClose={onClose} />;
}
