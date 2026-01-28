import 'dotenv/config';
import { buildApp } from './app.js';
// 🔥 START WORKER (ONE LINE)
import './workers/usdcSpender';

const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';

async function start() {
  try {
    const app = await buildApp();
    
    await app.listen({ 
      port: PORT, 
      host: HOST 
    });

    console.log(`
🚀 Server ready at http://localhost:${PORT}

Available endpoints:
  GET  /health
  POST /auth/send-otp
  POST /auth/verify-otp
  POST /escrows
  GET  /escrows/:id
  POST /payment-requests
  GET  /payment-requests/:id
  POST /webhooks/stripe
  POST /webhooks/mpesa
    `);
  } catch (err) {
    console.error('Error starting server:', err);
    process.exit(1);
  }
}

start();