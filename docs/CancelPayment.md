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

**HTTP Method:** `POST`  
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
