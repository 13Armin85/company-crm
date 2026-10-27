"""Stable display identifiers for records backed by the entity engine."""


def format_record_number(entity, sequence):
    config = entity.numbering or {}
    prefix = str(config.get("prefix", entity.code.upper()))[:60]
    padding = max(0, min(12, int(config.get("padding", 5))))
    numeric = str(sequence).zfill(padding)
    # The canonical work entity uses the ticket-style prefix immediately before
    # the sequence. Historical identifiers stay exactly as they were issued.
    separator = "" if entity.code == "ticket" else "-"
    return f"{prefix}{separator}{numeric}"
