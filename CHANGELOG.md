# Changelog

Notable changes to the easyCredit commercetools connector (processor and enabler). This changelog starts with the planned `1.1.0` release; earlier changes are not listed.

## [Unreleased]

Planned release: `1.1.0` for both processor and enabler. Deploy both from the same build.

This release adds pay by invoice alongside installment and improves payment creation, authorization, capture and refunds.

### Upgrade notes

Existing installment request fields are retained, but some responses and transaction states change.

- **Breaking: check API client scopes.** Capture and refund now require `manage_payments`, `manage_checkout_payment_intents` or `manage_project`. Tokens without one of these scopes receive `401 invalid_token`.
- **Verify webshop access before upgrading.** Activation and limits for both methods now come from `GET /payment/v3/webshop/{webShopId}`. Without valid, unexpired data, payment-method lookup and creation return `503 EasyCreditUnavailable`, and the widget is hidden. There are no fallback limits. Check the webshop ID and API password. See [webshop configuration](docs/GetPaymentMethod.md#webshop-configuration).
- **Breaking: old cancel and denial links stop working.** These links now require a signature. Links from payments created before the upgrade return `400 InvalidRedirectUrl` instead of redirecting to the shop. See [Cancel Payment](docs/CancelPayment.md).
- **Breaking for integrations using callback redirects.** The authorization callback now ignores `redirectUrl`. The connector's own server-to-server callback does not use this parameter. Successful calls return `200` with the `paymentId`; failed calls still return an error, such as `400 TransactionNotAuthorized` or `400 AmountMismatch`.
- **Redeploy to add the interest fields.** The post-deploy script adds `easyCreditInterest` and `easyCreditTotalValue` to the transaction custom type. Until then, writes to these fields log warnings without affecting responses.
- **Reconcile open refunds.** Refunds without a matching completed easyCredit booking stay `Initial` or `Pending` and reserve their amount indefinitely. This also affects legacy refunds booked under another refund's ID. Check the merchant portal and correct their state through the commercetools API. See [refund recovery](docs/RefundPayment.md#process).
- **Review old successful captures if their outcome is uncertain.** Earlier versions could mark failed capture bookings as `Success`. The upgrade does not correct those records, and they cannot be recaptured through the API. Reconcile them against the merchant portal.
- **Monitor authorization warnings.** Investigate `EASYCREDIT_AUTHORIZED_CT_NOT_SUCCESS` and `EASYCREDIT_AUTHORIZATION_SENT_ATTEMPT_DISCARDED`. easyCredit may have authorized a payment that commercetools did not record as successful. The connector does not automatically void it. See [authorization errors](docs/AuthorizePayment.md#error-responses).

### Added

- **Pay by invoice (`BILL_PAYMENT`).** Available alongside installment for private customers with German addresses and matching billing and shipping destinations. Supports capture and full, partial and repeated refunds, including refunds before capture. It remains disabled until `BILL_PAYMENT_ENABLED=1` and activation at easyCredit. See [payment availability](docs/GetPaymentMethod.md#payment-type-availability).
- **Payment type selection and reporting.** Payment-method lookup and payment creation accept an optional `paymentType`. Lookup returns availability and limits for both types; Get Payment reports the selected type. Stored `paymentMethodInfo.method` is `BILL_PAYMENT` for invoice and remains `easycredit` for installment. See [Create Payment](docs/CreatePayment.md).
- **Switching on the easyCredit page.** Enabling invoice allows easyCredit to offer a switch between payment types. The connector records the final type and rechecks eligibility before authorization where required. A switch in either direction is rejected if the final type is switched off in the connector or the cart does not qualify for it. See [payment type switching](docs/AuthorizePayment.md#sync-the-final-payment-type).
- **Installment interest details.** Authorization transactions store `easyCreditInterest` and `easyCreditTotalValue` when available. These fields are removed after a switch to invoice.
- **Optional wait for authorization.** Set `waitForAuthorization: true` to wait for easyCredit authorization and commercetools `Success`. easyCredit requests and polling share a 30-second budget. If confirmation is still pending when it runs out, the API returns `504 AuthorizationTimeout`. See [Authorize Payment](docs/AuthorizePayment.md).
- **Checkout support for both methods.** Checkout, label and summary components accept `paymentType`. The optional `CheckoutComponent.isAvailable()` helps the shop decide which methods to show. Multiple checkout components can share a page, and the widget can display both methods. See [Web Components](docs/WebComponents.md).

### Changed

- **Availability is checked before cart details.** Payment-method lookup and creation check activation, limits and excluded items before addresses and currency. Availability errors are returned first; amount messages use German formatting. See [Get Payment Method](docs/GetPaymentMethod.md).
- **Unavailable methods are hidden at checkout.** Disabled methods and unavailable webshop data no longer appear as installment widget alerts. Invoice is also hidden when the amount is outside its limits; installment still shows an amount alert. The widget uses `paymentTypes` from `GET /operations/widget-enabled` and is hidden when that list is empty. See [component availability](docs/WebComponents.md#availability).
- **Get Payment refreshes stored details.** It synchronizes payment type switches and interest fields. After a switch it can return `400` (transaction failed, cart unfrozen), `502 PaymentTypeUnknown` or `503`; see [Get Payment](docs/GetPayment.md#failure-modes-for-the-frontend). `decision` fields received as `null` are now omitted instead of being returned as `0` or `{}`.
- **Authorization retries respect the current state.** An existing `Success` returns `204`. An attempt already authorized at easyCredit can complete in commercetools, and a `Pending` authorization is not sent again on a sequential retry. The easyCredit status lookup and authorization request share a 30-second budget even without `waitForAuthorization`. See [authorization workflow](docs/AuthorizePayment.md#workflow).

### Fixed

**Capture**

- Rejected or unanswered captures now return an error instead of a misleading `204`. If easyCredit may still have booked the capture, the charge stays `Pending` and can be retried. A duplicate capture response from easyCredit (`409`) still returns `204` while awaiting the booking result.
- The charge is recorded before calling easyCredit, so early notifications can find it. Failed bookings now set a pending charge to `Failure`. After a failed booking the connector sends no further capture, and every later capture request returns `400 CaptureBookingFailed`. The charge stays `Failure`; see [after a failed capture](docs/CapturePayment.md#after-a-failed-capture) for follow-up.
- `trackingNumber` is limited to 50 characters. See [Capture Payment](docs/CapturePayment.md) for errors and retry behavior.

**Refund**

- Timeouts, network failures and easyCredit server errors keep the refund open; the API still returns `202`. Its state is `Pending`, or `Initial` if that state update cannot be saved. **Do not resend the refund:** each request creates a separate refund, and easyCredit may already have booked the first one.
- Missed notifications can be recovered from bookings during later refund requests, capture requests that read bookings, or a manual notification call. Each refund now uses its own booking ID and includes a timestamp. Refund state updates retry version conflicts, and combined capture/refund notifications are processed sequentially to avoid conflicting writes.
- Sent and stored amounts now match. Amounts with more than two decimal places and amounts above the remaining refundable balance, including open refunds, return `400 InvalidRefundAmount`. See [Refund Payment](docs/RefundPayment.md) for recovery and reconciliation.

**Authorization and callbacks**

- Rejected or unanswered authorization requests now return an error and leave the transaction `Initial`, replacing the misleading `204` and `Pending` state.
- Authorization and callbacks check amounts and handle declined or expired transactions. Invoice address and company rules are checked again before authorization. Orders created immediately after authorization can still complete the payment update.
- Concurrent authorization calls and callbacks preserve final `Success` and `Failure` states. An attempt discarded while authorization was being sent returns `400 TransactionNotAuthorized`. See [Authorize Payment](docs/AuthorizePayment.md).

**Cancellation and payment creation**

- Cancellation handles missing or expired easyCredit transactions and repeated calls. Without a redirect URL, authorized payments return `400 TransactionIsAuthorized`; signed browser links redirect to the shop's success URL. The cart is only unfrozen when no other easyCredit attempt is open. See [Cancel Payment](docs/CancelPayment.md).
- Payment creation replaces stale attempts and returns `400 PaymentInProgress` when an earlier attempt blocks a new payment or its status cannot be checked. Cart changes during creation are revalidated, and failures after freezing trigger cleanup. See [Create Payment](docs/CreatePayment.md).
- Address validation catches missing billing details, invalid postal codes and differences in `additionalStreetInfo` before creating the easyCredit transaction. The same checks apply to payment-method lookup.
- Each checkout component now handles submissions only from its own easyCredit element.
- Non-JSON easyCredit errors keep their HTTP status instead of becoming `500`.

### Configuration

- `BILL_PAYMENT_ENABLED` defaults to `0`; `INSTALLMENT_PAYMENT_ENABLED` defaults to `1`. Set either to `0` or `1` to control which methods are offered.
- Both methods support excluded product types and custom line items through their `BILL_PAYMENT_EXCLUDED_*` and `INSTALLMENT_PAYMENT_EXCLUDED_*` settings. Product type exclusions require `view_product_types` in `CTP_SCOPES`. Lookup failures return `503 BillPaymentCheckFailed` or `503 InstallmentPaymentCheckFailed`. See [excluded cart items](docs/GetPaymentMethod.md#excluded-cart-items) for variable names and list formats.
- `WEBSHOP_CACHE_TTL` controls caching of webshop configuration and excluded product types: `0`–`3600` seconds, default `300`.
- For these new settings, empty values use defaults. Invalid values fail the post-deploy step and processor startup.

### Security and development

- Updated dependencies to address known vulnerabilities, including Fastify, `@fastify/static` and `compression`.
- Added a root `.nvmrc` for Node.js 20; setup instructions use `nvm use`.
- Processor coverage now includes all source TypeScript except declarations and Jest setup files, with an 80% minimum for branches, functions, lines and statements.
