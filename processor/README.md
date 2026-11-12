# Connector Processor Integration Guide

This guide describes the functions of the processor connector.


For the architecture, see [Architecture Principles](../README.md#-architecture-principles).

## Table of Contents

- [Basic configs](#configure-processor-settings)
- [Features](#features)
- [Troubleshooting](#troubleshooting)

## Configure processor settings

You set these values in commercetools Connect when you deploy the connector. To change a value later, change the configuration of the installed connector in the Merchant Center, see [Manage installed Connectors](https://docs.commercetools.com/merchant-center/connect#manage-installed-connectors). [connect.yaml](../connect.yaml) lists the variables and their defaults. In the examples, replace `{region}` with the region of your project, for example `europe-west1.gcp`. See [Hosts](https://docs.commercetools.com/api/general-concepts#hosts).

| Configuration | Description |
| --- | --- |
| WEBSHOP_ID | The easyCredit WebShop ID from your portal. The connector needs it to get authorization for calls to the easyCredit APIs. |
| API_PASSWORD | The easyCredit API password from your portal. The connector needs it to get authorization for calls to the easyCredit APIs. |
| WIDGET_ENABLED | 0 or 1 (default 1). If this is 0, the widget and the label component do not show. The checkout component and the summary component do not read this value. |
| CTP_CLIENT_ID | CommerceTools Composable Commerce client ID. |
| CTP_CLIENT_SECRET | CommerceTools Composable Commerce client secret. |
| CTP_PROJECT_KEY | CommerceTools Composable Commerce project key. |
| CTP_SCOPES | Scopes of the connector API client, separated by spaces. The value must include `view_api_clients manage_orders manage_payments view_types manage_types view_sessions introspect_oauth_tokens manage_checkout_payment_intents`. If you set an `*_EXCLUDED_PRODUCT_TYPES` variable, add `view_product_types`. This is not the API client of your frontend (BFF). See [Configuration](../docs/CommercetoolsFrontendIntegration.md#configuration). |
| CTP_REGION | CommerceTools Composable Commerce API region, for example `europe-west1.gcp` (default). |
| CTP_API_URL | commercetools API URL, for example `https://api.{region}.commercetools.com`. |
| CTP_AUTH_URL | The CommerceTools Composable Commerce Authentication endpoint, for example `https://auth.{region}.commercetools.com`. The connector uses it to initialize the CommerceTools Payment SDK. The Payment SDK then secures the connector endpoints that need a CommerceTools access token. |
| CTP_SESSION_URL | The CommerceTools Composable Commerce Session endpoint, for example `https://session.{region}.commercetools.com`. The connector uses it to initialize the CommerceTools Payment SDK. The Payment SDK then secures the connector endpoints that need CommerceTools sessions. |
| CTP_JWKS_URL | The CommerceTools Composable Commerce JWT key set endpoint, for example `https://mc-api.{region}.commercetools.com/.well-known/jwks.json` (default for `europe-west1.gcp`: https://mc-api.europe-west1.gcp.commercetools.com/.well-known/jwks.json). The connector uses it to initialize the CommerceTools Payment SDK. |
| CTP_JWT_ISSUER | The CommerceTools Composable Commerce JWT issuer for JWT validation, for example `https://mc-api.{region}.commercetools.com` (default for `europe-west1.gcp`: https://mc-api.europe-west1.gcp.commercetools.com). The connector uses it to initialize the CommerceTools Payment SDK. |
| DEBUG | 0 or 1. If this is 1, the connector logger shows log messages of the debug level. |
| INSTALLMENT_PAYMENT_ENABLED | 0 or 1 (default 1). If this is 1 and easyCredit has activated installment payment for the webshop, the connector offers it in the checkout. If this and `BILL_PAYMENT_ENABLED` are both 0, the connector offers no easyCredit payment method and logs a warning at startup. |
| BILL_PAYMENT_ENABLED | 0 or 1 (default 0). If this is 1 and easyCredit has activated pay by invoice for the webshop, the connector offers pay by invoice (`BILL_PAYMENT`) as a separate payment method in the checkout. Before you set it to 1, check that your shop finds easyCredit payments by `paymentInterface`, see the [upgrade notes](../CHANGELOG.md#upgrade-notes). |
| INSTALLMENT_PAYMENT_EXCLUDED_PRODUCT_TYPES, BILL_PAYMENT_EXCLUDED_PRODUCT_TYPES | Optional comma-separated product type keys, for example vouchers. If a line item of the cart has one of these product types, the connector does not offer the payment type. This needs the `view_product_types` scope in `CTP_SCOPES`. |
| INSTALLMENT_PAYMENT_EXCLUDED_CUSTOM_LINE_ITEMS, BILL_PAYMENT_EXCLUDED_CUSTOM_LINE_ITEMS | Optional comma-separated custom line item slugs or keys. If the cart has a custom line item whose `slug` or `key` is in the list, the connector does not offer the payment type. |
| WEBSHOP_CACHE_TTL | Seconds (0 to 3600, default 300) to cache the easyCredit webshop configuration (activation status and order value limits per payment type) and the product type lookup of the `*_EXCLUDED_PRODUCT_TYPES` lists. |
| TRANSACTION_CUSTOM_TYPE_KEY | Key of the custom type for transaction resources (default `easy-credit-technical-transaction-id`). To share a custom type with other connectors, use an existing key. The post-deploy script adds the missing fields. |

For the full rules on the payment types, the excluded items, the format of the lists and the cache, see [Get payment method](../docs/GetPaymentMethod.md#payment-type-availability).

## Features
For more information on each feature, use the link.

| Feature | Documentations |
|---|---|
| Get payment method | [LINK](/docs/GetPaymentMethod.md) |
| Get payment | [LINK](/docs/GetPayment.md) |
| Create payment (installment and pay by invoice) | [LINK](/docs/CreatePayment.md) |
| Authorize payment (with `waitForAuthorization: true`, waits up to 30 s for the authorization) | [LINK](/docs/AuthorizePayment.md) |
| Cancel payment | [LINK](/docs/CancelPayment.md) |
| Capture payment | [LINK](/docs/CapturePayment.md) |
| Refund payment | [LINK](/docs/RefundPayment.md) |

## Troubleshooting

If unexpected behavior occurs during integration, read the **App Logs** of the processor. They can show the cause of the error.
