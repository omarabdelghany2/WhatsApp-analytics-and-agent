const { Client, LocalAuth, MessageMedia, Poll } = require('whatsapp-web.js');
const path = require('path');
const fs = require('fs');
const mime = require('mime-types');

class ClientManager {
    constructor(redisPublisher, dataDir) {
        this.clients = new Map();       // userId -> Client
        this.clientStatus = new Map();  // userId -> status
        this.qrCodes = new Map();       // userId -> qrCode
        this.redisPublisher = redisPublisher;
        this.dataDir = dataDir;

        // Ensure data directory exists
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
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

            // Destroy and recreate if in bad state
            await this.destroyClient(userId);
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
                    '--disable-gpu',
                    '--disable-extensions',
                    '--disable-background-networking',
                    '--disable-sync',
                    '--disable-translate',
                    '--metrics-recording-only',
                    '--mute-audio',
                    '--safebrowsing-disable-auto-update'
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
        this.clientStatus.set(userId, 'failed');
        return { success: false, status: 'failed', message: lastError?.message || 'Initialization failed' };
    }

    _setupEventHandlers(userId, client) {
        client.on('qr', (qr) => {
            console.log(`QR received for user ${userId}`);
            this.qrCodes.set(userId, qr);
            this.clientStatus.set(userId, 'qr_ready');

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

                // Only process group messages
                if (chatId && chatId.endsWith('@g.us')) {
                    const chat = await message.getChat();

                    // Get contact safely
                    let contact = null;
                    try {
                        contact = await message.getContact();
                    } catch (contactErr) {
                        console.log(`[WARN] Could not get contact for message: ${contactErr.message}`);
                    }

                    // Get sender phone number - try multiple sources
                    const senderId = message.author || message.from;
                let senderPhone = '';

                // Try to get phone from contact.number first
                if (contact?.number) {
                    senderPhone = contact.number;
                }
                // Try contact.id.user if it's a phone number format (not LID)
                else if (contact?.id?.user && !contact.id._serialized.endsWith('@lid')) {
                    senderPhone = contact.id.user;
                }
                // For own messages, try client.info
                else if (message.fromMe && client.info?.wid?.user) {
                    senderPhone = client.info.wid.user;
                }
                // Fallback: try to extract from @c.us format
                else if (senderId && senderId.includes('@c.us')) {
                    senderPhone = senderId.split('@')[0];
                }

                const senderName = message.fromMe ? 'You' : (contact?.pushname || contact?.name || 'Unknown');

                // Process message content - replace mention IDs with names
                let processedContent = message.body || '';
                const mentionedPhones = []; // Collect phone numbers of mentioned contacts

                try {
                    // Get all mentions in the message
                    const mentions = await message.getMentions();

                    if (mentions && mentions.length > 0) {
                        for (const mentionedContact of mentions) {
                            // Get the name to display
                            const mentionName = mentionedContact.pushname ||
                                               mentionedContact.name ||
                                               mentionedContact.number ||
                                               (mentionedContact.id?.user && !mentionedContact.id._serialized.endsWith('@lid')
                                                   ? mentionedContact.id.user
                                                   : 'Unknown');

                            // Get phone number for the mention
                            let mentionPhone = '';
                            if (mentionedContact.number) {
                                mentionPhone = mentionedContact.number;
                            } else if (mentionedContact.id?.user && !mentionedContact.id._serialized.endsWith('@lid')) {
                                mentionPhone = mentionedContact.id.user;
                            }

                            // Add to mentionedPhones list for agent detection
                            if (mentionPhone) {
                                mentionedPhones.push(mentionPhone);
                            }

                            // Replace the @ID pattern with @Name (phone)
                            // WhatsApp uses format @LIDNUMBER or @PHONENUMBER in raw body
                            const lidId = mentionedContact.id?._serialized?.replace('@c.us', '').replace('@lid', '');
                            const userId = mentionedContact.id?.user;

                            // Try to replace various ID formats
                            if (lidId) {
                                const pattern = new RegExp(`@${lidId}`, 'g');
                                const replacement = mentionPhone
                                    ? `@${mentionName} (${mentionPhone})`
                                    : `@${mentionName}`;
                                processedContent = processedContent.replace(pattern, replacement);
                            }
                            if (userId && userId !== lidId) {
                                const pattern = new RegExp(`@${userId}`, 'g');
                                const replacement = mentionPhone
                                    ? `@${mentionName} (${mentionPhone})`
                                    : `@${mentionName}`;
                                processedContent = processedContent.replace(pattern, replacement);
                            }
                        }
                    }
                } catch (err) {
                    console.error(`Error processing mentions:`, err.message);
                    // Keep original content if mention processing fails
                }

                this.redisPublisher.publish('whatsapp:events', {
                    type: 'message',
                    userId,
                    message: {
                        id: message.id._serialized,
                        groupId: chatId,
                        groupName: chat.name,
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
                    console.log(`🎤 Voice message detected from ${senderName} in ${chat.name}`);
                    this.redisPublisher.publish('whatsapp:events', {
                        type: 'certificate',
                        userId,
                        event: {
                            groupId: chatId,
                            groupName: chat.name,
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
        if (!client || this.clientStatus.get(userId) !== 'ready') {
            return [];
        }

        try {
            const chats = await client.getChats();
            const groups = [];

            for (const chat of chats) {
                if (chat.isGroup) {
                    let participantCount = 0;

                    try {
                        if (chat.participants && Array.isArray(chat.participants)) {
                            participantCount = chat.participants.length;
                        } else {
                            const groupChat = await client.getChatById(chat.id._serialized);
                            if (groupChat.participants && Array.isArray(groupChat.participants)) {
                                participantCount = groupChat.participants.length;
                            }
                        }
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

            return groups;
        } catch (error) {
            console.error(`Error getting groups for user ${userId}:`, error);

            // If frame is detached, the session is invalid - mark for reconnection
            if (error.message && error.message.includes('detached Frame')) {
                console.log(`[WARN] Session for user ${userId} has invalid frame, marking for reconnection`);
                this.clientStatus.set(userId, 'disconnected');

                // Try to reinitialize in background
                setTimeout(() => {
                    console.log(`[RECONNECT] Attempting to reinitialize client for user ${userId}`);
                    this.initializeClient(userId).catch(err => {
                        console.error(`[RECONNECT] Failed to reinitialize user ${userId}:`, err.message);
                    });
                }, 5000);
            }

            return [];
        }
    }

    async getGroupMembers(userId, groupId) {
        const client = this.clients.get(userId);
        if (!client || this.clientStatus.get(userId) !== 'ready') {
            return [];
        }

        try {
            const chat = await client.getChatById(groupId);
            if (!chat.isGroup) {
                return [];
            }

            const members = [];
            for (const participant of chat.participants) {
                // Safely get contact - may fail for some participant types
                let contact = null;
                try {
                    contact = await client.getContactById(participant.id._serialized);
                } catch (contactErr) {
                    console.log(`[WARN] Could not get contact for participant ${participant.id._serialized}: ${contactErr.message}`);
                }

                members.push({
                    id: participant.id._serialized,
                    name: contact?.pushname || contact?.name || participant.id.user,
                    phone: participant.id.user,
                    isAdmin: participant.isAdmin || participant.isSuperAdmin
                });
            }

            return members;
        } catch (error) {
            console.error(`Error getting members for group ${groupId}:`, error);

            // Handle detached frame error
            if (error.message && error.message.includes('detached Frame')) {
                console.log(`[WARN] Session for user ${userId} has invalid frame`);
                this.clientStatus.set(userId, 'disconnected');
            }

            return [];
        }
    }

    async setGroupMessagesAdminOnly(userId, groupId, adminOnly) {
        const client = this.clients.get(userId);
        if (!client || this.clientStatus.get(userId) !== 'ready') {
            throw new Error('Client not ready');
        }

        try {
            const chat = await client.getChatById(groupId);

            if (!chat || !chat.isGroup) {
                throw new Error('Group not found');
            }

            console.log(`[SETTINGS] Setting group ${groupId} admin-only=${adminOnly} for user ${userId}`);

            // setMessagesAdminsOnly(true) = only admins can send messages
            // setMessagesAdminsOnly(false) = everyone can send messages
            const success = await chat.setMessagesAdminsOnly(adminOnly);

            return {
                success: success,
                groupId: groupId,
                adminOnly: adminOnly
            };
        } catch (error) {
            console.error(`Error setting group ${groupId} admin-only for user ${userId}:`, error);

            // Handle detached frame error
            if (error.message && error.message.includes('detached Frame')) {
                console.log(`[WARN] Session for user ${userId} has invalid frame`);
                this.clientStatus.set(userId, 'disconnected');
            }

            throw error;
        }
    }

    async sendMessage(userId, groupId, content, options = {}) {
        const client = this.clients.get(userId);
        if (!client || this.clientStatus.get(userId) !== 'ready') {
            throw new Error('Client not ready');
        }

        // Retry logic for known whatsapp-web.js timing issues
        const maxRetries = 3;
        let lastError;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const chat = await client.getChatById(groupId);

                if (!chat) {
                    throw new Error('Group not found');
                }

                // Small delay to let chat object fully hydrate (fixes markedUnread error)
                if (attempt > 1) {
                    await new Promise(r => setTimeout(r, 2000));
                }

                // Build mentions array if provided
                let mentions = [];

                if (options.mentionAll) {
                    // Get all participants and add them as mentions
                    if (chat.participants && Array.isArray(chat.participants)) {
                        mentions = chat.participants.map(p => p.id._serialized);
                    }
                } else if (options.mentionIds && options.mentionIds.length > 0) {
                    // Convert phone numbers to WhatsApp IDs
                    mentions = options.mentionIds.map(phone => {
                        // Handle if already has @c.us suffix
                        if (phone.includes('@')) {
                            return phone;
                        }
                        return `${phone}@c.us`;
                    });
                }

                const sendOptions = mentions.length > 0 ? { mentions } : {};

                console.log(`[SEND] Sending message to ${groupId} for user ${userId} with ${mentions.length} mentions (attempt ${attempt})`);

                const result = await chat.sendMessage(content, sendOptions);

                return {
                    success: true,
                    messageId: result.id._serialized,
                    timestamp: result.timestamp,
                    groupId: groupId
                };
            } catch (error) {
                lastError = error;
                console.error(`Error sending message to group ${groupId} for user ${userId} (attempt ${attempt}):`, error.message);

                // Handle detached frame error - don't retry
                if (error.message && error.message.includes('detached Frame')) {
                    console.log(`[WARN] Session for user ${userId} has invalid frame`);
                    this.clientStatus.set(userId, 'disconnected');
                    throw error;
                }

                // Retry on markedUnread or similar timing errors
                if (attempt < maxRetries && (
                    error.message?.includes('markedUnread') ||
                    error.message?.includes('Cannot read properties of undefined')
                )) {
                    console.log(`[RETRY] Will retry in 3 seconds...`);
                    await new Promise(r => setTimeout(r, 3000));
                    continue;
                }

                throw error;
            }
        }

        throw lastError;
    }

    async sendMediaMessage(userId, groupId, mediaPath, caption = '', options = {}) {
        const client = this.clients.get(userId);
        if (!client || this.clientStatus.get(userId) !== 'ready') {
            throw new Error('Client not ready');
        }

        // Check if file exists before retries
        if (!fs.existsSync(mediaPath)) {
            throw new Error('Media file not found');
        }

        // Create MessageMedia from file once
        const media = MessageMedia.fromFilePath(mediaPath);

        // Retry logic for known whatsapp-web.js timing issues
        const maxRetries = 3;
        let lastError;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const chat = await client.getChatById(groupId);

                if (!chat) {
                    throw new Error('Group not found');
                }

                // Small delay to let chat object fully hydrate (fixes markedUnread error)
                if (attempt > 1) {
                    await new Promise(r => setTimeout(r, 2000));
                }

                // Build mentions array if provided
                let mentions = [];

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

                const sendOptions = {
                    caption: caption || undefined,
                };

                if (mentions.length > 0) {
                    sendOptions.mentions = mentions;
                }

                console.log(`[SEND] Sending media to ${groupId} for user ${userId} (attempt ${attempt})`);

                const result = await chat.sendMessage(media, sendOptions);

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
                    groupId: groupId
                };
            } catch (error) {
                lastError = error;
                console.error(`Error sending media to group ${groupId} for user ${userId} (attempt ${attempt}):`, error.message);

                // Handle detached frame error - don't retry
                if (error.message && error.message.includes('detached Frame')) {
                    console.log(`[WARN] Session for user ${userId} has invalid frame`);
                    this.clientStatus.set(userId, 'disconnected');
                    // Clean up file before throwing
                    try { fs.unlinkSync(mediaPath); } catch (e) {}
                    throw error;
                }

                // Retry on markedUnread or similar timing errors
                if (attempt < maxRetries && (
                    error.message?.includes('markedUnread') ||
                    error.message?.includes('Cannot read properties of undefined')
                )) {
                    console.log(`[RETRY] Will retry in 3 seconds...`);
                    await new Promise(r => setTimeout(r, 3000));
                    continue;
                }

                // Clean up file before throwing final error
                try { fs.unlinkSync(mediaPath); } catch (e) {}
                throw error;
            }
        }

        // Clean up file before throwing final error
        try { fs.unlinkSync(mediaPath); } catch (e) {}
        throw lastError;
    }

    async sendWelcomeMessage(userId, groupId, content, joinerPhones = [], extraMentionPhones = []) {
        const client = this.clients.get(userId);
        if (!client || this.clientStatus.get(userId) !== 'ready') {
            throw new Error('Client not ready');
        }

        try {
            const chat = await client.getChatById(groupId);

            if (!chat) {
                throw new Error('Group not found');
            }

            // Build mentions array and contact list for clickable mentions
            const mentions = [];
            const joinerMentionNames = [];
            const extraMentionNames = [];

            // Process joiner phones (will appear at the start)
            for (const phone of joinerPhones) {
                if (!phone) continue;

                // Clean phone number (remove any non-digit characters)
                const cleanPhone = phone.replace(/[^\d]/g, '');
                const contactId = `${cleanPhone}@c.us`;

                try {
                    // Get the contact to have a clickable mention
                    const contact = await client.getContactById(contactId);
                    mentions.push(contact);
                    joinerMentionNames.push(`@${cleanPhone}`);
                } catch (e) {
                    // If we can't get the contact, still add the ID
                    console.log(`[WELCOME] Could not get contact for ${phone}, adding raw ID`);
                    mentions.push(contactId);
                    joinerMentionNames.push(`@${cleanPhone}`);
                }
            }

            // Process extra mention phones (will appear at the end after text)
            for (const phone of extraMentionPhones) {
                if (!phone) continue;

                const cleanPhone = phone.replace(/[^\d]/g, '');
                const contactId = `${cleanPhone}@c.us`;

                try {
                    const contact = await client.getContactById(contactId);
                    mentions.push(contact);
                    extraMentionNames.push(`@${cleanPhone}`);
                } catch (e) {
                    console.log(`[WELCOME] Could not get contact for extra mention ${phone}, adding raw ID`);
                    mentions.push(contactId);
                    extraMentionNames.push(`@${cleanPhone}`);
                }
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

            const sendOptions = mentions.length > 0 ? { mentions } : {};

            console.log(`[WELCOME] Sending welcome message to ${groupId} for user ${userId} with ${joinerMentionNames.length} joiner mentions and ${extraMentionNames.length} extra mentions`);

            const result = await chat.sendMessage(messageContent, sendOptions);

            return {
                success: true,
                messageId: result.id._serialized,
                timestamp: result.timestamp,
                groupId: groupId,
                joinerMentionsCount: joinerMentionNames.length,
                hasOwnerMention: !!ownerMentionName
            };
        } catch (error) {
            console.error(`Error sending welcome message to group ${groupId} for user ${userId}:`, error);

            // Handle detached frame error
            if (error.message && error.message.includes('detached Frame')) {
                console.log(`[WARN] Session for user ${userId} has invalid frame`);
                this.clientStatus.set(userId, 'disconnected');
            }

            throw error;
        }
    }

    async sendPoll(userId, groupId, question, options, allowMultipleAnswers = false, mentionOptions = {}) {
        const client = this.clients.get(userId);
        if (!client || this.clientStatus.get(userId) !== 'ready') {
            throw new Error('Client not ready');
        }

        // Validate poll options (WhatsApp requires 2-12 options)
        if (!options || options.length < 2) {
            throw new Error('Poll must have at least 2 options');
        }
        if (options.length > 12) {
            throw new Error('Poll cannot have more than 12 options');
        }

        // Retry logic for known whatsapp-web.js timing issues
        const maxRetries = 3;
        let lastError;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const chat = await client.getChatById(groupId);

                if (!chat) {
                    throw new Error('Group not found');
                }

                // Small delay to let chat object fully hydrate (fixes markedUnread error)
                if (attempt > 1) {
                    await new Promise(r => setTimeout(r, 2000));
                }

                // Build mentions array if provided
                let mentions = [];

                if (mentionOptions.mentionAll) {
                    // Get all participants and add them as mentions
                    if (chat.participants && Array.isArray(chat.participants)) {
                        mentions = chat.participants.map(p => p.id._serialized);
                    }
                } else if (mentionOptions.mentionIds && mentionOptions.mentionIds.length > 0) {
                    // Convert phone numbers to WhatsApp IDs
                    mentions = mentionOptions.mentionIds.map(phone => {
                        // Handle if already has @c.us suffix
                        if (phone.includes('@')) {
                            return phone;
                        }
                        return `${phone}@c.us`;
                    });
                }

                // Create the poll
                const poll = new Poll(question, options, {
                    allowMultipleAnswers: allowMultipleAnswers
                });

                const sendOptions = mentions.length > 0 ? { mentions } : {};

                console.log(`[POLL] Sending poll to ${groupId} for user ${userId}: "${question}" with ${options.length} options, ${mentions.length} mentions (attempt ${attempt})`);

                const result = await chat.sendMessage(poll, sendOptions);

                return {
                    success: true,
                    messageId: result.id._serialized,
                    timestamp: result.timestamp,
                    groupId: groupId,
                    question: question,
                    optionsCount: options.length
                };
            } catch (error) {
                lastError = error;
                console.error(`Error sending poll to group ${groupId} for user ${userId} (attempt ${attempt}):`, error.message);

                // Handle detached frame error - don't retry
                if (error.message && error.message.includes('detached Frame')) {
                    console.log(`[WARN] Session for user ${userId} has invalid frame`);
                    this.clientStatus.set(userId, 'disconnected');
                    throw error;
                }

                // Retry on markedUnread or similar timing errors
                if (attempt < maxRetries && (
                    error.message?.includes('markedUnread') ||
                    error.message?.includes('Cannot read properties of undefined')
                )) {
                    console.log(`[RETRY] Will retry in 3 seconds...`);
                    await new Promise(r => setTimeout(r, 3000));
                    continue;
                }

                throw error;
            }
        }

        throw lastError;
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
        }
    }

    async destroyAll() {
        console.log('Destroying all clients...');
        for (const userId of this.clients.keys()) {
            await this.destroyClient(userId);
        }
    }

    // Auto-restore previously authenticated sessions on startup
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

            for (let i = 0; i < authenticatedSessions.length; i++) {
                const sessionDir = authenticatedSessions[i];
                // Extract user ID from directory name (session-user_X)
                const match = sessionDir.match(/session-user_(\d+)/);
                if (match) {
                    const userId = parseInt(match[1], 10);
                    console.log(`[RESTORE] Restoring session for user ${userId}...`);

                    try {
                        await this.initializeClient(userId);
                        console.log(`[RESTORE] Session restored for user ${userId}`);
                    } catch (error) {
                        console.error(`[RESTORE] Failed to restore session for user ${userId}:`, error.message);
                    }

                    // Wait 30 seconds between session restorations to avoid overwhelming puppeteer
                    if (i < authenticatedSessions.length - 1) {
                        console.log('[RESTORE] Waiting 30 seconds before next session...');
                        await new Promise(resolve => setTimeout(resolve, 30000));
                    }
                }
            }
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
