# Connector Processor Integration Guide

This guide provides information on the functionality of the processor connector.


## 📐 Architecture Principles

This repository contains two standalone modules that interact with commercetools and EasyCredit.
Complete integration requires running/intergrating both of the modules. Please find detail information in their readme below

![Payment flow](../docs/assets/payment-flow.png "Payment flow")

## Table of Contents

- [Basic configs](#configure-processor-settings)
- [Features](#features)
- [Troubleshooting](#troubleshooting)

## Configure processor settings

- First, after install the connector into the shop, you must config all the necessary credentials that defined in the processor part, you can have a look at [this file](../connect.yaml)

| Configuration | Description |
| --- | --- |
| WEBSHOP_ID | EasyCredit WebShop ID from your portal. We need it to be authorized when calling EasyCredit APIs. |
| API_PASSWORD | EasyCredit API Password from your portal. We need it to be authorized when calling EasyCredit APIs. |
| WIDGET_ENABLED | 0 or 1, used to define whether the EasyCredit Info Widget can be displayed or not. |
| CTP_CLIENT_ID | CommerceTools Composable Commerce client ID. |
| CTP_CLIENT_SECRET | CommerceTools Composable Commerce client secret. |
| CTP_PROJECT_KEY | CommerceTools Composable Commerce project key |
| CTP_SCOPES | CommerceTools Composable Commerce scope (should be: manage_project). |
| CTP_REGION | CommerceTools Composable Commerce API region. |
| CTP_API_URL | commercetools API URL |
| CTP_AUTH_URL | CommerceTools Composable Commerce Authentication endpoint. Used to initialize the CommerceTools Payment SKD inside the connector. Then, we use the Payment SDK to secure the connector’s endpoints which require CommerceTools access token. |
| CTP_SESSION_URL | CommerceTools Composable Commerce Session endpoint. Used to initialize the CommerceTools Payment SKD inside the connector. Then, we use the Payment SDK to secure the connector’s endpoints which require CommerceTools sessions. |
| CTP_JWKS_URL | CommerceTools Composable Commerce JWT keys set endpoint e.g: https://mc-api.europe-west1.gcp.commercetools.com/.well-known/jwks.json. Used to initialize the CommerceTools Payment SKD inside the connector. |
| CTP_JWT_ISSUER |  CommerceTools Composable Commerce JWT Issuer for JWT validation e.g: https://mc-api.europe-west1.gcp.commercetools.com/. Used to initialize the CommerceTools Payment SKD inside the connector. |
| DEBUG | 0 or 1, if it is enabled (= 1), the logger of the connector will display log message from debug level. |
| BILL_PAYMENT_ENABLED | 0 or 1 (default 0). Enables easyCredit pay by invoice (`BILL_PAYMENT`) if this is 1, easyCredit reports `availability: true` and `billPaymentActive: true` for the webshop, and the cart total is within `minBillingValue` / `maxBillingValue`. The payment method response then reports it as available and `POST /payments` accepts `paymentType: BILL_PAYMENT`. Offering it to customers in the checkout also requires the enabler (TEBA-248). |
| BILL_PAYMENT_EXCLUDED_PRODUCT_TYPES | Optional comma-separated product type keys, for example vouchers. Pay by invoice is not offered if any line item of the cart has one of these product types. Each key has at least 2 characters out of `A-Z`, `a-z`, `0-9`, `_` and `-`; an invalid entry stops the connector at startup. The keys are resolved to ids in one query with the cache duration of `WEBSHOP_CACHE_TTL`, which needs the `view_product_types` scope in `CTP_SCOPES`. If the lookup fails, for example with more than 500 keys, pay by invoice is not offered. See [Excluded cart items](../docs/GetPaymentMethod.md#excluded-cart-items). |
| BILL_PAYMENT_EXCLUDED_CUSTOM_LINE_ITEMS | Optional comma-separated custom line item slugs or keys, same format as above. Pay by invoice is not offered if the cart contains a custom line item whose `slug` or `key` is listed. |
| WEBSHOP_CACHE_TTL | Seconds (0 to 3600, default 300) to cache the easyCredit webshop configuration: activation status and order value limits per payment type. |

## Features
Follow the link for further information of each feature.
| Feature | Documentations |
|---|---|
| Get payment method | [LINK](/docs/GetPaymentMethod.md) |
| Get payment | [LINK](/docs/GetPayment.md) |
| Create payment (installment and pay by invoice) | [LINK](/docs/CreatePayment.md) |
| Authorize payment (waits up to 30 s for the authorization) | [LINK](/docs/AuthorizePayment.md) |
| Cancel payment | [LINK](/docs/CancelPayment.md) |
| Capture payment | [LINK](/docs/CapturePayment.md) |
| Refund payment | [LINK](/docs/RefundPayment.md) |

## Troubleshooting

- When integrating, if any unexpected behavior occurs, check the **App Logs** of the processor for errors that may assist in troubleshooting.
