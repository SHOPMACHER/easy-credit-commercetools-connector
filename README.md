# COMMERCETOOLS EASYCREDIT CONNECTOR

[![Project Status: Active – The project has reached a stable, usable state and is being actively developed.](https://www.repostatus.org/badges/latest/active.svg)](https://www.repostatus.org/#active)
[![GitHub Actions](https://github.com/SHOPMACHER/easy-credit-commercetools-connector/actions/workflows/build.yml/badge.svg)](https://github.com/SHOPMACHER/easy-credit-commercetools-connector/actions/workflows/build.yml/badge.svg)
[![GitHub Actions](https://github.com/SHOPMACHER/easy-credit-commercetools-connector/actions/workflows/audit.yml/badge.svg)](https://github.com/SHOPMACHER/easy-credit-commercetools-connector/actions/workflows/audit.yml/badge.svg)
[![Coverage](https://sonarqube.shopmacher.cloud/api/project_badges/measure?project=easy-credit-connector&metric=coverage&token=sqb_cfc24c1871abd4b576cebc86b16b25fb69072e84)](https://sonarqube.shopmacher.cloud/dashboard?id=easy-credit-connector)
[![Maintainability Rating](https://sonarqube.shopmacher.cloud/api/project_badges/measure?project=easy-credit-connector&metric=sqale_rating&token=sqb_cfc24c1871abd4b576cebc86b16b25fb69072e84)](https://sonarqube.shopmacher.cloud/dashboard?id=easy-credit-connector)
[![Security Rating](https://sonarqube.shopmacher.cloud/api/project_badges/measure?project=easy-credit-connector&metric=security_rating&token=sqb_cfc24c1871abd4b576cebc86b16b25fb69072e84)](https://sonarqube.shopmacher.cloud/dashboard?id=easy-credit-connector)
[![Quality Gate Status](https://sonarqube.shopmacher.cloud/api/project_badges/measure?project=easy-credit-connector&metric=alert_status&token=sqb_cfc24c1871abd4b576cebc86b16b25fb69072e84)](https://sonarqube.shopmacher.cloud/dashboard?id=easy-credit-connector)

![commercetools logo](https://unpkg.com/@commercetools-frontend/assets/logos/commercetools_primary-logo_horizontal_RGB.png)

easyCredit-Ratenkauf - use the easiest installment purchase in Germany now.

Our credo of simple, fair and secure applies to both installment purchase customers and retailers. The fast, simple and seamless process with an immediate online credit check can be securely integrated into your online store. We cover the loss risk and you can receive your payment after just three days.

You can rely on our many years of experience in liquidity management and the proven high level of customer satisfaction with easyCredit.

## Advantages for the merchant

- **Simple** - Easy integration of the plugin.

- **Fair** - Simple, transparent pricing model.

- **Secure** - Maximum protection of payment data has top priority.

## Advantages for the end customer

- **Immediate** - Immediate credit decision in the payment process. Conveniently without PostIdent procedure.

- **Fair** - Clear presentation of the installment price without hidden costs or fees.

- **Flexible** - Early repayment and payment breaks by the installment purchase customer possible.

## Product details

- **Purchase amounts**: Defined by easyCredit per webshop and not configurable in the connector. During temporary failures, installment uses usable cached limits or, if none remain, the legacy 200 € to 10,000 € defaults, unless a known deactivation or permanent failure blocks fallback. Bill payment is unavailable with stale or default data.

- **Terms**: 2 to 60 months freely selectable

- **Can be used in German online stores**

## 📔 Supported features

### Installment payment

- [Create payments](/docs/CreatePayment.md)
- [Authorize payments](/docs/AuthorizePayment.md)
- [Capture payments](/docs/CapturePayment.md)
- [Refund payments](/docs/RefundPayment.md)

### Pay by invoice (easyCredit-Rechnung)

TEBA-248 offers pay by invoice as a separate payment method with its own label and checkout widget. The backend creates and authorizes transactions with `paymentType: BILL_PAYMENT`. Set `BILL_PAYMENT_ENABLED=1` and have easyCredit activate pay by invoice for the webshop. Pay by invoice is limited to physical goods: carts with excluded product types or custom line items (`BILL_PAYMENT_EXCLUDED_PRODUCT_TYPES`, `BILL_PAYMENT_EXCLUDED_CUSTOM_LINE_ITEMS`) cannot use it.

See the [web components integration guide](./docs/WebComponents.md#pay-by-invoice-as-a-separate-payment-method) and [Create payments](/docs/CreatePayment.md).

## Prerequisite

1. Commercetools composable commerce account
2. [EasyCredit partner account](https://www.easycredit.de/)

## 📐 Architecture Principles

This repository contains two standalone modules that interact with commercetools and EasyCredit.
Complete integration requires running/intergrating both of the modules. Please find detail information in their readme below

- [Assets](/assets/README.md)
- [Processor](/processor/README.md)

![Payment flow](./docs/assets/payment-flow.png "Payment flow")

## 🤝 Contributing

Contributions are what make the open-source community such an amazing place to learn, inspire, and create. Any contributions you make are greatly appreciated.

Please follow these file for further information on how to contribute to this repository.

- [Contributing guideline](/docs/CONTRIBUTING.md)
- [Issue template](/docs/IssueTemplate.md)

## 📝 License

Distributed under the MIT License. See [LICENSE](/LICENSE) for more information.

## 📞 Contact

Are you interested and would like to use easyCredit-Ratenkauf?

Simply get in touch with us at

[sales.ratenkauf@easycredit.de](mailto:sales.ratenkauf@easycredit.de)

[+49 (0) 911 5390 2726](tel:+4991153902726)

Or register directly here:

[https://partner.easycredit-ratenkauf.de/registrierung](https://partner.easycredit-ratenkauf.de/registrierung)


Please note that you need a valid contract to use the connector.

<div align="center"> <b>Happy Coding! 🚀</b> </div>
