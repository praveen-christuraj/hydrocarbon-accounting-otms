"""
Sender / Receiver location pairing (Operation Entry clubbed dropdowns).

Product change (owner, 2026-10-18)
----------------------------------
The Operation Entry form now exposes exactly **two** location dropdowns
instead of four:

  * ``Sender``   - the location the movement starts from. One choice feeds
    **both** ``origin_location_code`` and ``sender_location_code``.
  * ``Receiver`` - the location the movement is addressed to. One choice
    feeds **both** ``destination_location_code`` and
    ``receiver_location_code``.

The four database columns stay exactly as they are (no drops, no renames, no
data loss) so every historical record keeps reading correctly. They are now
two views of the same value, which gives one invariant per pair::

    sender_location_code   == origin_location_code        (Sender)
    receiver_location_code == destination_location_code   (Receiver)

How existing data is handled ("utmost safety")
----------------------------------------------
Records created before this change only ever had one side of each pair
populated (usually ``origin`` / ``destination``; tracking receiver tickets
also had ``sender`` / ``receiver``). Nothing is rewritten on read. Instead:

  * :func:`resolve_sender_location_code` returns ``sender`` when it is
    populated and falls back to ``origin`` otherwise;
  * :func:`resolve_receiver_location_code` returns ``receiver`` when it is
    populated and falls back to ``destination`` otherwise.

Every read path (tracking modules, voyage aggregation, prefills) must go
through those two resolvers so old and new records behave identically.

New and edited records additionally get both columns of each pair written
(:func:`apply_sender_receiver_pairing`) so the columns stay individually
queryable, and ``ensure_sender_receiver_pairing_backfill`` (idempotent,
NULL-only) in ``app/utils/db_migrations.py`` aligns historical rows at
start-up.
"""

from app.utils.helpers import clean_optional_text


def _first_populated(*values):
    for value in values:
        cleaned = clean_optional_text(value)
        if cleaned is not None:
            return cleaned
    return None


def resolve_sender_location_code(transaction):
    """
    The single "Sender" location of a record: ``sender_location_code`` when
    it is populated, otherwise ``origin_location_code``.

    Works for records created before the clubbing (only ``origin`` set) and
    for new ones (both set to the same value).
    """
    if transaction is None:
        return None
    return _first_populated(
        getattr(transaction, "sender_location_code", None),
        getattr(transaction, "origin_location_code", None),
    )


def resolve_receiver_location_code(transaction):
    """
    The single "Receiver" location of a record: ``receiver_location_code``
    when it is populated, otherwise ``destination_location_code``.
    """
    if transaction is None:
        return None
    return _first_populated(
        getattr(transaction, "receiver_location_code", None),
        getattr(transaction, "destination_location_code", None),
    )


def resolve_location_pair(transaction):
    """Return ``(sender_code, receiver_code)`` using the pairing rules."""
    return (
        resolve_sender_location_code(transaction),
        resolve_receiver_location_code(transaction),
    )


def apply_sender_receiver_pairing(transaction):
    """
    Keep the two pairs in sync on an operation transaction (in place).

    Only blanks are ever filled - a column that already carries a value is
    never overwritten, so linked receiver tickets (where the server sets the
    sender side from the linked sender ticket) keep their values.

    Returns True when something changed.
    """
    if transaction is None:
        return False

    changed = False

    origin = clean_optional_text(getattr(transaction, "origin_location_code", None))
    sender = clean_optional_text(getattr(transaction, "sender_location_code", None))
    destination = clean_optional_text(
        getattr(transaction, "destination_location_code", None)
    )
    receiver = clean_optional_text(getattr(transaction, "receiver_location_code", None))

    if sender is None and origin is not None:
        transaction.sender_location_code = origin
        sender = origin
        changed = True

    if origin is None and sender is not None:
        transaction.origin_location_code = sender
        changed = True

    if receiver is None and destination is not None:
        transaction.receiver_location_code = destination
        receiver = destination
        changed = True

    if destination is None and receiver is not None:
        transaction.destination_location_code = receiver
        changed = True

    return changed
