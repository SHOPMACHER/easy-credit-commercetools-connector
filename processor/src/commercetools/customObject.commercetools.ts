import { Errorx } from '@commercetools/connect-payments-sdk';
import { createApiRoot } from '../client/create.client';
import { log } from '../libs/logger';
import {
  CustomObject,
  CustomObjectDraft,
} from '@commercetools/platform-sdk/dist/declarations/src/generated/models/custom-object';

export async function updateCustomObject(customObject: CustomObjectDraft): Promise<CustomObject> {
  try {
    const response = await createApiRoot()
      .customObjects()
      .post({
        body: customObject,
      })
      .execute();
    const { body: object } = response;

    return object;
  } catch (error: any) {
    log.error('Error in updateCustomObject', error);

    throw new Errorx({
      code: error?.code as string,
      message: error?.body?.message as string,
      httpErrorStatus: error?.statusCode,
      fields: error.body?.errors,
    });
  }
}

export async function getCustomObjectByKey(container: string, key: string): Promise<CustomObject | null> {
  try {
    const { body: customObject } = await createApiRoot()
      .customObjects()
      .withContainerAndKey({
        container,
        key,
      })
      .get()
      .execute();

    return customObject;
  } catch (error: any) {
    log.error('Error in getCustomObjectByKey', error);

    throw new Errorx({
      code: error?.code as string,
      message: error?.body?.message as string,
      httpErrorStatus: error?.statusCode,
      fields: error.body?.errors,
    });
  }
}
