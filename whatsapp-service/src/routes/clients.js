const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure multer for file uploads - use data dir for persistence
const dataDir = process.env.DATA_DIR || './data';
const uploadDir = path.join(dataDir, 'broadcast_media');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage,
    limits: {
        fileSize: 64 * 1024 * 1024 // 64MB max file size
    },
    fileFilter: (req, file, cb) => {
        // Allow images, videos, audio, and documents
        const allowedTypes = /jpeg|jpg|png|gif|webp|mp4|mov|avi|webm|mp3|ogg|wav|pdf|doc|docx|xls|xlsx|ppt|pptx|txt|zip|rar/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype.split('/')[1]) ||
                        file.mimetype.startsWith('image/') ||
                        file.mimetype.startsWith('video/') ||
                        file.mimetype.startsWith('audio/') ||
                        file.mimetype.startsWith('application/');

        if (extname || mimetype) {
            return cb(null, true);
        }
        cb(new Error('File type not allowed'));
    }
});

module.exports = (clientManager) => {
    const router = express.Router();

    // Initialize client for user
    router.post('/:userId/init', async (req, res) => {
        try {
            const userId = parseInt(req.params.userId);
            console.log(`Init request for user ${userId}`);
            const result = await clientManager.initializeClient(userId);
            res.json(result);
        } catch (error) {
            console.error('Error initializing client:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Get client status
    router.get('/:userId/status', (req, res) => {
        const userId = parseInt(req.params.userId);
        const status = clientManager.getStatus(userId);
        res.json(status);
    });

    // Get QR code
    router.get('/:userId/qr', (req, res) => {
        const userId = parseInt(req.params.userId);
        const qr = clientManager.getQRCode(userId);
        const status = clientManager.getStatus(userId);

        res.json({
            qr,
            status: status.status,
            hasQR: !!qr
        });
    });

    // Get available groups
    router.get('/:userId/groups', async (req, res) => {
        try {
            const userId = parseInt(req.params.userId);
            const groups = await clientManager.getGroups(userId);
            res.json({ success: true, groups });
        } catch (error) {
            console.error('Error getting groups:', error);
            res.status(500).json({ success: false, error: error.message, groups: [] });
        }
    });

    // Get group members
    router.get('/:userId/groups/:groupId/members', async (req, res) => {
        try {
            const userId = parseInt(req.params.userId);
            const groupId = req.params.groupId;
            const members = await clientManager.getGroupMembers(userId, groupId);
            res.json({ success: true, members });
        } catch (error) {
            console.error('Error getting group members:', error);
            res.status(500).json({ success: false, error: error.message, members: [] });
        }
    });

    // Send message to a group
    router.post('/:userId/groups/:groupId/send', async (req, res) => {
        try {
            const userId = parseInt(req.params.userId);
            const groupId = req.params.groupId;
            const { content, mentionAll, mentionIds } = req.body;

            if (!content) {
                return res.status(400).json({ success: false, error: 'Message content is required' });
            }

            const result = await clientManager.sendMessage(userId, groupId, content, {
                mentionAll: mentionAll || false,
                mentionIds: mentionIds || []
            });

            res.json(result);
        } catch (error) {
            console.error('Error sending message:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Send media message to a group
    router.post('/:userId/groups/:groupId/send-media', upload.single('media'), async (req, res) => {
        try {
            const userId = parseInt(req.params.userId);
            const groupId = req.params.groupId;
            const { caption, mentionAll, mentionIds } = req.body;

            if (!req.file) {
                return res.status(400).json({ success: false, error: 'Media file is required' });
            }

            const mentionIdsParsed = mentionIds ? JSON.parse(mentionIds) : [];

            const result = await clientManager.sendMediaMessage(userId, groupId, req.file.path, caption || '', {
                mentionAll: mentionAll === 'true' || mentionAll === true,
                mentionIds: mentionIdsParsed
            });

            res.json(result);
        } catch (error) {
            console.error('Error sending media:', error);
            // Clean up uploaded file on error
            if (req.file && fs.existsSync(req.file.path)) {
                try {
                    fs.unlinkSync(req.file.path);
                } catch (e) {
                    // Ignore cleanup errors
                }
            }
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Set group messages admin-only setting
    router.post('/:userId/groups/:groupId/settings', async (req, res) => {
        try {
            const userId = parseInt(req.params.userId);
            const groupId = req.params.groupId;
            const { messagesAdminOnly } = req.body;

            if (typeof messagesAdminOnly !== 'boolean') {
                return res.status(400).json({ success: false, error: 'messagesAdminOnly must be a boolean' });
            }

            const result = await clientManager.setGroupMessagesAdminOnly(userId, groupId, messagesAdminOnly);
            res.json(result);
        } catch (error) {
            console.error('Error setting group settings:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Send welcome message with clickable mentions by phone number
    router.post('/:userId/groups/:groupId/send-welcome', async (req, res) => {
        try {
            const userId = parseInt(req.params.userId);
            const groupId = req.params.groupId;
            const { content, joinerPhones, extraMentionPhones } = req.body;

            if (!content) {
                return res.status(400).json({ success: false, error: 'Message content is required' });
            }

            const result = await clientManager.sendWelcomeMessage(userId, groupId, content, joinerPhones || [], extraMentionPhones || []);
            res.json(result);
        } catch (error) {
            console.error('Error sending welcome message:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Send poll to a group
    router.post('/:userId/groups/:groupId/send-poll', async (req, res) => {
        try {
            const userId = parseInt(req.params.userId);
            const groupId = req.params.groupId;
            const { question, options, allowMultipleAnswers, mentionAll, mentionIds } = req.body;

            if (!question) {
                return res.status(400).json({ success: false, error: 'Poll question is required' });
            }

            if (!options || !Array.isArray(options) || options.length < 2) {
                return res.status(400).json({ success: false, error: 'Poll must have at least 2 options' });
            }

            if (options.length > 12) {
                return res.status(400).json({ success: false, error: 'Poll cannot have more than 12 options' });
            }

            const result = await clientManager.sendPoll(
                userId,
                groupId,
                question,
                options,
                allowMultipleAnswers || false,
                {
                    mentionAll: mentionAll || false,
                    mentionIds: mentionIds || []
                }
            );

            res.json(result);
        } catch (error) {
            console.error('Error sending poll:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // ==================== CHANNEL ROUTES ====================

    // Get available channels
    router.get('/:userId/channels', async (req, res) => {
        try {
            const userId = parseInt(req.params.userId);
            const channels = await clientManager.getChannels(userId);
            res.json({ success: true, channels });
        } catch (error) {
            console.error('Error getting channels:', error);
            res.status(500).json({ success: false, error: error.message, channels: [] });
        }
    });

    // Send message to a channel
    router.post('/:userId/channels/:channelId/send', async (req, res) => {
        try {
            const userId = parseInt(req.params.userId);
            const channelId = req.params.channelId;
            const { content } = req.body;

            if (!content) {
                return res.status(400).json({ success: false, error: 'Message content is required' });
            }

            const result = await clientManager.sendChannelMessage(userId, channelId, content);
            res.json(result);
        } catch (error) {
            console.error('Error sending channel message:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Send media message to a channel
    router.post('/:userId/channels/:channelId/send-media', upload.single('media'), async (req, res) => {
        try {
            const userId = parseInt(req.params.userId);
            const channelId = req.params.channelId;
            const { caption } = req.body;

            if (!req.file) {
                return res.status(400).json({ success: false, error: 'Media file is required' });
            }

            const result = await clientManager.sendChannelMediaMessage(userId, channelId, req.file.path, caption || '');
            res.json(result);
        } catch (error) {
            console.error('Error sending channel media:', error);
            // Clean up uploaded file on error
            if (req.file && fs.existsSync(req.file.path)) {
                try {
                    fs.unlinkSync(req.file.path);
                } catch (e) {
                    // Ignore cleanup errors
                }
            }
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Send media from stored path to a channel (for scheduled broadcasts)
    router.post('/:userId/channels/:channelId/send-media-from-path', async (req, res) => {
        try {
            const userId = parseInt(req.params.userId);
            const channelId = req.params.channelId;
            const { filePath, caption } = req.body;

            if (!filePath) {
                return res.status(400).json({ success: false, error: 'filePath is required' });
            }

            if (!fs.existsSync(filePath)) {
                return res.status(404).json({ success: false, error: 'Media file not found' });
            }

            const result = await clientManager.sendChannelMediaMessage(userId, channelId, filePath, caption || '');
            res.json(result);
        } catch (error) {
            console.error('Error sending channel media from path:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Send poll to a channel
    router.post('/:userId/channels/:channelId/send-poll', async (req, res) => {
        try {
            const userId = parseInt(req.params.userId);
            const channelId = req.params.channelId;
            const { question, options, allowMultipleAnswers } = req.body;

            if (!question) {
                return res.status(400).json({ success: false, error: 'Poll question is required' });
            }
            if (!options || !Array.isArray(options) || options.length < 2) {
                return res.status(400).json({ success: false, error: 'Poll must have at least 2 options' });
            }
            if (options.length > 12) {
                return res.status(400).json({ success: false, error: 'Poll cannot have more than 12 options' });
            }

            const result = await clientManager.sendChannelPoll(userId, channelId, question, options, allowMultipleAnswers || false);
            res.json(result);
        } catch (error) {
            console.error('Error sending channel poll:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Logout/destroy client
    router.post('/:userId/logout', async (req, res) => {
        try {
            const userId = parseInt(req.params.userId);
            await clientManager.destroyClient(userId);
            res.json({ success: true });
        } catch (error) {
            console.error('Error logging out:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Delete user session files (for when user is deleted from database)
    router.delete('/:userId/session', async (req, res) => {
        try {
            const userId = parseInt(req.params.userId);
            console.log(`[API] Delete session request for user ${userId}`);
            const result = await clientManager.deleteUserSession(userId);
            res.json(result);
        } catch (error) {
            console.error('Error deleting session:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Upload media for scheduled broadcast (stores on volume, returns path)
    router.post('/upload-media', upload.single('media'), async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({ success: false, error: 'Media file is required' });
            }

            console.log(`[UPLOAD] Media uploaded: ${req.file.path}`);
            res.json({
                success: true,
                filePath: req.file.path,
                filename: req.file.filename,
                mimetype: req.file.mimetype,
                size: req.file.size
            });
        } catch (error) {
            console.error('Error uploading media:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Send media from stored path (for scheduled broadcasts)
    router.post('/:userId/groups/:groupId/send-media-from-path', async (req, res) => {
        try {
            const userId = parseInt(req.params.userId);
            const groupId = req.params.groupId;
            const { filePath, caption, mentionAll, mentionIds } = req.body;

            if (!filePath) {
                return res.status(400).json({ success: false, error: 'filePath is required' });
            }

            if (!fs.existsSync(filePath)) {
                return res.status(404).json({ success: false, error: 'Media file not found' });
            }

            const result = await clientManager.sendMediaMessage(userId, groupId, filePath, caption || '', {
                mentionAll: mentionAll || false,
                mentionIds: mentionIds || []
            });

            // Delete file after sending (optional - comment out to keep)
            // try { fs.unlinkSync(filePath); } catch (e) {}

            res.json(result);
        } catch (error) {
            console.error('Error sending media from path:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Delete media file (cleanup after broadcast)
    router.delete('/media', async (req, res) => {
        try {
            const { filePath } = req.body;

            if (!filePath) {
                return res.status(400).json({ success: false, error: 'filePath is required' });
            }

            // Security: only allow deleting from upload directory
            if (!filePath.startsWith(uploadDir)) {
                return res.status(403).json({ success: false, error: 'Invalid file path' });
            }

            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                console.log(`[CLEANUP] Deleted media: ${filePath}`);
            }

            res.json({ success: true });
        } catch (error) {
            console.error('Error deleting media:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    return router;
};
