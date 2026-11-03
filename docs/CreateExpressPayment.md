# Create Express Payment

* [Differences to Create Payment](#differences-to-create-payment)
* [Placeholder address](#placeholder-address)
* [Stored express flag](#stored-express-flag)
* [Second express click](#second-express-click)
* [Check the payment types](#check-the-payment-types)
* [Example request](#request)
* [Response Format](#success-response)
* [Error response](#error-response)

## Overview
This API starts an easyCredit express checkout from the product page or the cart. The easyCredit transaction is created without customer and address data: the shopper enters both on the easyCredit payment page. The optional `paymentType` selects `INSTALLMENT_PAYMENT` (default) or `BILL_PAYMENT`.

Everything that is not listed below works as in [Create Payment](./CreatePayment.md): payment type availability, excluded cart items, cart freeze, the customer relationship, cleanup on failure and the CT `Authorization` transaction.
<br />

## Conditions

1. The session must be authenticated, and a valid session token must be included in the request.
2. The session must belong to a cart with shipping mode `Single`. For an express checkout from the product page, the shop puts the product into this cart before calling the API. The cart may have no addresses and no email.
3. The post-deploy script must have created the payment custom type, see [Stored express flag](#stored-express-flag).
<br />

## Differences to Create Payment

| | Create Payment | Create Express Payment |
| --- | --- | --- |
| Cart | `cartId` from the request body | Cart of the session, a `cartId` in the body is ignored |
| Shipping mode | `Single` or `Multiple` | `Single` only, `Multiple` returns `400 ExpressShippingModeNotSupported` |
| Address check | Identical, complete billing and shipping address in `DE` | Not checked here, the address is entered on the easyCredit payment page. The authorization checks it, see [Authorize Payment](./AuthorizePayment.md#express-payments) |
| Private customer check (`BILL_PAYMENT`) | Business Unit and company in the addresses | Business Unit only |
| easyCredit transaction | Sends `customer`, `invoiceAddress` and `shippingAddress` from the cart | Sends none of them |
| Redirect links | Any string | Absolute `http` or `https` URLs, otherwise `400 InvalidJsonInput` |
| CT payment | No custom type | Payment custom type with `easyCreditExpress: true`, see [Stored express flag](#stored-express-flag) |
| Cart freeze | See [Cart freeze](./CreatePayment.md#cart-freeze) | Same. A cart without shipping address first gets a placeholder, see [Placeholder address](#placeholder-address) |

The currency, the payment type availability, the limits and the [excluded cart items](./GetPaymentMethod.md#excluded-cart-items) are checked against the cart exactly as in Create Payment. The `paymentType` sent by the express button is only a selection.

The amount check uses the cart total at the time of the request. Shipping costs are only known once easyCredit returns the address.

`urlCancellation` and `urlDenial` are routed through the connector, which releases the cart before it redirects, see [Cancel Payment](./CancelPayment.md). `urlSuccess` is passed to easyCredit unchanged and should point to the express return page of the shop. The connector cannot check which page it is. A page that authorizes the payment without taking over the address from easyCredit gets `400 ExpressAddressMissing`, so the placeholder can never end up in an order.
<br />

## Placeholder address

commercetools cannot freeze a cart without shipping address. A cart without one therefore gets the placeholder `{ "country": "DE" }` in the same update that freezes it. The placeholder keeps the cart total unchanged and is replaced by the address from easyCredit after the return.

With the default `SoftFreeze`, addresses, email and the shipping method can still be set on the frozen cart (checked against commercetools on 2026-11-03). A shipping method that changes the cart total fails the authorization with `400 AmountMismatch`, see [Cart freeze](./CreatePayment.md#cart-freeze).

The CT payment records in `easyCreditExpressPlaceholderAddress` whether the connector added the placeholder. When the attempt ends without an order, the connector puts the cart back as it was before the express click: it unfreezes the cart and removes the placeholder in the same update. This happens on cancel and denial, on `DECLINED`, `EXPIRED` and failed checks during the authorization, and when the create request itself fails. A shipping method set on the placeholder is removed too, because commercetools does not unset a shipping address while a shipping method is set. Without an address before the express click, the shopper can only have set it on the placeholder.

The cart keeps its shipping address if it no longer holds only the country (the express return or the shop replaced the placeholder), or if the shop had set it before the express click.
<br />

## Stored express flag

The CT payment gets the custom type configured in `PAYMENT_CUSTOM_TYPE_KEY` (default `easy-credit-payment`) with these Boolean fields:

| Field | Content |
| --- | --- |
| `easyCreditExpress` | Always `true`. |
| `easyCreditExpressPlaceholderAddress` | `true` if the connector added the placeholder address, see [Placeholder address](#placeholder-address). |

The post-deploy script creates the type, or adds missing fields to an existing type with this key, so the type can be shared with other connectors. The existing type must include `payment` in its `resourceTypeIds`, otherwise the deployment fails.

**Existing deployments** get the type or the new field only when the post-deploy script runs again: redeploy the connector before the shop enables express. Until then this API and the [payment type check](#check-the-payment-types) answer `500 ExpressNotConfigured` before the cart is read or changed, and the connector logs that the type is missing. The regular Create Payment is not affected.

Payments created with [Create Payment](./CreatePayment.md) carry no custom type.
<br />

## Second express click

A second express click for the same cart while the first easyCredit page is still open discards the first attempt, as described in [Switching in the shop checkout](./CreatePayment.md#switching-in-the-shop-checkout). The cart is frozen again in the same update, so a placeholder the first attempt added stays and passes to the new attempt, which removes it if it ends without an order.

If the shopper then cancels in the tab of the first attempt, the cancel webhook finds a `Failure` transaction. It changes nothing and redirects to `urlCancellation`, see [Cancel Payment](./CancelPayment.md#already-failed-attempt).
<br />

## Check the payment types

[Get Payment Method](./GetPaymentMethod.md) validates the addresses, so it always fails for an express cart. Use the express variant to decide which express buttons to show:

**HTTP Method:** `GET`  
**URL:** `https://your-api-endpoint.com/payments/express/payment-method?paymentType=BILL_PAYMENT`  
**Headers:** `X-Session-Id: <session_id>`

It checks the cart of the session with the same rules as Create Express Payment and returns the same response and errors as [Get Payment Method](./GetPaymentMethod.md), plus `400 InvalidSession`, `400 ExpressShippingModeNotSupported` and `500 ExpressNotConfigured`. Hide the express buttons on any error. Call it once per payment type, as the checkout component does with Get Payment Method. `paymentType` defaults to `INSTALLMENT_PAYMENT`.
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
    }
}
```

A `customerRelationship` in the body is ignored. The connector derives it, see [Customer relationship](./CreatePayment.md#customer-relationship).

### Response Format

#### Success Response:

Same as [Create Payment](./CreatePayment.md#success-response). The shop redirects the shopper to `redirectUrl`.

#### Error Response

| Status | Code | Reason |
| --- | --- | --- |
| 400 | `InvalidSession` | The session has no cart. |
| 400 | `InvalidJsonInput` | The body does not match the schema, for example `redirectLinks` is missing or a link is not an absolute `http` or `https` URL. |
| 400 | `ExpressShippingModeNotSupported` | The cart has shipping mode `Multiple`. |
| 400 | `InvalidCurrency`, `CorporateCustomerNotAllowed`, `InvalidAmount`, `PaymentTypeNotAvailable`, `BillPaymentExcludedItems`, `TransactionNotSuccess`, `PaymentInProgress` | Same as [Create Payment](./CreatePayment.md#error-response-400). |
| 500 | `ExpressNotConfigured` | The payment custom type is missing or lacks a field. Redeploy the connector, see [Stored express flag](#stored-express-flag). |
| 503 | `BillPaymentCheckFailed`, `EasyCreditUnavailable` | Same as [Create Payment](./CreatePayment.md#error-response-4xx). |

The address codes `InvalidBillingAddress`, `InvalidShippingAddress`, `AddressesUnmatched` and `InvalidAddress` are never returned.
