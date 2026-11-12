# API collection

This folder has a Postman collection and a Postman environment for the easyCredit connector API, version 1.1.0. The collection covers pay by invoice (`BILL_PAYMENT`) and pay by installments (`INSTALLMENT_PAYMENT`).

Files:

- `easycredit_connector_postman_collection.json`: the requests (Postman collection v2.1).
- `easycredit_connector_postman_env.json`: the environment variables.

The Postman collection is the only source. You can import it into Postman, Bruno and Insomnia.

## Run order

Run the folders and requests in this order. For create and authorize, run one of the two variants. A run stops after the create request, because the [manual easyCredit step](#manual-easycredit-step) follows. Then continue with 2.6. In the Postman Collection Runner, deselect the variant that you do not run, and deselect 3.1 when you run 2.7 to 2.10.

1. **CommerceTools**
   - 1.1 Obtain access token
   - 1.2 Obtain Session ID
2. **Payment**
   - 2.1 Get Config
   - 2.2 and 2.3 Validate Cart (installments, pay by invoice)
   - 2.4 or 2.5 Create transaction (installments or pay by invoice). Run one of them. Each one overwrites `payment_id`.
   - Manual step on the easyCredit page. See [Manual easyCredit step](#manual-easycredit-step).
   - 2.6 Get EasyCredit Transaction
   - 2.7 Authorize, or 2.8 Authorize and wait. Run one of them. After 2.7, the transaction can stay `Pending` until the authorize callback of easyCredit sets it to `Success`.
   - 2.9 Capture Payment. It needs an authorized payment: run 2.8, or after 2.7 wait until the authorize callback sets the transaction to `Success`.
   - 2.10 Refund Payment. It also needs an authorized payment. You can run it before the capture.
3. **Webhook**
   - 3.1 Cancel Payment. It cancels a payment that is not authorized. Run it instead of 2.7 to 2.10.

## Variables

Fill in these variables in the environment before you start:

| Variable | Value |
| --- | --- |
| `connector_url` | The processor URL, that is the URL of the application `processor`. Read it from `applications[*].url` of the deployment, without a trailing slash. For more, see [Connector deployment](../CommercetoolsFrontendIntegration.md#connector-deployment). |
| `client_id`, `client_secret` | The commercetools API client for the requests. |
| `project-key` | The key of your commercetools project. Request 1.1 overwrites it with the project key from the scope of the token. |
| `auth_url`, `session_url` | The commercetools Auth and Session API URLs. The defaults are for the region `europe-west1` (GCP). Change them if your project is in another region. |
| `checkout_application_key` | Optional. The key of a Checkout application. The connector does not need commercetools Checkout. You can keep the placeholder value, see [Checkout application](../CommercetoolsFrontendIntegration.md#checkout-application). |
| `cart_id` | The ID of a cart that you create yourself. See below. |

The requests set these variables. Do not fill them in: `ctp_access_token`, `ctp_session_id` and `payment_id`.

### Cart

The collection has no request that creates a cart. Create a cart with your usual commercetools tooling. The cart needs a line item, the currency EUR, and an amount inside the limits of the payment type. easyCredit sets the limits for your webshop. The billing address and the shipping address must be in Germany and identical, also in the e-mail and the phone number. Then put the cart ID in `cart_id`. For all rules, see [Get Payment Method](../GetPaymentMethod.md#payment-type-availability).

### API client scopes

The API client in `client_id` and `client_secret` needs these scopes:

- `manage_sessions`: for request 1.2.
- One of `manage_payments`, `manage_checkout_payment_intents` or `manage_project`: for capture and refund.

Authorize needs only an active token. See [Authorize Payment](../AuthorizePayment.md#conditions).

## Manual easyCredit step

The easyCredit checkout happens in a browser. No request does it. Do these steps after request 2.4 or 2.5 and before request 2.6:

1. Copy the `redirectUrl` from the create response.
2. Open the URL in a browser.
3. Complete the easyCredit sandbox checkout.
4. Go back to your API tool and run request 2.6.

Authorize needs the easyCredit transaction in the state `PREAUTHORIZED`. See [Authorize Payment](../AuthorizePayment.md).

## Import into Postman

1. In Postman, select **Import**.
2. Select the file `easycredit_connector_postman_collection.json`.
3. Select **Import** again and select the file `easycredit_connector_postman_env.json`.
4. Select the environment `EasyCredit Dev env` in the environment list.
5. Fill in the variables.

Everything carries over, also the test scripts.

## Import into Bruno

1. In Bruno, select **Collections**, then **Import Collection**.
2. Select **Postman Collection** and select the file `easycredit_connector_postman_collection.json`. Select a folder to save the collection in.
3. Open the collection, then open the environment settings and select **Import**.
4. Select the file `easycredit_connector_postman_env.json`.
5. Select the environment and fill in the variables.

Checked with the converter package `@usebruno/converters` 0.25.0. The converter has no issues for this collection.

Carries over: folders and order, requests, URLs, query parameters, headers, JSON bodies, the basic auth of request 1.1, the descriptions, the environment variables, and the test scripts. The converter changes `pm.environment.set` to `bru.setEnvVar`, so `ctp_access_token`, `ctp_session_id` and `payment_id` are still set by the requests.

Does not carry over: the descriptions of the environment variables. Read them in this file.

The check ran the converter only. It did not open the result in the Bruno app.

## Import into Insomnia

1. In Insomnia, open the **Create** menu and select **Import**.
2. Select the file `easycredit_connector_postman_collection.json`, and import it.
3. Import the file `easycredit_connector_postman_env.json` the same way.
4. Select the imported environment and fill in the variables.

Checked with the package `insomnia-importers` 3.6.0. This package is an older importer, so the Insomnia app can give a different result. After the import, open some requests in the Insomnia app and make sure that the URLs, headers and bodies are complete.

Carries over: folders and order, requests, URLs, query parameters, headers, JSON bodies, the basic auth of request 1.1, the descriptions of the folders and requests, and the environment variables.

Does not carry over:

- The test scripts. Insomnia does not set `ctp_access_token`, `ctp_session_id` and `payment_id` for you. After request 1.1, copy `access_token` from the response into `ctp_access_token`. After request 1.2, copy `id` into `ctp_session_id`. After request 2.4 or 2.5, copy `paymentId` from the response into `payment_id`.
- The descriptions of the environment variables. Read them in this file.

## More documentation

- [Frontend integration guide](../CommercetoolsFrontendIntegration.md)
- [Get Payment Method](../GetPaymentMethod.md)
- [Create Payment](../CreatePayment.md)
- [Get Payment](../GetPayment.md)
- [Authorize Payment](../AuthorizePayment.md)
- [Capture Payment](../CapturePayment.md)
- [Refund Payment](../RefundPayment.md)
- [Cancel Payment](../CancelPayment.md)
