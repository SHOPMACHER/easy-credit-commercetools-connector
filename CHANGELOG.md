# Changelog

Notable changes to the easyCredit commercetools connector (processor and enabler). Versions match the git tags. Changes before this release are not listed.

## [Unreleased]

Planned as `1.1.0` of the processor and the enabler. Deploy both from the same build.

### Breaking changes

Check these before upgrading. They apply to installment payments as well.

**Capture** (`POST /payments/{paymentId}/capture`)

- A capture that easyCredit rejects returns the easyCredit status and error instead of `204`.
- If easyCredit answers with a `5xx`, cannot be reached or does not answer within 10 seconds, the capture returns `502` (`504` on a timeout) with the code `CaptureFailed`.
- The `Charge` transaction is added in state `Pending` before easyCredit is called. A rejected or failed capture now leaves a `Charge` in state `Failure`, and the capture can be requested again.
- A `FAILED` capture booking from easyCredit sets the `Charge` to `Failure` instead of `Success`. Charges written by earlier versions are not changed: a `Success` Charge from before this release can belong to a failed capture. Compare with the easyCredit merchant portal if in doubt.
- `trackingNumber` accepts at most 50 characters. A longer value returns `400 InvalidJsonInput`.

**Refund** (`POST /payments/{paymentId}/refund`)

- A refund that easyCredit rejects with a `4xx` returns the easyCredit status and error instead of `202`. The Refund transaction is set to `Failure`.
- If easyCredit answers with a `5xx`, cannot be reached or does not answer within 10 seconds, the refund returns `502` (`504` on a timeout) with the code `RefundFailed`. easyCredit may still book the refund, so the Refund transaction stays `Pending` and is completed by the notification. Do not send the refund again: a new request is a new refund.
- easyCredit accepts a refund above the remaining refundable amount with `202` and fails it later. The notification then sets the Refund transaction to `Failure`.

**Capture and refund**

- If easyCredit or commercetools reject the connector's own credentials (`401` or `403`), the API returns `502 UpstreamAuthenticationFailed` instead of passing the `401` or `403` on.

**Authorize** (`POST /payments/{paymentId}/authorize`)

- The request waits up to 30 seconds for the easyCredit decision and sets the `Authorization` transaction to `Success` once easyCredit reports `AUTHORIZED`. Without a decision in time it returns `504 AuthorizationTimeout` and the transaction stays `Pending`: do not create the order. Earlier versions returned `204` right after sending the authorization request.

**Create payment** (`POST /payments`)

- `paymentMethodInfo.method` is `INSTALLMENT_PAYMENT` or `BILL_PAYMENT` instead of `easycredit`. Identify easyCredit payments by `paymentMethodInfo.paymentInterface`. Payments created before keep `easycredit` and are treated as installment.
- The cart is frozen with `HardFreeze` instead of the default freeze. The shipping method cannot be changed after the payment was started.
- A new call for the same cart replaces the earlier easyCredit payment. While an earlier attempt is `Pending`, `Success` or authorized at easyCredit, the call returns `PaymentInProgress`.
- Billing and shipping address must also match in `additionalStreetInfo`, as in the easyCredit address check. A cart whose addresses only differ there now returns `400 AddressesUnmatched`. A missing and an empty value count as equal.
- An incomplete billing address returns `400 InvalidAddress`.

**Payment type availability**

- The installment limits come from the easyCredit webshop configuration instead of the fixed 200 € to 10,000 €. During an easyCredit outage the last valid configuration is used, then the old limits. If neither may be used, the API returns `503 EasyCreditUnavailable` with a `Retry-After` header.
- `InvalidAmount` formats amounts the German way, for example `10.000€`.
- easyCredit errors keep the easyCredit HTTP status instead of becoming a `500`.

**Enabler**

- `CheckoutComponent` requires `isAvailable(): Promise<boolean>`. The components from the supplied builders implement it. Custom implementations and typed test doubles must add it.

### Added

- Pay by invoice (`BILL_PAYMENT`) as a separate payment method next to installment, for private customers with German addresses. Both payment methods can be mounted on the same checkout page.
- `paymentType` query parameter for `GET /payments/payment-method/{cartId}` and `paymentType` field for `POST /payments`.
- Switching between installment and pay by invoice on the easyCredit page. The commercetools payment follows the payment type that easyCredit reports.
- Capture and full, partial and repeated refunds for pay by invoice, also refunds before the capture.
- Interest and total value of an installment payment in the `Authorization` transaction custom fields `easyCreditInterest` and `easyCreditTotalValue`.

### Changed

- A repeated capture of a payment with a `Pending` or `Success` `Charge` returns `204` without capturing again.
- Each refund request uses its own Refund transaction as easyCredit `bookingId`, also while other refunds of the payment are open.
- The notification also completes Refund transactions that are still `Initial`, and logs the easyCredit reason of a failed capture or refund.

### Configuration

- New environment variables: `BILL_PAYMENT_ENABLED` (default `0`), `BILL_PAYMENT_EXCLUDED_PRODUCT_TYPES`, `BILL_PAYMENT_EXCLUDED_CUSTOM_LINE_ITEMS` and `WEBSHOP_CACHE_TTL` (default `300`). See `connect.yaml`.
- `BILL_PAYMENT_EXCLUDED_PRODUCT_TYPES` needs the `view_product_types` scope.
- Redeploy the connector so the post-deploy script adds `easyCreditInterest` and `easyCreditTotalValue` to the transaction custom type.

### Security

- Updated dependencies with known vulnerabilities.
