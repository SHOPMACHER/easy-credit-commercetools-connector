import { FastifyReply, FastifyRequest } from 'fastify';
import { errorHandler } from '../libs/fastify/error-handler';
import { log } from '../libs/logger';
import { readConfiguration } from '../utils/config.utils';
import { initEasyCreditClient } from '../client/easycredit.client';

export const healthCheck = async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    log.debug('healthCheck - The connector is running healthily.');

    const checkIntegrationResponse = await initEasyCreditClient().integrationCheck({
      message: 'ratenkauf by easyCredit',
    });

    return reply.code(200).send({
      message:
        'The connector is running healthily' + (checkIntegrationResponse ? ' and connected to EasyCredit.' : '.'),
    });
  } catch (error) {
    log.error('healthCheck - Unexpected error occurred when processing request', error);

    if (error instanceof Error) {
      return errorHandler(error, request, reply);
    }

    return reply.code(400).send();
  }
};

export const isWidgetEnabled = async (request: FastifyRequest, reply: FastifyReply) => {
  const config = readConfiguration();

  log.debug('get PDP Widget config');

  return reply.code(200).send({
    isEnabled: !!config.easyCredit.widgetEnabled,
    webShopId: config.easyCredit.webShopId,
  });
};
