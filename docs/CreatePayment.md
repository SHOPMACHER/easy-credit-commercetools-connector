# Create Payment

* [Create payment workflow](#workflow)
* [Example request](#request)
* [Switching in the shop checkout](#switching-in-the-shop-checkout)
* [Switching on the easyCredit page](#switching-on-the-easycredit-page)
* [Response Format](#success-response)
* [Error response](#error-response-4xx)

## Overview
This API is designed to create payment details from CommerceTools using the provided `cartId`, needed `redirectLinks` and `customerRelationship` data. The optional `paymentType` selects `INSTALLMENT_PAYMENT` (default) or `BILL_PAYMENT`.
<br />

## Conditions

To use this functionality, the following conditions must be met:

1. A valid `cartId` must be provided, corresponding to a cart in CommerceTools.
2. The session must be authenticated, and a valid session token must be included in the request.
<br />

## Workflow

1. **Validate and get `cart`**: Retrieve CT `cart` instance by `cartId` and validate its addresses and currency.
2. **Check payment type availability**: The selected payment type must be activated for the webshop and the cart total must be within its effective limits. Activation status and limits come from the cached easyCredit webshop configuration (`GET /payment/v3/webshop/{webShopId}`), subject to the fallback policy in [Payment type availability](#payment-type-availability). `BILL_PAYMENT` additionally requires `BILL_PAYMENT_ENABLED=1` and a cart without excluded items, see [Excluded cart items](./GetPaymentMethod.md#excluded-cart-items). The cart is fetched again for this request, so items added after the GET payment method call are checked too.
3. **Discard stale attempts and freeze the cart**: Earlier easyCredit payments on the cart are discarded or refused, see [Switching in the shop checkout](#switching-in-the-shop-checkout). The cart is then frozen with the `HardFreeze` strategy, see [Cart freeze](#cart-freeze).
4. **Create CT Payment**: Create the payment from the cart and attach it to the cart. `paymentMethodInfo` records the selected type, see [Stored payment method](#stored-payment-method).
5. **Create EC transaction**: Convert CT data into EC data (including the `paymentType`) and create the transaction. `paymentSwitchPossible` is always sent as `true`, there is no configuration flag. The connector supports a switch between installment and pay by invoice when easyCredit offers one on its page, see [Switching on the easyCredit page](#switching-on-the-easycredit-page).
6. **Add CT transaction**: An `Authorization` transaction is added to the CT payment, with the easyCredit `transactionId` as `interactionId` and the `technicalTransactionId` in a custom field. Its state is `Initial`, or `Failure` if easyCredit answers with a negative decision (the API then returns `400 TransactionNotSuccess` and unfreezes the cart).

![Create payment flow](./assets/easycredit-create-payment-flow.png)
<br />

## Stored payment method

The `paymentType` is only a selector. The connector validates it server-side and stores it on the CT payment:

| `paymentMethodInfo` field | Value |
| --- | --- |
| `paymentInterface` | `easycredit` (unchanged, payment lookup and validation key on this field) |
| `method` | `INSTALLMENT_PAYMENT` or `BILL_PAYMENT` |
| `name` | `{ "de": "easyCredit Ratenkauf" }` or `{ "de": "easyCredit Rechnung" }` |

Payments created before this change have `method: "easycredit"`. They are treated as `INSTALLMENT_PAYMENT`. Merchant or order flows that identify easyCredit payments by `method === 'easycredit'` must use `paymentInterface` instead.
<br />

## Cart freeze

The cart is frozen with `HardFreeze`: prices, discounts and discount codes stay fixed and shipping methods cannot be set (commercetools Cart freeze documentation). A cart that is frozen with another strategy (for example `SoftFreeze`) is unfrozen and frozen again with `HardFreeze`; a cart that is already hard-frozen is left as it is. Merchants can therefore not change the shipping method after the payment was started.

Freezing can reprice the cart (unfreezing documents it, freezing an active cart does not say either way). If the total, the currency or the line items of the frozen cart differ from the cart that was validated (for example a gift line item added by a cart discount), the limits, the payment type availability and the [excluded cart items](./GetPaymentMethod.md#excluded-cart-items) are validated again on the frozen cart. On failure no payment is created and the cart is unfrozen again.

Validation failures (addresses, currency, payment type availability) leave the cart untouched, including a cart that was already frozen. Once the cart is frozen, every failure of the request unfreezes it again. Until the CT `Authorization` transaction is written, the CT payment is an orphan on the cart. If the easyCredit call or writing that transaction fails, the connector also removes the payment from the cart in the same update that unfreezes it. A negative decision writes a `Failure` transaction and only unfreezes the cart. If this cleanup fails, it is only logged and the original error is returned.
<br />

## Switching in the shop checkout

If the shopper changes the payment method in the shop checkout, the shop calls this endpoint again for the same cart. A frozen cart can still hold the earlier easyCredit payment. The connector does not reuse that payment, it replaces it. After the cart validation succeeded (a rejected request leaves the cart untouched) and before the cart is frozen, it checks every payment of the cart whose `paymentMethodInfo.paymentInterface` is `easycredit` (case-insensitive) in two passes.

Pass 1 only reads, so a refusal changes nothing:

| Earlier payment | Result |
| --- | --- |
| No `Authorization` transaction, or the transaction is `Failure` | Ignored, the payment stays on the cart. |
| Transaction `Pending` or `Success` | `400 PaymentInProgress`. |
| Transaction `Initial` and easyCredit (5 second limit) reports `AUTHORIZED` | `400 PaymentInProgress`. |
| Transaction `Initial` and easyCredit answers `404` or `410` (the transaction is gone, for example invalidated by a newer one), or any status other than `AUTHORIZED` (for example `OPEN`, `PREAUTHORIZED`, `DECLINED`, `EXPIRED`) | Stale, will be discarded. |
| Transaction `Initial` and the easyCredit lookup fails for any other reason (network error, timeout, `5xx`) | `400 PaymentInProgress`. |

Pass 2 runs only if at least one attempt is stale. The transaction of every stale attempt is set to `Failure`, but only if it is still `Initial`. An attempt that is already `Failure` (for example because the cancel webhook ran in between) counts as done. If an attempt is no longer `Initial` (for example it moved to `Pending` or `Success` after pass 1, because an authorization request was sent and written as `Pending`), pass 2 refuses with `400 PaymentInProgress` and that attempt is neither failed nor removed. This check is not airtight: the authorize call writes `Pending` only after it sent the authorization request, so there is a short window in which the attempt is still `Initial` although the request is out. An attempt discarded in that window is failed here, the authorize call then logs `EASYCREDIT_AUTHORIZATION_SENT_ATTEMPT_DISCARDED` and stops, and if easyCredit authorizes it anyway, the connector logs `EASYCREDIT_AUTHORIZED_CT_NOT_SUCCESS` when the easyCredit callback arrives and its status lookup succeeds. The merchant has to follow that up manually, there is no automatic void at easyCredit. Stale attempts handled earlier in the same loop then already have a `Failure` transaction and stay attached to the cart, and this step does not unfreeze the cart. A retry ignores `Failure` attempts. Otherwise one cart update unfreezes the cart (if it is frozen), removes all stale payments and freezes it again with `HardFreeze`. Creating the new payment continues as described in the [workflow](#workflow), including the re-validation if unfreezing repriced the cart, see [Cart freeze](#cart-freeze).

Other payment methods are not visible to the connector. If the shopper switches to a payment method that is not easyCredit, the shop must call the cancel webhook so that the payment is failed and the cart is unfrozen, see [Cancel Payment](./CancelPayment.md#switching-to-another-payment-method). The same webhook is the way out of an attempt that is stuck in `Pending`: this endpoint refuses it with `PaymentInProgress`, the cancel webhook cancels it unless easyCredit already reports `AUTHORIZED`. Alternatively wait until the attempt is decided, see [Timeout handling](./AuthorizePayment.md#timeout-handling).
<br />

## Switching on the easyCredit page

Every `POST /transaction` to easyCredit carries `paymentSwitchPossible: true`, and the connector supports a switch between installment and pay by invoice when easyCredit offers one on its page. The easyCredit sandbox page did not offer a switch on 2026-10-26 (checked: financing terms, data entry, decision pages, plan editor, info FAQ), so the switch path is covered by unit tests only and is not verified end to end against the live service. A deployment that sees a switch should check the first one. The connector does not learn about a switch from a redirect: `urlSuccess` goes straight to the shop. It reads the final payment type from easyCredit when the shop calls [Get Payment](./GetPayment.md) or [Authorize Payment](./AuthorizePayment.md), and when the easyCredit callback arrives. The final type is validated again for the cart before authorization, see [Authorize Payment](./AuthorizePayment.md#sync-the-final-payment-type). As the flag is always `true`, a shopper who is offered a switch can pick pay by invoice after the credit check even if it is disabled (`BILL_PAYMENT_ENABLED`) or the cart fails one of its rules. The authorization is then rejected.
<br />

## Transaction custom fields

The `Authorization` transaction carries custom fields of one shared custom type. Its key is `TRANSACTION_CUSTOM_TYPE_KEY` (default `easy-credit-technical-transaction-id`) and the post-deploy script creates it or adds missing field definitions:

| Field | Type | Content |
| --- | --- | --- |
| `easyCreditTechnicalTransactionId` | String | easyCredit `technicalTransactionId`, set when the transaction is created. |
| `easyCreditInterest` | Number | `decision.interest` from easyCredit, in EUR. Only for installment payments. |
| `easyCreditTotalValue` | Number | `decision.totalValue` from easyCredit, in EUR. Only for installment payments. |

The interest fields are written when [Get Payment](./GetPayment.md), [Authorize Payment](./AuthorizePayment.md) or the easyCredit callback reads the easyCredit transaction, whenever they differ from the stored values. This also covers a changed term on the easyCredit page without a type switch. A switch to pay by invoice removes them. They are informational: there is no interest line item in the cart, because a frozen cart rejects price-affecting updates and the cart total must equal the easyCredit `orderValue`, which excludes interest. The `Charge` transaction added by [Capture Payment](./CapturePayment.md) copies only `easyCreditTechnicalTransactionId`. The interest fields stay on the `Authorization` transaction, which holds the credit terms the shopper agreed to.

**Existing deployments** do not have the two interest field definitions until the post-deploy script runs again. Redeploy the connector to run it. Until then, writing the fields fails: the connector logs a warning (`Failed to record the interest and total value on the transaction`) and, from `updatePayment`, an error (`Error in updatePayment`) on every installment Get Payment or Authorize Payment call. Nothing else changes.
<br />

## Payment type availability

The request is rejected before any cart or payment change if:

- easyCredit rejected the webshop request with a permanent error or sent an invalid installment configuration, or a known deactivation/permanent failure blocks fallback without usable cached data, see [Webshop configuration](GetPaymentMethod.md#webshop-configuration) (`503 EasyCreditUnavailable`),
- the selected payment type is disabled or not activated for the webshop (error code below). For installment this means `availability: false` or `installmentPaymentActive: false`. For bill this means `BILL_PAYMENT_ENABLED` is not `1`, `availability: false`, `billPaymentActive: false`, absent or invalid bill configuration, or stale/default webshop data (bill fails closed). The error is `400 PaymentTypeNotAvailable`,
- `BILL_PAYMENT` is enabled but the cart contains an excluded product type or custom line item (`400 BillPaymentExcludedItems`). This takes precedence over `InvalidAmount`. A matching custom line item skips the product type lookup,
- `BILL_PAYMENT` is enabled but the product type lookup fails, for example because of a missing `view_product_types` scope or a commercetools outage (`503 BillPaymentCheckFailed`). This takes precedence over `InvalidAmount`,
- the payment type is enabled but the cart total is outside its effective limits (`400 InvalidAmount`). A disabled type never returns `InvalidAmount`, only `PaymentTypeNotAvailable`.

The optional request field `paymentType` defaults to `INSTALLMENT_PAYMENT`. Any other value is rejected by the body schema with `400 InvalidJsonInput`. The checkout component sends the payment type it was built with. `BILL_PAYMENT` is accepted if it is enabled and activated for the webshop and the customer is a private person. A GET payment method response for `BILL_PAYMENT` and this endpoint use the same check.

Limits are defined by easyCredit per webshop and cannot be configured in the connector. During temporary failures, installment uses usable cached limits or, if none remain, the legacy 200 € to 10.000 € defaults, unless a known deactivation or permanent failure blocks fallback. Bill payment is unavailable with stale or default data. See [Get Payment Method](./GetPaymentMethod.md#webshop-configuration) for caching and retries.

The billing address must be complete for both payment types, see the `InvalidAddress` error below.
<br />

## Example URL Call

To create a payment, you can make a call to the following URL. Ensure to include the session header for authentication.

### Request

**HTTP Method:** `POST`  
**URL:** `https://your-api-endpoint.com/payments/`  
**Headers:**
```http
X-Session-Id: <session_id>
Content-Type: application/json
```

To obtain the `X-Session-Id`, refer to the [CommerceTools Sessions API documentation](https://docs.commercetools.com/checkout/installing-checkout#create-checkout-sessions).

**Parameters:**

```json
{
    // cartId of a valid cart
    // a valid cart must have
    //     a total amount within the effective limits of the selected payment type (webshop limits, or outage defaults for installment)
    //     identical, complete billing and shipping addresses in Germany
    "cartId": "YOUR_CART_ID", 
    // optional, defaults to INSTALLMENT_PAYMENT. Use BILL_PAYMENT for pay by invoice
    "paymentType": "INSTALLMENT_PAYMENT",
    "redirectLinks": {
        "urlSuccess": "https://example.com/success",
        "urlCancellation": "https://example.com/cancellation",
        "urlDenial": "https://example.com/denial"
    },
    "customerRelationship": {
        "customerStatus": "NEW_CUSTOMER",
        "customerSince": "yyyy-MM-dd",
        "numberOfOrders": 0
    }
}
```

### Response Format

#### Success Response:

On successful creation of a payment, the API returns a `201 Created` response along with the following structure:

```json
{
    "technicalTransactionId": "c2b818bb.1120065723LwY1rRZcggpX9az7qUgAvdEh",
    "paymentId": "25559370-d4a0-4291-b84e-b0f7e46d6972",
    "redirectUrl": "https://ratenkauf.easycredit.de/app/payment/c2b818bb.1120065723LwY1rRZcggpX9az7qUgAvdEh/finanzierungsvorgaben",
    "transactionInformation": {
        "status": "OPEN",
        "decision": {
            "decisionOutcome": "",
            "decisionOutcomeText": null
        }
    }
}
```

#### Error Response 4xx:  

If the provided `cartId` is invalid, or if there is an issue with the session token, the API will return a `404 Not found` error:

```json
{
    "message": "The Resource with ID '35c84223c-d598-4d76-a059-ed5b3da396b7' was not found.",
    "statusCode": 404,
    "errors": [
        {
            "code": 404,
            "message": "The Resource with ID '35c84223c-d598-4d76-a059-ed5b3da396b7' was not found.",
            "fields": [
                {
                    "code": "ResourceNotFound",
                    "message": "The Resource with ID '35c84223c-d598-4d76-a059-ed5b3da396b7' was not found."
                }
            ]
        }
    ]
}
```

#### Error Response 400:

If the cart fails validation, the API returns a `400 Bad Request` error. The checks run in the same order as in [Get Payment Method](./GetPaymentMethod.md#workflow): for installment the address and currency checks run first, for pay by invoice the payment type checks run first. `InvalidAmount` and `PaymentTypeNotAvailable` are never returned together with an address, currency or customer error.

| Code | Reason |
| --- | --- |
| `InvalidBillingAddress`, `InvalidShippingAddress` | The cart has no billing or shipping address. |
| `AddressesUnmatched` | Billing and shipping address differ (including `additionalStreetInfo`, see [Get Payment Method](./GetPaymentMethod.md)), or the country is not `DE`. |
| `InvalidAddress` | The billing address is incomplete or invalid: `firstName`, `lastName`, `streetName` and `city` must not be blank and `postalCode` must be 5 digits. Only reported if both addresses exist, in addition to the codes above. |
| `InvalidCurrency` | The cart currency is not `EUR`. |
| `CorporateCustomerNotAllowed` | Only for `BILL_PAYMENT`: the cart has a Business Unit or a company in the billing or shipping address. |
| `InvalidAmount` | The cart total is outside the effective limits of the selected payment type, which is enabled. The message contains the limits from fresh or usable stale webshop data, or the installment defaults. |
| `PaymentTypeNotAvailable` | The selected payment type is disabled or not activated for the webshop. |
| `BillPaymentExcludedItems` | `BILL_PAYMENT` was selected but the cart contains a voucher or another excluded item, see [Excluded cart items](./GetPaymentMethod.md#excluded-cart-items). |
| `BillPaymentCheckFailed` | `503`: `BILL_PAYMENT` was selected but the excluded product types could not be loaded from commercetools, so the cart items could not be checked. Check the `view_product_types` scope and the processor logs. |
| `PaymentInProgress` | An earlier easyCredit payment on the cart is `Pending` or `Success`, is `Initial` and authorized at easyCredit, or could not be checked at easyCredit. No new payment is created. See [Switching in the shop checkout](#switching-in-the-shop-checkout). The message offers to cancel or wait, which does not fit every case: for a `Success` attempt the payment is already authorized, so create the order from it (the cancel webhook refuses it). For an `Initial` attempt that easyCredit reports as `AUTHORIZED`, call [Authorize Payment](./AuthorizePayment.md). For a `Pending` attempt, wait or call the [cancel webhook](./CancelPayment.md). |
| `TransactionNotSuccess` | easyCredit answered the new transaction with a negative decision. The message is the `decisionOutcomeText`. The CT transaction is `Failure` and the cart is unfrozen. |

easyCredit errors (for example `5xx`) are returned with the upstream HTTP status and the title easyCredit sent as code, and the cart is unfrozen as described in [Cart freeze](#cart-freeze).

Example for a webshop whose installment limits are 200 € to 10.000 €:

```json
{
    "message": "Die Summe des Warenkorbs muss zwischen 200€ und 10.000€ liegen.",
    "statusCode": 400,
    "errors": [
        {
            "code": "InvalidAmount",
            "message": "Die Summe des Warenkorbs muss zwischen 200€ und 10.000€ liegen.",
            "fields": {
                "webShopId": "2.de.7607.2"
            }
        }
    ]
}
```
