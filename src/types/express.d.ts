import 'express';
import type { AuthedPayload } from '../utils/auth';

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthedPayload;
  }
}
