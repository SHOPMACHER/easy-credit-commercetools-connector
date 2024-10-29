# Get Payment

* [Representation: CT Payment Response](#representation-ct-payment-response)
* [Fetching Payment Details from CommerceTools and Easy Credit](#fetching-payment-details-from-commercetools-and-easy-credit)
* [Response Format](#response-format)
* [Error Handling](#error-handling)

## Overview
This API is designed to fetch payment details from CommerceTools using the provided `paymentId`. It also retrieves additional payment data from Easy Credit using the `interactionId` from the payment's transaction. The response includes detailed information about the payment amount, web shop ID, status, and decision details, which are gathered from both CommerceTools and Easy Credit systems.

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
3. **Retrieve Payment from Easy Credit**: The `interactionId` from the CommerceTools transaction is used to fetch additional payment details from Easy Credit.
4. **Return Merged Data**: The final response combines data from CommerceTools (e.g., payment amount, transaction details) and Easy Credit (e.g., payment decision, status).

<br />

### Response Format

#### Success Response (200):
On successful retrieval of the payment information, the API returns a `200 OK` response along with the following structure:

```json
{
  "webShopId": "2.de.7607.2",
  "amount": 10,
  "status": "OPEN",
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


