const WebSocket = require('ws');

const WS_URL = 'ws://localhost:9006';
const TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhZG1pbiIsImVtYWlsIjoibXJvZHJpZ3VlekBzb3JiYS5haSIsInVzZXJJZCI6IkU0cm02T3VlZ3Y4ZiIsInNjb3BlIjpbImFkbWluIl0sImF1dGhvcml6ZWQiOnRydWUsImlhdCI6MTc2MzU2MDg4NiwiZXhwIjoxNzYzNTc1Mjg2fQ.hEMtcCdT9vHuAqj9WnQ1Rirbg7VJDTz_jOmOZ-hJvco';

/**
 * Starts a WebSocket connection to the server
 * Subscribes to alerting and logging channels
 * Automatically reconnects on connection close
 */
function startWebsocket() {
    const socket = new WebSocket(`${WS_URL}?token=${TOKEN}`, {
        rejectUnauthorized: false // Allow self-signed certificates for localhost
    });

    /**
     * Handles incoming messages from the WebSocket
     * @param {Object} event - WebSocket message event
     */
    socket.on('message', (data) => {
        console.log('Received data:', data.toString());

        try {
            const message = JSON.parse(data.toString());
            console.log('Channel:', message.channel);
            console.log('Payload length:', message.payload?.length || 0);
            console.log('Payload:', message.payload);
        } catch (error) {
            console.error('Error parsing message:', error);
            console.log('Raw data:', data.toString());
        }
    });

    /**
     * Handles WebSocket connection open event
     * Subscribes to the specified channels
     */
    socket.on('open', () => {
        console.log('✅ WebSocket connected');

        // Subscribe to alerting engine alarms state changes
        socket.send(JSON.stringify({
            request: 'SUBSCRIBE',
            channel: 'alerting-engine/alarms.state.changed.event'
        }));

        // Subscribe to all log saved events
        socket.send(JSON.stringify({
            request: 'SUBSCRIBE',
            channel: '*/log.saved.event'
        }));

        console.log('📡 Subscribed to channels:');
        console.log('   - alerting-engine/alarms.state.changed.event');
        console.log('   - */log.saved.event');

        // Publish to session_expired channel with empty object
        socket.send(JSON.stringify({
            request: 'PUBLISH',
            channel: 'session_expired',
            payload: JSON.stringify({ status: 'active', tabId: 'tab_' + Math.random().toString(36).substr(2, 9), userId: 'user_' + Date.now() })
        }));

         console.log('📤 Published to channel: session_expired');
    });

    /**
     * Handles WebSocket connection close event
     * Automatically reconnects after 3 seconds
     */
    socket.on('close', () => {
        console.warn('⚠️  WebSocket connection closed, reconnecting in 3 seconds...');
        setTimeout(startWebsocket, 3000);
    });

    /**
     * Handles WebSocket connection errors
     */
    socket.on('error', (error) => {
        console.error('❌ WebSocket error:', error.message);
    });

    return socket;
}

// Start the WebSocket connection
console.log('🚀 Starting WebSocket client...');
startWebsocket();

