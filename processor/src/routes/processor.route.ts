import { Router } from 'express';
import {
  install,
  healthCheck,
  uninstall,
} from '../controllers/connector.controller';

const serviceRouter = Router();

// serviceRouter.post('/', post);

serviceRouter.get('/health-check', healthCheck);

serviceRouter.post('/install', install);

serviceRouter.post('/uninstall', uninstall);

export default serviceRouter;
