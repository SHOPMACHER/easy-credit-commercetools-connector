# Create Payment

For the terms in this document (EC, CT, easyCredit status values, cart freeze), see [Terms](./CommercetoolsFrontendIntegration.md#terms).

* [Create payment workflow](#workflow)
* [Example request](#request)
* [Switching in the shop checkout](#switching-in-the-shop-checkout)
* [Switching on the easyCredit page](#switching-on-the-easycredit-page)
* [Response Format](#success-response)
* [Error response](#error-response-4xx)

## Overview
This API creates payment details from CommerceTools. It uses the `cartId`, the necessary `redirectLinks` and the `customerRelationship` data. The optional `paymentType` selects `INSTALLMENT_PAYMENT` (default) or `BILL_PAYMENT`.
<br />

## Conditions

To use this function, these conditions must be true:

1. You give a valid `cartId` that belongs to a cart in CommerceTools.
2. The session is authenticated. The request has a valid session token.
<br />

## Workflow

1. **Get `cart`**: Get the CT `cart` instance with the `cartId`. If the selected payment type is off in the connector configuration (`INSTALLMENT_PAYMENT_ENABLED=0` or `BILL_PAYMENT_ENABLED=0`), the connector rejects the request before it reads the cart.
2. **Check payment type availability, then the cart**: The connector checks the selected payment type, see [Payment type availability](#payment-type-availability). Then the connector validates the addresses and the currency. The connector gets the cart again for this request. It therefore also checks items that you added after the GET payment method call.
3. **Discard stale attempts and freeze the cart**: The connector discards or refuses earlier easyCredit payments on the cart, see [Switching in the shop checkout](#switching-in-the-shop-checkout). Then it freezes the cart, see [Cart freeze](#cart-freeze).
4. **Create CT Payment**: Create the payment from the cart and attach it to the cart. `paymentMethodInfo` records the selected type, see [Stored payment method](#stored-payment-method).
5. **Create EC transaction**: Convert the CT data into EC data (the `paymentType` included). Create the transaction. `paymentSwitchPossible` is `true` only if `BILL_PAYMENT_ENABLED=1`. The connector then supports a switch between installment and pay by invoice, if easyCredit offers one on its page. See [Switching on the easyCredit page](#switching-on-the-easycredit-page).
6. **Add CT transaction**: Add an `Authorization` transaction to the CT payment. Its `interactionId` is the easyCredit `transactionId`. The `technicalTransactionId` is in a custom field. The state is `Initial`. If easyCredit answers with a negative decision, the state is `Failure`. The API then returns `400 TransactionNotSuccess` and unfreezes the cart.

![Create payment flow](./assets/easycredit-create-payment-flow.png)
<br />

## Stored payment method

The `paymentType` is only a selector. The connector validates it on the server and stores it on the CT payment:

| `paymentMethodInfo` field | Value |
| --- | --- |
| `paymentInterface` | `easycredit` (no change: payment lookup and validation use this field) |
| `method` | `easycredit` for installment, as in earlier versions, or `BILL_PAYMENT` |
| `name` | `{ "de": "easyCredit Ratenkauf" }` or `{ "de": "easyCredit Rechnung" }` |

The connector treats every `method` other than `BILL_PAYMENT` as `INSTALLMENT_PAYMENT`. Some order flows identify easyCredit payments with `method === 'easycredit'`. These flows keep working for installment, but they miss pay by invoice. Use `paymentInterface` to find all easyCredit payments.
<br />

## Cart freeze

**Freeze.** The connector freezes the cart when it creates the payment:

- A cart that is not frozen gets the default strategy (`SoftFreeze`), as in earlier versions.
- A cart that is already frozen keeps its strategy.
- With `SoftFreeze`, you can still change the shipping method and remove discount codes (commercetools Cart freeze documentation).

**Checks at authorization.** The authorization checks that the cart is still frozen. It also checks that the cart total, the CT transaction amount and the easyCredit order value are identical. If the cart total changed after the payment started, the connector rejects the payment with `400 AmountMismatch`. It sets the transaction to `Failure`. See [Authorize Payment](./AuthorizePayment.md#workflow).

**Checks on the frozen cart.** The commercetools documentation says that unfreezing can reprice a cart. It does not say this for freezing. Thus the connector assumes that the frozen cart can differ from the validated cart. For example, a cart discount can add a gift line item. If the total, the currency or the line items differ, the connector validates the frozen cart again:

- the limits
- the payment type availability
- the [excluded cart items](./GetPaymentMethod.md#excluded-cart-items)

If this validation fails, the connector creates no payment and unfreezes the cart again.

**Unfreeze after a failure.**

- If a validation before the freeze fails (addresses, currency, payment type availability), the cart stays as it is. This includes a cart that was already frozen.
- After the freeze, every failure of the request unfreezes the cart again.
- Until the connector writes the CT `Authorization` transaction, the CT payment is an orphan on the cart. If the easyCredit call fails, or the write of that transaction fails, the connector also removes the payment from the cart. It does this in the same update that unfreezes the cart.
- A negative decision writes a `Failure` transaction and only unfreezes the cart.
- If this cleanup fails, the connector only logs it and returns the original error.
<br />

## Switching in the shop checkout

If the shopper changes the payment method in the shop checkout, the shop calls this endpoint again for the same cart. A frozen cart can still hold the earlier easyCredit payment. The connector does not reuse that payment. It replaces it. The connector does this after the cart validation succeeds (a rejected request leaves the cart as it is) and before it freezes the cart. It checks every payment of the cart whose `paymentMethodInfo.paymentInterface` is `easycredit` (not case-sensitive). There are two passes.

Pass 1 only reads, so a refusal changes nothing:

| Earlier payment | Result |
| --- | --- |
| No `Authorization` transaction, or the transaction is `Failure` | Ignored. The payment stays on the cart. |
| Transaction `Pending` or `Success` | `400 PaymentInProgress`. |
| Transaction `Initial` and easyCredit (5 second limit) reports `AUTHORIZED` | `400 PaymentInProgress`. |
| Transaction `Initial` and easyCredit answers `404` or `410` (the transaction is gone, for example because a newer one invalidated it), or any status other than `AUTHORIZED` (for example `OPEN`, `PREAUTHORIZED`, `DECLINED`, `EXPIRED`) | Stale. The connector discards it. |
| Transaction `Initial` and the easyCredit lookup fails for any other reason (network error, timeout, `5xx`) | `400 PaymentInProgress`. |

Pass 2 runs only if at least one attempt is stale.

- The connector sets the transaction of every stale attempt to `Failure`, but only if it is still `Initial`. An attempt that is already `Failure` counts as done. This occurs, for example, when the cancel webhook ran in between.
- If an attempt is no longer `Initial`, pass 2 refuses with `400 PaymentInProgress`. The connector does not fail or remove that attempt. An example: the attempt moved to `Pending` or `Success` after pass 1, because the connector sent an authorization request and wrote `Pending`.
- This check is not airtight. An attempt that the connector discards while an authorize call sends its request gets `Failure`, but easyCredit can still authorize it. For this window and its log messages, see [Authorize Payment](./AuthorizePayment.md#workflow), step 5.
- If pass 2 refuses with `400 PaymentInProgress`, the stale attempts that the connector handled earlier in the same loop already have a `Failure` transaction. They stay attached to the cart. This step does not unfreeze the cart. A retry ignores `Failure` attempts.
- If pass 2 does not refuse, one cart update removes all stale payments. The connector unfreezes a frozen cart before this and freezes it again with its previous strategy in the same update.
- Creating the new payment continues as described in the [workflow](#workflow). This includes the new validation if unfreezing repriced the cart, see [Cart freeze](#cart-freeze).

The connector cannot see other payment methods. If the shopper switches to a payment method that is not easyCredit, the shop must call the cancel webhook for an `Initial` attempt. The webhook fails the payment and unfreezes the cart, see [Cancel Payment](./CancelPayment.md#switching-to-another-payment-method). This endpoint refuses an attempt that is `Pending` with `PaymentInProgress`. Do not cancel it automatically, because easyCredit can still authorize it. Wait until the attempt is decided, see [Timeout handling](./AuthorizePayment.md#timeout-handling), or let the [order recovery job](./CommercetoolsFrontendIntegration.md#order-recovery-job) complete it. Cancel a `Pending` attempt only by hand, after the easyCredit merchant portal shows that the transaction is not authorized.
<br />

## Switching on the easyCredit page

With `BILL_PAYMENT_ENABLED=1`, every `POST /transaction` to easyCredit has `paymentSwitchPossible: true`. The connector supports a switch between installment and pay by invoice, if easyCredit offers one on its page.

The easyCredit API has the transaction field `paymentSwitchPossible` and the endpoint `switchPaymentMethod`, see the [easyCredit API definition](https://ratenkauf.easycredit.de/api/payment/v3/openapi). The easyCredit sandbox page did not offer a switch on 2026-10-26 (checked: financing terms, data entry, decision pages, plan editor, info FAQ). Unit tests cover the switch path. When your deployment gets its first switch, check that the CT payment shows the final type.

The connector does not learn about a switch from a redirect: `urlSuccess` goes straight to the shop. It reads the final payment type from easyCredit in these cases:

- The shop calls [Get Payment](./GetPayment.md) or [Authorize Payment](./AuthorizePayment.md).
- The easyCredit callback arrives.

The connector validates the final type again for the cart before the authorization, see [Authorize Payment](./AuthorizePayment.md#sync-the-final-payment-type). A shopper who gets a switch offer can pick pay by invoice after the credit check, even if the cart fails one of its rules. The connector then rejects the authorization. With `BILL_PAYMENT_ENABLED=0`, the flag is `false`. easyCredit then offers no switch, and installment payments behave as in earlier versions.
<br />

## Transaction custom fields

The `Authorization` transaction has custom fields of one shared custom type. Its key is `TRANSACTION_CUSTOM_TYPE_KEY` (default `easy-credit-technical-transaction-id`). The post-deploy script creates the type or adds missing field definitions:

| Field | Type | Content |
| --- | --- | --- |
| `easyCreditTechnicalTransactionId` | String | easyCredit `technicalTransactionId`. The connector sets it when it creates the transaction. |
| `easyCreditInterest` | Number | `decision.interest` from easyCredit, in EUR. Only for installment payments. |
| `easyCreditTotalValue` | Number | `decision.totalValue` from easyCredit, in EUR. Only for installment payments. |

The connector writes the interest fields when [Get Payment](./GetPayment.md), [Authorize Payment](./AuthorizePayment.md) or the easyCredit callback reads the easyCredit transaction. It writes them when they differ from the stored values. This also covers a changed term on the easyCredit page without a type switch. A switch to pay by invoice removes them.

The interest fields are for information only. There is no interest line item in the cart, for two reasons. A frozen cart rejects updates that change the price. The cart total must equal the easyCredit `orderValue`, which excludes interest. The `Charge` transaction that [Capture Payment](./CapturePayment.md) adds copies only `easyCreditTechnicalTransactionId`. The interest fields stay on the `Authorization` transaction. It holds the credit terms that the shopper agreed to. To show the interest on the storefront, see [Get Payment](./GetPayment.md#showing-the-interest-on-the-storefront).

**Existing deployments** get the two interest field definitions from the post-deploy script of the 1.1.0 deployment. To check that this step succeeded, see the [upgrade notes](../CHANGELOG.md#details). Until the fields exist, the write of the fields fails. On every installment Get Payment or Authorize Payment call, the connector logs a warning (`Failed to record the interest and total value on the transaction`). From `updatePayment`, it also logs an error (`Error in updatePayment`). Nothing else changes.
<br />

## Payment type availability

For the selected payment type, the connector runs the same check as [Get Payment Method](./GetPaymentMethod.md#payment-type-availability), with the same error codes and the same order. If the check fails, the connector rejects the request before it changes a cart or a payment. For the limits, the caching and the retries, see [Webshop configuration](./GetPaymentMethod.md#webshop-configuration).

The request field `paymentType` is optional. It defaults to `INSTALLMENT_PAYMENT`. A request without it is therefore rejected with `PaymentTypeNotAvailable` if `INSTALLMENT_PAYMENT_ENABLED=0`. The body schema rejects any other value with `400 InvalidJsonInput`. The checkout component sends the payment type that it was built with.

The billing address must be complete for both payment types. See the `InvalidAddress` error below.
<br />

## Example URL Call

To create a payment, call this URL. Include the session header for authentication.

### Request

**HTTP Method:** `POST`  
**URL:** `https://your-api-endpoint.com/payments/`  
**Headers:**
```http
X-Session-Id: <session_id>
Content-Type: application/json
```

To get the `X-Session-Id`, see the [CommerceTools Sessions API documentation](https://docs.commercetools.com/checkout/installing-checkout#create-checkout-sessions).

**Parameters:**

| Field | Rule |
| --- | --- |
| `cartId` | The ID of a valid cart. A valid cart has a total amount within the limits of the selected payment type (from the easyCredit webshop configuration). It has identical, complete billing and shipping addresses in Germany. |
| `paymentType` | Optional. The default is `INSTALLMENT_PAYMENT`. Use `BILL_PAYMENT` for pay by invoice. |

```json
{
    "cartId": "YOUR_CART_ID",
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

If the connector creates the payment, the API returns a `201 Created` response with this structure:

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

If the session token is missing, not valid or expired, the API returns `401` with the code `invalid_token`. If no cart exists for `cartId`, the API returns a `404 Not found` error:

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

If the cart fails validation, the API returns a `400 Bad Request` error. The checks run in the same order as in [Get Payment Method](./GetPaymentMethod.md#workflow). For both payment types, the payment type checks run first. Then the address and currency checks run. The API never returns `InvalidAmount` and `PaymentTypeNotAvailable` together with an address, currency or customer error.

| Code | Reason |
| --- | --- |
| `InvalidBillingAddress`, `InvalidShippingAddress` | The cart has no billing or shipping address. |
| `AddressesUnmatched` | Billing and shipping address differ (`additionalStreetInfo` included, see [Get Payment Method](./GetPaymentMethod.md)), or the country is not `DE`. |
| `InvalidAddress` | The billing address is not complete or not valid: `firstName`, `lastName`, `streetName` or `city` is blank, or `postalCode` does not have 5 digits. The API reports this only if both addresses exist, in addition to the codes above. |
| `InvalidCurrency` | The cart currency is not `EUR`. |
| `CorporateCustomerNotAllowed` | Only for `BILL_PAYMENT`: the cart has a Business Unit or a company in the billing or shipping address. |
| `InvalidAmount` | The cart total is outside the limits of the selected payment type, which is enabled. The message has the limits from the fresh webshop configuration. |
| `PaymentTypeNotAvailable` | The selected payment type is disabled or not activated for the webshop. A disabled type never returns `InvalidAmount`. |
| `EasyCreditUnavailable` | `503`: the connector has no fresh easyCredit webshop configuration. This applies to both payment types. See [Webshop configuration](./GetPaymentMethod.md#webshop-configuration). |
| `InstallmentPaymentExcludedItems` | `INSTALLMENT_PAYMENT` was selected, but the cart has a voucher or another excluded item. See [Excluded cart items](./GetPaymentMethod.md#excluded-cart-items). |
| `InstallmentPaymentCheckFailed` | `503`: `INSTALLMENT_PAYMENT` was selected, but the connector could not load the excluded product types from commercetools. It could not check the cart items. Check the `view_product_types` scope and the processor logs. |
| `BillPaymentExcludedItems` | `BILL_PAYMENT` was selected, but the cart has a voucher or another excluded item. See [Excluded cart items](./GetPaymentMethod.md#excluded-cart-items). |
| `BillPaymentCheckFailed` | `503`: `BILL_PAYMENT` was selected, but the connector could not load the excluded product types from commercetools. It could not check the cart items. Check the `view_product_types` scope and the processor logs. |
| `PaymentInProgress` | An earlier easyCredit payment on the cart is `Pending` or `Success`, or is `Initial` and authorized at easyCredit, or the connector could not check it at easyCredit. The connector creates no new payment. See [Switching in the shop checkout](#switching-in-the-shop-checkout). The message offers to cancel or wait. This does not fit every case. For a `Success` attempt, the payment is already authorized: create the order from it (the cancel webhook refuses it). For an `Initial` attempt that easyCredit reports as `AUTHORIZED`, call [Authorize Payment](./AuthorizePayment.md). For a `Pending` attempt, wait. Call the [cancel webhook](./CancelPayment.md) only by hand, after the easyCredit merchant portal shows that the transaction is not authorized. |
| `TransactionNotSuccess` | easyCredit answered the new transaction with a negative decision. The message is the `decisionOutcomeText`. The CT transaction is `Failure` and the cart is unfrozen. |

**`504` from this call:** another payment API extension in the commercetools project can cause it. An API extension on payments without a `condition` also runs for easyCredit payments. If that extension is slow, commercetools stops the request. Make sure that each payment API extension has a `condition` for its own `paymentInterface`.

The API returns easyCredit errors (for example `5xx`) with the upstream HTTP status. The code is the title that easyCredit sent. The connector unfreezes the cart as described in [Cart freeze](#cart-freeze).

Example for a webshop with installment limits of 200 € to 10.000 €:

```json
{
    "message": "Die Summe des Warenkorbs muss zwischen 200€ und 10.000€ liegen.",
    "statusCode": 400,
    "errors": [
        {
            "code": "InvalidAmount",
            "message": "Die Summe des Warenkorbs muss zwischen 200€ und 10.000€ liegen.",
            "fields": {
                "webShopId": "<WEBSHOP_ID>"
            }
        }
    ]
}
```
