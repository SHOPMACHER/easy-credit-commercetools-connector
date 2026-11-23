import { Errorx } from '@commercetools/connect-payments-sdk';

// The request may have reached easyCredit without a clear answer, so easyCredit may still book it.
export class ECOutcomeUnknownError extends Errorx {}
