const express = require('express');
const cors = require('cors');
const ClientManager = require('./services/ClientManager');
const RedisPublisher = require('./services/RedisPublisher');
const clientRoutes = require('./routes/clients');

const app = express();
const PORT = process.env.PORT || 3001;
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const DATA_DIR = process.env.DATA_DIR || './data';

// Middleware
app.use(cors());
app.use(express.json());

// Initialize services
const redisPublisher = new RedisPublisher(REDIS_URL);
const clientManager = new ClientManager(redisPublisher, DATA_DIR);

// Routes
app.use('/api/clients', clientRoutes(clientManager));

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'healthy', service: 'whatsapp-service' });
});

// Start server
app.listen(PORT, async () => {
    console.log(`WhatsApp service running on port ${PORT}`);
    console.log(`Redis URL: ${REDIS_URL}`);
    console.log(`Data directory: ${DATA_DIR}`);

    // Auto-restore previously authenticated WhatsApp sessions
    console.log('Checking for saved WhatsApp sessions...');
    await clientManager.restoreSessions();
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('Received SIGTERM, shutting down gracefully...');
    await clientManager.destroyAll();
    await redisPublisher.disconnect();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('Received SIGINT, shutting down gracefully...');
    await clientManager.destroyAll();
    await redisPublisher.disconnect();
    process.exit(0);
});
