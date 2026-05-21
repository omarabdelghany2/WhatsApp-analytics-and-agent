const { Client, LocalAuth, MessageMedia, Poll, ScheduledEvent } = require('whatsapp-web.js');
const path = require('path');
const fs = require('fs');
const mime = require('mime-types');

class ClientManager {
    constructor(redisPublisher, dataDir) {
        this.clients = new Map();       // userId -> Client
        this.clientStatus = new Map();  // userId -> status
        this.qrCodes = new Map();       // userId -> qrCode
        this.qrTimeouts = new Map();    // userId -> timeoutId (for QR cleanup)
        this.operationQueues = new Map(); // userId -> Promise (for serializing operations)
        this.groupsCache = new Map();   // userId -> { groups: [], timestamp: Date }
        this.membersCache = new Map();  // groupId -> { members: [], timestamp: Date }
        this.chatNameCache = new Map();  // chatId -> { name, timestamp }
        this.CHAT_NAME_CACHE_TTL = 30 * 60 * 1000; // Cache chat names for 30 minutes
        this.GROUPS_CACHE_TTL = 300000;  // Cache groups for 5 minutes
        this.MEMBERS_CACHE_TTL = 300000; // Cache members for 5 minutes
        this.monitoredGroups = new Map(); // userId -> Set<whatsappGroupId>
        this.isRestarting = false; // Only restart one client at a time
        this.MAX_CONCURRENT_CLIENTS = parseInt(process.env.MAX_CONCURRENT_CLIENTS) || 3; // Limit concurrent browsers
        this.redisPublisher = redisPublisher;
        this.dataDir = dataDir;

        // Ensure data directory exists
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        // Start health check to detect silent disconnections
        this._startHealthCheck();
    }

    /**
     * Set the list of monitored group IDs for a user.
     * Only events from these groups will be processed.
     */
    setMonitoredGroups(userId, groupIds) {
        this.monitoredGroups.set(userId, new Set(groupIds));
        console.log(`[MONITOR] User ${userId}: monitoring ${groupIds.length} groups`);
    }

    /**
     * Check if a group is monitored by a user.
     * If no monitored groups are set, process all (fallback for safety).
     */
    _isGroupMonitored(userId, groupId) {
        const monitored = this.monitoredGroups.get(userId);
        if (!monitored) return true; // No filter set — process all (safety fallback)
        return monitored.has(groupId);
    }

    /**
     * Health check: every 5 minutes, ping each "ready" client with getState().
     * If the session is not CONNECTED, restart the browser to restore it.
     */
    _startHealthCheck() {
        setInterval(async () => {
            for (const [userId, client] of this.clients.entries()) {
                const status = this.clientStatus.get(userId);
                if (status !== 'ready') continue;
                if (this.isRestarting) continue;

                try {
                    const state = await client.getState();
                    if (state === 'CONNECTED') continue;

                    console.log(`[HEALTH] User ${userId} state is "${state}" — restarting browser`);
                } catch (error) {
                    console.log(`[HEALTH] User ${userId} getState() failed: ${error.message} — restarting browser`);
                }

                // Restart this client
                this.isRestarting = true;
                try {
                    this.redisPublisher.publish('whatsapp:events', {
                        type: 'restarting',
                        userId
                    });

                    await this.destroyClient(userId);
                    await new Promise(resolve => setTimeout(resolve, 5000));

                    const result = await this.initializeClient(userId);
                    if (result.success) {
                        console.log(`[HEALTH] Browser restarted for user ${userId}, waiting for ready...`);
                        const readyTimeout = 90000;
                        const startWait = Date.now();
                        while (Date.now() - startWait < readyTimeout) {
                            const newStatus = this.clientStatus.get(userId);
                            if (newStatus === 'ready') {
                                console.log(`[HEALTH] User ${userId} is ready after restart`);
                                break;
                            }
                            if (newStatus === 'failed' || newStatus === 'disconnected') {
                                console.log(`[HEALTH] User ${userId} failed after restart: ${newStatus}`);
                                break;
                            }
                            await new Promise(resolve => setTimeout(resolve, 5000));
                        }
                    } else {
                        console.log(`[HEALTH] Failed to reinitialize user ${userId}: ${result.message}`);
                    }
                } catch (err) {
                    console.error(`[HEALTH] Error restarting user ${userId}:`, err.message);
                } finally {
                    this.isRestarting = false;
                }

                // Only restart one client per cycle
                break;
            }
        }, 5 * 60 * 1000); // Check every 5 minutes
    }

    /**
     * Count currently active (initializing or ready) clients
     */
    getActiveClientCount() {
        let count = 0;
        for (const status of this.clientStatus.values()) {
            if (status === 'initializing' || status === 'ready' || status === 'qr_ready' || status === 'authenticated') {
                count++;
            }
        }
        return count;
    }

    /**
     * Queue an operation for a specific client to prevent concurrent Puppeteer calls
     * This serializes all operations per client to avoid timeout issues
     */
    async _queueOperation(userId, operation) {
        const currentQueue = this.operationQueues.get(userId) || Promise.resolve();

        const newQueue = currentQueue
            .catch(() => {}) // Ignore previous errors
            .then(() => operation());

        this.operationQueues.set(userId, newQueue);

        try {
            return await newQueue;
        } finally {
            // Clean up queue reference if this was the last operation
            if (this.operationQueues.get(userId) === newQueue) {
                this.operationQueues.delete(userId);
            }
        }
    }

