# Cancel Payment

For the terms in this document (EC, CT, easyCredit status values, cart freeze), see [Terms](./CommercetoolsFrontendIntegration.md#terms).

* [Switching to another payment method](#switching-to-another-payment-method)
* [Representation: CT Payment](#representation-ct-payment)
* [Creating CommerceTools Actions from Easy Credit's Response](#creating-commercetools-actions-from-easy-credits-response)

## Overview
This function cancels an easyCredit payment that is not complete.

<br />

## Conditions

To cancel a payment, the customer must have a payment that is created but not paid. The CommerceTools Payment object must meet these criteria:

1. The payment is an easyCredit payment: `paymentMethodInfo.paymentInterface` is `easycredit`. The comparison is not case-sensitive. A value such as `EasyCredit` (in the example below) also matches. The connector writes `easycredit`.
2. A transaction of type `Authorization` exists. Its state is `Initial` or `Pending`. For `Pending`, see step 5.
3. The transaction has an `interactionId`. This is the easyCredit Payment ID.
4. The connector checks the status of the easyCredit transaction through the easyCredit API.
   - If the status is AUTHORIZED, the connector blocks the cancellation. It returns an error: you cannot cancel an authorized easyCredit payment.
   - If easyCredit no longer knows an `Initial` transaction (`404` or `410`), the connector skips the check and continues the cancellation. This can occur when a newer transaction invalidates the old one. The cart can then unfreeze.
   - If the lookup fails for any other reason, the connector returns the error and changes nothing.
5. `Pending` means that the connector already sent the authorization request to easyCredit (see [Authorize Payment](./AuthorizePayment.md)). easyCredit can still authorize the payment. easyCredit has no cancel operation for this case: its cancellation endpoint is only for Direct Sales shops. Thus the connector cancels a `Pending` transaction only if easyCredit reports a final status:
   - `DECLINED` or `EXPIRED`: easyCredit cannot authorize the payment anymore. The connector cancels the payment and unfreezes the cart.
   - `AUTHORIZED`: the connector returns `400 TransactionIsAuthorized` (see step 4).
   - Any other status, or easyCredit no longer knows the transaction (`404` or `410`): the connector returns `400 PaymentInProgress`. It does not change the payment or the cart. The authorization callback or [Authorize Payment](./AuthorizePayment.md) sets the final state. If the payment stays `Pending`, see [Settle a stuck Pending payment](#settle-a-stuck-pending-payment).
6. The connector writes `Failure` only if the transaction state did not change after step 2. It reads the payment again before the write. commercetools refuses the write if the payment changed after this read (`409`). The connector then reads the payment again and checks the state again. It does this one time. A second `409` is returned as an error. Thus a parallel authorization that sets `Pending` or `Success` cannot end in `Failure`:
   - The transaction is now `Pending`: the connector returns `400 PaymentInProgress` and changes nothing.
   - The transaction is now `Success`: the connector returns `400 TransactionIsAuthorized` and changes nothing.
   - The transaction is now `Failure` (a parallel cancel or a decline callback): the connector unfreezes the cart and returns success.

<br />

## Switching to another payment method

The connector cannot see when a shopper picks a payment method that is not easyCredit in the shop checkout. In this case, the shop must call this webhook for the open easyCredit payment of the cart, if its `Authorization` transaction is `Initial`. If the shop does not call the webhook, the cart stays `Frozen` with the old easyCredit payment. The connector froze the cart when it created the payment (see [Create Payment](./CreatePayment.md#cart-freeze)). The call sets the `Authorization` transaction to `Failure` and unfreezes the cart, as described below. If the transaction is `Pending` or `Success`, do not call this webhook. The webhook refuses the cancel (`400 PaymentInProgress` or `400 TransactionIsAuthorized`). The shopper must not switch the payment method for this cart. The [order recovery job](./CommercetoolsFrontendIntegration.md#order-recovery-job) completes the payment.

If the shopper switches to easyCredit again (installment or pay by invoice), you do not need to call the cancel webhook. [Create Payment](./CreatePayment.md#switching-in-the-shop-checkout) discards the stale attempt itself. It refuses a `Pending` attempt with `400 PaymentInProgress`. The cancel webhook also refuses a `Pending` attempt. Wait for the order recovery job.

If easyCredit no longer finds the transaction because it expired (in the sandbox, about 30 minutes after the last action of the shopper; easyCredit does not document the expiry), the connector still cancels the payment. An expired transaction cannot be authorized.

The call is idempotent. If the `Authorization` transaction is already `Failure`, the connector does not change the payment. It still responds with success or the redirect. This occurs, for example, when the shopper opens the cancel link again through the browser history.

After the cancellation, the cart unfreezes. The exception: another easyCredit payment on the same cart is still `Initial` or `Pending`. A new checkout discards older `Initial` easyCredit payments on the cart (see the create flow). The checkout is refused while one is `Pending` or authorized at easyCredit.

<br />

## Settle a stuck Pending payment

A `Pending` payment can stay `Pending`. For example, easyCredit no longer finds the transaction, or the status lookup returns an error. Then the cart stays frozen, and Create Payment refuses new attempts with `400 PaymentInProgress`. Do these steps:

1. Call [Authorize Payment](./AuthorizePayment.md) with `{ "waitForAuthorization": true }`. If easyCredit reports `AUTHORIZED`, authorize sets `Success`. If easyCredit reports `DECLINED` or `EXPIRED`, authorize sets `Failure` and unfreezes the cart.
2. If the payment is still `Pending`, examine the transaction in the easyCredit merchant portal.
3. If the portal shows the transaction as authorized, do not change the payment. Create the order, or settle the payment manually in the portal.
4. If the portal shows that the transaction is not authorized, use the commercetools API:
   1. Set the `Authorization` transaction to `Failure` with the update action `changeTransactionState`.
   2. If no other easyCredit payment of the cart is `Initial` or `Pending`, unfreeze the cart with the update action `unfreezeCart`.

<br />

## Several payments on one order

A cancelled attempt stays on the cart and on the order with a `Failure` transaction. To find the payment that the shopper used, see [Find the used payment](./CommercetoolsFrontendIntegration.md#find-the-used-payment).

<br />

## Representation: CT Payment

<details>
  <summary>Example of the final state of Payment object after cancelling successfully</summary>

```json
{
    "id": "c0887a2d-bfbf-4f77-8f3d-fc33fb4c0920",
    "version": 8,
    "key": "ord_5h2f3w",
    "amountPlanned": {
        "type": "centPrecision",
        "currencyCode": "EUR",
        "centAmount": 1604,
        "fractionDigits": 2
    },
    "paymentMethodInfo": {
        "paymentInterface": "EasyCredit",
        "method": "easycredit"
    },
    "transactions": [
        {
            "id": "869ea4f0-b9f6-4006-bf04-d8306b5c1234",
            "type": "Authorization",
            "interactionId": "<EasyCreditPaymentID>",
            "amount": {
                "type": "centPrecision",
                "currencyCode": "EUR",
                "centAmount": 1604,
                "fractionDigits": 2
            },
            "state": "Failure"
        }
    ],
    "interfaceInteractions": []
}
```

</details>

<br />

## Example URL Call

There are two forms of the call.

### Request from your server

**HTTP Method:** `GET`  
**URL:** `https://your-api-endpoint.com/webhook/{{payment_id}}/cancel`  

Use this form from your BFF or a server job, for example when the shopper switches to a payment method that is not easyCredit. The call has no query parameters. It needs no authentication and no signature. On success, it returns `200` with `{ "paymentId": "..." }`. On an error, it returns the error, for example `400 TransactionIsAuthorized` or `400 PaymentInProgress`. See [Success Response](#success-response) and [Error Response](#error-response).

### Request from the browser

**HTTP Method:** `GET`  
**URL:** `https://your-api-endpoint.com/webhook/{{payment_id}}/cancel?redirectUrl={{redirect_url}}&successUrl={{success_url}}&sig={{signature}}`  

The connector builds this URL when it creates the payment. It gives the URL to easyCredit. `successUrl` is the `urlSuccess` of the shop. `sig` is the hex HMAC-SHA256 of the JSON array `["{{payment_id}}", "{{redirect_url}}", "{{success_url}}"]`, with `API_PASSWORD` as the key. The URLs in the array are plain, not URL-encoded. Use `null` if there is no success URL. If the call has a `redirectUrl` without a valid `sig`, the connector rejects it with `400 InvalidRedirectUrl`. It then does not cancel the payment. This way, nobody can use the route as an open redirect.  

With a valid `redirectUrl`, the shopper always returns to the shop:

| Outcome | Redirect target |
|---|---|
| Cancelled, or already cancelled | `redirectUrl` |
| Payment already authorized (commercetools `Success`, or easyCredit `AUTHORIZED`) | `successUrl`. The connector does not change the payment or the cart. |
| Any other error, also `400 PaymentInProgress` | `redirectUrl` with `error=cancel_failed` in its query, so the shop can show a message. The connector adds this parameter only to an absolute URL. A relative URL stays as it is. The connector logs the error and does not change the payment. |

**Headers:**
```http
Content-Type: application/json
```
<br />

### Success Response

**Status:** `200`

**Body:**

```json
{
  "paymentId": "<payment_id>"
}
```

If the cancellation succeeds and a redirect is necessary, the API responds with a redirect status.

**Status:** `302`

**Headers:**
```http
Location: {{redirect_url}}
```

### Error Response

**Status:** `400`

**Body:**

```json
{
  "statusCode": 400,
  "message": "You are not allowed to cancel a payment with Easy Credit AUTHORIZED transaction.",
  "errors": [
    {
      "code": "TransactionIsAuthorized",
      "message": "The transaction is in an AUTHORIZED state and cannot be canceled."
    }
  ]
}
```

<br />

## Creating CommerceTools Actions from Easy Credit's Response

When easyCredit cancels a payment, the webhook updates the CommerceTools Payment and Cart with these actions:

| Action Name (CT)        | Value                                                 |
|-------------------------|-------------------------------------------------------|
| changeTransactionState   | { "transactionId": "<interactionId>", "state": "Failure" } |
| unfreezeCart            | { "action": "unfreezeCart" }                         |
