import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { errorHandler } from './middleware/errorHandler.js';
// Rotas
import authRoutes from './routes/auth.routes.js';
import financeRoutes from './routes/finance.routes.js';
import budgetRoutes from './routes/budget.routes.js';
import entitiesRoutes from './routes/entities.routes.js';
import recurringRoutes from './routes/recurring.routes.js';
import calendarRoutes from './routes/calendar.routes.js';
import remindersRoutes from './routes/reminders.routes.js';
import categoriesRoutes from './routes/categories.routes.js';
import exportRoutes from './routes/export.routes.js';
import cardsRoutes from './routes/cards.routes.js';
import incomeSourcesRoutes from './routes/income_sources.routes.js';
import installmentsRoutes from './routes/installments.routes.js';
import agentRoutes from './routes/agent.routes.js';
import webhookRoutes from './routes/webhooks.routes.js';
import googleRoutes from './routes/google.routes.js';
import userDataRoutes from './routes/user_data.routes.js';
import subscriptionRoutes from './routes/subscription.routes.js';
import billingRoutes from './routes/billing.routes.js';
import platformAdminRoutes from './routes/platform-admin.routes.js';
import invitationRoutes from './routes/invitation.routes.js';
import importsRoutes from './routes/imports.routes.js';
import { LegalController } from './controllers/legal.controller.js';
import { apiLimiter } from './middleware/rate-limiter.js';
import { schedulerHealthSnapshot } from './services/job-runtime.service.js';
import { configureTrustProxy } from './config/trust-proxy.js';
import { createBillingWebhookRouter } from './billing/webhook-router.js';
import { AbacatePayProvider } from './billing/abacatepay.provider.js';

dotenv.config();

process.env.TZ = 'America/Sao_Paulo';

const app = express();
const trustProxyHops = configureTrustProxy(app);
const PORT = process.env.PORT || 3001;

// --- Middlewares Globais ---
const defaultAllowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
  'https://torrinco.forjacorp.com',
  'http://torrinco.forjacorp.com',
  'https://apitorrinco.forjacorp.com',
  'http://apitorrinco.forjacorp.com'
];
const configuredOrigins = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map(origin => origin.trim().replace(/\/$/, ''))
  .filter(Boolean);
const allowedOrigins = new Set(configuredOrigins.length > 0 ? configuredOrigins : defaultAllowedOrigins);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const normalizedOrigin = origin.replace(/\/$/, '');
    if (allowedOrigins.has(normalizedOrigin)) {
      callback(null, true);
    } else {
      console.warn(`[cors] Origin recusada: ${normalizedOrigin}`);
      callback(new Error(`Origin não permitida pelo CORS: ${normalizedOrigin}`));
    }
  },
  credentials: true
}));

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  crossOriginEmbedderPolicy: false
}));

// O corpo bruto e necessario para validar a assinatura HMAC do AbacatePay.
app.use('/api/billing/webhook/abacatepay', express.raw({ type: 'application/json', limit: '256kb' }), createBillingWebhookRouter(new AbacatePayProvider()));
app.use(express.json());
app.use(cookieParser());

// Rate limit global — protege a API inteira contra abuso/DoS.
// Rotas sensíveis (login, reset) têm limites próprios mais apertados.
app.use('/api', apiLimiter);



// --- Rotas ---

// Rota de Saúde / Info
app.get('/', (req: Request, res: Response) => {
  res.json({ 
    message: 'Torrinco API',
    status: 'online',
    version: '1.0.0'
  });
});

// Health Check para Coolify
app.get('/health', async (req: Request, res: Response) => {
  try {
    const { prisma } = await import('./lib/prisma.js');
    await prisma.$queryRaw`SELECT 1`;
    const scheduler = schedulerHealthSnapshot();
    const [retrying, permanentFailures] = await Promise.all([
      prisma.reminder_deliveries.count({ where: { status: 'retry' } }),
      prisma.reminder_deliveries.count({ where: { status: 'permanent_failure', failed_at: { gte: new Date(Date.now() - 24 * 60 * 60_000) } } })
    ]);
    res.json({ status: 'healthy', database: 'connected', scheduler: { started: scheduler.started, lastTickAt: scheduler.lastTickAt, lastSuccessAt: scheduler.lastSuccessAt, lastErrorAt: scheduler.lastErrorAt, retrying, permanentFailures24h: permanentFailures } });
  } catch (error) {
    res.status(503).json({ status: 'unhealthy', database: 'disconnected' });
  }
});

// Páginas legais (públicas) — exigidas pelo Google OAuth consent screen.
app.get('/privacy', LegalController.privacy);
app.get('/terms', LegalController.terms);
app.get('/api/legal/privacy', LegalController.privacy);
app.get('/api/legal/terms', LegalController.terms);

//// Registro de Módulos
app.use('/api/auth', authRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/budgets', budgetRoutes);
app.use('/api/entities', entitiesRoutes);
app.use('/api/recurring', recurringRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/reminders', remindersRoutes);
app.use('/api/categories', categoriesRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/cards', cardsRoutes);
app.use('/api/income-sources', incomeSourcesRoutes);
app.use('/api/installments', installmentsRoutes);
app.use('/api/agent', agentRoutes);
app.use('/api/google', googleRoutes);
app.use('/api/user', userDataRoutes);
app.use('/api/subscription', subscriptionRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/platform-admin', platformAdminRoutes);
app.use('/api/invitations', invitationRoutes);
app.use('/api/imports', importsRoutes);
app.use('/webhooks', webhookRoutes);


// --- Tratamento de Erros ---
app.use(errorHandler);

// --- Inicialização do Servidor ---
const startServer = async () => {
  try {
    const { prisma } = await import('./lib/prisma.js');
    await prisma.$connect();
    console.log('✅ Conectado ao banco de dados (Prisma)');

    // Registra os jobs agendados (recorrências + ciclo de faturas).
    const { startScheduledJobs } = await import('./jobs/scheduler.js');
    if (process.env.SCHEDULER_ENABLED !== 'false') startScheduledJobs();

    app.listen(PORT, () => {
      console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
      console.log(`🆔 PID do Processo: ${process.pid}`);
    });
  } catch (error) {
    console.error('❌ Falha ao iniciar o servidor:', error);
    process.exit(1);
  }
};

startServer();
