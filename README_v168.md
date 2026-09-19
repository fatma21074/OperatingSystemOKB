# OKB v168 — Dashboard Back + Bottom Label

Built directly on **v167**.

Changes only:
- Dashboard: removed the normal `↻ Refresh` button and put the unified `Back` button in the same position using `goBackToPreviousPage()` and the existing Back component/style.
- Dashboard: reused the existing branch bottom badge component to show `Dashboard` with the exact same font/background/color as branch names.
- Dashboard bottom badge intentionally has no Sticky Note message.

No SQL migration is required.
No financial, stock, commission, permissions, filter, treasury, Signed, or order workflow logic was changed.
