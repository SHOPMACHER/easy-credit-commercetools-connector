import { FastifyReply, FastifyRequest } from 'fastify';
import { errorHandler } from '../libs/fastify/error-handler';
import { log } from '../libs/logger';
import { readConfiguration } from '../utils/config.utils';

export const healthCheck = async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    log.debug('SCTE - healthCheck - The connector is running healthily.');
    return reply.code(200).send({
      message: 'The connector is running healthily.',
    });
  } catch (error) {
    log.error('SCTE - healthCheck - Unexpected error occurred when processing request', error);

    if (error instanceof Error) {
      return errorHandler(error, request, reply);
    }

    return reply.code(400).send();
  }
};

export const isWidgetEnabled = async (request: FastifyRequest, reply: FastifyReply) => {
  const config = readConfiguration();

  log.debug('SCTE - get PDP Widget config');

  return reply.code(200).send({
    isEnabled: config.easyCredit.widgetEnabled === '1' ? true : false,
    webShopId: config.easyCredit.webShopId,
  });
};
