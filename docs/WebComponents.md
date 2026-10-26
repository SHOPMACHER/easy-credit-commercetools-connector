# Connector Web Components Integration Guide

This guide provides instructions on how to integrate and display the connector's provided web-components which are [EasyCredit Web Components](https://netzkollektiv.com/docs/easycredit-components/?path=/docs/getting-started-installation--docs) but with our connector's validation logic.

## Table of Contents

- [Step 1: Configuration](#step-1-configuration)
- [Step 2: Initialize and Display the components](#step-2-initialize-and-display-the-components)
- [Step 3: Troubleshooting](#step-3-troubleshooting)

## Step 1: Configuration

- First, after install the connector into the shop, you must config all the necessary credentials that defined in the processor part, you can have a look at [this file](../connect.yaml)

- Then, in your shop, you need to install our package to use provided components:
  - Install via npm package \
    Simply run `npm i @shopmacher/easy-credit-commercetools-component`.
  - Install via CT connector asset service url \
    After installing the connector, an URL will be generated hosting the required package. \
    Simply include this URL as follow 
    ```
    <script type="module" src="YOUR_ASSET_URL_HERE" />
    ```

## Step 2: Initialize and Display the components

- We provide you a way to initialize the components easily just with a short Javascript script. You can have a look at the [demo file](../assets/index.html)
- Currently, we have 4 components which created from EasyCredit Web Components: label, widget, checkout and summary.

### Label component

- Created from [EasyCredit Label component](https://netzkollektiv.com/docs/easycredit-components/?path=/docs/checkout-label--docs)
- It is handled in [label.component.ts](../assets/src/components/label.component.ts)
- To use this component, you need to integrate this short snippet into your shop:

  ```
    const enabler = new Enabler({
      processorUrl: 'https://service-bk5phtyi8svk2ne51fw3ulsn.europe-west1.gcp.commercetools.app/', // Connector's processor URL
      sessionId: session.token, // CommerceTools session ID
    });

    enabler.createLabelBuilder().then((labelBuilder: any) => {
          // paymentType: 'INSTALLMENT_PAYMENT' (default) or 'BILL_PAYMENT'
          const labelComponent = labelBuilder.build({ paymentType: 'INSTALLMENT_PAYMENT' });
          labelComponent.mount('#easycredit-checkout-label');
          setLabelLoaded(true);
        });
  ```

- By doing this, the component will make API calls to the connector to check whether the component can be displayed or not, if it is able to be displayed, the result will be like the image below: ![EasyCredit Label component](./assets/easycredit-label.png)

### Widget component

- Created from [EasyCredit Widget component](https://netzkollektiv.com/docs/easycredit-components/?path=/docs/marketing-widget--docs)
- It is handled in [widget.component.ts](../assets/src/components/widget.component.ts)
- To display the EasyCredit Widget, which mostly been used in the PDP of every shop, you need to make sure that the `WEBSHOP_ID` is set up correctly and the `WIDGET_ENABLED` is set to be `1`
- Then, in the shop side, you need to integrate this short snippet:

  ```
    const enabler = new Enabler({
      processorUrl: 'https://service-bk5phtyi8svk2ne51fw3ulsn.europe-west1.gcp.commercetools.app/', // Connector's processor URL
      sessionId: sessionToken, // CommerceTools session ID
    });

    const widgetBuilder = await enabler.createWidgetBuilder();

    const widgetComponent = widgetBuilder.build({
      amount: totalValue, // Cart amount
    });

    // Mount the new widget
    widgetComponent
      .mount('#easycredit-cart') // The place to display the component
      .then((res: any) => {
        console.log('mounted successfully', res);
      })
      .catch((error: any) => {
        console.log('failed to mount', error);
      });
  ```

- By doing this, the component will make API calls to the connector to check whether the widget can be displayed or not, if it is able to be displayed, the result will be like the image below: ![EasyCredit Widget](./assets/easycredit-widget.png)

### Checkout component

- Created from [EasyCredit Label component](https://netzkollektiv.com/docs/easycredit-components/?path=/docs/checkout-label--docs) and [EasyCredit Checkout component](https://netzkollektiv.com/docs/easycredit-components/?path=/docs/checkout-checkout--docs)
- It is handled in [checkout.component.ts](../assets/src/components/checkout.component.ts)
- To use this component, you need to integrate this short snippet into your shop:

  ```
    const enabler = new Enabler({
      processorUrl: 'https://service-bk5phtyi8svk2ne51fw3ulsn.europe-west1.gcp.commercetools.app/', // Connector's processor URL
      sessionId: session.token, // CommerceTools session ID
    });

    enabler.createCheckoutBuilder().then((checkoutBuilder: any) => {
      const checkoutComponent = checkoutBuilder.build({
        cartId: cart.cartId,
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

        onError: (err: any) => {
          console.error('onError', err);
        },

        onSuccess: (response: any) => {
          console.log('connector handled it successfully', response);

          window.location.replace(response?.redirectUrl);
        },
      });

      checkoutComponent
        .mount('#easycredit-checkout') // The place to display the component
        .then((res: any) => {
          console.log('mounted successfully', res);
        })
        .catch((error: any) => {
          console.log('failed to mount', error);
        });
    });
  ```

- By doing this, the component will make API calls to the connector to check whether the component can be displayed or not, if it is able to be displayed, the result will be like the image below: ![EasyCredit Checkout component](./assets/easycredit-checkout.png)

#### Availability

- `paymentType` selects the easyCredit payment method: `INSTALLMENT_PAYMENT` (default) or `BILL_PAYMENT`. The component asks the connector whether this payment type can be offered for the cart, see [Get Payment Method](./GetPaymentMethod.md).
- `isAvailable()` resolves to `false` if the payment type cannot be offered at all, or if the processor response contains no `webShopId` to render the widget with (for example `401` or `500`), or if the request fails (network error or a body that is not JSON). For `BILL_PAYMENT`, a successful response must also report `paymentTypes.BILL_PAYMENT.available: true`. It does not reject. Hide the payment option in that case. For `BILL_PAYMENT`, `mount()` then renders nothing. For `INSTALLMENT_PAYMENT`, `mount()` keeps its previous behavior: it renders the widget with the error as an alert, or throws if the response has no `webShopId`.

  | Payment type | Hidden on |
  | --- | --- |
  | `INSTALLMENT_PAYMENT` | `PaymentTypeNotAvailable` (installment not activated for the webshop) |
  | `BILL_PAYMENT` | `PaymentTypeNotAvailable` (disabled in the connector or by easyCredit), `InvalidAmount` (cart total outside the billing limits), `EasyCreditUnavailable` |

- Any other error is shown as an alert inside the widget, for example billing and shipping address differ or are not in Germany, or the cart total is outside the installment limits.
- Each `isAvailable()` and `mount()` call queries the current cart state from the processor.
- After the cart changes, call `isAvailable()` again. Hide the payment option when it returns `false`, and clear any previously mounted label and widget containers. Clear the containers before remounting an available option as well, so outdated content is not retained.

#### Compatibility

`paymentType` and `isAvailable()` require a processor that supports the `paymentType` query parameter of [Get Payment Method](./GetPaymentMethod.md). Deploy the enabler and the processor from the same connector release. An older processor ignores `paymentType` and answers with the installment checks. The enabler then shows pay by invoice only if that response reports `paymentTypes.BILL_PAYMENT.available: true`, so a processor without this field never offers it.

No numbered release contains this integration yet, so neither a commit nor the package version tells whether a deployed processor supports it. Check the processor instead: with a valid session, `GET /payments/payment-method/{cartId}?paymentType=UNKNOWN` returns `400 InvalidField` on a supported processor, while an older processor ignores the parameter and answers with the installment checks.

When upgrading TypeScript integrations, `CheckoutComponent` now requires `isAvailable(): Promise<boolean>`. Components returned by the supplied builder already implement it. Add the method to custom implementations and typed test doubles; custom implementations must follow the availability rules above. Existing callers that only use `mount()` and `submit()` need no additional call for installment. For bill payment, call `isAvailable()` before displaying the payment option.

For a test double, choose the result for the scenario under test:

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

- Build a second checkout component with `paymentType: 'BILL_PAYMENT'` and a label with `{ paymentType: 'BILL_PAYMENT' }`. Both payment methods can be mounted on the same page, each into its own container.
- Pay by invoice is only offered if `BILL_PAYMENT_ENABLED=1` in the connector, easyCredit has activated it for the webshop and the cart total is within the billing limits.
- Any `paymentType` other than `INSTALLMENT_PAYMENT` or `BILL_PAYMENT` makes the builder throw an error.
- Pay by invoice is only available for private persons who receive the goods at their billing address in Germany. For a cart with a Business Unit, a company in the billing or any shipping address, or a shipping address that differs from the billing address, the widget shows an error message. With `shippingMode: Multiple` or item shipping addresses, every shipping address is checked.

  ```ts
    const [labelBuilder, checkoutBuilder] = await Promise.all([
      enabler.createLabelBuilder(),
      enabler.createCheckoutBuilder(),
    ]);

    for (const [paymentType, elementId] of [
      ['INSTALLMENT_PAYMENT', 'easycredit-checkout'],
      ['BILL_PAYMENT', 'easycredit-bill-checkout'],
    ] as const) {
      const checkoutComponent = checkoutBuilder.build({
        ...checkoutOptions, // same options as above
        paymentType,
      });

      if (!(await checkoutComponent.isAvailable())) {
        continue; // do not offer this payment method
      }

      // show the payment option, then mount label and widget into it
      labelBuilder.build({ paymentType }).mount(`#${elementId}-label`);
      await checkoutComponent.mount(`#${elementId}`);
    }
  ```

The example uses TypeScript; omit `as const` when using plain JavaScript.

### Summary component

- Created from [EasyCredit Label component](https://netzkollektiv.com/docs/easycredit-components/?path=/docs/checkout-label--docs) and [EasyCredit Checkout component](https://netzkollektiv.com/docs/easycredit-components/?path=/docs/checkout-checkout--docs)
- It is handled in [summary.component.ts](../assets/src/components/summary.component.ts)
- The summary shows the payment type of the payment, installment or pay by invoice, as returned in `paymentType` by [Get Payment](./GetPayment.md). If the response has no `paymentType`, for example an error, it uses the optional `paymentType` build option and otherwise installment. Pass the payment type the customer selected, so an error is not shown under the installment label.
- To use this component, you need to integrate this short snippet into your shop:

  ```
    enabler = new Enabler({
      processorUrl: 'https://service-bk5phtyi8svk2ne51fw3ulsn.europe-west1.gcp.commercetools.app/', // Connector's processor URL
      sessionId: session.token, // CommerceTools session ID
    });

    enabler.createSummaryBuilder().then((summaryComponentBuilder: any) => {
      const summaryComponent = summaryComponentBuilder.build({
        paymentId: easyCreditPayment.id,
        paymentType: 'BILL_PAYMENT', // optional, 'INSTALLMENT_PAYMENT' (default) or 'BILL_PAYMENT'
      });

      summaryComponent
        .mount('#easycredit-summary') // The place to display the component
        .then((res: any) => {
          console.log('mounted successfully', res);
        })
        .catch((error: any) => {
          console.log('failed to mount', error);
        });
    });
  ```

- By doing this, the component will make API calls to the connector to check whether the component can be displayed or not, if it is able to be displayed, the result will be like the image below: ![EasyCredit Checkout component](./assets/easycredit-summary.png)

## Step 3: Troubleshooting

- When integrating, if any unexpected behavior occurs, check the Console tab in Dev Tools for errors that may assist in troubleshooting.
