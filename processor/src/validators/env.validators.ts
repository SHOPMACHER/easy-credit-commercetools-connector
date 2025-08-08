import { optional, region, standardKey, standardString, standardUrl } from './helpers.validators';

/**
 * Create here your own validators
 */
const envValidators = [
  standardString(
    ['commerceTools', 'clientId'],
    {
      code: 'InValidClientId',
      message: 'Client id should be 24 characters.',
      referencedBy: 'environmentVariables',
    },
    { min: 24, max: 24 },
  ),

  standardString(
    ['commerceTools', 'clientSecret'],
    {
      code: 'InvalidClientSecret',
      message: 'Client secret should be 32 characters.',
      referencedBy: 'environmentVariables',
    },
    { min: 32, max: 32 },
  ),

  standardKey(['commerceTools', 'projectKey'], {
    code: 'InvalidProjectKey',
    message: 'Project key should be a valid string.',
    referencedBy: 'environmentVariables',
  }),

  optional(standardString)(
    ['scope'],
    {
      code: 'InvalidScope',
      message: 'Scope should be at least 2 characters long.',
      referencedBy: 'environmentVariables',
    },
    { min: 2, max: undefined },
  ),

  region(['commerceTools', 'region'], {
    code: 'InvalidRegion',
    message: 'Not a valid region.',
    referencedBy: 'environmentVariables',
  }),

  standardUrl(['commerceTools', 'sessionUrl'], {
    code: 'InvalidSessionUrl',
    message: 'Invalid Session URL.',
    referencedBy: 'environmentVariables',
  }),

  standardString(
    ['easyCredit', 'widgetEnabled'],
    {
      code: 'InvalidWidgetEnabled',
      message: 'Easycredit Widget enabled should be a valid string of either "0" or "1".',
      referencedBy: 'environmentVariables',
    },
    {
      min: 1,
      max: 1,
    },
  ),

  standardString(
    ['easyCredit', 'webShopId'],
    {
      code: 'InvalidWebShopId',
      message: 'Easycredit webshop ID should be a valid string',
      referencedBy: 'environmentVariables',
    },
    {
      min: 1,
      max: 30,
    },
  ),

  standardString(
    ['easyCredit', 'apiPassword'],
    {
      code: 'InvalidWebShopId',
      message: 'Easycredit API Password should be a valid string',
      referencedBy: 'environmentVariables',
    },
    {
      min: 1,
      max: 50,
    },
  ),

  standardString(
    ['easyCredit', 'debug'],
    {
      code: 'InvalidDebug',
      message: 'Mollie debug should be a valid string of either "0" or "1".',
      referencedBy: 'environmentVariables',
    },
    {
      min: 1,
      max: 1,
    },
  ),
];

export default envValidators;
