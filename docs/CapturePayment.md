# Capture Payment

* [Capture EC transaction](#workflow)
* [Response Format](#success-response-204)
* [Error Handling](#error-responses)

## Overview
This API is designed to capture EC payment using the provided CT `paymentId`. It works for `INSTALLMENT_PAYMENT` and `BILL_PAYMENT` payments alike.
<br />

## Conditions

To use this functionality, the following conditions must be met:

1. A valid `paymentId` must be provided in associated with an existing payment holding an `authorized EC transaction` in CommerceTools.
2. The request must be authenticated with a CommerceTools access token.
3. The payment has no `Charge` transaction in state `Pending` or `Success`. A payment is captured only once; after a `Failure` the capture can be triggered again.
<br />

## Workflow

1. **Validate and get `payment`**: Use `paymentId` to get related CT `payment` data.
2. **Retrieve EC `technicalTransactionId`**: The id is stored in a custom field named `easyCreditTechnicalTransactionId` under the payment transaction
3. **Check & capture the EC transaction**: With the `technicalTransactionId`, the connector reads the EC transaction. If its status is not `AUTHORIZED`, the API returns `400 TransactionIsNotAuthorized`. Otherwise a capture request with the CT `paymentId` as `orderId` and the optional `trackingNumber` is sent to EC
4. **Reflect the change to CT transactions**: A new transaction with type `Charge` and `Pending` state will be added to the payment. As the EC capture procedure asynchronously, the new `Charge` transaction state will be then updated by the EC notification: `Success` if EC booked the capture, `Failure` if EC reports it as failed. If EC rejects the capture request, no `Charge` transaction is added and the API returns the error

![Capture payment flow](./assets/easycredit-capture-payment-flow.png)
<br />

## Example URL Call

To capture a payment, you can make a call to the following URL. Ensure to include a CommerceTools access token for authentication.

### Request

**HTTP Method:** `POST`  
**URL:** `https://your-api-endpoint.com/payments/{payment_id}/capture`  
**Headers:**
```http
Authorization: Bearer <access_token>
Content-Type: application/json
```

**Body:** `trackingNumber` is optional and passed on to EC.
```json
{
    "trackingNumber": "1Z999AA10123456784"
}
```
<br />

### Response Format

#### Success Response 204:
On successful capture the payment, the API returns a `204 No content` response.

#### Error Responses:
If the provided `payment_id` is invalid, or if there is an issue with the session token, the API will return a `404 Not found` error:

```json
{
    "message": "The Resource with ID '8efc676b-1069-437-87e2-ad3bba70e35b' was not found.",
    "statusCode": 404,
    "errors": [
        {
            "code": 404,
            "message": "The Resource with ID '8efc676b-1069-437-87e2-ad3bba70e35b' was not found.",
            "fields": [
                {
                    "code": "ResourceNotFound",
                    "message": "The Resource with ID '8efc676b-1069-437-87e2-ad3bba70e35b' was not found."
                }
            ]
        }
    ]
}
```

If the payment was already captured, the API returns `400`:

```json
{
    "message": "The payment has already been captured",
    "statusCode": 400,
    "errors": [
        {
            "code": "PaymentAlreadyCaptured",
            "message": "The payment has already been captured"
        }
    ]
}
```

If easyCredit rejects the capture, the API returns the status code and the `title` of the easyCredit response as `code` and `message`, with the easyCredit `violations` as `fields`. Without a usable `title` the code is `CaptureFailed`. If easyCredit cannot be reached, the API returns `502` (`504` on a timeout) with the code `CaptureFailed`.

```json
{
    "message": "Transaction not capturable",
    "statusCode": 409,
    "errors": [
        {
            "code": "Transaction not capturable",
            "message": "Transaction not capturable"
        }
    ]
}
```
