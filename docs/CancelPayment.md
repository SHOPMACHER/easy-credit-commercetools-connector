# Cancel Payment

* [Representation: CT Payment](#representation-ct-payment)
* [Creating CommerceTools Actions from Easy Credit's Response](#creating-commercetools-actions-from-easy-credits-response)

## Overview
This functionality is designed to cancel pending payments created with Easy Credit that have not yet been completed.

<br />

## Conditions

To use this functionality, the customer must have a payment that is created but remains unpaid. For a successful cancellation, the CommerceTools Payment object should meet these criteria:

1. The payment must be an Easy Credit payment.
2. A transaction of type `Authorization` should exist with a state of either `Pending` or `Initial`.
3. The transaction should include an `interactionId`, which is the Easy Credit Payment ID.
4. The status of the Easy Credit transaction should be verified through the Easy Credit API. If the transaction status is AUTHORIZED, the cancellation will be blocked, and an error will be returned to indicate that cancellations are not allowed for authorized Easy Credit payments.

If Easy Credit no longer finds the transaction because it expired (about 30 minutes after the shopper's last action), the payment is cancelled anyway, since an expired transaction can't be authorized.

The call is idempotent: if the `Authorization` transaction is already `Failure` (for example the shopper hits the cancel link again through browser history), the connector does not change the payment and still responds with success or the redirect.

After cancelling, the cart is unfrozen unless another Easy Credit payment on the same cart is still `Initial` or `Pending`. Starting a new checkout sets older `Initial` Easy Credit payments on the cart to `Failure`.

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
**URL:** `https://your-api-endpoint.com/webhook/{{payment_id}}/cancel?redirectUrl={{redirect_url}}&sig={{signature}}`  

The connector builds this URL itself when it creates the payment and passes it to Easy Credit. `sig` is the hex HMAC-SHA256 of `{{payment_id}}:{{redirect_url}}` (the plain, not URL-encoded, redirect URL) keyed with `API_PASSWORD`. A `redirectUrl` without a valid `sig` is rejected with `400 InvalidRedirectUrl`, so the route can't be used as an open redirect.  

With a valid `redirectUrl` the shopper is always redirected back to the shop, also when the cancel itself fails (for example the payment is already authorized). The error is logged and the payment is left as it was.  
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
