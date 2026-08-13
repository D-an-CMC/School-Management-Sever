import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { errorMiddleware } from './middleware/error.middleware';
import { corsOptions } from './config/cors';
import { env } from './config/env';
import routes from './routes';

const app = express();

app.use(cors(corsOptions));
app.use(express.json());

app.use('/api', routes);

app.use(errorMiddleware);

app.listen(env.PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${env.PORT}`);
});

process.on('SIGINT', () => {
  process.exit(0);
});
process.on('SIGTERM', () => {
  process.exit(0);
});
