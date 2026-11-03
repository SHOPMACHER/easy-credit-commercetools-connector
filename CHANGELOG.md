# Changelog

Notable changes to the easyCredit commercetools connector (processor and enabler). Versions match the git tags. Changes before this release are not listed.

## [Unreleased]

Planned as `1.1.0` of the processor and the enabler. Deploy both from the same build.

### Upgrade notes

Pay by invoice stays off until `BILL_PAYMENT_ENABLED=1`. Existing installment integrations need no code changes, but check these points:

- **Breaking:** `POST /payments/{paymentId}/capture` and `POST /payments/{paymentId}/refund` need a token with one of the scopes `manage_payments`, `manage_checkout_payment_intents` or `manage_project`. A token without them gets `401 invalid_token` with the accepted scopes in `fields.validAuthorities`. Before, any valid token of the project was accepted. Check the API client that calls capture and refund before upgrading.

- Installment now reads the easyCredit webshop configuration (`GET /payment/v3/webshop/{webShopId}`) for its limits, with the same credentials. If easyCredit rejects that request (for example `401` or `404`), `GET /payments/payment-method/{cartId}` and `POST /payments` answer `503 EasyCreditUnavailable` instead of offering installment. Check that the webshop ID and API password are accepted by that endpoint before upgrading. See [Changed](#changed).

A few responses change where the previous version answered wrongly, see [Fixed](#fixed):

- A capture that easyCredit rejects or does not answer returns an error instead of `204`. Before, the `204` hid a capture that never happened.
- An authorization request that easyCredit rejects returns the easyCredit error instead of `204`. Before, the `204` and the `Pending` transaction hid an authorization that never happened.
- `POST /payments` refuses carts that easyCredit rejects later (`InvalidAddress`, `AddressesUnmatched` for `additionalStreetInfo`) and a second payment while an earlier one is still open (`PaymentInProgress`).
- `GET /payments/{paymentId}` leaves out `decision` fields that easyCredit sends as `null` instead of returning `0` or `{}`.
- A refund with more than two decimal places, or above the payment amount minus the refunds that did not fail, returns `400 InvalidRefundAmount`. Before, the amount was sent to easyCredit unrounded, and an over-refund was accepted and failed later.

### Added

- Pay by invoice (`BILL_PAYMENT`) as a separate payment method next to installment, for private customers with German addresses. Both payment methods can be mounted on the same checkout page. Its payments have `paymentMethodInfo.method` `BILL_PAYMENT`; installment payments keep `easycredit`.
- `paymentType` query parameter for `GET /payments/payment-method/{cartId}` and `paymentType` field for `POST /payments`.
- Switching between installment and pay by invoice on the easyCredit page, offered only if pay by invoice is enabled. The commercetools payment follows the payment type that easyCredit reports.
- Capture and full, partial and repeated refunds for pay by invoice, also refunds before the capture.
- Interest and total value of an installment payment in the `Authorization` transaction custom fields `easyCreditInterest` and `easyCreditTotalValue`.
- `waitForAuthorization` body field for `POST /payments/{paymentId}/authorize`. With `true` the call waits up to 30 seconds until easyCredit reports `AUTHORIZED` and the transaction is `Success`, or returns `504 AuthorizationTimeout`. Without it the call answers after sending the authorization request, as before.
- Enabler: `CheckoutComponent.isAvailable()` tells whether a payment method can be offered for the cart. It is an optional member of the type, so existing implementations and test doubles compile unchanged.

### Changed

- The installment limits come from the easyCredit webshop configuration instead of the fixed 200 € to 10,000 €. If easyCredit cannot be reached or sends an invalid configuration, the last valid configuration or the fixed limits are used. `503 EasyCreditUnavailable` with a `Retry-After` header is returned only if easyCredit rejects the webshop request itself (for example `401` or `404`), or reported installment as deactivated and cannot be reached since.
- `InvalidAmount` formats amounts the German way, for example `10.000€`.
- A repeated capture of a payment with a `Success` `Charge` returns `204` without calling easyCredit again. With a `Pending` `Charge`, the easyCredit capture bookings decide: a `DONE` booking completes the `Charge`, a capture still in progress returns `204`, and a `FAILED` booking or no booking 15 minutes after the `Charge` sets it to `Failure` and captures again.
- `POST /payments/{paymentId}/authorize` returns `204` for a payment that is already authorized, instead of `400 TransactionNotPreauthorized`.
- The notification also completes Refund transactions that are still `Initial`, and logs the easyCredit reason of a failed capture or refund.
- easyCredit errors with a body that is not JSON keep the easyCredit HTTP status instead of becoming a `500`.

### Fixed

**Capture** (`POST /payments/{paymentId}/capture`)

- A capture that easyCredit rejects returns the easyCredit status and error, and a capture that easyCredit does not answer within 10 seconds or cannot be reached returns `504` or `502` with the code `CaptureFailed`. Before, both returned `204` and no `Charge` was written, so the payment was never collected. The `Charge` is set to `Failure` and the capture can be requested again.
- The `Charge` transaction is added in state `Pending` before easyCredit is called, so an early notification finds it.
- A `FAILED` capture booking from easyCredit sets the `Charge` to `Failure` instead of `Success`. Charges written by earlier versions are not changed: a `Success` Charge from before this release can belong to a failed capture, and it cannot be captured again through the API. Compare with the easyCredit merchant portal if in doubt.
- An earlier `FAILED` capture booking no longer fails the `Charge` of a capture that was requested again, also before easyCredit lists the booking of the new capture.
- A `Pending` `Charge` whose notification never arrives no longer blocks the capture forever, see [Changed](#changed).
- `trackingNumber` is limited to the 50 characters easyCredit accepts. A longer value returns `400 InvalidJsonInput` instead of a rejected capture.

**Refund** (`POST /payments/{paymentId}/refund`)

- If easyCredit answers with a `5xx`, cannot be reached or does not answer within 10 seconds, the Refund transaction is set to `Pending` instead of `Failure`, because easyCredit may still book the refund. The notification completes it. The response stays `202` with the payment. Do not send the refund again: a new request is a new refund.
- A refund whose notification never arrives no longer stays open forever. Each capture and refund request of the payment first reads the easyCredit bookings: an open refund with a `DONE` or `FAILED` booking gets `Success` or `Failure`, and one without a booking 15 minutes after it was sent gets `Failure`, which frees its amount for a new refund. Calling `GET /easycredit-notification?vorgangskennung={easyCredit transaction ID}` does the same.
- Each refund request uses its own Refund transaction as easyCredit `bookingId`. Before, a refund stuck in `Initial` made later requests change the wrong transaction.
- A refund that easyCredit accepted no longer stays `Initial` when another request changed the payment at the same time.
- A notification that completes a refund and the capture together no longer fails with a version conflict and leaves the refunds `Pending`.
- The refund amount sent to easyCredit is the same as the amount of the Refund transaction. Before, `10.005` was stored as `1001` cents but sent as `10.005`, and `0.001` created a Refund of `0` cents.
- A refund above the amount that earlier refunds left is rejected before easyCredit is called.

**Authorize** (`POST /payments/{paymentId}/authorize`)

- If easyCredit rejects the authorization request, its error is returned. Before, the call returned `204` and set the transaction to `Pending`.
- If easyCredit reports `DECLINED` or `EXPIRED`, the transaction is set to `Failure` and the cart is unfrozen. The response is still `400 TransactionNotPreauthorized`.
- The transaction is set to `Failure` with `400 AmountMismatch` if the cart is no longer frozen or the cart total, the transaction amount and the easyCredit amount differ. Once easyCredit reports `AUTHORIZED` (callback, or a retry of this call), an `Ordered` cart is accepted and a deleted cart leaves the check to transaction and easyCredit amount, so an order created right after the `204` still gets its `Success`.

**Create payment** (`POST /payments`)

- A new call for the same cart replaces the earlier easyCredit payment instead of adding a second one to the cart. While an earlier attempt is `Pending`, `Success` or authorized at easyCredit, the call returns `400 PaymentInProgress`.
- Billing and shipping address must also match in `additionalStreetInfo`, as in easyCredit's own address check. A missing and an empty value count as equal.
- An incomplete billing address returns `400 InvalidAddress` instead of failing at easyCredit.

**Get payment** (`GET /payments/{paymentId}`)

- `decision` fields that easyCredit sends as `null` are left out. Before, they were returned as `0` or `{}`.

### Configuration

- New environment variables: `BILL_PAYMENT_ENABLED` (default `0`), `BILL_PAYMENT_EXCLUDED_PRODUCT_TYPES`, `BILL_PAYMENT_EXCLUDED_CUSTOM_LINE_ITEMS` and `WEBSHOP_CACHE_TTL` (default `300`). See `connect.yaml`.
- `BILL_PAYMENT_EXCLUDED_PRODUCT_TYPES` needs the `view_product_types` scope.
- Redeploy the connector so the post-deploy script adds `easyCreditInterest` and `easyCreditTotalValue` to the transaction custom type.

### Security

- Capture and refund check the token scopes, see [Upgrade notes](#upgrade-notes).
- Updated dependencies with known vulnerabilities.
