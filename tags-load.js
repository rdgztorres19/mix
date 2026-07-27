const { AuthenticatorBuilder, NodeType } = require("@sorbotics/api-sdk");
const IORedis = require("ioredis");

const PUBLISH_INTERVAL_MS = 1000;
const WRITE_CHANNEL = "write_queue";

class AutopilotClient {
    constructor() {

        this.sdk = AuthenticatorBuilder.create()
            .useApiConnector()
            .withUrl("http://localhost:8089")
            .useSDK()
            .useIOTUnifiedAPI();

        this.redis = new IORedis({
            host: "localhost",
            port: 6379
        });
        this.redis.on("connect", () => console.log("Redis client connected"));
        this.redis.on("error", (err) => console.error("Redis Client Error:", err));

        this.nodes = [];
        this.timer = null;
    }

    async loadTags() {
        this.nodes = await this.sdk.filterNodes({
            filter: {
                "$and": [
                    {
                        type: NodeType.Tag
                    },
                    {
                        kind: {
                            "$is": null
                        }
                    }
                ]
            }
        });

        console.log(this.nodes.length + " tags loaded");
    }

    // Genera un value segun params.typeID del tag.
    // Siempre se devuelve como string (el value se publica como string).
    generateValue(typeID) {
        switch (typeID) {
            case 10: // array JSON cualquiera
                return JSON.stringify([
                    Math.floor(Math.random() * 100),
                    Math.floor(Math.random() * 100),
                    Math.floor(Math.random() * 100)
                ]);
            case 1: // bool 0 o 1
                return String(Math.random() < 0.5 ? 0 : 1);
            case 9: // string random
                return Math.random().toString(36).slice(2, 10);
            default: // real
                return String((Math.random() * 100).toFixed(2));
        }
    }

    // Por cada tag con id, genera un value segun su typeID, timestamp actual y quality 1,
    // y lo publica al canal write_queue usando un pipeline de Redis.
    async publishOnce() {
        const timestamp = String(Date.now());
        const pipeline = this.redis.pipeline();
        let published = 0;

        for (const node of this.nodes) {
            if (node.id == null) continue;

            const typeID = node.params && node.params.typeID;

            const message = {
                id: node.id,
                value: this.generateValue(typeID),
                timestamp,
                isOnServer: 1,
                quality: 1,
                source: "test"
            };

            pipeline.publish(WRITE_CHANNEL, JSON.stringify(message));
            published++;
        }

        if (published > 0) {
            await pipeline.exec();
        }
        console.log(`Published ${published} tags to ${WRITE_CHANNEL} @ ${timestamp}`);
    }

    startPublishing() {
        if (this.timer) return;
        // Publica inmediatamente y luego cada segundo.
        this.publishOnce().catch(err => console.error("Publish error:", err));
        this.timer = setInterval(() => {
            this.publishOnce().catch(err => console.error("Publish error:", err));
        }, PUBLISH_INTERVAL_MS);
    }

    // Publica cada segundo durante `durationMs` (por defecto 30s) y luego se detiene.
    async publishForDuration(durationMs = 30000) {
        if (this.timer) return;

        this.publishOnce().catch(err => console.error("Publish error:", err));
        this.timer = setInterval(() => {
            this.publishOnce().catch(err => console.error("Publish error:", err));
        }, PUBLISH_INTERVAL_MS);

        await new Promise(resolve => setTimeout(resolve, durationMs));

        clearInterval(this.timer);
        this.timer = null;
        console.log(`Done publishing after ${durationMs / 1000}s`);
    }

    stop() {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        this.redis.quit();
    }
}


const client = new AutopilotClient();

client.loadTags()
    .then(() => client.publishForDuration(30000))
    .then(() => client.stop())
    .catch(err => {
        console.error("Error loading tags:", err);
        client.stop();
    });

// Cierre limpio con Ctrl+C
process.on("SIGINT", () => {
    console.log("\nStopping...");
    client.stop();
    process.exit(0);
});
