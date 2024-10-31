import { FastifyInstance } from 'fastify';
import { easyCreditRoutes } from '../../routes/easycreditNotification.route';

export default async function (server: FastifyInstance) {
  await server.register(easyCreditRoutes, {
    prefix: '/easycredit-notification',
  });
}
