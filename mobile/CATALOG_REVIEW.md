# Product review (1.49.0)

## Workspace restore and Undo

- The APK and PWA save the current navigation stack, catalog filters, and unsaved manual product details per logged-in user.
- Reopening the app restores the saved screen and draft on the same device.
- `ANULEAZĂ` restores up to the last 100 local UI steps. Confirmed API operations remain final and are never replayed or reversed by local Undo.

Open **Produse de verificat** from the APK home screen. The menu is available
to administrators and users granted the **items** page permission in Sentry.
Pending products, including unsuccessful or ambiguous TecDoc lookups, remain
in this list. Search by scanned EAN, SKU or product name.

Open a product to retry TecDoc by EAN or manufacturer/OE reference, or enter
its name, brand, manufacturer code, category, description, EANs, product
photos and OE/equivalent references manually. Product photos can be taken with
the camera or chosen from the device, are stored by Sentry, and can be removed
before saving. A saved product moves to
**Completate manual**, where its details can be edited again. Manual entries
do not invent TecDoc article IDs and are excluded from automatic matching.
Local prices continue to be managed in Sentry Web.

**Echivalează toate în TecDoc** processes a snapshot of every pending product,
including those on other pages or outside the current search. Progress counts
confirmed batch results; unique EAN matches are saved, while unmatched,
ambiguous, invalid-code and failed products stay available for review.
Keep the screen open. Stop takes effect after the current batch; backgrounding
the APK also stops further batches. Restarting processes the still-pending
products. A connection failure stops the run because the in-flight batch may
already have saved results. Reopen/refresh the list before retrying.
