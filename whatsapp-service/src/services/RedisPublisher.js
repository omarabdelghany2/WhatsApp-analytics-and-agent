const Redis = require('ioredis');

class RedisPublisher {
    constructor(redisUrl) {
        this.redis = new Redis(redisUrl);
        this.channel = 'whatsapp:events';

        this.redis.on('connect', () => {
            console.log('Redis connected');
        });

        this.redis.on('error', (err) => {
            console.error('Redis error:', err);
        });
    }

    async publish(channel, data) {
        try {
            const message = JSON.stringify(data);
            await this.redis.publish(channel || this.channel, message);
            console.log(`Published to ${channel || this.channel}:`, data.type, data.userId);
        } catch (error) {
            console.error('Failed to publish to Redis:', error);
        }
    }

    async disconnect() {
        await this.redis.quit();
    }
}

module.exports = RedisPublisher;
