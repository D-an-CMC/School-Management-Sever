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

app.listen(env.PORT, () => {
  console.log(`Server running on http://localhost:${env.PORT}`);
});
