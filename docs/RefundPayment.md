# Refund an easyCredit payment

For the terms in this document (EC, CT, easyCredit status values, cart freeze), see [Terms](./CommercetoolsFrontendIntegration.md#terms).

This guide shows how to trigger a Refund for an easyCredit payment from the CommerceTools shop side. A refund is a back-office call. Send it from a Merchant Center custom application, your order management system or a server job. Do not send it from the storefront. It works for `INSTALLMENT_PAYMENT` and `BILL_PAYMENT` payments. It works for full and partial refunds, for several refunds on the same payment and for refunds before the capture.

Behavior changes for existing integrations, installment included, are in the [changelog](../CHANGELOG.md#upgrade-notes).

An order can have more than one easyCredit payment. Refund the payment with a `Success` `Authorization` transaction, see [Find the used payment](./CommercetoolsFrontendIntegration.md#find-the-used-payment).

## Table of Contents

- [API endpoint](#api-endpoint)
- [Process](#process)
- [Error responses](#error-responses)
- [Handling Notification](#handling-notification)

## API endpoint

- The endpoint `POST /payments/:paymentId/refund` triggers the Refund for an easyCredit payment. The endpoint needs:
  - Headers:
    - `Authorization`: A CommerceTools access token. Get it from the CommerceTools auth endpoint with your CommerceTools credentials. The token needs one of the scopes `manage_payments`, `manage_checkout_payment_intents` or `manage_project`
  - Params:
    - `paymentId`: The CommerceTools Payment ID
  - Payload:
    - `amount`: The amount to refund. It is a JSON number in EUR major units (for example `2.5` for 2 EUR 50 cent). It is not a string and not cents

- Request example:
  ```
    curl --location '{{connectorProcessorUrl}}/payments/{{paymentId}}/refund' \
    --header 'Authorization: Bearer {{accessToken}}' \
    --header 'Content-Type: application/json' \
    --data '{
        "amount": 2.5
    }'
  ```

## Process

- When you call the endpoint, it checks these conditions:
  - The refund amount is greater than 0 and has at most two decimal places. The connector checks this first, before it reads the payment or easyCredit
  - The CommerceTools Payment exists
  - The CommerceTools Payment `paymentMethodInfo.paymentInterface` is `easycredit` (otherwise `400 InvalidPaymentMethod`)
  - The CommerceTools Payment has a transaction with type = `Authorization`, state = `Success` and a defined `interactionId`. This is the easyCredit transaction ID (otherwise `400 InvalidPaymentTransaction`)
  - The connector settles open refunds from the easyCredit bookings, see below
  - The refund amount is at most the CommerceTools Payment `amountPlanned` minus the amounts of its Refund transactions in state `Initial`, `Pending` or `Success`. A `Failure` refund does not count. Two parallel requests cannot both use the same remaining amount: the second request fails with `409` when it adds its Refund transaction

- After all checks pass, the connector first creates a new transaction for the refund. The transaction has type = `Refund` and state = `Initial`. Its amount is the refund amount

- Next, the connector creates a Refund request for this easyCredit transaction. It uses the ID of the new Refund transaction as `bookingId`

- The [easyCredit docs](https://developer.easycredit-ratenkauf.de/documentation/dokumentation-transaction-api-v3/) say that a successful refund request returns 202 as status code. If the connector receives 202, it changes the state of the `Initial` Refund transaction to `Pending`. It returns `202` with the updated payment. If another request changed the payment at the same time, the connector repeats the state change on the latest version. If the connector still cannot save it, the API returns `202` with the transaction in state `Initial`. The notification also completes it.

- After the connector adds the refund transaction, the API always returns `202` with the payment. The state of the new Refund transaction shows the result of the easyCredit request. The connector logs the easyCredit error:

  | easyCredit answer | Refund transaction |
  | --- | --- |
  | `202` | `Pending`, completed by the notification |
  | `4xx`, `401` and `403` included | `Failure`. Nothing was booked. You can send the refund again. |
  | `5xx`, no answer within 10 seconds, not reachable, or a `2xx` other than `202` | `Pending`, because easyCredit can still book the refund. The notification completes it. |

  **Do not send a `Pending` refund again**, for example after a timeout of your request or of easyCredit. A new request is a new refund with its own `bookingId`. Read the `Refund` transactions of the payment instead. Send again only if the earlier one is `Failure`. If the connector cannot save the `Failure` state, the API returns the commercetools error instead. You can then send the refund again.

- You can refund a payment before it is captured. easyCredit accepts the refund of a payment that is not captured yet.

- If the payment has `Initial` or `Pending` refunds, each refund request first reads the easyCredit bookings, in case a notification did not arrive. A refund with a `DONE` or `FAILED` booking gets `Success` or `Failure`. The connector checks the remaining amount after this step. If easyCredit cannot be read or sends no `bookings`, the request continues and the refunds stay open. A capture request settles them the same way. There are two exceptions. A payment that is already captured (`Charge` in state `Success`) returns `204` before the read. For a payment with another `Charge`, a failed read fails the capture. See [Capture Payment](./CapturePayment.md#workflow).

- Only a booking completes a refund. A refund without an easyCredit booking stays `Initial` or `Pending`, however old it is, and its amount stays reserved. Only easyCredit knows if it booked the refund, and a booking can still appear later. A refund or capture request that reads the bookings logs such refunds as a warning. A notification with a completed refund booking does the same. The log text is `Refunds without an easyCredit booking stay open and keep their amount`, with their IDs, states and amounts. If such a refund stays open, do these steps:
  - Check the transaction in the easyCredit merchant portal.
  - If easyCredit never booked it, set the Refund transaction to `Failure` with the commercetools API (`changeTransactionState`). This frees its amount.
  - If easyCredit booked it under another `bookingId`, set it to the state of that booking. Earlier versions booked a refund under another `bookingId` while an older refund was still `Initial`.

- Each request uses its own Refund transaction ID as easyCredit `bookingId`. This is true also when another refund of the same payment is still `Initial` or `Pending`.

- The refund trigger is then complete. easyCredit processes the refund asynchronously, so the connector does not wait for it. easyCredit has a feature to send notifications about the resource: the [Benachrichtigungs-URL](https://developer.easycredit-ratenkauf.de/documentation/anleitung-einbindung-transaction-api-v3/#2003044967732465) (notification URL). The connector supports this feature. To register the URL, see [Notification URL](./CommercetoolsFrontendIntegration.md#notification-url). See also [Handling notification](#handling-notification).

## Error responses

| Status | `code` | When | Refund transaction |
| --- | --- | --- | --- |
| `400` | `InvalidRefundAmount` | The amount is not greater than 0, has more than two decimal places, or is more than the payment `amountPlanned` minus the refunds that did not fail. If the amount fits without the open refunds, `fields.openRefunds` lists them, see [Process](#process). | none added |
| `401` | `invalid_token` | The access token is missing or not valid, or has none of the scopes `manage_payments`, `manage_checkout_payment_intents` and `manage_project` (`fields.validAuthorities` then lists them). | none added |
| `404` | `404`, with `ResourceNotFound` in `fields` | No payment exists for `paymentId`. | none added |
| `409` | `409`, with `ConcurrentModification` in `fields` | Another request changed the payment while the connector added the refund transaction. The connector sent nothing to easyCredit, so you can send the refund again. | none added |
| commercetools status | commercetools error | The connector could not save the `Failure` state of a refund that easyCredit rejected. Nothing was booked, so you can send the refund again. | `Initial` |

```json
{
    "message": "The refund amount cannot be greater than the payment amount minus the refunds that did not fail",
    "statusCode": 400,
    "errors": [
        {
            "code": "InvalidRefundAmount",
            "message": "The refund amount cannot be greater than the payment amount minus the refunds that did not fail"
        }
    ]
}
```

If the amount fits without the open refunds:

```json
{
    "message": "The refund amount cannot be greater than the payment amount minus the refunds that did not fail. Open refunds keep their amount until easyCredit completes their booking, see docs/RefundPayment.md#process",
    "statusCode": 400,
    "errors": [
        {
            "code": "InvalidRefundAmount",
            "message": "The refund amount cannot be greater than the payment amount minus the refunds that did not fail. Open refunds keep their amount until easyCredit completes their booking, see docs/RefundPayment.md#process",
            "fields": {
                "openRefunds": [
                    { "transactionId": "<Refund transaction ID>", "state": "Initial", "centAmount": 5000 }
                ]
            }
        }
    ]
}
```

The API does not return easyCredit errors of the refund request as error responses. See [Process](#process).

## Handling notification

- As explained above, the connector has an endpoint for easyCredit. easyCredit notifies the connector when it completes a refund. The endpoint is `GET /easycredit-notification`

- Example: a refund succeeds in an easyCredit transaction, and you registered the endpoint in your easyCredit portal. easyCredit then notifies you through that endpoint with a URL param, for example `/easycredit-notification?vorgangskennung=V8RW8H`. `V8RW8H` is the easyCredit `transactionId`, see [Terms](./CommercetoolsFrontendIntegration.md#terms). The connector does these steps:
  - It reads this easyCredit transaction.
  - It finds the CommerceTools Payment by the `bookingId` of the first completed refund booking. This is the ID of a CommerceTools Refund transaction.
  - It sets each `Initial` or `Pending` refund whose ID matches a completed booking to `Success` (booking `DONE`) or `Failure` (booking `FAILED`).
  - If there is no completed refund booking, it looks up no payment for the refunds and changes none.
  - If easyCredit sends the transaction without `bookings`, the notification changes nothing and answers `204`.

- You can also call the endpoint by hand, for example if a refund stays `Pending` because a notification did not arrive.

- To register the notification URL, see [Notification URL](./CommercetoolsFrontendIntegration.md#notification-url).
