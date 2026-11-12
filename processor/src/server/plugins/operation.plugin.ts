import { FastifyInstance } from 'fastify';
import { operationsRoute } from '../../routes/operation.route';

export default async function (server: FastifyInstance) {
  await server.register(operationsRoute, { prefix: '/operations' });
}
