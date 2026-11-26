# Connector Web Components Integration Guide

For the terms in this document (EC, CT, easyCredit status values, cart freeze), see [Terms](./CommercetoolsFrontendIntegration.md#terms).

This guide tells you how to add the web components of the connector to your shop and how to show them. The components are the [easyCredit Web Components](https://netzkollektiv.com/docs/easycredit-components/?path=/docs/getting-started-installation--docs). The connector adds its own validation logic.

## Table of Contents

- [Step 1: Configuration](#step-1-configuration)
- [Step 2: Initialize and Display the components](#step-2-initialize-and-display-the-components)
- [Step 3: Troubleshooting](#step-3-troubleshooting)

## Step 1: Configuration

- Deploy the connector. Then set all the credentials that the processor needs. See [Deploy and upgrade](../README.md#deploy-and-upgrade) and [connect.yaml](../connect.yaml).
- Load the enabler at runtime from the asset URL of the connector (`<ASSET_URL>`). For the two bundles and how to load them, see [Load the enabler](./CommercetoolsFrontendIntegration.md#load-the-enabler).
- For the TypeScript types, install the npm package as a development dependency, see [Load the enabler](./CommercetoolsFrontendIntegration.md#load-the-enabler).
- The snippets below use the name `Enabler`. With the ES module, `Enabler` is the export of the module: `const { Enabler } = await import('<ASSET_URL>/connector-enabler.es.js')`. With the UMD bundle, use `window.Connector.Enabler`.

## Step 2: Initialize and Display the components

- A short JavaScript script initializes the components. See the [demo file](../assets/index.html).
- There are 5 components, made from the easyCredit Web Components: label, widget, checkout, summary and express button.

### Label component

- It is made from the [easyCredit Label component](https://netzkollektiv.com/docs/easycredit-components/?path=/docs/checkout-label--docs).
- The code is in [label.component.ts](../assets/src/components/label.component.ts).
- To use this component, add this snippet to your shop:

  ```js
    // Assumes: Enabler is loaded, see Step 1.
    const enabler = new Enabler({
      processorUrl: '<PROCESSOR_URL>', // Connector's processor URL
      sessionId: '', // The label needs no session
    });

    enabler.createLabelBuilder().then((labelBuilder) => {
      // paymentType: 'INSTALLMENT_PAYMENT' (default) or 'BILL_PAYMENT'
      const labelComponent = labelBuilder.build({ paymentType: 'INSTALLMENT_PAYMENT' });
      labelComponent.mount('#easycredit-checkout-label');
    });
  ```

- The component reads only `GET /operations/widget-enabled`. It renders when `isEnabled` is `true`, that is when `WIDGET_ENABLED` is `1`. The checkout component does not read this value. It then looks like this image: ![easyCredit Label component](./assets/easycredit-label.png)
- For pay by invoice, easyCredit controls the label text. See *A/B test* in [Terms](./CommercetoolsFrontendIntegration.md#terms).

### Widget component

- It is made from the [easyCredit Widget component](https://netzkollektiv.com/docs/easycredit-components/?path=/docs/marketing-widget--docs).
- The code is in [widget.component.ts](../assets/src/components/widget.component.ts).
- Shops mostly use the widget on the product page (PDP). To show it, set `WEBSHOP_ID` correctly and set `WIDGET_ENABLED` to `1`.
- Then add this snippet to your shop:

  ```js
    // Assumes: Enabler is loaded, see Step 1.
    // totalValue: the amount in EUR major units, for example 599.9. Your shop provides it.
    const enabler = new Enabler({
      processorUrl: '<PROCESSOR_URL>', // Connector's processor URL
      sessionId: '', // The widget needs no session
    });

    async function mountWidget() {
      const widgetBuilder = await enabler.createWidgetBuilder();

      const widgetComponent = widgetBuilder.build({
        amount: totalValue,
      });

      // Mount the new widget
      widgetComponent
        .mount('#easycredit-widget') // The place to display the component
        .catch((error) => {
          console.error('failed to mount', error);
        });
    }

    mountWidget();
  ```

- The component sends API calls to the connector to find out if the widget can be shown. If it can be shown, it looks like this image: ![easyCredit Widget](./assets/easycredit-widget.png)
- `GET /operations/widget-enabled` needs no checkout session. The widget therefore also works on product pages for shoppers who have no cart.
- On the cart page, the total changes. Clear the container and mount the widget again for each new total, and stop the earlier call so that it cannot mount an old amount. The widget can take several seconds to show, so show a placeholder until it has rendered. For an example, see [Widget on the product and cart page](./CommercetoolsFrontendIntegration.md#widget-on-the-product-and-cart-page).

#### Pay by invoice in the widget

- The shop does not pass a payment type. `GET /operations/widget-enabled` returns `{ isEnabled, webShopId, paymentTypes, amountLimits, expressButtonEnabled, expressButtonVisibility }`. The two express fields are for the [express button](#express-button-component). `paymentTypes` lists what the checkout offers. It uses the same rules as [Get Payment Method](./GetPaymentMethod.md):
  - `INSTALLMENT_PAYMENT` is in the list when installment is active for the webshop.
  - `BILL_PAYMENT` is in the list only when all of these are true: `BILL_PAYMENT_ENABLED=1`, easyCredit reports `availability` and `billPaymentActive`, and the webshop data is fresh. It fails closed (see [Terms](./CommercetoolsFrontendIntegration.md#terms)). Stale or default data never advertises it.
- The widget renders these types as `payment-types` (for example `payment-types="INSTALLMENT,BILL"`). With both types, the easyCredit widget reads "Finanzieren ab … / Monat oder heute bestellen, in 30 Tagen zahlen". The widget of easyCredit applies the easyCredit amount limits.
- `amountLimits` is only sent for a payment type whose [merchant amount limits](./GetPaymentMethod.md#merchant-amount-limits) narrow the easyCredit limits, for example `{ "BILL_PAYMENT": { "minAmount": 100, "maxAmount": 5000 } }`. The enabler leaves that type out of `payment-types` if the `amount` of the widget is outside these limits or is not a number. It checks the amount only on mount, so mount the widget again for a new total, as described above. If no type is left, the widget is not rendered. Deploy the processor and the enabler from the same build. An older enabler ignores `amountLimits` and can advertise a type that the checkout then rejects with `InvalidAmount`.
- An empty `paymentTypes` means that the checkout offers no easyCredit payment type. The widget is then not rendered. This happens in these cases: neither type is active for the webshop; easyCredit reports the webshop as unavailable (the checkout answers 503 `EasyCreditUnavailable`); neither `WIDGET_ENABLED` nor `EXPRESS_BUTTON_ENABLED` is `1` (the connector then does not call easyCredit).
- If there is an error, or the lookup takes longer than 1.5 s, `paymentTypes` is empty and the widget is not rendered. A slow lookup continues and fills the cache (`WEBSHOP_CACHE_TTL`). The next widget then gets the full list. The first widget after a deploy or a cache expiry can therefore be missing.
- Older processors do not send `paymentTypes`. The widget then renders without the attribute, and the easyCredit component defaults to installment.
- The widget sets the attribute when it is mounted. The easyCredit component ignores later changes to `payment-types`. After the invoice setting changes, clear the container and call `mount` again.

### Checkout component

- It is made from the [easyCredit Label component](https://netzkollektiv.com/docs/easycredit-components/?path=/docs/checkout-label--docs) and the [easyCredit Checkout component](https://netzkollektiv.com/docs/easycredit-components/?path=/docs/checkout-checkout--docs).
- The code is in [checkout.component.ts](../assets/src/components/checkout.component.ts).
- To use this component, add this snippet to your shop:

  ```js
    // Assumes: Enabler is loaded, see Step 1. Your shop provides these values:
    // sessionId: the checkout session ID. cartId: the commercetools cart ID.
    // isLoggedIn: the shopper is logged in. customerCreatedAt: the createdAt of the commercetools customer.
    // numberOfOrders: the number of earlier orders of the customer.
    const enabler = new Enabler({
      processorUrl: '<PROCESSOR_URL>', // Connector's processor URL
      sessionId: sessionId, // The checkout session ID
    });

    enabler.createCheckoutBuilder().then((checkoutBuilder) => {
      const checkoutComponent = checkoutBuilder.build({
        cartId: cartId,
        paymentType: 'INSTALLMENT_PAYMENT', // optional, 'INSTALLMENT_PAYMENT' (default) or 'BILL_PAYMENT'
        redirectLinks: {
          urlSuccess: window.location.origin + window.location.pathname + '?step=3',
          urlCancellation: window.location.origin + window.location.pathname + '?step=2&status=cancelled',
          urlDenial: window.location.origin + window.location.pathname + '?step=2&status=denied',
        },
        customerRelationship: {
          customerStatus: loggedIn === true ? 'EXISTING_CUSTOMER' : 'NEW_CUSTOMER',
          customerSince: account?.createdAt,
          numberOfOrders: myOrdersCount,
        },

        onError: (err) => {
          console.error('onError', err);
        },

        onSuccess: (response) => {
          console.log('connector handled it successfully', response);

          window.location.replace(response?.redirectUrl);
        },
      });

      checkoutComponent
        .mount('#easycredit-checkout') // The place to display the component
        .catch((error) => {
          console.error('failed to mount', error);
        });
    });
  ```

- The component sends API calls to the connector to find out if it can be shown. If it can be shown, it looks like this image: ![easyCredit Checkout component](./assets/easycredit-checkout.png)

#### Availability

- `paymentType` selects the easyCredit payment method: `INSTALLMENT_PAYMENT` (default) or `BILL_PAYMENT`. The component asks the connector if it can offer this payment type for the cart. See [Get Payment Method](./GetPaymentMethod.md).
- `isAvailable()` tells you whether to show the option. It does not reject. If it returns `false`, hide the payment option. Some errors show the option with an alert inside the widget:

  | Processor response | `INSTALLMENT_PAYMENT` | `BILL_PAYMENT` |
  | --- | --- | --- |
  | `400 PaymentTypeNotAvailable` | hidden | hidden |
  | `503 EasyCreditUnavailable` | hidden | hidden |
  | `400 InvalidAmount` (cart total outside the limits) | shown with an alert | hidden |
  | `400 InstallmentPaymentExcludedItems`, `400 BillPaymentExcludedItems` | shown with an alert | shown with an alert |
  | `503 InstallmentPaymentCheckFailed`, `503 BillPaymentCheckFailed` | shown with an alert | shown with an alert |
  | `400 CorporateCustomerNotAllowed` (pay by invoice only) | not applicable | shown with an alert |
  | `400 AddressesUnmatched`, `InvalidBillingAddress`, `InvalidShippingAddress`, `InvalidAddress`, `InvalidCurrency` | shown with an alert | shown with an alert |
  | `200` without `paymentTypes.BILL_PAYMENT.available: true` | not applicable | hidden |
  | No `webShopId` in the response, for example `401 invalid_token` for a session that is missing, not valid or expired, or a `500` | hidden | hidden |
  | Network error, or a body that is not JSON | hidden | hidden |

- "Hidden" means that `isAvailable()` returns `false`. `mount()` then renders nothing, with two exceptions:

  | Case | `mount()` |
  | --- | --- |
  | Network error, or a body that is not JSON | rejects with an error, for both payment types |
  | `INSTALLMENT_PAYMENT` and no `webShopId` in the response | throws an error |

  Call `isAvailable()` before `mount()`.
- You do not have to disable an option that shows an alert. If the shopper submits that form, the processor refuses the payment with the same error, and the component calls `onError`.
- Each `isAvailable()` and `mount()` call asks the processor for the current cart state.
- If the cart total, an address or the cart ID changes, call `isAvailable()` again. If it returns `false`, hide the payment option and clear the label and widget containers that you mounted before. Also clear the containers before you mount an available option again. Then the container holds no outdated content.

#### Compatibility

`paymentType` and `isAvailable()` need a processor that supports the `paymentType` query parameter of [Get Payment Method](./GetPaymentMethod.md). Deploy the enabler and the processor from the same connector release. An older processor ignores `paymentType` and answers with the installment checks. The enabler then shows pay by invoice only if that response reports `paymentTypes.BILL_PAYMENT.available: true`. A processor without this field therefore never offers pay by invoice.

To check a deployed processor, send `GET /payments/payment-method/{cartId}?paymentType=UNKNOWN` with a valid session. A processor that supports the parameter returns `400 InvalidField`. An older processor ignores the parameter and answers with the installment checks.

In TypeScript, `isAvailable` is an optional member of `CheckoutComponent`. Custom implementations and typed test doubles that you wrote for earlier versions therefore compile unchanged. The components that the supplied builder returns always implement it. The builder is typed with `CheckoutComponent`, so call `isAvailable?.()` and treat a missing method as unavailable. A caller that uses only `mount()` and `submit()` gets an empty installment container when installment is switched off (`INSTALLMENT_PAYMENT_ENABLED=0`) or easyCredit is unavailable. Call `isAvailable()` before you show either payment option. Then the option itself is also hidden. A custom implementation that adds the method must follow the availability rules above.

A test double for availability can return the result that the test scenario needs:

```ts
const availableCheckout: CheckoutComponent = {
  mount: () => {},
  submit: () => {},
  isAvailable: async () => true,
};
const unavailableCheckout: CheckoutComponent = {
  ...availableCheckout,
  isAvailable: async () => false,
};
```

#### Pay by invoice as a separate payment method

- Build a second checkout component with `paymentType: 'BILL_PAYMENT'`. Build a label with `{ paymentType: 'BILL_PAYMENT' }`. You can mount both payment methods on the same page. Give each its own container.
- For the rules that decide if the connector offers each payment type, see [Payment type availability](./GetPaymentMethod.md#payment-type-availability).
- If `paymentType` is not `INSTALLMENT_PAYMENT` or `BILL_PAYMENT`, the builder throws an error.
- Pay by invoice is available only for private persons who receive the goods at their billing address in Germany. If the cart breaks one of these rules, the widget shows an error message. For the rules, see [Payment type availability](./GetPaymentMethod.md#payment-type-availability).

  ```ts
  const [labelBuilder, checkoutBuilder] = await Promise.all([
    enabler.createLabelBuilder(),
    enabler.createCheckoutBuilder(),
  ]);

  for (const [paymentType, elementId] of [
    ["INSTALLMENT_PAYMENT", "easycredit-checkout"],
    ["BILL_PAYMENT", "easycredit-bill-checkout"],
  ] as const) {
    // Assumes: enabler as above. checkoutOptions: the options of the checkout snippet above, without paymentType.
    const checkoutComponent = checkoutBuilder.build({
      ...checkoutOptions,
      paymentType,
    });

    if (!(await checkoutComponent.isAvailable?.())) {
      continue; // do not offer this payment method
    }

    // show the payment option, then mount label and widget into it
    labelBuilder.build({ paymentType }).mount(`#${elementId}-label`);
    await checkoutComponent.mount(`#${elementId}`);
  }
  ```

The example uses TypeScript. If you use plain JavaScript, omit `as const`.

### Summary component

- It is made from the [easyCredit Label component](https://netzkollektiv.com/docs/easycredit-components/?path=/docs/checkout-label--docs) and the [easyCredit Checkout component](https://netzkollektiv.com/docs/easycredit-components/?path=/docs/checkout-checkout--docs).
- The code is in [summary.component.ts](../assets/src/components/summary.component.ts).
- The summary shows the payment type of the payment, installment or pay by invoice. It uses `paymentType` from [Get Payment](./GetPayment.md). This is the final type from easyCredit. If easyCredit reports another type than the one the payment was created with (a switch on the easyCredit page, see [Create Payment](./CreatePayment.md#switching-on-the-easycredit-page)), the summary renders the new type, whatever type the component was built with.
- If the response has no `paymentType` (for example, an error), the summary uses the optional `paymentType` build option. If you do not set it, the summary uses installment. Pass the payment type that the customer selected. Then an error is not shown under the installment label.
- To use this component, add this snippet to your shop:

  ```js
    // Assumes: Enabler is loaded, see Step 1. Your shop provides these values:
    // sessionId: the checkout session ID. paymentId: the ID of the commercetools payment.
    const enabler = new Enabler({
      processorUrl: '<PROCESSOR_URL>', // Connector's processor URL
      sessionId: sessionId, // The checkout session ID
    });

    enabler.createSummaryBuilder().then((summaryComponentBuilder) => {
      const summaryComponent = summaryComponentBuilder.build({
        paymentId: paymentId,
        paymentType: 'BILL_PAYMENT', // optional, 'INSTALLMENT_PAYMENT' (default) or 'BILL_PAYMENT'
      });

      summaryComponent
        .mount('#easycredit-summary') // The place to display the component
        .catch((error) => {
          console.error('failed to mount', error);
        });
    });
  ```

- The component sends API calls to the connector to find out if it can be shown. If it can be shown, it looks like this image: ![easyCredit Checkout component](./assets/easycredit-summary.png)

### Express button component

- It is made from the `easycredit-express-button` web component of easyCredit. For the payment flow behind it, see [Create Express Payment](./CreateExpressPayment.md) and [Express Return](./ExpressReturn.md).
- The code is in [express.component.ts](../assets/src/components/express.component.ts).
- It starts an express checkout from the product page (PDP) or the cart. The shopper enters name and address on the easyCredit page.
- To show the button, set `EXPRESS_BUTTON_ENABLED` to `1` and set `WEBSHOP_ID` correctly. `WIDGET_ENABLED` has no effect on the button. `EXPRESS_BUTTON_VISIBILITY` selects where the button shows: `PDP_AND_CART` (default), `PDP` or `CART`. These settings only control the button. The express endpoints do not check them.
- To use this component, add this snippet to your shop:

  ```js
    // Assumes: Enabler is loaded, see Step 1. Your shop provides these values:
    // sessionId: the checkout session ID. amount: the amount in EUR major units, for example 599.9.
    // Declare the counter once, outside the code that mounts: let latestMount = 0;
    const run = ++latestMount; // A later run for the same container overtakes this one.
    const enabler = new Enabler({
      processorUrl: '<PROCESSOR_URL>', // Connector's processor URL
      sessionId: sessionId, // The checkout session ID. On the PDP, `sessionId` can be empty: `prepareCart` supplies the session of the prepared cart, see below.
    });

    const expressBuilder = await enabler.createExpressButtonBuilder();
    const expressButton = expressBuilder.build({
      placement: 'CART', // 'PDP' or 'CART'. PDP needs prepareCart, see below.
      amount: amount,
      redirectLinks: {
        urlSuccess: window.location.origin + '/express/return',
        urlCancellation: window.location.origin + '/cart?status=cancelled',
        urlDenial: window.location.origin + '/cart?status=denied',
      },
      onLoading: () => {}, // optional, for example show a spinner
      onError: (err) => console.error('onError', err),
      onSuccess: (response) => window.location.replace(response.redirectUrl),
    });

    const rendered = await expressButton.mount('#easycredit-express'); // The place to display the component
    // Use only the result of the latest run. An overtaken mount resolves false.
    if (run === latestMount) {
      document.querySelector('#easycredit-express').hidden = !rendered; // Hide without a button, show with one
    }
  ```

#### Options

| Option | Required | Description |
| --- | --- | --- |
| `placement` | yes | `PDP` or `CART`. It selects the payment type check and the visibility setting. |
| `amount` | yes | The amount in EUR major units. If it is not a finite number, the button is not rendered. |
| `redirectLinks` | yes | `urlSuccess`, `urlCancellation` and `urlDenial`. They follow the rules in [Create Express Payment](./CreateExpressPayment.md). |
| `prepareCart` | on `PDP` | A function that empties the cart, puts only this product in it and returns the checkout session ID of that cart. Required on the PDP: without it, `mount()` renders nothing, resolves to `false` and logs an error to the console. Optional on the cart. See [Product page](#product-page). |
| `onLoading` | no | Called when the shopper clicks the button, before any request. |
| `onError` | yes | Called with the error body of the processor, with `{ statusCode }` if the error body is not JSON (for example a gateway `502` or `504`), or with an `Error`. |
| `onSuccess` | yes | Called with the response of `POST /payments/express`. Send the shopper to `redirectUrl`. |

#### Which payment types the button shows

- Both placements read `GET /operations/widget-enabled`. The button shows only if `expressButtonEnabled` is `true`, `expressButtonVisibility` is the placement or `PDP_AND_CART`, and the response has a `webShopId`. An older processor does not send the express fields, so the button stays hidden.
- `PDP`: the button shows the `paymentTypes` of `widget-enabled`. It does not check the cart. The easyCredit web component applies the amount limits.
- `CART`: the button keeps a payment type only if `GET /payments/express/payment-method` answers `200` for the cart of the session. See [Check the payment types](./CreateExpressPayment.md#check-the-payment-types).
- If no payment type is left, the button is not rendered.

#### Mount and click behavior

- `mount()` resolves to `true` when it rendered a button and to `false` when it did not. It does not reject. If it resolves to `false`, it removed any earlier button from the container (unless a later mount took over, see below). Hide the container on `false` and show it again on `true`.
- The container must exist when you call `mount()` and stay in the DOM until `mount()` resolves. The component looks up the container before its first request and renders the button into that element.
- A second `mount()` in the same container replaces the button. Call it again for each new amount. If two mounts overlap, only the one that started last changes the container. The earlier one resolves to `false` without touching the container. Use only the result of the last mount to show or hide the container.
- Do not mount the button inside a `<form>`. The web component also fires a deprecated `submit` event that bubbles.
- A click while an earlier click is still running is ignored.
- On click, the component calls `prepareCart` (always on the PDP, on the cart if set). Then it sends `POST /payments/express` with the chosen payment type and `redirectLinks`, and calls `onSuccess` or `onError`.
- Only the payment type goes to the connector. The number of installments that the shopper chose in the easyCredit modal is not forwarded.
- After the shopper accepts, the easyCredit modal stays open. If the page has not navigated away after 10 seconds, easyCredit shows its own alert that easyCredit payment is not possible at the moment and closes the modal. So `prepareCart`, `POST /payments/express` and the redirect in `onSuccess` must finish within 10 seconds. After `onError`, the shopper also sees this alert from easyCredit.

#### Product page

- On the PDP, `prepareCart` is required. `POST /payments/express` charges the whole cart of the session, but the button shows the price of this product. So `prepareCart` must empty the cart and put only this product in it, quantity 1. This is a requirement of easyCredit (TeamBank). It returns the checkout session ID of this cart. The component sends the express request with this session ID.
- The function runs on every click, also when the shopper clicks again after `onError`. It must be idempotent: after each run, the cart holds exactly this product, quantity 1.
- An error in the function goes to `onError`.

  ```js
    placement: 'PDP',
    prepareCart: async () => {
      // Your shop code: remove all line items, then add only this product with quantity 1.
      await replaceCartWithProduct(productId);
      return await createCheckoutSession(); // The session of the cart that holds only this product
    },
  ```

## Step 3: Troubleshooting

- If the components do not work as you expect, look for errors in the Console tab of the browser developer tools.
