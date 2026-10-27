# Create Express Payment

* [Differences to Create Payment](#differences-to-create-payment)
* [Stored express flag](#stored-express-flag)
* [Check the payment types](#check-the-payment-types)
* [Example request](#request)
* [Response Format](#success-response)
* [Error response](#error-response-400)

## Overview
This API starts an easyCredit express checkout from the product page or the cart. The easyCredit transaction is created without customer and address data: the shopper enters both on the easyCredit payment page. The optional `paymentType` selects `INSTALLMENT_PAYMENT` (default) or `BILL_PAYMENT`.

Everything that is not listed below works as in [Create Payment](./CreatePayment.md): payment type availability, excluded cart items, cart freeze, cleanup on failure and the CT `Authorization` transaction.
<br />

## Conditions

1. The session must be authenticated, and a valid session token must be included in the request.
2. The session must belong to a cart. For an express checkout from the product page, the shop puts the product into this cart before calling the API. The cart may have no addresses and no email.
<br />

## Differences to Create Payment

| | Create Payment | Create Express Payment |
| --- | --- | --- |
| Cart | `cartId` from the request body | Cart of the session, a `cartId` in the body is ignored |
| Address check | Identical, complete billing and shipping address in `DE` | Not checked, the address is entered on the easyCredit payment page |
| Private customer check (`BILL_PAYMENT`) | Business Unit and company in the addresses | Business Unit only |
| easyCredit transaction | Sends `customer`, `invoiceAddress` and `shippingAddress` from the cart | Sends none of them |
| `customerRelationship` | Required | Optional, sent to easyCredit if given |
| CT payment | No custom type | Payment custom type with `easyCreditExpress: true` |
| Cart freeze | `HardFreeze` | `HardFreeze`. A cart without shipping address first gets the placeholder `{ "country": "DE" }`, because commercetools cannot freeze a cart without one |

The currency, the payment type availability, the limits and the [excluded cart items](./GetPaymentMethod.md#excluded-cart-items) are checked against the cart exactly as in Create Payment. The `paymentType` sent by the express button is only a selection.

The amount check uses the cart total at the time of the request. Shipping costs are only known once easyCredit returns the address.

The placeholder keeps the cart total unchanged and is replaced by the address from easyCredit after the return. Addresses and email can still be set on the frozen cart, only the shipping method cannot. If the shopper cancels, the cart is unfrozen and keeps the placeholder.

`urlCancellation` and `urlDenial` are routed through the connector, which unfreezes the cart before it redirects, see [Cancel Payment](./CancelPayment.md). `urlSuccess` is passed to easyCredit unchanged and should point to the express return page of the shop.
<br />

## Stored express flag

The CT payment gets the custom type configured in `PAYMENT_CUSTOM_TYPE_KEY` (default `easy-credit-payment`) with the Boolean field `easyCreditExpress: true`. The post-deploy script creates the type, or adds the field to an existing type with this key, so the type can be shared with other connectors. The existing type must include `payment` in its `resourceTypeIds`, otherwise the deployment fails.

Payments created with [Create Payment](./CreatePayment.md) carry no custom type.
<br />

## Check the payment types

[Get Payment Method](./GetPaymentMethod.md) validates the addresses, so it always fails for an express cart. Use the express variant to decide which express buttons to show:

**HTTP Method:** `GET`  
**URL:** `https://your-api-endpoint.com/payments/express/payment-method?paymentType=BILL_PAYMENT`  
**Headers:** `X-Session-Id: <session_id>`

It checks the cart of the session with the same rules as Create Express Payment and returns the same response and errors as [Get Payment Method](./GetPaymentMethod.md), plus `400 InvalidSession`. Call it once per payment type, as the checkout component does with Get Payment Method. `paymentType` defaults to `INSTALLMENT_PAYMENT`.
<br />

## Example URL Call

### Request

**HTTP Method:** `POST`  
**URL:** `https://your-api-endpoint.com/payments/express`  
**Headers:**
```http
X-Session-Id: <session_id>
Content-Type: application/json
```

**Parameters:**

```json
{
    // optional, defaults to INSTALLMENT_PAYMENT. Use BILL_PAYMENT for pay by invoice
    "paymentType": "INSTALLMENT_PAYMENT",
    "redirectLinks": {
        "urlSuccess": "https://example.com/express/return",
        "urlCancellation": "https://example.com/cart",
        "urlDenial": "https://example.com/cart"
    },
    // optional
    "customerRelationship": {
        "customerStatus": "EXISTING_CUSTOMER",
        "customerSince": "yyyy-MM-dd",
        "orderDoneWithLogin": true,
        "numberOfOrders": 3
    }
}
```

### Response Format

#### Success Response:

Same as [Create Payment](./CreatePayment.md#success-response). The shop redirects the shopper to `redirectUrl`.

#### Error Response 400:

| Code | Reason |
| --- | --- |
| `InvalidSession` | The session has no cart. |
| `InvalidJsonInput` | The body does not match the schema, for example `redirectLinks` is missing. |
| `InvalidCurrency`, `CorporateCustomerNotAllowed`, `InvalidAmount`, `PaymentTypeNotAvailable`, `BillPaymentExcludedItems`, `BillPaymentCheckFailed`, `TransactionNotSuccess` | Same as [Create Payment](./CreatePayment.md#error-response-400). |

The address codes `InvalidBillingAddress`, `InvalidShippingAddress`, `AddressesUnmatched` and `InvalidAddress` are never returned.
