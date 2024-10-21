import { Static, Type } from '@sinclair/typebox';

enum CustomerStatus {
  NEW_CUSTOMER = 'NEW_CUSTOMER',
  EXISTING_CUSTOMER = 'EXISTING_CUSTOMER',
  PREMIUM_CUSTOMER = 'PREMIUM_CUSTOMER',
}

enum NegativePaymentInformation {
  NO_PAYMENT_DISRUPTION = 'NO_PAYMENT_DISRUPTION',
  PAYMENT_DELAY = 'PAYMENT_DELAY',
  PAYMENT_NOT_DONE = 'PAYMENT_NOT_DONE',
  NO_INFORMATION = 'NO_INFORMATION',
}

export const CreatePaymentBodySchema = Type.Object({
  cartId: Type.String(),
  redirectLinks: Type.Object({
    urlSuccess: Type.String(),
    urlCancellation: Type.String(),
    urlDenial: Type.String(),
  }),
  customerRelationship: Type.Object({
    customerStatus: Type.Enum(CustomerStatus),
    customerSince: Type.Optional(Type.String()),
    orderDoneWithLogin: Type.Optional(Type.Boolean()),
    numberOfOrders: Type.Number(),
    negativePaymentInformation: Type.Optional(Type.Enum(NegativePaymentInformation)),
    riskyItemsInShoppingCart: Type.Optional(Type.Boolean()),
    logisticsServiceProvider: Type.Optional(Type.String()),
  }),
});

export const AuthorizePaymentBodySchema = Type.Object({
  paymentId: Type.String(),
});

export const CreatePaymentResponseSchema = Type.Object({
  technicalTransactionId: Type.String(),
  transactionId: Type.String(),
  redirectUrl: Type.String(),
  transactionInformation: Type.Object({
    status: Type.String(),
    decision: Type.Object({
      decisionOutcome: Type.String(),
      decisionOutcomeText: Type.String(),
    }),
  }),
});

export const AuthorizePaymentResponseSchema = Type.Object({
  webShopId: Type.String(),
});

export type CreatePaymentRequestSchemaDTO = Static<typeof CreatePaymentBodySchema>;

export type AuthorizePaymentRequestSchemaDTO = Static<typeof AuthorizePaymentBodySchema>;

export type CreatePaymentResponseSchemaDTO = Static<typeof CreatePaymentResponseSchema>;

export type AuthorizePaymentResponseSchemaDTO = Static<typeof AuthorizePaymentResponseSchema>;
