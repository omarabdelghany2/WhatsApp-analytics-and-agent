const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure multer for file uploads
const uploadDir = path.join(__dirname, '../../uploads');
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

            const result = await clientManager.sendPoll(
                userId,
                groupId,
                question,
                options,
                allowMultipleAnswers || false
            );

            res.json(result);
        } catch (error) {
            console.error('Error sending poll:', error);
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

    return router;
};
