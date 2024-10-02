import { createApplicationLogger, rewriteFieldsFormatter } from '@commercetools-backend/loggers';
import { VERSION_STRING } from '../../utils/constant.utils';
import { readConfiguration } from '../../utils/config.utils';
import { toBoolean } from 'validator';

export const log = createApplicationLogger({
  level: toBoolean(readConfiguration().easyCredit.debug ?? '0', true) ? 'debug' : 'info',

  formatters: [
    rewriteFieldsFormatter({
      fields: [{ from: 'message', to: 'message', replaceValue: (value) => `[${VERSION_STRING}] - ${value}` }],
    }),
  ],
  json: true,
});
