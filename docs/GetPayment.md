# Get Payment

* [Representation: CT Payment Response](#representation-ct-payment-response)
* [Fetching Payment Details from CommerceTools and Easy Credit](#fetching-payment-details-from-commercetools-and-easy-credit)
* [Response Format](#response-format)
* [Error Handling](#error-handling)

## Overview
This API is designed to fetch payment details from CommerceTools using the provided `paymentId`. It also retrieves additional payment data from Easy Credit using the `interactionId` from the payment's transaction. The response includes detailed information about the payment type, amount, web shop ID, status, and decision details, which are gathered from both CommerceTools and Easy Credit systems.

<br />

## Conditions

To use this functionality, the following conditions must be met:

1. A valid `paymentId` must be provided, corresponding to a payment in CommerceTools.
2. The payment must have a valid `transaction` with an `interactionId`.
3. The session must be authenticated, and a valid session token must be included in the request.

<br />

## Workflow

1. **Fetch Payment by ID**: The payment is retrieved from CommerceTools using the provided `paymentId`.
2. **Validate Payment and Transaction**: The payment object and its associated transaction are validated to ensure they meet the required conditions.
3. **Retrieve Payment from Easy Credit**: The `easyCreditTechnicalTransactionId` custom field of the CommerceTools transaction is used to fetch additional payment details from Easy Credit.
4. **Sync the final payment type**: easyCredit may offer a switch between installment and pay by invoice on its page (not verified against the live service, see [Create Payment](./CreatePayment.md#switching-on-the-easycredit-page)), so the payment type of the easyCredit transaction is the source of truth. The connector compares it with the CT payment and may write to commercetools, see [Side effects](#side-effects).
5. **Return Merged Data**: The final response combines data from CommerceTools (e.g., payment amount, transaction details) and Easy Credit (e.g., payment decision, status, the final payment type).

<br />

## Example URL Call

To get a payment, you can make a call to the following URL. Ensure to include the session header for authentication.

### Request

**HTTP Method:** `GET`  
**URL:** `https://your-api-endpoint.com/payments/{{payment_id}}`
**Headers:**
```http
X-Session-Id: <session_id>
Content-Type: application/json
```

To obtain the `X-Session-Id`, refer to the [CommerceTools Sessions API documentation](https://docs.commercetools.com/checkout/installing-checkout#create-checkout-sessions).


<br />

### Response Format

#### Success Response (200):
On successful retrieval of the payment information, the API returns a `200 OK` response.

`paymentType` is `INSTALLMENT_PAYMENT` or `BILL_PAYMENT`. It is the final payment type from the easyCredit transaction (`transaction.paymentType`), which can differ from the type the payment was created with if the shopper switched on the easyCredit page (not verified against the live service, see [Create Payment](./CreatePayment.md#switching-on-the-easycredit-page)). If easyCredit sends no type or an unrecognised one, or the payment is not synced (see [Side effects](#side-effects)), it is the type stored in `paymentMethodInfo.method` of the CT payment; the legacy method `easycredit` is reported as `INSTALLMENT_PAYMENT`.

The installment specific `decision` fields `interest`, `totalValue`, `numberOfInstallments`, `installment`, `lastInstallment`, `mtan` and `bankAccountCheck` are optional. easyCredit sends a JSON `null` for fields that do not apply, for example `interest` of a completed `BILL_PAYMENT` (its `totalValue` then equals `orderValue`). The connector removes every `null` field of `decision` from the response, so such a field is omitted and never shows up as `0`. While a transaction is still `OPEN`, easyCredit reports installment values (`interest`, `totalValue`) even for a `BILL_PAYMENT`, so a summary rendered at that point shows a plan. After completion `interest` is omitted (`null`), while `totalValue` stays and equals `orderValue`. `orderValue` and `decisionOutcome` are always present. `interest` and `totalValue` are for display only: the cart has no interest line item and the amounts used for authorization are unchanged. For installment payments they are also stored on the `Authorization` transaction, see [Create Payment](./CreatePayment.md#transaction-custom-fields).

Example for an installment payment:

```json
{
  "webShopId": "2.de.7607.2",
  "amount": 10,
  "status": "OPEN",
  "paymentType": "INSTALLMENT_PAYMENT",
  "decision": {
    "interest": 90.93,
    "totalValue": 2705.72,
    "orderValue": 2614.79,
    "decisionOutcome": "",
    "numberOfInstallments": 6,
    "installment": 451,
    "lastInstallment": 450.72,
    "mtan": {
      "required": false,
      "successful": false
    },
    "bankAccountCheck": {
      "required": false
    }
  }
}
```

Example for a bill payment (the installment fields are absent):

```json
{
  "webShopId": "2.de.7607.2",
  "amount": 150,
  "status": "OPEN",
  "paymentType": "BILL_PAYMENT",
  "decision": {
    "orderValue": 150,
    "decisionOutcome": ""
  }
}
```

#### Side effects

This is a `GET`, but it can write to commercetools. The rules are the ones of [Authorize Payment](./AuthorizePayment.md#sync-the-final-payment-type). They only apply if the easyCredit status is `PREAUTHORIZED` or `AUTHORIZED` and the CT transaction is not `Failure`; otherwise the call changes nothing.

- If the final type differs from the stored one, `paymentMethodInfo.method` and `paymentMethodInfo.name` of the CT payment are updated (`INSTALLMENT_PAYMENT` with `easyCredit Ratenkauf`, `BILL_PAYMENT` with `easyCredit Rechnung`).
- If the shopper switched while the easyCredit status is `PREAUTHORIZED` and the CT transaction is `Initial`, the cart is validated for the final type first. If a deterministic rule fails (for example `BILL_PAYMENT_ENABLED` is not `1`, the cart total is outside the limits, the cart has excluded items or the customer is a company), the CT transaction is set to `Failure`, the cart is unfrozen and the call returns the validation error (`400`, see [Create Payment](./CreatePayment.md#error-response-400)). Other errors (for example `503`) are returned and leave the transaction untouched.
- For installment payments `easyCreditInterest` and `easyCreditTotalValue` are written on the transaction when they differ from the stored values. A switch to pay by invoice removes them. Deployments that did not run the post-deploy script again lack these fields: the write then fails with a logged warning and the response is not affected.
- If easyCredit sends no payment type for a `BILL_PAYMENT` payment, the call fails with `502 PaymentTypeUnknown` and writes nothing, but only while the easyCredit status is `PREAUTHORIZED` and the CT transaction is `Initial`, the state in which the payment can still be authorized. In every other state the stored type is kept, the error is logged, the interest fields are recorded for the stored type and the call succeeds. A value that is not `INSTALLMENT_PAYMENT` or `BILL_PAYMENT` is treated the same way as an absent type.

#### Error Response (400):
If the provided paymentId is invalid, or if there is an issue with the session token, the API will return a `400 Bad Request` error:

```json
{
  "statusCode": 400,
  "message": "Invalid paymentId",
  "errors": [
    {
      "code": "InvalidPaymentId",
      "message": "The provided paymentId is not valid or does not exist."
    }
  ]
}
```


