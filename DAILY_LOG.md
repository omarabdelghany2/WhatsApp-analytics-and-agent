# Daily Development Log

## 2026-02-04

### Summary
Added Channel Broadcast feature with full support for text, media, and polls to WhatsApp channels.

---

### Bug Fixes

#### 1. whatsapp-web.js Channel.js Bug (Patch)
- **Issue**: `Cannot read properties of undefined (reading 'description')` when calling `client.getChannels()`
- **Cause**: The `Channel.js` constructor in whatsapp-web.js v1.34.6 accesses `data.channelMetadata.description` without checking if `channelMetadata` exists
- **Fix**: Updated patch file to use optional chaining: `data.channelMetadata?.description || ''`
- **Commit**: `2a1cdff` - Fix: Patch whatsapp-web.js Channel.js for undefined channelMetadata

#### 2. Dockerfile Patch Order Issue
- **Issue**: Patches weren't being applied during Docker build
- **Cause**: `COPY patches ./patches` happened AFTER `npm ci`, so patches folder didn't exist when `patch-package` ran
- **Fix**: Moved `COPY patches ./patches` before `RUN npm ci`
- **Commit**: `2a1cdff` - Fix: Copy patches folder before npm ci in Dockerfile

---

### New Features

#### Channel Poll Support
Added ability to send polls to WhatsApp channels (in addition to existing text/media support).

**Files Modified:**

1. **whatsapp-service/src/services/ClientManager.js**
   - Added `sendChannelPoll(userId, channelId, question, pollOptions, allowMultipleAnswers)` method

2. **whatsapp-service/src/routes/clients.js**
   - Added `POST /:userId/channels/:channelId/send-poll` route

3. **backend/app/services/whatsapp_bridge.py**
   - Added `send_channel_poll()` bridge method

4. **backend/app/api/broadcast.py**
   - Added `SendChannelPollRequest` Pydantic model
   - Added `send_immediate_channel_poll()` background task function
   - Added `POST /api/broadcast/send-channel-poll` endpoint
   - Updated `/scheduled` and `/history` queries to include `channel_poll` task type

5. **frontend/src/services/api.ts**
   - Added `sendChannelPollBroadcast()` API method

6. **frontend/src/pages/BroadcastPage.tsx**
   - Added Message/Poll mode selector in Channels tab
   - Added channel poll state variables (`channelPollQuestion`, `channelPollOptions`, `channelPollAllowMultiple`)
   - Added `sendChannelPollMutation` mutation
   - Added WebSocket subscriptions for `channel_poll_progress` and `channel_poll_complete`
   - Added poll form UI (question input, options list, allow multiple toggle)
   - Added "Channel Poll" badge (teal color) in Scheduled/History tabs
   - Updated task type checks to include `channel_poll`

**Commit**: `124ccad` - Feature: Add poll support for channel broadcasts

---

### Pending Issues

1. **Backend not responding to channel requests**
   - Requests to `/api/broadcast/send-channel` and `/api/broadcast/send-channel-poll` returning no response
   - No logs appearing in Railway
   - Possible causes: Backend still deploying, startup crash, or CORS preflight issues
   - **Status**: Investigating

---

### Git Commits Today

| Commit | Description |
|--------|-------------|
| `2a1cdff` | Fix: Patch whatsapp-web.js Channel.js for undefined channelMetadata |
| `2a1cdff` | Fix: Copy patches folder before npm ci in Dockerfile |
| `124ccad` | Feature: Add poll support for channel broadcasts |

---

### Architecture Notes

**Channel Broadcast Types:**
- `channel_broadcast` - Text and/or media to channels
- `channel_poll` - Polls to channels

**Channel vs Group Differences:**
| Feature | Groups | Channels |
|---------|--------|----------|
| Mentions | Supported | Not supported |
| Polls | Supported | Supported (new) |
| Media | Supported | Supported |
| Scheduling | Supported | Supported |

**Channel ID Format:** `123456789@newsletter`
