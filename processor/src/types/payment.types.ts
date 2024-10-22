import { GetPaymentMethodResponseSchemaDTO } from '../dtos/payments/getPaymentMethod.dto';

export type GetPaymentMethodResponse = GetPaymentMethodResponseSchemaDTO;

export enum CTCartState {
  Active = 'Active',
  Ordered = 'Ordered',
  Frozen = 'Frozen',
}

export enum CTTransactionType {
  Authorization = 'Authorization',
  CancelAuthorization = 'CancelAuthorization',
  Charge = 'Charge',
  Refund = 'Refund',
  Chargeback = 'Chargeback',
}

export enum CTTransactionState {
  Initial = 'Initial',
  Pending = 'Pending',
  Success = 'Success',
  Failure = 'Failure',
}

type ECTransactionOrderDetailsAddress = {
  address: string;
  additionalAddressInformation: string;
  zip: string;
  city: string;
  country: string;
  firstName: string;
  lastName: string;
};

type ECTransactionOrderDetailsArticleNumber = {
  numberType: string;
  number: string | number;
};

export type ECTransactionOrderDetailsShoppingCartInformation = {
  productName: string;
  quantity: number;
  price: number;
  manufacturer?: string;
  productCategory?: string;
  productImageUrl?: string;
  productUrl?: string;
  articleNumber?: ECTransactionOrderDetailsArticleNumber[];
};

type ECTransactionOrderDetails = {
  orderValue: number;
  orderId: string;
  numberOfProductsInShoppingCart: number;
  withoutFlexprice: boolean;
  invoiceAddress: ECTransactionOrderDetailsAddress;
  shippingAddress: ECTransactionOrderDetailsAddress;
  shoppingCartInformation: ECTransactionOrderDetailsShoppingCartInformation[];
};

type ECTransactionShopSystem = {
  shopSystemManufacturer: string;
  shopSystemModuleVersion: string;
};

type ECTransactionCustomer = {
  gender?: 'MR' | 'MRS' | 'DIVERS' | 'NO_GENDER';
  firstName: string;
  lastName: string;
  birthDate?: string;
  birthName?: string;
  birthPlace?: string;
  title?: string;
  contact?: {
    email: string;
    mobilePhoneNumber: string;
    phoneNumber: string;
    phoneNumbersConfirmed: boolean;
  };
  bank?: {
    description: string;
    iban: string;
    bic: string;
  };
  employment?: {
    employmentType:
      | 'EMPLOYEE'
      | 'EMPLOYEE_PUBLIC_SECTOR'
      | 'ANGESTELLTER_OEFFENTLICHER_DIENST'
      | 'WORKER'
      | 'CIVIL_SERVANT'
      | 'RETIREE'
      | 'SELF_EMPLOYED'
      | 'UNEMPLOYED'
      | 'SONSTIGES';
    monthlyNetIncome: number;
  };
  companyName?: string;
};

export type ECTransactionCustomerRelationship = {
  customerStatus: 'NEW_CUSTOMER' | 'EXISTING_CUSTOMER' | 'PREMIUM_CUSTOMER';
  customerSince?: string;
  orderDoneWithLogin?: boolean;
  numberOfOrders: number;
  negativePaymentInformation?: 'NO_PAYMENT_DISRUPTION' | 'PAYMENT_DELAY' | 'PAYMENT_NOT_DONE' | 'NO_INFORMATION';
  riskyItemsInShoppingCart?: boolean;
  logisticsServiceProvider?: string;
};

export type ECTransactionRedirectLinksWithoutAuthorizationCallback = {
  urlSuccess: string;
  urlCancellation: string;
  urlDenial: string;
};

type ECTransactionRedirectLinks = ECTransactionRedirectLinksWithoutAuthorizationCallback & {
  urlAuthorizationCallback: string;
};

export enum ECTransactionPaymentType {
  ECTransactionInstallmentPayment = 'INSTALLMENT_PAYMENT',
  ECTransactionBillPayment = 'BILL_PAYMENT',
}

type ECTransactionConsent = {
  sepaMandate: boolean;
  advertisement: boolean;
  dataProcessing: boolean;
  consentToActInOnwnName: boolean;
};

export type ECTransaction = {
  financingTerm?: number;
  orderDetails: ECTransactionOrderDetails;
  shopsystem?: ECTransactionShopSystem;
  customer: ECTransactionCustomer;
  customerRelationship?: ECTransactionCustomerRelationship;
  redirectLinks: ECTransactionRedirectLinks;
  paymentType?: ECTransactionPaymentType;
  paymentSwitchPossible?: boolean;
  consent?: ECTransactionConsent;
};

export enum ECTransactionDecision {
  POSITIVE = 'POSITIVE',
  NEGATIVE = 'NEGATIVE',
}

export type ECCreatePaymentResponse = {
  technicalTransactionId: string;
  transactionId: string;
  redirectUrl: string;
  transactionInformation: {
    status: string;
    decision: {
      decisionOutcome: string;
      decisionOutcomeText: string;
    };
  };
};

export enum ECTransactionStatus {
  PENDING = 'PENDING',
  SUCCESS = 'SUCCESS',
  FAILURE = 'FAILURE',
}

export type ECGetPaymentResponse = {
  status: ECTransactionStatus;
};

type ECTransactionViolation = {
  field: string;
  message: string;
  messageDE: string;
};

export type ECTransactionError = {
  title: string;
  violations: ECTransactionViolation[];
};
