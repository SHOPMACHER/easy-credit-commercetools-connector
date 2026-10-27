import { Static, Type } from '@sinclair/typebox';
import { ECTransactionPaymentType } from '../../types/payment.types';

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

const RedirectLinksSchema = Type.Object({
  urlSuccess: Type.String(),
  urlCancellation: Type.String(),
  urlDenial: Type.String(),
});

const CustomerRelationshipSchema = Type.Object({
  customerStatus: Type.Enum(CustomerStatus),
  customerSince: Type.Optional(Type.String()),
  orderDoneWithLogin: Type.Optional(Type.Boolean()),
  numberOfOrders: Type.Number(),
  negativePaymentInformation: Type.Optional(Type.Enum(NegativePaymentInformation)),
  riskyItemsInShoppingCart: Type.Optional(Type.Boolean()),
  logisticsServiceProvider: Type.Optional(Type.String()),
});

export const CreatePaymentBodySchema = Type.Object({
  cartId: Type.String(),
  paymentType: Type.Optional(Type.Enum(ECTransactionPaymentType)),
  redirectLinks: RedirectLinksSchema,
  customerRelationship: CustomerRelationshipSchema,
});

// No cartId: express always uses the cart of the session.
export const CreateExpressPaymentBodySchema = Type.Object({
  paymentType: Type.Optional(Type.Enum(ECTransactionPaymentType)),
  redirectLinks: RedirectLinksSchema,
  customerRelationship: Type.Optional(CustomerRelationshipSchema),
});

export const CreatePaymentResponseSchema = Type.Object({
  technicalTransactionId: Type.String(),
  paymentId: Type.String(),
  redirectUrl: Type.String(),
  transactionInformation: Type.Object({
    status: Type.String(),
    decision: Type.Object({
      decisionOutcome: Type.String(),
      decisionOutcomeText: Type.String({
        nullable: true,
      }),
    }),
  }),
});

export type CreatePaymentRequestSchemaDTO = Static<typeof CreatePaymentBodySchema>;

export type CreateExpressPaymentRequestSchemaDTO = Static<typeof CreateExpressPaymentBodySchema>;

export type CreatePaymentResponseSchemaDTO = Static<typeof CreatePaymentResponseSchema>;
