# Changelog

This file lists the notable changes to the easyCredit commercetools connector (processor and enabler). The changelog starts with release `1.1.0`. It does not list earlier changes.

## [1.1.0] - 2026-11-16

This release adds pay by invoice next to installment. It also improves payment creation, authorization, capture and refunds.

Install these parts:

- **Processor and enabler `1.1.0`, deployed from the same build.** The processor and the enabler are two applications of one connector deployment.
- **Runtime enabler:** Load the enabler from the asset URL of the deployed connector. See [Load the enabler](docs/CommercetoolsFrontendIntegration.md#load-the-enabler).
- **TypeScript types:** Add the npm package `@shopmacher/easy-credit-commercetools-component@^1.1.0` as a development dependency. Version `1.0.2` does not have `isAvailable` and `paymentType`.

### Upgrade notes

The installment request fields of 1.0.x do not change. Some responses and transaction states change.

#### Upgrade checklist

Do the steps in this order. Each item has a label:

- **All shops:** every shop must do it.
- **Invoice only:** only a shop that sets `BILL_PAYMENT_ENABLED=1` must do it.
- **Optional:** a shop can do it.

The processor and the enabler are two applications of one connector deployment. They come from the same build. Do not combine a processor and an enabler of different versions.

1. **Before the deploy.** These changes also work with 1.0.x. Release them before the deploy.
   1. **All shops. API client scopes for capture and refund.** The token must have `manage_payments`, `manage_checkout_payment_intents` or `manage_project`. See [Details](#details).
   2. **All shops. Webshop access and limits.** Make sure that the connector can read the easyCredit webshop configuration. Send the `curl` request in [Details](#details). The fixed limits of 1.0.x (200 to 10000 EUR) are removed. The limits now come only from easyCredit.
   3. **All shops. Capture body.** If `trackingNumber` has more than 50 characters, the API returns `400`.
   4. **All shops. Refund amount.** If `amount` has more than two decimal places, the API returns `400 InvalidRefundAmount`. If `amount` is more than the remaining refundable balance, the API also returns `400 InvalidRefundAmount`. Open refunds count against this balance.
   5. **All shops. Get Payment response.** These `decision` fields are optional now: `interest`, `totalValue`, `numberOfInstallments`, `installment`, `lastInstallment`, `mtan` and `bankAccountCheck`. Typed consumers must accept missing values.
   6. **All shops. Several easyCredit payments per order.** A cart or an order can have more than one easyCredit payment. Cancelled, declined and failed attempts stay on the cart with a `Failure` transaction. For capture, refund and order display, use the payment with a `Success` authorization. See [Find the used payment](docs/CommercetoolsFrontendIntegration.md#find-the-used-payment).
   7. **All shops. Match payments on `paymentInterface`.** Find easyCredit payments by `paymentMethodInfo.paymentInterface` `easycredit` (case-insensitive). Do not use `method === 'easycredit'`. Invoice payments have `method` `BILL_PAYMENT`.
   8. **Invoice only. Read `method` when you need it.** Do not keep the payment type from payment creation. Read `paymentMethodInfo.method` at capture, refund or display time. The reasons:
      - If `BILL_PAYMENT_ENABLED=1`, the connector sends `paymentSwitchPossible: true` to easyCredit. easyCredit can then offer a switch between the payment types on its page.
      - The switch is also possible for a payment that the shopper started as installment.
      - After a switch, the connector changes `paymentMethodInfo.method` and `paymentMethodInfo.name`.
      - If you set `BILL_PAYMENT_ENABLED` back to `0`, payments with `method` `BILL_PAYMENT` keep this value.
   9. **All shops. Select the deploy time.** Deploy at a time with few checkouts, so that few payments are in flight (see *In-flight payment* in [Terms](docs/CommercetoolsFrontendIntegration.md#terms)). This time has no fixed length. In the sandbox, easyCredit expired an open transaction about 30 minutes after the last action of the shopper. easyCredit does not document this value.
2. **Deploy the processor and the enabler together.** Deploy release `1.1.0` to the existing deployment. Use the Connect API action [Redeploy](https://docs.commercetools.com/connect/deployments#redeploy) with `updateConnector: true`. This action updates the connector of the deployment to its latest published state. If you omit `configurationValues`, the existing configuration values do not change. The new settings of 1.1.0 are optional and have defaults, see [Configuration](#configuration). Do not set `skipScripts` to `true`, because the post-deploy script must run. The Merchant Center documentation describes **Redeploy** only for a failed installation.
   - **Public connector from the Connect marketplace:** Redeploy is sufficient.
   - **Organization connector:** first set the release tag of 1.1.0 with the action [Set Repository](https://docs.commercetools.com/connect/connectors-staged#set-repository) and publish the connector again. Then redeploy. See [Update your Connector](https://docs.commercetools.com/connect/getting-started#update-your-connector).

   Write down the go-live time of 1.1.0: the time when [Get Deployment](https://docs.commercetools.com/connect/deployments#get-deployment) shows the status `Deployed`. A deployment can take up to 15 minutes. Payments created before this time go to the manual review of step 5. The [order recovery job](docs/CommercetoolsFrontendIntegration.md#order-recovery-job) takes the payments created after it. The job uses this time as its lower time limit.
3. **After the deploy.**
   1. **All shops. Version.** Read the deployment with [Get Deployment](https://docs.commercetools.com/connect/deployments#get-deployment). `connector.repository.tag` must be the tag of release 1.1.0 or later.
   2. **All shops. Post-deploy script.** Check that the post-deploy script added the interest fields. Read the transaction custom type through the API, see [Details](#details). Do not rely on the deployment status.
   3. **All shops. Connector URLs.** Read the processor URL and the asset URL of the deployment again. Make sure that your shop configuration uses these values. See [Connector deployment](docs/CommercetoolsFrontendIntegration.md#connector-deployment).
   4. **All shops. Notification URL.** The notification URL does not change in 1.1.0. Make sure that `<PROCESSOR_URL>/easycredit-notification` is registered in the easyCredit merchant portal. Without it, `Charge` and `Refund` transactions stay `Pending`. See [Notification URL](docs/CommercetoolsFrontendIntegration.md#notification-url).
   5. **All shops. Scopes.** Monitor the first capture and refund calls of your back office. A `401 invalid_token` means that the token has none of the scopes of step 1.1.
   6. **All shops. Reconcile.** Reconcile open refunds and uncertain captures in the easyCredit merchant portal. See [Details](#details).
   7. **All shops. Order recovery job.** Start a scheduled job that completes or cancels easyCredit payments that the checkout did not complete. Start it immediately after the deploy, not with the shop code of step 4. The job calls only the processor and the commercetools API, so it does not need the 1.1.0 shop code. Give it the go-live time of 1.1.0 as its lower time limit. See [Order recovery job](docs/CommercetoolsFrontendIntegration.md#order-recovery-job).
4. **Release the shop code.** Release it after the deploy. If you release it before the deploy, the asset URL still serves the 1.0.x enabler. The 1.0.x checkout component has no `isAvailable`, so the shop code of [Show the payment methods](docs/CommercetoolsFrontendIntegration.md#show-the-payment-methods) hides all easyCredit payment methods.
   1. **All shops. Runtime enabler.** Load the enabler from the asset URL, see [Load the enabler](docs/CommercetoolsFrontendIntegration.md#load-the-enabler). Remove each runtime import of the npm package `@shopmacher/easy-credit-commercetools-component`. Keep the package `^1.1.0` as a development dependency, and use it only in `import type` lines.
   2. **Invoice only. Components.** Give `paymentType` to the checkout, label and summary components. Use `isAvailable()` to decide which methods to show. See [Web Components](docs/WebComponents.md).
   3. **Invoice only. Enable pay by invoice.** Set `BILL_PAYMENT_ENABLED=1` last, after the shop code and the back office are ready. Change the configuration in the Merchant Center: open **Manage connectors**, click the **Installations** tab and select the connector, see [Manage installed Connectors](https://docs.commercetools.com/merchant-center/connect#manage-installed-connectors). If you use the Redeploy action instead, do not set `updateConnector: true`, because it can also install a newer release. The Connect documentation does not say if a partial `configurationValues` keeps the other values. Thus send the full configuration of the `processor` application, also the secured values.
   4. **Optional. Authorize body.** `POST /payments/:paymentId/authorize` accepts an optional `waitForAuthorization` (boolean). If your commercetools Frontend shop calls authorize from a BFF action, see [Authorize and create the order](docs/CommercetoolsFrontendIntegration.md#authorize-and-create-the-order).
   5. **Optional. Widget configuration call.** `GET /operations/widget-enabled` is public now. The call does not need the `X-Session-Id` header.
   6. **Optional. Cancel return page.** If the cancellation fails, the shopper goes back to your cancel or denial URL with `error=cancel_failed` in the query. If the payment is already authorized, the shopper goes to your success URL. See [Cancel Payment](docs/CancelPayment.md).

   Until you release the shop code, a shop that bundles the 1.0.x npm enabler continues to work, for installment only. The 1.0.x components send no `paymentType`, so the processor uses `INSTALLMENT_PAYMENT`. The 1.0.x checkout component has no `isAvailable` and cannot hide the form. If the processor refuses the cart, the form shows an alert. The 1.1.0 processor signs the cancel and denial links of the new payments, so these links work.
5. **In-flight payments.** The cancel and denial links of payments from before the deploy return `400 InvalidRedirectUrl`. The connector does not cancel these payments. For the effects, see [Details](#details). Do these steps:
   1. **All shops.** If the shopper selects a payment method that is not easyCredit, call the cancel webhook from your server, without a query, only for an `Initial` payment. This call needs no signature. See [Cancel Payment](docs/CancelPayment.md#request-from-your-server). The cancel webhook refuses a `Pending` payment with `400 PaymentInProgress`, unless easyCredit reports `DECLINED` or `EXPIRED`. 1.0.x set `Pending` also when the authorization request failed, but easyCredit can also have authorized the payment. Thus examine each `Pending` payment in the easyCredit merchant portal, as in step 5.2.
   2. **All shops.** The order recovery job does not touch payments that were created before the go-live time. Examine these payments one time by hand. Use the queries of the order recovery job with `createdAt < "<go-live time>"` instead of the lower time limit, and without the limit `lastModifiedAt > "<now minus 24 hours>"`. Also add a lower limit, for example `createdAt > "<go-live time minus 30 days>"`. 30 days is an example value. Without a lower limit, the queries find each abandoned payment of 1.0.x. Also query the `Failure` payments with the same time limits: `paymentMethodInfo(paymentInterface="easycredit") and transactions(type="Authorization" and state="Failure")`. Keep only the `Failure` payments whose cart is `Ordered`. For each payment, read its cart and look at the transaction in the easyCredit merchant portal. Then decide:
      - `Success` and the cart is `Ordered`: this is a normal order. Do nothing.
      - The cart is `Ordered` and the payment is `Pending`, `Initial` or `Failure`: 1.0.x returned `204` and set `Pending` also when the authorization request failed. 1.0.x also left `Initial` when authorize failed before the `Pending` write, and it set `Failure` when a cancel failed on an ordered cart. Thus a shop can have created an order for a payment that is not authorized. Examine the transaction in the easyCredit merchant portal first. If the portal does not show the transaction as authorized, stop the order. Do not ship it. Contact the shopper. Do not call the cancel webhook. If the portal shows the transaction as authorized and the payment is `Pending` or `Initial`, call authorize with `{ "waitForAuthorization": true }`. Authorize reads the easyCredit status and sets the transaction to `Success`. If the portal shows the transaction as authorized and the payment is `Failure`, the API cannot complete it. Settle it manually in the portal and in commercetools. If the cart amount and the easyCredit amount are different, authorize returns `400 AmountMismatch` and sets the transaction to `Failure`. Then do not ship the order. Settle the amount difference manually in the merchant portal, and contact the shopper.
      - `Success` without an order: create the order, or contact the shopper.
      - `Pending` without an order: 1.0.x also set `Pending` when the authorization request failed. If easyCredit shows the transaction as authorized, call authorize and create the order. If the portal shows that the transaction is not authorized, follow [Settle a stuck Pending payment](docs/CancelPayment.md#settle-a-stuck-pending-payment). The cancel webhook refuses a `Pending` payment with `400 PaymentInProgress`, unless easyCredit reports `DECLINED` or `EXPIRED`.
      - `Initial` and the cart is not `Ordered`: call the cancel webhook from your server, without a query. If it returns `400 TransactionIsAuthorized`, treat the payment as `Pending`.
6. **Rollback to 1.0.x.** Test the rollback in a test project before you do it in production:
   - Roll back the shop code together with the connector. The asset URL then serves the 1.0.x enabler. The 1.0.x checkout component has no `isAvailable`. The shop code of [Show the payment methods](docs/CommercetoolsFrontendIntegration.md#show-the-payment-methods) treats a missing `isAvailable` as "not available", so it hides all easyCredit payment methods.
   - If you keep the 1.1.0 shop code, treat a missing `isAvailable` as available for `INSTALLMENT_PAYMENT` only. Keep `BILL_PAYMENT` hidden. The 1.0.x component ignores `paymentType`, so it renders a second installment form.
   - In 1.0.x, `GET /operations/widget-enabled` needs a valid session. The widget and the label component read this endpoint. Without a session, for example on the product page, the widget and the label do not show.
   - The transaction custom type keeps `easyCreditInterest` and `easyCreditTotalValue`. The 1.0.x post-deploy script does not remove fields.
   - Payments with `method` `BILL_PAYMENT` and the `paymentMethodInfo.name` values stay. 1.0.x checks only `paymentInterface`, so 1.0.x accepts these payments for capture and refund. Before a rollback, test the capture and the refund of an invoice payment with 1.0.x in a test project.
   - 1.0.x creates only installment payments. 1.0.x uses the fixed limits of 200 to 10000 EUR again.
   - Refunds that 1.1.0 left in `Initial` stay `Initial`, because 1.0.x notifications update only `Pending` refunds.
   - 1.0.x does not check the `sig` parameter of cancel links.

#### Details

- **Breaking: check the API client scopes.** Capture and refund now need `manage_payments`, `manage_checkout_payment_intents` or `manage_project`. A token without one of these scopes gets `401 invalid_token`.
- **The connector API client needs no new scope.** Add `view_product_types` to `CTP_SCOPES` only if you set an `*_EXCLUDED_PRODUCT_TYPES` variable.
- **Make sure that the webshop access works before you upgrade.** The activation and the limits of the two methods now come from `GET /payment/v3/webshop/{webShopId}`. If the connector has no valid data that is not expired, payment-method lookup and payment creation return `503 EasyCreditUnavailable`. The widget is then hidden. There are no fallback limits. The fixed 200 to 10000 EUR limits of 1.0.x are removed, and the limits from easyCredit can be different. See [webshop configuration](docs/GetPaymentMethod.md#webshop-configuration). To check the access, send this request with the `WEBSHOP_ID` and the `API_PASSWORD` of the connector:

  ```sh
  curl -u '<WEBSHOP_ID>:<API_PASSWORD>' 'https://ratenkauf.easycredit.de/api/payment/v3/webshop/<WEBSHOP_ID>'
  ```

  The response must have the status `200`. It must contain `installmentPaymentActive` (boolean), `minInstallmentValue` and `maxInstallmentValue` (numbers). For pay by invoice, it must also contain `billPaymentActive`, `minBillingValue` and `maxBillingValue`. The minimum must not be more than the maximum. If `availability` is `false`, the connector offers no payment type.
- **Breaking: old cancel and denial links stop working.** These links now need a signature. The links of in-flight payments have no signature. If the shopper of such a payment cancels, or easyCredit declines the payment, this occurs:
  - The browser shows a JSON error `400 InvalidRedirectUrl` from the processor. The shopper does not return to the shop.
  - The connector does not cancel the payment. The cart stays frozen.
  - If the shopper starts a new easyCredit payment in the shop, Create Payment discards the old attempt. This works only if the old attempt is `Initial` and easyCredit does not report it as `AUTHORIZED`. Otherwise Create Payment returns `400 PaymentInProgress`. This also occurs if the easyCredit status lookup fails with an error other than `404` or `410`.
  - 1.0.x set a transaction to `Pending` also when the authorization request failed. Create Payment returns `400 PaymentInProgress` for these payments too.

  The success links do not change. A shopper who completes the easyCredit form returns to the shop as before.

  For the steps, see step 5 of the [upgrade checklist](#upgrade-checklist).

  The signature uses `API_PASSWORD` as the key. Thus, a change of `API_PASSWORD` also breaks the links of open payments in the same way.
- **Breaking for integrations that use callback redirects.** In 1.0.x, the authorization callback redirected with `302` to the query parameter `redirectUrl`, if the call had one. In 1.1.0, the callback ignores `redirectUrl`. A successful call always returns `200` with the `paymentId`. A failed call still returns an error, for example `400 TransactionNotAuthorized` or `400 AmountMismatch`.
- **Breaking: invoice payments have `method` `BILL_PAYMENT`.** Code that matches `method === 'easycredit'` does not find invoice payments. This code also does not find installment payments that the shopper switched to invoice. Match on `paymentInterface` (case-insensitive). Installment payments keep `easycredit`.
- **Breaking for typed consumers: the `decision` fields of Get Payment are optional.** easyCredit sends `null` for fields that do not apply, for example the interest of an invoice payment. The connector does not return these fields.
- **Check that the post-deploy script of the 1.1.0 deployment added the interest fields.** The post-deploy script runs after a successful Connect deployment, see [Automation scripts](https://docs.commercetools.com/connect/automation-scripts). A deployment can show success also if the script failed, see [Verify the resource, not the status](https://docs.commercetools.com/certifications/deploy-marketplace-connector/deploy-a-connector-in-merchant-center). The script adds `easyCreditInterest` and `easyCreditTotalValue` to the transaction custom type. To check this, read the type with `GET /{projectKey}/types/key=<TRANSACTION_CUSTOM_TYPE_KEY>` (default key `easy-credit-technical-transaction-id`). Its `fieldDefinitions` must contain the two fields. Until the fields exist, writes to these fields log warnings, see [Transaction custom fields](docs/CreatePayment.md#transaction-custom-fields). The responses do not change.
- **Reconcile open refunds.** If a refund has no matching completed easyCredit booking, the refund stays `Initial` or `Pending`. Its amount stays reserved with no time limit. This also applies to legacy refunds that easyCredit booked under the ID of a different refund. Check the refund in the easyCredit merchant portal. Then correct the refund state through the commercetools API. See [refund recovery](docs/RefundPayment.md#process).
- **Examine old successful captures if their result is not certain.** Earlier versions could set failed capture bookings to `Success`. The upgrade does not correct these records. You cannot capture these payments again through the API. Reconcile them with the merchant portal.
- **Monitor the authorization warnings.** Examine `EASYCREDIT_AUTHORIZED_CT_NOT_SUCCESS` and `EASYCREDIT_AUTHORIZATION_SENT_ATTEMPT_DISCARDED`. easyCredit possibly authorized a payment that commercetools did not record as successful. The connector does not void this payment automatically. See [authorization errors](docs/AuthorizePayment.md#error-responses).

### Added

- **Pay by invoice (`BILL_PAYMENT`).** Pay by invoice is available next to installment. It is for private customers with German addresses, where the billing address and the shipping destinations match. It supports capture and full, partial and repeated refunds. Refunds before capture are also possible. Pay by invoice stays disabled until `BILL_PAYMENT_ENABLED=1` and easyCredit activates it. See [payment availability](docs/GetPaymentMethod.md#payment-type-availability).
- **Payment type selection and reporting.** Payment-method lookup and payment creation accept an optional `paymentType`. The lookup returns the availability and the limits of the two types. Get Payment returns the selected type. The stored `paymentMethodInfo.method` is `BILL_PAYMENT` for invoice and stays `easycredit` for installment. New payments also store `paymentMethodInfo.name` (`{ "de": "easyCredit Ratenkauf" }` or `{ "de": "easyCredit Rechnung" }`). See [Create Payment](docs/CreatePayment.md).
- **Switch on the easyCredit page.** If invoice is enabled, easyCredit can offer a switch between the payment types. The connector records the final type. Where necessary, the connector checks the eligibility again before authorization. The connector rejects a switch in the two directions if the final type is switched off in the connector. The connector also rejects the switch if the cart does not qualify for the final type. The easyCredit sandbox page did not offer the switch on 2026-10-26. See [payment type switching](docs/AuthorizePayment.md#sync-the-final-payment-type).
- **Installment interest details.** Authorization transactions store `easyCreditInterest` and `easyCreditTotalValue` when these values are available. After a switch to invoice, the connector removes these fields.
- **Optional wait for authorization.** Set `waitForAuthorization: true` to wait for the easyCredit authorization and the commercetools `Success`. The easyCredit requests and the polling share a 30-second budget. If the confirmation is still pending at the end of the budget, the API returns `504 AuthorizationTimeout`. See [Authorize Payment](docs/AuthorizePayment.md).
- **Checkout support for the two methods.** The checkout, label and summary components accept `paymentType`. The optional `CheckoutComponent.isAvailable()` helps the shop decide which methods to show. One page can have more than one checkout component. The widget can show the two methods. See [Web Components](docs/WebComponents.md).

### Changed

- **`GET /operations/widget-enabled` is public.** The call does not need `X-Session-Id` now. Thus, pages without a checkout session can show the widget.
- **Availability is checked before cart details.** Payment-method lookup and payment creation check activation, limits and excluded items first. Then they check addresses and currency. Availability errors come first. Amount messages use German number format. See [Get Payment Method](docs/GetPaymentMethod.md).
- **Unavailable methods are hidden at checkout.** Disabled methods and unavailable webshop data no longer show as installment widget alerts. If the amount is outside the invoice limits, invoice is also hidden. Installment still shows an amount alert. The widget uses `paymentTypes` from `GET /operations/widget-enabled`. If this list is empty, the widget is hidden. If the webshop lookup takes more than 1.5 seconds, that request returns an empty list. The lookup continues and fills the cache for the next request. See [component availability](docs/WebComponents.md#availability).
- **Get Payment updates the stored details.** Get Payment synchronizes payment type switches and interest fields. After a switch, Get Payment can return `400` (transaction failed, cart unfrozen), `502 PaymentTypeUnknown` or `503`. See [Get Payment](docs/GetPayment.md#failure-modes-for-the-frontend). The connector now omits `decision` fields that easyCredit sends as `null`. Before, it returned them as `0` or `{}`.
- **Authorization retries use the current state.** If the authorization is already `Success`, the API returns `204`. If easyCredit already authorized an attempt, the attempt can complete in commercetools. A sequential retry does not send a `Pending` authorization again. The easyCredit status lookup and the authorization request share a 30-second budget, also without `waitForAuthorization`. See [authorization workflow](docs/AuthorizePayment.md#workflow).

### Fixed

**Capture**

- The connector records the charge as `Pending` before it calls easyCredit. Thus, early notifications can find the charge.
- If the connector cannot read the easyCredit transaction before it sends the capture, the API returns an error, for example `502` or `504 CaptureFailed`. The payment does not change.
- If easyCredit does not answer, or answers with `5xx`, the API returns an error. The charge stays `Pending`, because easyCredit can still book the capture. A later capture request settles the charge from the easyCredit bookings or sends the capture again.
- If easyCredit answers `409` (it already has a capture), the API returns `204`. The charge stays `Pending` until the booking result.
- If easyCredit rejects the first capture with a different error, the charge changes to `Failure`. The API returns the error. A later capture request then sends a new capture. The exception: easyCredit has a failed capture booking.
- If easyCredit rejects a capture that the connector sends again, the charge stays `Pending`.
- If easyCredit reports a failed capture booking, the charge changes to `Failure`. The connector then sends no more captures. Each later capture request returns `400 CaptureBookingFailed`. For the next steps, see [after a failed capture](docs/CapturePayment.md#after-a-failed-capture).
- The maximum length of `trackingNumber` is 50 characters. For errors and retry behavior, see [Capture Payment](docs/CapturePayment.md).

**Refund**

- After a timeout, a network failure or an easyCredit server error, the refund stays open. The API still returns `202`. The refund state is `Pending`. If the connector cannot save this state update, the state is `Initial`. **Do not send the refund again:** each request creates a separate refund, and easyCredit possibly booked the first one.
- The connector can recover missed notifications from the bookings. It does this during later refund requests, during capture requests that read bookings, or during a manual notification call. Each refund now uses its own booking ID and has a timestamp. Refund state updates retry after version conflicts. The connector processes combined capture and refund notifications one after the other, so that the writes do not conflict.
- The sent amounts and the stored amounts now match. If an amount has more than two decimal places, the API returns `400 InvalidRefundAmount`. If an amount is more than the remaining refundable balance, the API also returns `400 InvalidRefundAmount`. Open refunds count against this balance. For recovery and reconciliation, see [Refund Payment](docs/RefundPayment.md).

**Authorization and callbacks**

- If easyCredit rejects an authorization request or does not answer, the API now returns an error and the transaction stays `Initial`. Before, the API returned a misleading `204` and set the state `Pending`.
- Authorization and callbacks check the amounts. They also handle declined and expired transactions. Before authorization, the connector checks the invoice address and company rules again. Orders created immediately after authorization can still complete the payment update.
- Concurrent authorization calls and callbacks keep the final `Success` and `Failure` states. If the connector discards an attempt while it sends the authorization, the API returns `400 TransactionNotAuthorized`. See [Authorize Payment](docs/AuthorizePayment.md).

**Cancellation and payment creation**

- **Cancellation refuses `Pending` payments.** The cancel webhook returns `400 PaymentInProgress` for a `Pending` payment and changes nothing, because easyCredit can still authorize it. 1.0.x set such a payment to `Failure`. The exception: easyCredit reports `DECLINED` or `EXPIRED`. Then the cancel continues. The cancel webhook writes `Failure` only if the transaction state did not change after its first read. A parallel authorization that sets `Pending` thus cannot end in `Failure`. See [Cancel Payment](docs/CancelPayment.md#conditions).
- Cancellation handles missing or expired easyCredit transactions and repeated calls. Without a redirect URL, an authorized payment returns `400 TransactionIsAuthorized`. With a signed browser link, an authorized payment redirects to the success URL of the shop. The connector unfreezes the cart only when no other easyCredit attempt is open. See [Cancel Payment](docs/CancelPayment.md).
- Payment creation replaces stale attempts. Payment creation returns `400 PaymentInProgress` if an earlier attempt blocks a new payment. It also returns this error if the connector cannot check the status of the earlier attempt. The connector validates cart changes during creation again. If a failure occurs after the freeze, the connector starts a cleanup. See [Create Payment](docs/CreatePayment.md).
- Before the connector creates the easyCredit transaction, the address validation finds these problems: missing billing details and invalid postal codes (`400 InvalidAddress`), and differences in `additionalStreetInfo`. Payment-method lookup uses the same checks.
- Each checkout component now handles only the submissions from its own easyCredit element.
- easyCredit errors that are not JSON keep their HTTP status. Before, they became `500`.

### Configuration

- `BILL_PAYMENT_ENABLED` has the default `0`. `INSTALLMENT_PAYMENT_ENABLED` has the default `1`. Set each one to `0` or `1` to control which methods the connector offers.
- The two methods support excluded product types and custom line items through their `BILL_PAYMENT_EXCLUDED_*` and `INSTALLMENT_PAYMENT_EXCLUDED_*` settings. Product type exclusions need `view_product_types` in `CTP_SCOPES`. If the lookup fails, the API returns `503 BillPaymentCheckFailed` or `503 InstallmentPaymentCheckFailed`. For the variable names and list formats, see [excluded cart items](docs/GetPaymentMethod.md#excluded-cart-items).
- `WEBSHOP_CACHE_TTL` sets the cache time for the webshop configuration and the excluded product types. The range is `0` to `3600` seconds. The default is `300`.
- If one of these new settings is empty, the connector uses the default. An invalid value stops the post-deploy step and the processor startup.

### Security and development

- Updated dependencies to address known vulnerabilities, for example in Fastify, `@fastify/static` and `compression`.
- Added a root `.nvmrc` for Node.js 20. The setup instructions use `nvm use`.
- Processor coverage now includes all source TypeScript files, except declarations and Jest setup files. The minimum is 80% for branches, functions, lines and statements.
