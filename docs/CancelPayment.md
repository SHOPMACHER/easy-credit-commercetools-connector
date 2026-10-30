# Cancel Payment

* [Switching to another payment method](#switching-to-another-payment-method)
* [Representation: CT Payment](#representation-ct-payment)
* [Creating CommerceTools Actions from Easy Credit's Response](#creating-commercetools-actions-from-easy-credits-response)

## Overview
This functionality is designed to cancel pending payments created with Easy Credit that have not yet been completed.

<br />

## Conditions

To use this functionality, the customer must have a payment that is created but remains unpaid. For a successful cancellation, the CommerceTools Payment object should meet these criteria:

1. The payment must be an Easy Credit payment: `paymentMethodInfo.paymentInterface` is `easycredit`. The comparison is case-insensitive, so a value such as `EasyCredit` (as in the example below) matches too. The connector itself writes `easycredit`.
2. A transaction of type `Authorization` should exist with a state of either `Pending` or `Initial`.
3. The transaction should include an `interactionId`, which is the Easy Credit Payment ID.
4. The status of the Easy Credit transaction should be verified through the Easy Credit API. If the transaction status is AUTHORIZED, the cancellation will be blocked, and an error will be returned to indicate that cancellations are not allowed for authorized Easy Credit payments. If Easy Credit no longer knows the transaction (`404` or `410`, for example because a newer transaction invalidated it), the check is skipped and the cancellation continues, so the cart can still be unfrozen. Any other failure of the lookup is returned and nothing is changed.
5. A `Pending` transaction means the authorization request was already sent to Easy Credit (see [Authorize Payment](./AuthorizePayment.md)). Cancelling it is still allowed, but Easy Credit can authorize between the status check and the `Failure` write. After the `Failure` write the connector therefore checks the Easy Credit status once more, with a 5 second limit. If it is `AUTHORIZED`, the connector logs `EASYCREDIT_AUTHORIZED_CT_NOT_SUCCESS` (reason: cancelled while the authorization was in flight). The cancellation itself still completes, and the cart is unfrozen. A failing re-check is logged as a warning and does not fail the cancellation. There is no automatic void at Easy Credit, so a logged event needs manual follow-up.

<br />

## Switching to another payment method

The connector cannot see that a shopper picks a payment method in the shop checkout that is not easyCredit. The shop must call this webhook for the open easyCredit payment of the cart in that case. Otherwise the cart stays `Frozen` with the old easyCredit payment (the cart was frozen when the payment was created, see [Create Payment](./CreatePayment.md#cart-freeze)). The call sets the `Authorization` transaction to `Failure` and unfreezes the cart, as described below.

If the shopper switches to easyCredit again (installment or pay by invoice), no cancel call is needed: [Create Payment](./CreatePayment.md#switching-in-the-shop-checkout) discards the stale attempt itself. It refuses a `Pending` attempt with `400 PaymentInProgress`, and this webhook is the way out of that state, unless easyCredit already reports `AUTHORIZED`.

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
        "method": "credit"
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

<br />

## Example URL Call

To cancel a payment, you can make a call to the following URL.

### Request

**HTTP Method:** `GET`  
**URL:** `https://your-api-endpoint.com/webhook/{{payment_id}}/cancel?redirectUrl={{redirect_url}}`  
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

If the cancellation is processed successfully and requires a redirect, the API responds with a redirect status.

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

When a payment is successfully canceled in Easy Credit, the webhook will update the CommerceTools Payment and Cart with the following actions:

| Action Name (CT)        | Value                                                 |
|-------------------------|-------------------------------------------------------|
| changeTransactionState   | { "transactionId": "<interactionId>", "state": "Failure" } |
| unfreezeCart            | { "action": "unfreezeCart" }                         |