    async initializeClient(userId) {
        console.log(`Initializing client for user ${userId}`);

        // Check if client already exists
        if (this.clients.has(userId)) {
            const status = this.clientStatus.get(userId);
            console.log(`Client already exists for user ${userId}, status: ${status}`);

            if (status === 'authenticated' || status === 'ready') {
                return { success: true, status, message: 'Client already connected' };
            }

            // If QR is ready or initializing, don't recreate - just return current state
            if (status === 'qr_ready') {
                const qr = this.qrCodes.get(userId);
                return { success: true, status, message: 'QR code already available', qr };
            }

            if (status === 'initializing') {
                return { success: true, status, message: 'Client is initializing, please wait' };
            }

            // Only destroy and recreate if in bad state (failed, disconnected)
            console.log(`[INIT] Destroying client in bad state: ${status}`);
            await this.destroyClient(userId);
        }

        // Check concurrent client limit (skip check if this user already has a slot)
        const activeCount = this.getActiveClientCount();
        if (activeCount >= this.MAX_CONCURRENT_CLIENTS) {
            console.log(`[INIT] Concurrent client limit reached (${activeCount}/${this.MAX_CONCURRENT_CLIENTS}). User ${userId} queued.`);
            return {
                success: false,
                status: 'queued',
                message: `Server is at capacity (${this.MAX_CONCURRENT_CLIENTS} active sessions). Please try again later.`
            };
        }

        const authPath = path.join(this.dataDir, '.wwebjs_auth');

        // Ensure auth directory exists
        if (!fs.existsSync(authPath)) {
            fs.mkdirSync(authPath, { recursive: true });
        }

        // Clean up lock files
        this._cleanLockFiles(path.join(authPath, `session-user_${userId}`));

        const client = new Client({
            authStrategy: new LocalAuth({
                dataPath: authPath,
                clientId: `user_${userId}`
            }),
            puppeteer: {
                headless: true,
                protocolTimeout: 600000, // 10 minutes timeout for protocol operations
                timeout: 120000, // 2 minutes for navigation timeout
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--single-process',
                    '--disable-gpu',
                    '--disable-extensions',
                    '--disable-background-networking',
                    '--disable-sync',
                    '--disable-translate',
                    '--metrics-recording-only',
                    '--mute-audio',
                    '--safebrowsing-disable-auto-update',
                    '--disable-software-rasterizer',
                    '--disable-component-update',
                    '--disable-default-apps',
                    '--disable-domain-reliability',
                    '--disable-features=TranslateUI,BlinkGenPropertyTrees',
                    '--disable-renderer-backgrounding',
                    '--disable-backgrounding-occluded-windows'
                ],
                executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
            }
        });

        // Set up event handlers
        this._setupEventHandlers(userId, client);

        // Store client
        this.clients.set(userId, client);
        this.clientStatus.set(userId, 'initializing');

