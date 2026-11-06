# Changelog

Notable changes to the easyCredit commercetools connector (processor and enabler). Versions match git tags from `1.1.0` onward; earlier changes are not listed.

## [Unreleased]

Planned release: `1.1.0` for both processor and enabler. Deploy both from the same build.

### Upgrade notes

Pay by invoice remains disabled until `BILL_PAYMENT_ENABLED=1`. Existing installment request fields are retained, but responses and transaction states change. Review the scope requirements and upgrade notes below:

- **Breaking:** Capture and refund require one of these token scopes: `manage_payments`, `manage_checkout_payment_intents` or `manage_project`. Tokens without them receive `401 invalid_token`, with accepted scopes in `fields.validAuthorities`; previously, any valid project token was accepted. Check the API client used for these calls.

- Run the post-deploy script to add `easyCreditEarlierCaptureBookings` (set of strings) to the transaction custom type. Without it, adding a new `Charge` after an earlier one fails with a commercetools `400` if easyCredit lists a capture booking; no capture request is sent. See [Configuration](#configuration).

- Refunds without an easyCredit booking remain `Initial` or `Pending` and reserve their amount indefinitely; only a `DONE` or `FAILED` booking completes them. This includes legacy refunds booked under an older `Initial` refund's ID. Booking reads during capture, refund or notification processing log these cases as warnings; refund requests exceeding the remaining amount return `400 InvalidRefundAmount` with `fields.openRefunds`. Reconcile them against the easyCredit merchant portal and update their state through the commercetools API; see [Refund Payment](docs/RefundPayment.md#process).

- Installment now reads its limits from `GET /payment/v3/webshop/{webShopId}` using the existing credentials. If easyCredit rejects this request, for example with `401` or `404`, payment-method lookup and payment creation return `503 EasyCreditUnavailable` for both payment types. Verify that the webshop ID and API password work with this endpoint; see [Changed](#changed).

- Monitor `EASYCREDIT_AUTHORIZED_CT_NOT_SUCCESS` for easyCredit authorizations that do not reach `Success` in commercetools, and `EASYCREDIT_AUTHORIZATION_SENT_ATTEMPT_DISCARDED` for attempts failed concurrently after authorization was sent, for example by a new create call, cancellation or declined callback. The merchant must investigate these events because easyCredit may have authorized the payment and the connector does not automatically void it. See [Authorize Payment](docs/AuthorizePayment.md#error-responses) and [Cancel Payment](docs/CancelPayment.md#conditions).

Response corrections to account for when upgrading; see [Fixed](#fixed):

- Rejected or unanswered capture requests return an error instead of the previous misleading `204`.
- Rejected or unanswered authorization requests return an error instead of the previous misleading `204` and `Pending` state.
- Payment-method lookup and payment creation reject invalid addresses earlier (`InvalidAddress`, `AddressesUnmatched` for `additionalStreetInfo`); the enabler still shows these address errors as widget alerts. Payment creation also rejects a second payment while an earlier attempt is open (`PaymentInProgress`).
- `GET /payments/{paymentId}` omits `decision` fields received as `null`, previously serialized as `0` or `{}`.
- Refunds exceeding two decimal places or the remaining refundable amount return `400 InvalidRefundAmount`. Previously, amounts were sent unrounded and excessive refunds failed later.
- The authorization callback checks amounts and handles declined, repeated and failed transactions.

### Added

**Pay by invoice**

- Pay by invoice (`BILL_PAYMENT`) alongside installment for private customers with German addresses, with both methods supported on the same checkout page. `paymentMethodInfo.method` is `BILL_PAYMENT` for invoice and remains `easycredit` for installment; new payments receive the German name `easyCredit Rechnung` or `easyCredit Ratenkauf` in `paymentMethodInfo.name.de`.
- Pay by invoice requires activation and billing limits in fresh easyCredit webshop data; stale data and fixed limits cannot enable it. Requests return `400` for:
  - a cart with a `businessUnit`, or a billing or shipping address with a `company` (`CorporateCustomerNotAllowed`),
  - any shipping destination that differs from the billing address, including item addresses in multiple shipping (`AddressesUnmatched`),
  - product types or custom line items excluded by `BILL_PAYMENT_EXCLUDED_PRODUCT_TYPES` or `BILL_PAYMENT_EXCLUDED_CUSTOM_LINE_ITEMS` (`BillPaymentExcludedItems`); failed product type lookups return `503 BillPaymentCheckFailed`.
- `400 PaymentTypeNotAvailable` for methods disabled in the connector or at easyCredit; `InvalidAmount` applies only to enabled methods.
- Optional `paymentType` query parameter on `GET /payments/payment-method/{cartId}` and body field on `POST /payments`. Invalid values return `400 InvalidField` for the query and `400 InvalidJsonInput` for the body.
- `paymentTypes` in the payment-method response, exposing `available`, `minAmount` and `maxAmount` for `INSTALLMENT_PAYMENT` and `BILL_PAYMENT`.
- `paymentType` in the `GET /payments/{paymentId}` response.
- Switching between installment and pay by invoice on the easyCredit page. `BILL_PAYMENT_ENABLED=1` sets `paymentSwitchPossible: true` for every new payment, including carts ineligible for invoice; commercetools records the method and name reported by easyCredit.
- After a switch, Get Payment and Authorize Payment revalidate the cart only when easyCredit is `PREAUTHORIZED` and the commercetools transaction is `Initial`. Definitive cart errors or invoice disabled in the connector fail the transaction and unfreeze the cart; other errors leave it `Initial` and frozen for retry. Type synchronization skips this validation for `Pending` or `Success` transactions, or when easyCredit is `AUTHORIZED`. See [Authorize Payment](docs/AuthorizePayment.md#sync-the-final-payment-type).
- A missing or invalid easyCredit payment type returns `502 PaymentTypeUnknown` only for a stored `BILL_PAYMENT` with easyCredit status `PREAUTHORIZED` and commercetools state `Initial`. Otherwise, the stored type is retained; see [Authorize Payment](docs/AuthorizePayment.md#easycredit-sends-no-payment-type).
- Capture and full, partial and repeated refunds for pay by invoice, including refunds before capture.

**Other**

- Installment interest and total value in the `Authorization` custom fields `easyCreditInterest` and `easyCreditTotalValue`. Get Payment, Authorize Payment and the callback record available values, logging write failures; these fields are removed after a switch to invoice and excluded from the `Charge`.
- `easyCreditEarlierCaptureBookings` on `Charge` transactions, recording capture bookings listed before the charge was added.
- Optional `waitForAuthorization` on Authorize Payment: `true` waits for easyCredit `AUTHORIZED` and commercetools `Success`, with a 30-second deadline from the start of the call (`504 AuthorizationTimeout`). Authorization errors still apply, including `400 TransactionNotPreauthorized` and `400 AmountMismatch`.
- Enabler:
  - `paymentType` build option for checkout, label and summary: `INSTALLMENT_PAYMENT` (default) or `BILL_PAYMENT`, with exported types `PaymentType` and `LabelComponentOptions`. Unknown values throw during construction.
  - Optional `CheckoutComponent.isAvailable()` to check whether a method can be offered, preserving compatibility with existing implementations and test doubles. Installment remains available outside its amount limits and shows an alert; deactivation or request failures make it unavailable.
  - Unavailable invoice checkout mounts no widget and does not load the easyCredit script.
  - Checkout sends `paymentType` in payment-method queries and payment creation; summary uses the type returned by Get Payment and a separate message for declined invoice payments.

### Changed

- Installment limits now come from the webshop configuration. During transient failures (timeout, `5xx`, `408`, `429`), cached limits remain usable for `WEBSHOP_CACHE_TTL` plus one hour, then fall back to €200–€10,000; invalid configuration uses these defaults immediately. A rejected webshop request, such as `401` or `404`, blocks fallback and returns `503 EasyCreditUnavailable` with `Retry-After`. Known deactivation also blocks fallback: during an outage it returns `400 PaymentTypeNotAvailable` until the cached data is older than `WEBSHOP_CACHE_TTL` plus one hour, then `503`. This also affects Get Payment and Authorize Payment after a type switch.
- `InvalidAmount` messages use German amount formatting, for example `10.000€`.
- Payment creation leaves the cart untouched on validation, availability or `PaymentInProgress` errors before freezing. Later failures unfreeze it and remove any newly attached payment whose creation failed; cleanup errors preserve the original error.
- Get Payment now updates commercetools with payment-type switches and interest fields; see [Added](#added).
- `POST /payments/{paymentId}/authorize`:
  - Returns `204` for an existing `Success` transaction, or completes an `Initial` or `Pending` transaction already `AUTHORIZED` at easyCredit. Previously, these returned `400 TransactionNotPreauthorized`.
  - Does not resend `Pending` authorizations; `Failure` returns `400 TransactionNotPreauthorized` without calling easyCredit.
  - Without `waitForAuthorization`, still returns after sending the request, but status lookup and authorization share a 30-second deadline; a slow lookup returns `504 AuthorizationTimeout`.
  - Returns `400 TransactionNotAuthorized` if a concurrent payment-creation request discarded the attempt.
- Repeated capture returns `204` for an existing `Success` charge. Other existing charges require a booking lookup; network errors or timeouts return `502` or `504` with `CaptureFailed`, while first capture reads bookings only for open refunds and tolerates lookup failures. For a `Pending` charge, `DONE` completes it, its own `FAILED` booking fails it and starts another capture, its own `PENDING` booking returns `204`, and no matching booking triggers a resend on the same charge. easyCredit accepts one capture per transaction and answers further requests with `409`: without an earlier capture, this leaves the charge `Pending` with `204`; otherwise, the `409` is returned. See [Capture Payment](docs/CapturePayment.md#workflow).
- New Refund transactions include a `timestamp`.
- Notifications also complete `Initial` refunds and log easyCredit failure reasons. Failed capture bookings create no charge when none is pending; transactions without `bookings` are ignored.
- Non-JSON easyCredit errors retain their HTTP status instead of becoming `500`.

### Fixed

**Capture** (`POST /payments/{paymentId}/capture`)

- Rejected captures return the easyCredit error and mark the charge `Failure`. Timeouts (10 seconds), network failures and `5xx` responses return `504`, `502` or the upstream status while keeping it `Pending`, since easyCredit may have booked it. Previously, these failures returned `204` without recording a charge; both cases now allow retry.
- Pre-capture transaction lookup has a 10-second timeout. Network failures and timeouts return `502` or `504` with `CaptureFailed` without adding a charge.
- The `Pending` charge is recorded before calling easyCredit, allowing early notifications to find it.
- Failed capture bookings now mark the charge `Failure` instead of `Success`. Existing `Success` charges are unchanged, may represent failed captures and cannot be recaptured through the API; reconcile doubtful cases against the merchant portal.
- Failed bookings from earlier attempts no longer fail a new charge, even before its booking appears. `easyCreditEarlierCaptureBookings` identifies earlier bookings by ID rather than date.
- A pending charge with no matching capture booking can be retried on the same charge; see [Changed](#changed).
- `trackingNumber` is limited to 50 characters; longer values return `400 InvalidJsonInput`.

**Refund** (`POST /payments/{paymentId}/refund`)

- Timeouts (10 seconds), network failures and `5xx` responses leave refunds `Pending` for notification processing, since easyCredit may still book them. The response remains `202` with the payment; do not resend, as each request creates a separate refund.
- Missed refund notifications are recovered from bookings on a later capture or refund request, or a manual call to `GET /easycredit-notification?vorgangskennung={easyCredit transaction ID}`. Refunds remain open without a trigger or booking; see [Upgrade notes](#upgrade-notes).
- Each refund uses its own transaction ID as `bookingId`, preventing older `Initial` refunds from redirecting later updates.
- Concurrent payment updates no longer leave accepted refunds stuck in `Initial`.
- Combined capture and refund notifications no longer cause version conflicts that leave refunds `Pending`.
- Sent and stored refund amounts now match, with rounding preventing lost cents from floating-point truncation. Previously, `10.005` was stored as `1000` cents but sent unchanged, and `0.001` created a zero-cent refund.
- Refunds above the remaining amount are rejected before calling easyCredit; non-positive amounts or more than two decimal places are rejected before reading payment data or calling easyCredit.

**Authorize** (`POST /payments/{paymentId}/authorize`)

- Rejected authorization requests now return the easyCredit status and error; network failures and timeouts return `502` or `504` with `AuthorizationFailed`. The transaction remains `Initial`, replacing the previous misleading `204` and `Pending` state.
- `DECLINED` or `EXPIRED` sets the transaction to `Failure` and unfreezes the cart; the response remains `400 TransactionNotPreauthorized`.
- An unfrozen cart or a mismatch between cart, transaction and easyCredit amounts fails authorization with `400 AmountMismatch` and unfreezes the cart. Once easyCredit reports `AUTHORIZED`, `Ordered` carts are accepted and deleted carts require only transaction/easyCredit amount checks, allowing orders created immediately after `204` to complete authorization.
- Invoice address and company rules are rechecked on the frozen cart before authorization; violations fail the transaction, unfreeze the cart and return `400`.

**Callback** (`GET /webhook/{paymentId}/authorize`)

- Existing `Success` transactions receive a successful response instead of `400 InvalidPaymentTransaction`.
- Accepts both `Initial` and `Pending`; `Failure` returns `400 TransactionNotAuthorized` instead of `400 InvalidPaymentTransaction`.
- `DECLINED` or `EXPIRED` fails the transaction and unfreezes the cart.
- `AUTHORIZED` applies the authorization amount check (`Failure` and `400 AmountMismatch` on mismatch), then records payment type and interest.
- Concurrent authorization calls and callbacks preserve final `Success` and `Failure` states. Allowed transitions are `Initial` to `Pending`, `Success` or `Failure`, and `Pending` to `Success` or `Failure`.

**Cancel** (`GET /webhook/{paymentId}/cancel`)

- Cancellation now proceeds when easyCredit no longer knows the transaction (`404` or `410`), setting it to `Failure` and unfreezing the cart.
- Cancelling a `Pending` transaction triggers a status recheck with a 5-second timeout. A late authorization logs `EASYCREDIT_AUTHORIZED_CT_NOT_SUCCESS` for manual follow-up; lookup failures are logged without blocking cancellation. See [Upgrade notes](#upgrade-notes).

**Create payment** (`POST /payments`)

- A new request replaces a stale `Initial` attempt by failing its transaction and removing its payment from the cart. Creation returns `400 PaymentInProgress` if an earlier attempt is `Pending`, `Success` or already authorized at easyCredit, or its status cannot be checked within 5 seconds.
- Cart totals, currency or item changes during freezing or attempt replacement trigger revalidation before payment creation, including excluded gift items that leave the total unchanged. Failed checks unfreeze the cart and create no payment; see [Create Payment](docs/CreatePayment.md#cart-freeze).
- Billing and shipping addresses must also match in `additionalStreetInfo`, treating missing and empty values equally. This also applies to payment-method lookup.
- When both addresses exist, missing billing first name, last name, street or city, or a postal code other than five digits, returns `400 InvalidAddress` before reaching easyCredit. This also applies to payment-method lookup.

**Get payment** (`GET /payments/{paymentId}`)

- Omits `decision` fields received as `null`, previously serialized as `0` or `{}`.

**Enabler**

- Each checkout binds its submit listener to its own easyCredit element, allowing multiple checkouts on one page.

### Configuration

- New environment variables in `connect.yaml`; empty values use defaults, while invalid values stop processor startup after deployment:
  - `BILL_PAYMENT_ENABLED`: `0` (default) or `1`.
  - `BILL_PAYMENT_EXCLUDED_PRODUCT_TYPES` and `BILL_PAYMENT_EXCLUDED_CUSTOM_LINE_ITEMS`: comma-separated keys of at least two characters using `A-Z`, `a-z`, `0-9`, `_` or `-`.
  - `WEBSHOP_CACHE_TTL`: `0`–`3600` seconds, default `300`; also controls excluded product type caching.
- `BILL_PAYMENT_EXCLUDED_PRODUCT_TYPES` requires `view_product_types` in `CTP_SCOPES`. Missing scope or more than 500 keys makes invoice unavailable.
- Redeploy to add `easyCreditInterest`, `easyCreditTotalValue` and `easyCreditEarlierCaptureBookings` to the transaction custom type. Until then, interest writes log errors and some captures fail; see [Upgrade notes](#upgrade-notes).

### Security

- Capture and refund enforce token scopes; see [Upgrade notes](#upgrade-notes).

### Development

- Root `.nvmrc` selects Node.js 20; setup instructions now use `nvm use` before installing each application's dependencies.
- Processor coverage includes all source TypeScript except declarations and Jest setup files, with an 80% minimum for branches, functions, lines and statements.
