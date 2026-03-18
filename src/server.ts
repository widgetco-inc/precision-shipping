import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import path from 'path';
import { env } from './lib/env';
import appRoutes from './routes/app';
import previewRoutes from './routes/preview';
import carrierRoutes from './routes/carrier';
import adminRoutes from './routes/admin';

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'widgetco-shipping-app' });
});

app.use(appRoutes);
app.use(previewRoutes);
app.use(carrierRoutes);
app.use(adminRoutes);

app.get('/', (_req, res) => res.redirect('/app'));

app.listen(env.port, () => {
  console.log(`WidgetCo shipping app listening on port ${env.port}`);
});