        // Initialize with retry logic
        const maxRetries = 2;
        let lastError = null;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                console.log(`[INIT] Attempt ${attempt}/${maxRetries} for user ${userId}`);
                await client.initialize();
                return { success: true, status: 'initializing' };
            } catch (error) {
                lastError = error;
                console.error(`[INIT] Attempt ${attempt} failed for user ${userId}:`, error.message);

                // If it's a timeout error and we have retries left, wait and try again
                if (attempt < maxRetries && error.message.includes('timed out')) {
                    console.log(`[INIT] Waiting 10 seconds before retry...`);
                    await new Promise(resolve => setTimeout(resolve, 10000));

                    // Clean up and recreate client for retry
                    try {
                        await client.destroy();
                    } catch (e) {
                        // Ignore destroy errors
                    }

                    // Clean lock files again
                    this._cleanLockFiles(path.join(authPath, `session-user_${userId}`));
                } else {
                    break;
                }
            }
        }

        console.error(`[INIT] All attempts failed for user ${userId}:`, lastError?.message);

        // Clean up the failed client to free resources
        try {
            const failedClient = this.clients.get(userId);
            if (failedClient) {
                await failedClient.destroy().catch(() => {});
            }
        } catch (e) {
            // Ignore cleanup errors
        }

        // Remove from maps to free up concurrent slot
        this.clients.delete(userId);
        this.clientStatus.set(userId, 'failed');
        this.qrCodes.delete(userId);

        return { success: false, status: 'failed', message: lastError?.message || 'Initialization failed' };
    }

    _setupEventHandlers(userId, client) {
        client.on('qr', (qr) => {
            console.log(`QR received for user ${userId}`);
            this.qrCodes.set(userId, qr);
            this.clientStatus.set(userId, 'qr_ready');

            // Clear any existing QR timeout
            if (this.qrTimeouts.has(userId)) {
                clearTimeout(this.qrTimeouts.get(userId));
            }

            // Set timeout to auto-destroy client if QR not scanned within 5 minutes
            const timeoutId = setTimeout(async () => {
                if (this.clientStatus.get(userId) === 'qr_ready') {
                    console.log(`[CLEANUP] QR timeout for user ${userId} - destroying unused client`);
                    await this.destroyClient(userId);

                    // Notify frontend that session timed out
                    this.redisPublisher.publish('whatsapp:events', {
                        type: 'qr_timeout',
                        userId
                    });
                }
                this.qrTimeouts.delete(userId);
            }, 5 * 60 * 1000); // 5 minutes

            this.qrTimeouts.set(userId, timeoutId);

            this.redisPublisher.publish('whatsapp:events', {
                type: 'qr',
                userId,
                qr
            });
        });

        client.on('authenticated', () => {
            console.log(`User ${userId} authenticated`);
            this.qrCodes.delete(userId);
            this.clientStatus.set(userId, 'authenticated');

            // Clear QR timeout since user authenticated successfully
            if (this.qrTimeouts.has(userId)) {
                clearTimeout(this.qrTimeouts.get(userId));
                this.qrTimeouts.delete(userId);
            }

            this.redisPublisher.publish('whatsapp:events', {
                type: 'authenticated',
                userId
            });
        });

        client.on('ready', async () => {
            console.log(`Client ready for user ${userId}`);
            console.log(`[READY] Client is now ready to receive messages`);
            this.clientStatus.set(userId, 'ready');
            // Get phone number
            const info = client.info;
            const phoneNumber = info?.wid?.user;
            console.log(`[READY] Phone number: ${phoneNumber}`);

            this.redisPublisher.publish('whatsapp:events', {
                type: 'ready',
                userId,
                phoneNumber
            });
        });

        // message_create fires for ALL messages (incoming + outgoing)
        client.on('message_create', async (message) => {
            try {
                // Get the chat ID - for group messages from self, use message.to
                const chatId = message.fromMe ? message.to : message.from;

                // Only process group messages from monitored groups
                if (chatId && chatId.endsWith('@g.us')) {
                    // Skip non-monitored groups immediately (no Puppeteer calls)
                    if (!this._isGroupMonitored(userId, chatId)) return;

                    // Get group name from cache or fetch once (avoid getChat() Puppeteer call)
                    let groupName = 'Unknown Group';
                    const cachedChat = this.chatNameCache?.get(chatId);
                    if (cachedChat && (Date.now() - cachedChat.timestamp) < (this.CHAT_NAME_CACHE_TTL || 30 * 60 * 1000)) {
                        groupName = cachedChat.name;
                    } else {
                        try {
                            const chat = await message.getChat();
                            groupName = chat.name;
                            if (!this.chatNameCache) this.chatNameCache = new Map();
                            this.chatNameCache.set(chatId, { name: groupName, timestamp: Date.now() });
                        } catch (chatErr) {
                            // Use cached name even if expired, or fallback
                            if (cachedChat) groupName = cachedChat.name;
                        }
                    }

                    // Get sender info directly from message data (no getContact() Puppeteer call)
                    const senderId = message.author || message.from;
                    let senderPhone = '';
                    let senderName = 'Unknown';

                    // Extract phone from senderId
                    if (message.fromMe && client.info?.wid?.user) {
                        senderPhone = client.info.wid.user;
                        senderName = 'You';
                    } else if (senderId && senderId.includes('@c.us')) {
                        senderPhone = senderId.split('@')[0];
                    } else if (senderId && senderId.includes('@lid')) {
                        senderPhone = senderId.split('@')[0];
                    }

                    // Use notifyName from message data (no Puppeteer call needed)
                    if (!message.fromMe) {
                        senderName = message._data?.notifyName || senderPhone || 'Unknown';
                    }

                    // Process mentions without getMentions() Puppeteer call
                    let processedContent = message.body || '';
                    const mentionedPhones = [];

                    // Use mentionedIds (already on message object, no Puppeteer call)
                    const mentionedIds = message.mentionedIds || [];
                    if (mentionedIds.length > 0) {
                        for (const mentionId of mentionedIds) {
                            const mentionIdStr = mentionId._serialized || mentionId;
                            const mentionPhone = mentionIdStr.split('@')[0];
                            if (mentionPhone) {
                                mentionedPhones.push(mentionPhone);
                            }

                            // Replace @ID patterns in content with @phone
                            const idWithoutSuffix = mentionIdStr.replace('@c.us', '').replace('@lid', '');
                            if (idWithoutSuffix) {
                                const pattern = new RegExp(`@${idWithoutSuffix}`, 'g');
                                processedContent = processedContent.replace(pattern, `@${mentionPhone}`);
                            }
                        }
                    }

                this.redisPublisher.publish('whatsapp:events', {
                    type: 'message',
                    userId,
                    message: {
                        id: message.id._serialized,
                        groupId: chatId,
                        groupName: groupName,
                        senderId: senderId,
                        senderName: senderName,
                        senderPhone: senderPhone,
                        content: processedContent,
                        mentionedPhones: mentionedPhones,
                        timestamp: message.timestamp,
                        messageType: message.type
                    }
                });

                // Check for voice messages (certificates)
                if (message.type === 'ptt' || message.type === 'audio') {
                    console.log(`Voice message detected from ${senderName} in ${groupName}`);
                    this.redisPublisher.publish('whatsapp:events', {
                        type: 'certificate',
                        userId,
                        event: {
                            groupId: chatId,
                            groupName: groupName,
                            memberId: senderId,
                            memberName: senderName,
                            memberPhone: senderPhone,
                            timestamp: message.timestamp
                        }
                    });
                }
            }
        } catch (error) {
            console.error(`[ERROR] Error processing message for user ${userId}:`, error.message);
        }
        });

        client.on('group_join', async (notification) => {
            try {
                // Skip non-monitored groups
                if (!this._isGroupMonitored(userId, notification.chatId)) return;
                console.log(`Group join event for user ${userId}`);
                const chat = await notification.getChat();

                for (const participant of notification.recipientIds) {
                    let contact = null;
                    try {
                        contact = await client.getContactById(participant);
                    } catch (e) {
                        console.log(`[WARN] Could not get contact for join: ${e.message}`);
                    }

                    // Get phone number - try multiple sources (same logic as messages)
                    let memberPhone = '';
                    if (contact?.number) {
                        memberPhone = contact.number;
                    } else if (contact?.id?.user && !contact.id._serialized.endsWith('@lid')) {
                        memberPhone = contact.id.user;
                    } else if (participant.includes('@c.us')) {
                        memberPhone = participant.split('@')[0];
                    }

                    this.redisPublisher.publish('whatsapp:events', {
                        type: 'member_join',
                        userId,
                        event: {
                            groupId: notification.chatId,
                            groupName: chat.name,
                            memberId: participant,
                            memberName: contact?.pushname || contact?.name || memberPhone || participant.split('@')[0],
                            memberPhone: memberPhone,
                            timestamp: notification.timestamp
                        }
                    });
                }
            } catch (error) {
                console.error(`[ERROR] Error processing group_join for user ${userId}:`, error.message);
            }
        });

        client.on('group_leave', async (notification) => {
            // Skip non-monitored groups
            if (!this._isGroupMonitored(userId, notification.chatId)) return;
            console.log(`Group leave event for user ${userId}`);
            try {
                const chat = await notification.getChat();

                for (const participant of notification.recipientIds) {
                    // Safely get contact - may fail for some participant types
                    let contact = null;
                    try {
                        contact = await client.getContactById(participant);
                    } catch (contactErr) {
                        console.log(`[WARN] Could not get contact for participant ${participant}: ${contactErr.message}`);
                    }

                    // Get phone number - try multiple sources (same logic as messages)
                    let memberPhone = '';
                    if (contact?.number) {
                        memberPhone = contact.number;
                    } else if (contact?.id?.user && !contact.id._serialized.endsWith('@lid')) {
                        memberPhone = contact.id.user;
                    } else if (participant.includes('@c.us')) {
                        memberPhone = participant.split('@')[0];
                    }

                    this.redisPublisher.publish('whatsapp:events', {
                        type: 'member_leave',
                        userId,
                        event: {
                            groupId: notification.chatId,
                            groupName: chat.name,
                            memberId: participant,
                            memberName: contact?.pushname || contact?.name || memberPhone || participant.split('@')[0],
                            memberPhone: memberPhone,
                            timestamp: notification.timestamp
                        }
                    });
                }
            } catch (error) {
                console.error(`[ERROR] Error processing group_leave for user ${userId}:`, error.message);
            }
        });

        client.on('disconnected', (reason) => {
            console.log(`Client disconnected for user ${userId}: ${reason}`);
            this.clientStatus.set(userId, 'disconnected');

            this.redisPublisher.publish('whatsapp:events', {
                type: 'disconnected',
                userId,
                reason
            });
        });

        client.on('auth_failure', (msg) => {
            console.error(`Auth failure for user ${userId}:`, msg);
            this.clientStatus.set(userId, 'failed');

            this.redisPublisher.publish('whatsapp:events', {
                type: 'auth_failure',
                userId,
                message: msg
            });
        });
    }

    getStatus(userId) {
        return {
            status: this.clientStatus.get(userId) || 'not_initialized',
            hasQR: this.qrCodes.has(userId)
        };
    }

    getQRCode(userId) {
        return this.qrCodes.get(userId) || null;
    }

    async getGroups(userId) {
        const client = this.clients.get(userId);
        const status = this.clientStatus.get(userId);

        console.log(`[GROUPS] getGroups called for user ${userId}, client exists: ${!!client}, status: ${status}`);

        if (!client || status !== 'ready') {
            console.log(`[GROUPS] Returning empty - client not ready for user ${userId}`);
            return [];
        }

        // Check cache first
        const cached = this.groupsCache.get(userId);
        if (cached && (Date.now() - cached.timestamp) < this.GROUPS_CACHE_TTL) {
            console.log(`[CACHE] Returning cached groups for user ${userId} (${cached.groups.length} groups)`);
            return cached.groups;
        }

        // Use operation queue to prevent concurrent calls
        return this._queueOperation(userId, async () => {
            // Double-check cache after getting queue lock (another request might have populated it)
            const cachedAfterQueue = this.groupsCache.get(userId);
            if (cachedAfterQueue && (Date.now() - cachedAfterQueue.timestamp) < this.GROUPS_CACHE_TTL) {
                console.log(`[CACHE] Returning cached groups for user ${userId} after queue (${cachedAfterQueue.groups.length} groups)`);
                return cachedAfterQueue.groups;
            }

            try {
                console.log(`[GROUPS] Fetching groups for user ${userId}...`);
                const chats = await client.getChats();
                console.log(`[GROUPS] Got ${chats ? chats.length : 0} total chats for user ${userId}`);
                const groups = [];

                for (const chat of chats) {
                    if (chat.isGroup) {
                        let participantCount = 0;

                        try {
                            if (chat.participants && Array.isArray(chat.participants)) {
                                participantCount = chat.participants.length;
                            }
                            // Skip getChatById to avoid extra timeout-prone operations
                            // The participant count from getChats() should be sufficient
                        } catch (e) {
                            // Silently handle errors
                        }

                        groups.push({
                            id: chat.id._serialized,
                            name: chat.name,
                            participantCount: participantCount
                        });
                    }
                }

                // Cache the results
                this.groupsCache.set(userId, {
                    groups: groups,
                    timestamp: Date.now()
                });

                console.log(`[GROUPS] Fetched and cached ${groups.length} groups for user ${userId}`);
                return groups;
            } catch (error) {
                console.error(`[GROUPS] Error getting groups for user ${userId}:`, error.message);
                console.error(`[GROUPS] Full error:`, error);

                // If frame is detached or timeout, the session may be invalid
                if (error.message && (error.message.includes('detached Frame') || error.message.includes('timed out'))) {
                    console.log(`[WARN] Session for user ${userId} has issues: ${error.message}`);

                    // Return cached data if available (even if expired)
                    const staleCached = this.groupsCache.get(userId);
                    if (staleCached) {
                        console.log(`[CACHE] Returning stale cached groups for user ${userId} due to error`);
                        return staleCached.groups;
                    }

                    // Only mark disconnected for detached Frame, not for timeouts
                    if (error.message.includes('detached Frame')) {
                        this.clientStatus.set(userId, 'disconnected');

                        // Try to reinitialize in background
                        setTimeout(() => {
                            console.log(`[RECONNECT] Attempting to reinitialize client for user ${userId}`);
                            this.initializeClient(userId).catch(err => {
                                console.error(`[RECONNECT] Failed to reinitialize user ${userId}:`, err.message);
                            });
                        }, 5000);
                    }
                }

                return [];
            }
        });
    }

    async getGroupMembers(userId, groupId) {
        const client = this.clients.get(userId);
        if (!client || this.clientStatus.get(userId) !== 'ready') {
            return [];
        }

        // Check members cache first
        const cached = this.membersCache.get(groupId);
        if (cached && (Date.now() - cached.timestamp) < this.MEMBERS_CACHE_TTL) {
            console.log(`[CACHE] Returning cached members for group ${groupId} (${cached.members.length} members)`);
            return cached.members;
        }

        // Use operation queue to prevent concurrent calls
        return this._queueOperation(userId, async () => {
            try {
                const chat = await client.getChatById(groupId);
                if (!chat.isGroup) {
                    return [];
                }

                const members = chat.participants.map(participant => ({
                    id: participant.id._serialized,
                    name: participant.id.user,
                    phone: participant.id.user,
                    isAdmin: participant.isAdmin || participant.isSuperAdmin
                }));

                // Cache the results
                this.membersCache.set(groupId, { members, timestamp: Date.now() });

                return members;
            } catch (error) {
                console.error(`Error getting members for group ${groupId}:`, error.message);

                // Handle detached frame or timeout errors
                if (error.message && (error.message.includes('detached Frame') || error.message.includes('timed out'))) {
                    console.log(`[WARN] Session for user ${userId} has issues: ${error.message}`);

                    if (error.message.includes('detached Frame')) {
                        this.clientStatus.set(userId, 'disconnected');
                    }
                }

                return [];
            }
        });
    }

    async setGroupMessagesAdminOnly(userId, groupId, adminOnly) {
        const client = this.clients.get(userId);
        if (!client || this.clientStatus.get(userId) !== 'ready') {
            throw new Error('Client not ready');
        }

        // Use operation queue to prevent concurrent calls
        return this._queueOperation(userId, async () => {
            try {
                console.log(`[SETTINGS] Setting group ${groupId} admin-only=${adminOnly} for user ${userId}`);

                const chat = await client.getChatById(groupId);

                if (!chat || !chat.isGroup) {
                    throw new Error('Group not found');
                }

                // setMessagesAdminsOnly(true) = only admins can send messages
                // setMessagesAdminsOnly(false) = everyone can send messages
                const success = await chat.setMessagesAdminsOnly(adminOnly);

                return {
                    success: success,
                    groupId: groupId,
                    adminOnly: adminOnly
                };
            } catch (error) {
                console.error(`Error setting group ${groupId} admin-only for user ${userId}:`, error.message);

                // Handle detached frame or timeout errors
                if (error.message && (error.message.includes('detached Frame') || error.message.includes('timed out'))) {
                    console.log(`[WARN] Session for user ${userId} has issues: ${error.message}`);

                    // Only mark disconnected for detached Frame, not for timeouts
                    if (error.message.includes('detached Frame')) {
                        this.clientStatus.set(userId, 'disconnected');
                    }
                }

                throw error;
            }
        });
    }

    async sendMessage(userId, groupId, content, options = {}) {
        const client = this.clients.get(userId);
        if (!client || this.clientStatus.get(userId) !== 'ready') {
            throw new Error('Client not ready');
        }

        // Use operation queue to prevent concurrent calls
        return this._queueOperation(userId, async () => {
            try {
                // Build mentions array if provided
                let mentions = [];

                if (options.mentionAll || options.mentionIds?.length > 0) {
                    const chat = await client.getChatById(groupId);
                    if (!chat) {
                        throw new Error('Group not found');
                    }

                    if (options.mentionAll) {
                        // Get all participants and add them as mentions
                        if (chat.participants && Array.isArray(chat.participants)) {
                            mentions = chat.participants.map(p => p.id._serialized);
                        }
                    } else if (options.mentionIds && options.mentionIds.length > 0) {
                        // Convert phone numbers to WhatsApp IDs
                        mentions = options.mentionIds.map(phone => {
                            if (phone.includes('@')) {
                                return phone;
                            }
                            return `${phone}@c.us`;
                        });
                    }
                }

                // Use client.sendMessage directly with sendSeen: false to bypass markedUnread error
                const sendOptions = {
                    sendSeen: false,  // Skip sendSeen to avoid markedUnread error
                    ...(mentions.length > 0 ? { mentions } : {})
                };

                console.log(`[SEND] Sending message to ${groupId} for user ${userId} with ${mentions.length} mentions`);

                const result = await client.sendMessage(groupId, content, sendOptions);

                return {
                    success: true,
                    messageId: result.id._serialized,
                    timestamp: result.timestamp,
                    groupId: groupId
                };
            } catch (error) {
                console.error(`Error sending message to group ${groupId} for user ${userId}:`, error.message);

                // Handle detached frame or timeout errors
                if (error.message && (error.message.includes('detached Frame') || error.message.includes('timed out'))) {
                    if (error.message.includes('detached Frame')) {
                        this.clientStatus.set(userId, 'disconnected');
                    }
                }

                throw error;
            }
        });
    }

    async sendMediaMessage(userId, groupId, mediaPath, caption = '', options = {}) {
        const client = this.clients.get(userId);
        if (!client || this.clientStatus.get(userId) !== 'ready') {
            throw new Error('Client not ready');
        }

        // Check if file exists before queuing
        if (!fs.existsSync(mediaPath)) {
            throw new Error('Media file not found');
        }

        // Use operation queue to prevent concurrent calls
        return this._queueOperation(userId, async () => {
            try {
                // Create MessageMedia from file
                const media = MessageMedia.fromFilePath(mediaPath);

                // Build mentions array if provided
                let mentions = [];

                if (options.mentionAll || options.mentionIds?.length > 0) {
                    const chat = await client.getChatById(groupId);
                    if (chat) {
                        if (options.mentionAll) {
                            if (chat.participants && Array.isArray(chat.participants)) {
                                mentions = chat.participants.map(p => p.id._serialized);
                            }
                        } else if (options.mentionIds && options.mentionIds.length > 0) {
                            mentions = options.mentionIds.map(phone => {
                                if (phone.includes('@')) {
                                    return phone;
                                }
                                return `${phone}@c.us`;
                            });
                        }
                    }
                }

                // Use client.sendMessage directly with sendSeen: false to bypass markedUnread error
                const sendOptions = {
                    sendSeen: false,  // Skip sendSeen to avoid markedUnread error
                    caption: caption || undefined,
                    ...(mentions.length > 0 ? { mentions } : {})
                };

                console.log(`[SEND] Sending media to ${groupId} for user ${userId}`);

                const result = await client.sendMessage(groupId, media, sendOptions);

                // NOTE: Don't delete file here - for scheduled broadcasts, the same file
                // is sent to multiple groups. The scheduler handles cleanup after all groups.
                // See message_scheduler.py:170 which calls whatsapp_bridge.delete_media()

                return {
                    success: true,
                    messageId: result.id._serialized,
                    timestamp: result.timestamp,
                    groupId: groupId
                };
            } catch (error) {
                console.error(`Error sending media to group ${groupId} for user ${userId}:`, error.message);

                // Clean up uploaded file on error
                try {
                    if (fs.existsSync(mediaPath)) {
                        fs.unlinkSync(mediaPath);
                    }
                } catch (e) {
                    // Ignore cleanup errors
                }

                if (error.message && (error.message.includes('detached Frame') || error.message.includes('timed out'))) {
                    if (error.message.includes('detached Frame')) {
                        this.clientStatus.set(userId, 'disconnected');
                    }
                }

                throw error;
            }
        });
    }

    async sendWelcomeMessage(userId, groupId, content, joinerPhones = [], extraMentionPhones = []) {
        const client = this.clients.get(userId);
        if (!client || this.clientStatus.get(userId) !== 'ready') {
            throw new Error('Client not ready');
        }

        // Use operation queue to prevent concurrent calls
        return this._queueOperation(userId, async () => {
            try {
                // Build mentions array and contact list for clickable mentions
                const mentions = [];
                const joinerMentionNames = [];
                const extraMentionNames = [];

                // Process joiner phones (will appear at the start)
                // Note: Using ID strings instead of Contact objects (Contact array is deprecated)
                for (const phone of joinerPhones) {
                    if (!phone) continue;

                    // Clean phone number (remove any non-digit characters)
                    const cleanPhone = phone.replace(/[^\d]/g, '');
                    const contactId = `${cleanPhone}@c.us`;

                    // Always use contactId string (not Contact object) to avoid deprecation warning
                    mentions.push(contactId);
                    joinerMentionNames.push(`@${cleanPhone}`);
                }

                // Process extra mention phones (will appear at the end after text)
                for (const phone of extraMentionPhones) {
                    if (!phone) continue;

                    const cleanPhone = phone.replace(/[^\d]/g, '');
                    const contactId = `${cleanPhone}@c.us`;

                    // Always use contactId string (not Contact object) to avoid deprecation warning
                    mentions.push(contactId);
                    extraMentionNames.push(`@${cleanPhone}`);
                }

                // Build the message: @joiners + text + @extraMentions
                let messageContent = '';

                // Add joiner mentions at the start
                if (joinerMentionNames.length > 0) {
                    messageContent = joinerMentionNames.join(' ') + '\n\n';
                }

                // Add welcome text
                messageContent += content;

                // Add extra mentions at the end
                if (extraMentionNames.length > 0) {
                    messageContent += '\n\n' + extraMentionNames.join(' ');
                }

                // Use client.sendMessage directly with sendSeen: false to bypass markedUnread error
                const sendOptions = {
                    sendSeen: false,  // Skip sendSeen to avoid markedUnread error
                    ...(mentions.length > 0 ? { mentions } : {})
                };

                console.log(`[WELCOME] Sending welcome message to ${groupId} for user ${userId} with ${joinerMentionNames.length} joiner mentions and ${extraMentionNames.length} extra mentions`);

                const result = await client.sendMessage(groupId, messageContent, sendOptions);

                return {
                    success: true,
                    messageId: result.id._serialized,
                    timestamp: result.timestamp,
                    groupId: groupId,
                    joinerMentionsCount: joinerMentionNames.length,
                    extraMentionsCount: extraMentionNames.length
                };
            } catch (error) {
                console.error(`Error sending welcome message to group ${groupId} for user ${userId}:`, error.message);

                // Handle detached frame or timeout errors
                if (error.message && (error.message.includes('detached Frame') || error.message.includes('timed out'))) {
                    if (error.message.includes('detached Frame')) {
                        this.clientStatus.set(userId, 'disconnected');
                    }
                }

                throw error;
            }
        });
    }

    async sendPoll(userId, groupId, question, pollOptions, allowMultipleAnswers = false, mentionOptions = {}) {
        const client = this.clients.get(userId);
        if (!client || this.clientStatus.get(userId) !== 'ready') {
            throw new Error('Client not ready');
        }

        // Validate poll options (WhatsApp requires 2-12 options)
        if (!pollOptions || pollOptions.length < 2) {
            throw new Error('Poll must have at least 2 options');
        }
        if (pollOptions.length > 12) {
            throw new Error('Poll cannot have more than 12 options');
        }

        // Use operation queue to prevent concurrent calls
        return this._queueOperation(userId, async () => {
            try {
                // Build mentions array if provided
                let mentions = [];

                if (mentionOptions.mentionAll || mentionOptions.mentionIds?.length > 0) {
                    const chat = await client.getChatById(groupId);
                    if (chat) {
                        if (mentionOptions.mentionAll) {
                            if (chat.participants && Array.isArray(chat.participants)) {
                                mentions = chat.participants.map(p => p.id._serialized);
                            }
                        } else if (mentionOptions.mentionIds && mentionOptions.mentionIds.length > 0) {
                            mentions = mentionOptions.mentionIds.map(phone => {
                                if (phone.includes('@')) {
                                    return phone;
                                }
                                return `${phone}@c.us`;
                            });
                        }
                    }
                }

                // Create the poll
                const poll = new Poll(question, pollOptions, {
                    allowMultipleAnswers: allowMultipleAnswers
                });

                // Use client.sendMessage directly with sendSeen: false to bypass markedUnread error
                const sendOptions = {
                    sendSeen: false,  // Skip sendSeen to avoid markedUnread error
                    ...(mentions.length > 0 ? { mentions } : {})
                };

                console.log(`[POLL] Sending poll to ${groupId} for user ${userId}: "${question}" with ${pollOptions.length} options, ${mentions.length} mentions`);

                const result = await client.sendMessage(groupId, poll, sendOptions);

                return {
                    success: true,
                    messageId: result.id._serialized,
                    timestamp: result.timestamp,
                    groupId: groupId,
                    question: question,
                    optionsCount: pollOptions.length
                };
            } catch (error) {
                console.error(`Error sending poll to group ${groupId} for user ${userId}:`, error.message);

                if (error.message && (error.message.includes('detached Frame') || error.message.includes('timed out'))) {
                    if (error.message.includes('detached Frame')) {
                        this.clientStatus.set(userId, 'disconnected');
                    }
                }

                throw error;
            }
        });
    }

    // ==================== SCHEDULED EVENT METHODS ====================

    async sendEvent(userId, groupId, name, startTime, options = {}, mentionOptions = {}) {
        const client = this.clients.get(userId);
        if (!client || this.clientStatus.get(userId) !== 'ready') {
            throw new Error('Client not ready');
        }

        if (!name) {
            throw new Error('Event name is required');
        }

        if (!startTime) {
            throw new Error('Event start time is required');
        }

        // Use operation queue to prevent concurrent calls
        return this._queueOperation(userId, async () => {
            try {
                // Build mentions array if provided
                let mentions = [];

                if (mentionOptions.mentionAll || mentionOptions.mentionIds?.length > 0) {
                    const chat = await client.getChatById(groupId);
                    if (chat) {
                        if (mentionOptions.mentionAll) {
                            if (chat.participants && Array.isArray(chat.participants)) {
                                mentions = chat.participants.map(p => p.id._serialized);
                            }
                        } else if (mentionOptions.mentionIds && mentionOptions.mentionIds.length > 0) {
                            mentions = mentionOptions.mentionIds.map(phone => {
                                if (phone.includes('@')) {
                                    return phone;
                                }
                                return `${phone}@c.us`;
                            });
                        }
                    }
                }

                // Build event options
                const eventOptions = {};
                if (options.description) eventOptions.description = options.description;
                if (options.location) eventOptions.location = options.location;
                eventOptions.callType = options.callType || 'none';
                if (options.endTime) eventOptions.endTime = new Date(options.endTime);

                // Create the ScheduledEvent
                const event = new ScheduledEvent(name, new Date(startTime), eventOptions);

                // Send with options
                const sendOptions = {
                    sendSeen: false,
                    ...(mentions.length > 0 ? { mentions } : {})
                };

                console.log(`[EVENT] Sending event "${name}" to ${groupId} for user ${userId}`);

                const result = await client.sendMessage(groupId, event, sendOptions);

                return {
                    success: true,
                    messageId: result.id._serialized,
                    timestamp: result.timestamp,
                    groupId: groupId,
                    eventName: name
                };
            } catch (error) {
                console.error(`Error sending event to group ${groupId} for user ${userId}:`, error.message);

                if (error.message && (error.message.includes('detached Frame') || error.message.includes('timed out'))) {
                    if (error.message.includes('detached Frame')) {
                        this.clientStatus.set(userId, 'disconnected');
                    }
                }

                throw error;
            }
        });
    }

    // ==================== CHANNEL METHODS ====================

    async getChannels(userId) {
        const client = this.clients.get(userId);
        const status = this.clientStatus.get(userId);

        console.log(`[CHANNELS] getChannels called for user ${userId}, client exists: ${!!client}, status: ${status}`);

        if (!client || status !== 'ready') {
            console.log(`[CHANNELS] Returning empty - client not ready for user ${userId}`);
            return [];
        }

        // Use operation queue to prevent concurrent calls
        return this._queueOperation(userId, async () => {
            try {
                console.log(`[CHANNELS] Fetching channels for user ${userId}...`);
                const channels = await client.getChannels();
                console.log(`[CHANNELS] Got ${channels ? channels.length : 0} channels for user ${userId}`);

                // Filter out undefined/invalid channels and safely map properties
                const validChannels = (channels || [])
                    .filter(channel => channel && channel.id)
                    .map(channel => {
                        console.log(`[CHANNELS] Processing channel:`, channel.name, channel.id?._serialized);
                        return {
                            id: channel.id?._serialized || String(channel.id),
                            name: channel.name || 'Unknown Channel',
                            description: channel.description || ''
                        };
                    });

                console.log(`[CHANNELS] Returning ${validChannels.length} valid channels for user ${userId}`);
                return validChannels;
            } catch (error) {
                console.error(`[CHANNELS] Error getting channels for user ${userId}:`, error.message);

                if (error.message && (error.message.includes('detached Frame') || error.message.includes('timed out'))) {
                    if (error.message.includes('detached Frame')) {
                        this.clientStatus.set(userId, 'disconnected');
                    }
                }

                return [];
            }
        });
    }

    async sendChannelMessage(userId, channelId, content) {
        const client = this.clients.get(userId);
        if (!client || this.clientStatus.get(userId) !== 'ready') {
            throw new Error('Client not ready');
        }

        // Use operation queue to prevent concurrent calls
        return this._queueOperation(userId, async () => {
            try {
                console.log(`[CHANNEL] Sending message to channel ${channelId} for user ${userId}`);

                const channel = await client.getChatById(channelId);
                if (!channel) {
                    throw new Error('Channel not found');
                }

                const result = await channel.sendMessage(content);

                return {
                    success: true,
                    messageId: result.id._serialized,
                    timestamp: result.timestamp,
                    channelId: channelId
                };
            } catch (error) {
                console.error(`Error sending message to channel ${channelId} for user ${userId}:`, error.message);

                if (error.message && (error.message.includes('detached Frame') || error.message.includes('timed out'))) {
                    if (error.message.includes('detached Frame')) {
                        this.clientStatus.set(userId, 'disconnected');
                    }
                }

                throw error;
            }
        });
    }

    async sendChannelMediaMessage(userId, channelId, mediaPath, caption = '') {
        const client = this.clients.get(userId);
        if (!client || this.clientStatus.get(userId) !== 'ready') {
            throw new Error('Client not ready');
        }

        // Check if file exists before queuing
        if (!fs.existsSync(mediaPath)) {
            throw new Error('Media file not found');
        }

        // Use operation queue to prevent concurrent calls
        return this._queueOperation(userId, async () => {
            try {
                console.log(`[CHANNEL] Sending media to channel ${channelId} for user ${userId}`);

                // Create MessageMedia from file
                const media = MessageMedia.fromFilePath(mediaPath);

                const channel = await client.getChatById(channelId);
                if (!channel) {
                    throw new Error('Channel not found');
                }

                const sendOptions = {
                    caption: caption || undefined
                };

                const result = await channel.sendMessage(media, sendOptions);

                // Clean up uploaded file after sending
                try {
                    fs.unlinkSync(mediaPath);
                } catch (e) {
                    console.log(`[WARN] Could not delete temp file: ${e.message}`);
                }

                return {
                    success: true,
                    messageId: result.id._serialized,
                    timestamp: result.timestamp,
                    channelId: channelId
                };
            } catch (error) {
                console.error(`Error sending media to channel ${channelId} for user ${userId}:`, error.message);

                // Clean up uploaded file on error
                try {
                    if (fs.existsSync(mediaPath)) {
                        fs.unlinkSync(mediaPath);
                    }
                } catch (e) {
                    // Ignore cleanup errors
                }

                if (error.message && (error.message.includes('detached Frame') || error.message.includes('timed out'))) {
                    if (error.message.includes('detached Frame')) {
                        this.clientStatus.set(userId, 'disconnected');
                    }
                }

                throw error;
            }
        });
    }

    async sendChannelPoll(userId, channelId, question, pollOptions, allowMultipleAnswers = false) {
        const client = this.clients.get(userId);
        if (!client || this.clientStatus.get(userId) !== 'ready') {
            throw new Error('Client not ready');
        }

        // Validate poll options (WhatsApp requires 2-12 options)
        if (!pollOptions || pollOptions.length < 2) {
            throw new Error('Poll must have at least 2 options');
        }
        if (pollOptions.length > 12) {
            throw new Error('Poll cannot have more than 12 options');
        }

        // Use operation queue to prevent concurrent calls
        return this._queueOperation(userId, async () => {
            try {
                console.log(`[CHANNEL POLL] Sending poll to channel ${channelId} for user ${userId}: "${question}" with ${pollOptions.length} options`);

                // Create Poll object
                const poll = new Poll(question, pollOptions, {
                    allowMultipleAnswers: allowMultipleAnswers
                });

                // Send poll to channel
                const result = await client.sendMessage(channelId, poll, {
                    sendSeen: false
                });

                return {
                    success: true,
                    messageId: result.id._serialized,
                    timestamp: result.timestamp,
                    channelId: channelId,
                    question: question,
                    optionsCount: pollOptions.length
                };
            } catch (error) {
                console.error(`Error sending poll to channel ${channelId} for user ${userId}:`, error.message);

                if (error.message && (error.message.includes('detached Frame') || error.message.includes('timed out'))) {
                    if (error.message.includes('detached Frame')) {
                        this.clientStatus.set(userId, 'disconnected');
                    }
                }

                throw error;
            }
        });
    }

    async destroyClient(userId) {
        const client = this.clients.get(userId);
        if (client) {
            try {
                await client.destroy();
                console.log(`Client destroyed for user ${userId}`);
            } catch (error) {
                console.error(`Error destroying client for user ${userId}:`, error);
            }
            this.clients.delete(userId);
            this.clientStatus.delete(userId);
            this.qrCodes.delete(userId);
            this.groupsCache.delete(userId);
            this.operationQueues.delete(userId);
            // Don't delete monitoredGroups — preserved for restart/reconnect

            // Clear QR timeout if exists
            if (this.qrTimeouts.has(userId)) {
                clearTimeout(this.qrTimeouts.get(userId));
                this.qrTimeouts.delete(userId);
            }
        }
    }

    /**
     * Delete user session files from disk (for when user is deleted from database)
     */
    async deleteUserSession(userId) {
        // First destroy the client if running
        await this.destroyClient(userId);

        const sessionPath = path.join(this.dataDir, '.wwebjs_auth', `session-user_${userId}`);

        if (fs.existsSync(sessionPath)) {
            try {
                fs.rmSync(sessionPath, { recursive: true, force: true });
                console.log(`[CLEANUP] Deleted session files for user ${userId}`);
                return { success: true, message: `Session files deleted for user ${userId}` };
            } catch (error) {
                console.error(`[CLEANUP] Error deleting session files for user ${userId}:`, error);
                return { success: false, error: error.message };
            }
        } else {
            console.log(`[CLEANUP] No session files found for user ${userId}`);
            return { success: true, message: 'No session files found' };
        }
    }

    async destroyAll() {
        console.log('Destroying all clients...');
        for (const userId of this.clients.keys()) {
            await this.destroyClient(userId);
        }
    }

    // Auto-restore previously authenticated sessions on startup
    // Only restores up to MAX_CONCURRENT_CLIENTS to avoid resource exhaustion
    async restoreSessions() {
        const authPath = path.join(this.dataDir, '.wwebjs_auth');

        if (!fs.existsSync(authPath)) {
            console.log('[RESTORE] No auth directory found, skipping session restore');
            return;
        }

        try {
            const sessions = fs.readdirSync(authPath);
            const userSessions = sessions.filter(dir => dir.startsWith('session-user_'));

            console.log(`[RESTORE] Found ${userSessions.length} saved session folders`);

            // Filter to only sessions that are actually authenticated
            const authenticatedSessions = userSessions.filter(sessionDir => {
                return this._isSessionAuthenticated(path.join(authPath, sessionDir));
            });

            console.log(`[RESTORE] ${authenticatedSessions.length} sessions have valid authentication data`);
            console.log(`[RESTORE] Will restore up to ${this.MAX_CONCURRENT_CLIENTS} sessions (limit)`);

            let restoredCount = 0;
            let failedCount = 0;

            for (let i = 0; i < authenticatedSessions.length; i++) {
                // Stop if we've reached the concurrent limit
                if (restoredCount >= this.MAX_CONCURRENT_CLIENTS) {
                    console.log(`[RESTORE] Reached concurrent limit (${this.MAX_CONCURRENT_CLIENTS}). Remaining ${authenticatedSessions.length - i} sessions will be restored on-demand.`);
                    break;
                }

                const sessionDir = authenticatedSessions[i];
                // Extract user ID from directory name (session-user_X)
                const match = sessionDir.match(/session-user_(\d+)/);
                if (match) {
                    const userId = parseInt(match[1], 10);
                    console.log(`[RESTORE] Restoring session ${i + 1}/${Math.min(authenticatedSessions.length, this.MAX_CONCURRENT_CLIENTS)} for user ${userId}...`);

                    try {
                        const result = await this.initializeClient(userId);
                        if (result.success) {
                            restoredCount++;
                            console.log(`[RESTORE] Session initiated for user ${userId}`);

                            // Wait for client to be ready (with timeout)
                            const readyTimeout = 90000; // 90 seconds max wait
                            const startTime = Date.now();
                            while (Date.now() - startTime < readyTimeout) {
                                const status = this.clientStatus.get(userId);
                                if (status === 'ready') {
                                    console.log(`[RESTORE] User ${userId} is ready`);
                                    break;
                                }
                                if (status === 'failed' || status === 'disconnected') {
                                    console.log(`[RESTORE] User ${userId} failed to connect: ${status}`);
                                    failedCount++;
                                    restoredCount--; // Free up the slot
                                    break;
                                }
                                await new Promise(resolve => setTimeout(resolve, 5000)); // Check every 5 seconds
                            }
                        } else {
                            console.log(`[RESTORE] Could not restore user ${userId}: ${result.message}`);
                        }
                    } catch (error) {
                        console.error(`[RESTORE] Failed to restore session for user ${userId}:`, error.message);
                        failedCount++;
                    }

                    // Wait 60 seconds between session restorations to let system stabilize
                    if (i < authenticatedSessions.length - 1 && restoredCount < this.MAX_CONCURRENT_CLIENTS) {
                        console.log('[RESTORE] Waiting 60 seconds before next session...');
                        await new Promise(resolve => setTimeout(resolve, 60000));
                    }
                }
            }

            console.log(`[RESTORE] Complete. Restored: ${restoredCount}, Failed: ${failedCount}, Pending: ${authenticatedSessions.length - restoredCount - failedCount}`);
        } catch (error) {
            console.error('[RESTORE] Error restoring sessions:', error);
        }
    }

    _isSessionAuthenticated(sessionPath) {
        /**
         * Check if a session folder contains valid authentication data.
         * A properly authenticated session will have:
         * - A "Default" folder (Chrome profile)
         * - Local Storage or IndexedDB data with WhatsApp auth info
         */
        try {
            // Check if Default folder exists (Chrome profile data)
            const defaultPath = path.join(sessionPath, 'Default');
            if (!fs.existsSync(defaultPath)) {
                return false;
            }

            // Check for Local Storage folder (contains auth tokens)
            const localStoragePath = path.join(defaultPath, 'Local Storage');
            const indexedDBPath = path.join(defaultPath, 'IndexedDB');

            // Session is authenticated if it has Local Storage or IndexedDB
            const hasLocalStorage = fs.existsSync(localStoragePath) &&
                fs.readdirSync(localStoragePath).length > 0;
            const hasIndexedDB = fs.existsSync(indexedDBPath) &&
                fs.readdirSync(indexedDBPath).length > 0;

            if (hasLocalStorage || hasIndexedDB) {
                return true;
            }

            return false;
        } catch (error) {
            console.log(`[RESTORE] Error checking session ${sessionPath}:`, error.message);
            return false;
        }
    }

    _cleanLockFiles(dir) {
        if (!fs.existsSync(dir)) {
            return;
        }

        try {
            const files = fs.readdirSync(dir);
            for (const file of files) {
                if (file.startsWith('Singleton')) {
                    const filePath = path.join(dir, file);
                    fs.unlinkSync(filePath);
                    console.log(`Removed lock file: ${filePath}`);
                }
            }

            // Recursively check subdirectories
            for (const file of files) {
                const filePath = path.join(dir, file);
                try {
                    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
                        this._cleanLockFiles(filePath);
                    }
                } catch (e) {
                    // File may have been deleted, skip
                }
            }
        } catch (error) {
            // Only log if it's not a "file not found" error
            if (error.code !== 'ENOENT') {
                console.error('Error cleaning lock files:', error);
            }
        }
    }
}

module.exports = ClientManager;
