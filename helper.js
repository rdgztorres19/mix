const { Client } = require('ssh2');
const OpenAIApi = require('openai');

class AIAssistant {
    constructor() {
        // OpenAI assistant configuration
        this.assistantID = "asst_yGVuch0QeNyGcc3Aot2QZYEL";
        this.openai = new OpenAIApi({
            apiKey: "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", // Replace with your API key
        });

        // Thread and message caching per user
        this.userThreads = new Map();
        this.userMessagesCache = new Map();

        // Instructions for the assistant
        this.instructions = `You should only respond to queries related to Thera programs and vials. You may respond to questions about medicine and protocols, but always relate them to Thera.`;

        // SSH configuration (update with your server details)
        this.sshConfig = {
            host: '192.168.1.45',     // Replace with your SSH server address
            port: 22,
            username: 'sdc',   // Replace with your SSH username
            password: 'sbrQp10',   // Or use privateKey: require('fs').readFileSync('/path/to/your/key')
        };

        this.sshConnection = null;
    }

    /* ----------------- OpenAI Thread Methods ----------------- */

    /**
     * Creates a new thread using the OpenAI API.
     * @returns {Promise<Object>} The thread object.
     */
    async createThread() {
        return await this.openai.beta.threads.create();
    }

    /**
     * Retrieves cached messages for a given user.
     * @param {string} userId - Unique user identifier.
     * @returns {Array} List of messages.
     */
    getUserMessages(userId) {
        return this.userMessagesCache.get(userId) || [];
    }

    /**
     * Creates or retrieves an existing thread for the user.
     * @param {string} userId - Unique user identifier.
     * @returns {Promise<string>} The thread ID.
     */
    async createUserThread(userId) {
        if (!this.userThreads.has(userId)) {
            const thread = await this.createThread();
            this.userThreads.set(userId, thread.id);
            this.userMessagesCache.set(userId, []);
            return thread.id;
        }
        return this.userThreads.get(userId);
    }

    /**
     * Sends a user message to the thread and triggers the assistant run.
     * @param {string} userId - Unique user identifier.
     * @param {string} userMessage - The user's message.
     * @returns {Promise<Array>} Formatted messages from the thread.
     */
    async sendUserMessage(userId, userMessage) {
        const threadId = await this.createUserThread(userId);
        const cachedMessages = this.userMessagesCache.get(userId);
        cachedMessages.push({ role: 'user', content: userMessage });

        // Create a message in the thread
        await this.openai.beta.threads.messages.create(threadId, {
            role: 'user',
            content: userMessage,
        });

        // Run the assistant instructions and poll for completion
        const run = await this.openai.beta.threads.runs.createAndPoll(threadId, {
            assistant_id: this.assistantID,
            instructions: this.instructions,
        });

        if (run.status === 'completed') {
            // Retrieve all messages from the thread
            const messagesResponse = await this.openai.beta.threads.messages.list(threadId);
            const formattedMessages = messagesResponse.data.reverse().map(message => ({
                role: message.role,
                content: message.content[0]?.text?.value || "",
            }));

            // Update the cache and return the formatted messages
            this.userMessagesCache.set(userId, formattedMessages);
            return formattedMessages;
        }
        return [];
    }

    /* ----------------- SSH Integration Methods ----------------- */

    /**
     * Connects to the remote SSH server.
     * @returns {Promise<Client>} Resolves with the established SSH connection.
     */
    connectSSH() {
        return new Promise((resolve, reject) => {
            this.sshConnection = new Client();
            this.sshConnection.on('ready', () => {
                console.log('SSH connection established.');
                resolve(this.sshConnection);
            });
            this.sshConnection.on('error', (err) => {
                console.error('SSH connection error:', err);
                reject(err);
            });
            this.sshConnection.connect(this.sshConfig);
        });
    }

    /**
     * Executes a command on the remote server via SSH.
     * @param {string} command - The command to execute.
     * @returns {Promise<{ output: string, code: number }>}
     */
    executeSSHCommand(command) {
        return new Promise((resolve, reject) => {
            console.log(`Executing SSH command: ${command}`);
            this.sshConnection.exec(command, (err, stream) => {
                if (err) return reject(err);
                let output = '';
                stream.on('data', (data) => output += data.toString());
                stream.stderr.on('data', (data) => output += data.toString());
                stream.on('close', (code) => {
                    console.log(`SSH command exited with code ${code}. Output:\n${output}`);
                    resolve({ output, code });
                });
            });
        });
    }

    /**
     * Closes the SSH connection if established.
     */
    closeSSHConnection() {
        if (this.sshConnection) {
            this.sshConnection.end();
            console.log('SSH connection closed.');
        }
    }

    /* ----------------- Combined Remote Debug Session ----------------- */

    /**
     * Starts a remote debug session.
     * The assistant uses SSH to run commands and OpenAI to decide the next command.
     * @param {string} initialCommand - The first command to execute.
     */
    async startRemoteDebugSession(initialCommand) {
        try {
            // Connect via SSH
            await this.connectSSH();

            // Build initial history for the AI with the first command output
            let history = `Initial remote debug session started.\n`;
            let nextCommand = initialCommand;

            // Iterate until the AI instructs to finish by returning "FIN"
            while (nextCommand.toUpperCase() !== 'FIN' && nextCommand.trim() !== '') {
                // Execute the command over SSH
                const { output } = await this.executeSSHCommand(nextCommand);

                // Build a prompt for OpenAI with the accumulated history
                const prompt = `
You are a remote debugging assistant. Based on the following debug history, determine the next command to execute on the remote server. If no further actions are needed, respond with "FIN".

${history}
`;
                // Query OpenAI to decide the next step
                const response = await this.openai.chat.completions.create({
                    messages: [{ role: 'user', content: prompt }],
                    model: 'gpt-4o-mini'
                });
                nextCommand = response.data.choices[0].text.trim();
                console.log(`AI suggests next SSH command: ${nextCommand}`);
            }

            console.log('Remote debug session completed by AI instruction.');
        } catch (err) {
            console.error('Error during remote debug session:', err);
        } finally {
            this.closeSSHConnection();
        }
    }
}

if (require.main === module) {
    (async () => {
        const assistant = new AIAssistant();
        const initialCommand = 'supervisorctl status all'; // Comando inicial de ejemplo
        await assistant.startRemoteDebugSession(initialCommand);
    })();
}
