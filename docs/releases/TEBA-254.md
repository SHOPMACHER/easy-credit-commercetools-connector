# TEBA-254 — TEBA-247 compatibility changes

Unreleased. This note describes the implemented behavior; production contract verification below is still outstanding.

## Availability and outages

- Installment activation and EUR limits now come from the easyCredit webshop configuration when it is available. Previously the connector always used 200 € to 10,000 €.
- Temporary failures (network errors, timeouts, `5xx`, `408`, `429`) retain the last valid configuration for at most one hour after its cache TTL expires. Without usable cached data, installment falls back to the previous 200 € to 10,000 € limits, subject to the block below. Bill payment is unavailable whenever stale or default data is used.
- A response disabling installment/the webshop blocks default fallback. Other `4xx` responses or malformed installment configuration discard cached data and also block fallback. Later transient errors cannot remove this block: only a valid webshop response can replace it. The block is stored in memory per webshop and resets on process restart. Once disabled data is too old to use, requests return `503 EasyCreditUnavailable`; a fresh disabled configuration returns `400 PaymentTypeNotAvailable`.
- Invalid or absent bill-only fields, including `null`, affect only bill availability. Missing `availability` is treated as `true` for compatibility and logged. Required installment flags and limits remain validated.
- Webshop requests time out after 10 seconds. The first failed fetch can incur that delay; subsequent retries run in the background after a 30-second retry window. `503` responses include `Retry-After` and `fields.webShopId` so the checkout can display its alert.

## API compatibility

- GET reports `paymentTypes`, but checkout and transaction creation still support only `INSTALLMENT_PAYMENT`. The optional POST `paymentType` defaults to installment; explicit `BILL_PAYMENT` requests return `400 PaymentTypeNotAvailable`. Bill checkout remains deferred to TEBA-248/249.
- Amount validation follows address and currency validation. `InvalidAmount` no longer appears in the same response as an address or currency error.
- `InvalidAmount` uses German (`de-DE`) number formatting, for example `10.000€` instead of `10,000€`.
- The shared easyCredit client error handler preserves upstream HTTP status even for non-JSON/null error bodies or non-string titles. Empty or invalid titles use `Unknown Error` / `An error occurred`. This also affects transaction create/read, merchant transaction reads and the integration check used by `/operations/health-check`; callers may now receive the upstream error status instead of a parsing-related `500`.
- Failed POST validation does not mutate the cart, even if it was already frozen. Cleanup after payment creation starts preserves the original error if unfreezing fails.

## Before release

- [ ] Record a sanitized response from a production (`testMode: false`) webshop confirming the installment fields, the presence/absence of `availability`, and that limits are EUR values.
- [ ] Confirm the production response for a merchant without bill activated, including whether `billPaymentActive`, `minBillingValue` and `maxBillingValue` are missing or `null`. Record the resulting installment availability. Automated fixtures with `null` bill fields do not establish the production contract.
