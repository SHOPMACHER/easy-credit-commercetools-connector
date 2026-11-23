# Get Payment

For the terms in this document (EC, CT, easyCredit status values, cart freeze), see [Terms](./CommercetoolsFrontendIntegration.md#terms).

* [Workflow](#workflow)
* [Side effects](#side-effects)
* [Response Format](#response-format)
* [Error Response (400)](#error-response-400)

## Overview
This API gets payment details from CommerceTools with the `paymentId`. It also gets more payment data from easyCredit. It uses the `interactionId` from the transaction of the payment. The response has details about the payment type, amount, web shop ID, status and decision. The data comes from both CommerceTools and easyCredit.

<br />

## Conditions

To use this function, these conditions must be true:

1. You give a valid `paymentId` that belongs to a payment in CommerceTools.
2. The payment has a valid `transaction` with an `interactionId`.
3. The session is authenticated. The request has a valid session token.

<br />

## Workflow

1. **Fetch Payment by ID**: The connector gets the payment from CommerceTools with the `paymentId`.
2. **Validate Payment and Transaction**: The connector validates the payment object and its transaction. They must meet the required conditions.
3. **Retrieve Payment from easyCredit**: The connector uses the `easyCreditTechnicalTransactionId` custom field of the CommerceTools transaction. It gets more payment details from easyCredit.
4. **Sync the final payment type**: easyCredit can offer a switch between installment and pay by invoice on its page (see [Create Payment](./CreatePayment.md#switching-on-the-easycredit-page)). The payment type of the easyCredit transaction is therefore the source of truth. The connector compares it with the CT payment. It can write to commercetools, see [Side effects](#side-effects).
5. **Return Merged Data**: The final response combines data from CommerceTools (for example, payment amount and transaction details) and easyCredit (for example, payment decision, status and the final payment type).

<br />

## Example URL Call

To get a payment, call this URL. Include the session header for authentication.

### Request

**HTTP Method:** `GET`  
**URL:** `https://your-api-endpoint.com/payments/{{payment_id}}`
**Headers:**
```http
X-Session-Id: <session_id>
Content-Type: application/json
```

To get the `X-Session-Id`, see the [CommerceTools Sessions API documentation](https://docs.commercetools.com/checkout/installing-checkout#create-checkout-sessions).


<br />

### Response Format

#### Success Response (200):
If the connector gets the payment information, the API returns a `200 OK` response.

`paymentType` is `INSTALLMENT_PAYMENT` or `BILL_PAYMENT`. It is the final payment type from the easyCredit transaction (`transaction.paymentType`). It can differ from the type that the payment had at creation, if the shopper switched on the easyCredit page (see [Create Payment](./CreatePayment.md#switching-on-the-easycredit-page)). In these cases, `paymentType` is the type in `paymentMethodInfo.method` of the CT payment:

- easyCredit sends no type or a type that the connector does not know.
- The connector does not sync the payment (see [Side effects](#side-effects)).

The connector reports the legacy method `easycredit` as `INSTALLMENT_PAYMENT`.

The installment-specific `decision` fields are optional: `interest`, `totalValue`, `numberOfInstallments`, `installment`, `lastInstallment`, `mtan` and `bankAccountCheck`. easyCredit sends a JSON `null` for fields that do not apply. An example is `interest` of a completed `BILL_PAYMENT` (its `totalValue` then equals `orderValue`). The connector removes every `null` field of `decision` from the response. Such a field is omitted and is never `0`.

While a transaction is `OPEN`, easyCredit reports installment values (`interest`, `totalValue`) even for a `BILL_PAYMENT`. A summary that you render at that time shows a plan. After completion, `interest` is omitted (`null`). `totalValue` stays and equals `orderValue`. `orderValue` and `decisionOutcome` are always present.

`interest` and `totalValue` are for display only. The cart has no interest line item and the amounts for authorization do not change. For installment payments, the connector also stores them on the `Authorization` transaction, see [Create Payment](./CreatePayment.md#transaction-custom-fields). To render them, see [Showing the interest on the storefront](#showing-the-interest-on-the-storefront).

Example for an installment payment:

```json
{
  "webShopId": "<WEBSHOP_ID>",
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
  "webShopId": "<WEBSHOP_ID>",
  "amount": 150,
  "status": "OPEN",
  "paymentType": "BILL_PAYMENT",
  "decision": {
    "orderValue": 150,
    "decisionOutcome": ""
  }
}
```

#### Showing the interest on the storefront

The interest is not part of the commercetools cart, the payment or the order. The cart total, the `Authorization` transaction and the order total are the goods value (`orderValue`). The shopper pays the total with interest. Thus the storefront should show the interest as a separate item, with the total that includes it. Read the interest from one of two places:

| Source | Use it for | Fields |
| --- | --- | --- |
| `decision` in the response of this call | The order summary right after the shopper returns from easyCredit. The connector reads it from easyCredit on every call. | `interest`, `totalValue`, `numberOfInstallments`, `installment`, `lastInstallment` |
| Custom fields of the `Authorization` transaction on the CT payment | Later views that should not call the connector, for example the order confirmation page, emails or a back office. | `easyCreditInterest`, `easyCreditTotalValue`, see [Create Payment](./CreatePayment.md#transaction-custom-fields) |

Rules for rendering:

- Render the interest only after the shopper returned from easyCredit, when the easyCredit `status` is `PREAUTHORIZED` or `AUTHORIZED`. While it is `OPEN`, easyCredit reports installment values even for a bill payment. They are only a preview.
- Render the interest only if the payment is an installment payment (`paymentType` is `INSTALLMENT_PAYMENT`) and `interest` is present. For `BILL_PAYMENT`, the field is omitted. Show no interest line.
- Read the `Authorization` custom fields only when `paymentMethodInfo.method` of the payment is not `BILL_PAYMENT` (installment payments have `easycredit`). The connector removes the fields on a switch to pay by invoice. But this write is best effort, so a stale value can remain until the next Get Payment, Authorize Payment or callback.
- Show `totalValue` as the total amount that the shopper repays. It equals `orderValue + interest`. Do not calculate it from the cart total, which excludes the interest.
- Units differ. `interest`, `totalValue` and `orderValue` are decimal EUR amounts (`17.05`). commercetools cart and order amounts are cent amounts (`1705`).
- The custom fields exist only after the connector reads the easyCredit transaction (this call, [Authorize Payment](./AuthorizePayment.md) or the callback). A payment that did not get that far has none. A deployment whose 1.1.0 post-deploy step failed also has none. In these cases, use this call.
- The order that the shop creates from the cart does not contain the interest. If an order confirmation or an ERP export needs it, read the custom fields of the `Authorization` transaction of the payment of the order:

```ts
const method = payment.paymentMethodInfo.method;
const isInstallment = method !== 'BILL_PAYMENT';
const authorization = payment.transactions.find((transaction) => transaction.type === 'Authorization');
const fields = isInstallment ? authorization?.custom?.fields : undefined;
const interest = fields?.easyCreditInterest;
const totalValue = fields?.easyCreditTotalValue;
```

#### Side effects

This is a `GET`, but it can write to commercetools. The rules are the rules of [Authorize Payment](./AuthorizePayment.md#sync-the-final-payment-type). They apply only if the easyCredit status is `PREAUTHORIZED` or `AUTHORIZED` and the CT transaction is not `Failure`. Otherwise the call changes nothing.

- If the final type is not the stored type, the connector updates `paymentMethodInfo.method` and `paymentMethodInfo.name` of the CT payment. Installment gets `easycredit` with `easyCredit Ratenkauf`. Pay by invoice gets `BILL_PAYMENT` with `easyCredit Rechnung`.
- If the shopper switched while the easyCredit status is `PREAUTHORIZED` and the CT transaction is `Initial`, the connector first validates the cart for the final type. If a rule fails for a reason that a retry does not change, the connector fails the transaction. Examples of such reasons: the final type is switched off with `INSTALLMENT_PAYMENT_ENABLED=0` or `BILL_PAYMENT_ENABLED=0`, the cart total is outside the limits, the cart has excluded items, or the customer is a company. The connector then sets the CT transaction to `Failure` and unfreezes the cart. The call returns the validation error (`400`, see [Create Payment](./CreatePayment.md#error-response-400)). The connector returns other errors (for example `503`) and does not change the transaction.
- For installment payments, the connector writes `easyCreditInterest` and `easyCreditTotalValue` on the transaction, see [Transaction custom fields](./CreatePayment.md#transaction-custom-fields). If this write fails, the response does not change.
- If easyCredit sends no payment type for a `BILL_PAYMENT` payment, the call fails with `502 PaymentTypeUnknown` and writes nothing. This occurs only while the easyCredit status is `PREAUTHORIZED` and the CT transaction is `Initial`. In this state, the payment can still be authorized. In every other state, the connector keeps the stored type and logs the error. It records the interest fields for the stored type and the call succeeds. The connector treats a value that is not `INSTALLMENT_PAYMENT` or `BILL_PAYMENT` the same way as an absent type.

#### Failure modes for the frontend

This call can answer with an error that is not about the request itself:
- `400` with a validation code (for example `InvalidAmount`, `CorporateCustomerNotAllowed`, `AddressesUnmatched`): the shopper switched on the easyCredit page to a type that does not fit the cart. The transaction is `Failure` and the cart is unfrozen. Send the shopper back to the payment method selection.
- `502 PaymentTypeUnknown`: easyCredit sent no usable payment type for a bill payment that the connector is about to authorize. The connector wrote nothing. Do not continue with this payment.
- `503` (for example `InstallmentPaymentCheckFailed`, `BillPaymentCheckFailed`, `EasyCreditUnavailable`) or another `5xx`: a temporary problem. The connector changed nothing, so you can retry the call. The cart stays frozen until the shop cancels or the shopper picks another method. See [Authorize Payment](./AuthorizePayment.md#validation-of-the-final-type).

#### Error Response (400):
If the payment is not an easyCredit payment, the API returns `400 InvalidPaymentMethod`. If no payment exists for `paymentId`, the API returns `404` with `ResourceNotFound` in `fields`.

If the session token is missing, not valid or expired, the API returns `401`:

```json
{
  "message": "Session is not active",
  "statusCode": 401,
  "errors": [
    {
      "code": "invalid_token",
      "message": "Session is not active"
    }
  ],
  "error": "invalid_token",
  "error_description": "Session is not active"
}
```


