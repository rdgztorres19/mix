// HmacRequestSigner.js
const axios = require("axios");
const crypto = require("crypto");
const express = require("express");

const app = express();

class HmacRequestSigner {
    /**
     * Creates an HMAC request signer for secure API authentication
     * @param {string} apiKey - Service identifier (e.g., "svc-b")
     * @param {string} baseSecret - Base secret for key derivation (e.g., "base-secret-b")
     * @param {number} periodSeconds - How often the derived key changes (default: 5 seconds)
     */
    constructor({ apiKey, baseSecret, periodSeconds = 5 }) {
        this.apiKey = apiKey;           // ej. "svc-b"
        this.baseSecret = baseSecret;   // ej. "base-secret-b"
        this.period = periodSeconds;    // cada cuánto cambia la clave derivada
    }

    /**
     * Derives a time-based secret key from the base secret
     * How it works:
     * 1. Gets current timestamp in seconds and adds any offset
     * 2. Divides by period to get a "time slice" number that changes every period
     * 3. Uses HMAC-SHA256 with base secret to hash the time slice number
     * 4. This creates a rotating key that changes predictably over time
     * 
     * Example: If period=5 and current time=1000s, slice=200
     *          If period=5 and current time=1004s, slice=200 (same key)
     *          If period=5 and current time=1005s, slice=201 (new key)
     * 
     * @param {number} offsetSeconds - Time offset for key rotation tolerance
     * @returns {Buffer} Derived secret key
     */
    #deriveSecret(offsetSeconds = 0) {
        // slice = número que cambia cada periodo (p. ej., cada minuto)
        const slice = Math.floor((Date.now() / 1000 + offsetSeconds) / this.period);

        return crypto.createHmac("sha256", this.baseSecret)
            .update(String(slice))
            .digest();
    }

    /**
     * Signs an HTTP request with HMAC authentication headers
     * Creates a canonical string representation of the request and signs it
     * @param {string} method - HTTP method (GET, POST, etc.)
     * @param {string} url - Full URL of the request
     * @returns {Object} Headers object with x-service, X-Timestamp, and X-Signature
     */
    sign(method, url) {
        const parsed = new URL(url);
        const path = parsed.pathname;

        const timestamp = new Date().toISOString();
        const derivedSecret = this.#deriveSecret();

        console.log(derivedSecret.toString('base64'), "derivedSecret");

        const canonical = `${method.toUpperCase()}\n${path}\n${this.apiKey}\n${timestamp}`;

        const signature = crypto
            .createHmac("sha256", derivedSecret)
            .update(canonical)
            .digest("base64");

        return {
            "x-service": this.apiKey,
            "X-Timestamp": timestamp,
            "X-Signature": signature,
        };
    }
}

class TimeBasedHmacVerifier {
    /**
     * Creates an HMAC verifier for validating signed requests
     * @param {string} baseSecrets - Base secret for HMAC verification
     * @param {number} maxSkewSeconds - Maximum allowed time difference between server and client (default: 100s)
     * @param {number} periodSeconds - Period of the secret key rotation (default: 5s)
     */
    constructor({ baseSecrets, maxSkewSeconds = 100, periodSeconds = 5 }) {
        this.baseSecrets = baseSecrets;
        this.maxSkew = maxSkewSeconds;
        this.period = periodSeconds;
    }

    /**
     * Derives a time-based secret key (same logic as HmacRequestSigner)
     * @param {string} base - Base secret to derive from
     * @param {number} offsetSeconds - Time offset for key rotation tolerance
     * @returns {Buffer} Derived secret key
     */
    #deriveSecret(base, offsetSeconds = 0) {
        const slice = Math.floor((Date.now() / 1000 + offsetSeconds) / this.period);
        return crypto.createHmac("sha256", base).update(String(slice)).digest();
    }

    /**
     * Verifies an incoming HTTP request's HMAC signature
     * Process:
     * 1. Extracts authentication headers (api-key, timestamp, signature)
     * 2. Validates timestamp is within acceptable time skew
     * 3. Recreates the canonical string from request data
     * 4. Tests signature against current, previous, and next time periods
     * 5. Uses timing-safe comparison to prevent timing attacks
     * 
     * @param {Object} req - Express request object
     * @returns {Object} Verification result with valid flag, microserviceId, and reason
     */
    verifyRequest(req) {
        console.time("verifyRequest");
        const apiKey = req.headers["x-service"];
        const timestamp = req.headers["x-timestamp"];
        const signature = req.headers["x-signature"];

        if (!apiKey || !timestamp || !signature)
            return { valid: false, microserviceId: null, reason: "Missing headers" };

        const base = this.baseSecrets;

        if (!base)
            return { valid: false, microserviceId: null, reason: "Unknown microservice" };

        const t = Date.parse(timestamp);

        if (Number.isNaN(t) || Math.abs(Date.now() - t) > this.maxSkew * 1000) {
            console.log("Timestamp skew", Math.abs(Date.now() - t), this.maxSkew * 1000);
            return { valid: false, microserviceId: apiKey, reason: "Timestamp skew" };
        }

        const canonical = `${req.method.toUpperCase()}\n${req.path}\n${apiKey}\n${timestamp}`;
        const sigBuf = Buffer.from(signature, "base64");

        // Try derived key from current, previous, and next period (tolerance for clock drift)
        const offsets = [0, -this.period, this.period];

        for (const offset of offsets) {
            const derived = this.#deriveSecret(base, offset);
            const expected = crypto.createHmac("sha256", derived)
                .update(canonical)
                .digest();

            if (sigBuf.length === expected.length && crypto.timingSafeEqual(sigBuf, expected)) {
                console.timeEnd("verifyRequest");
                return { valid: true, microserviceId: apiKey };
            }
                
        }

        console.timeEnd("verifyRequest");
        return { valid: false, microserviceId: apiKey, reason: "Bad signature" };
    }
}

/**
 * Sets up the HTTP server that receives and verifies HMAC-signed requests
 * Creates middleware to validate all incoming requests before processing
 */
const receiver = () => {
    const verifier = new TimeBasedHmacVerifier({
        baseSecrets: "super-secret-b",
    });

    // Middleware to verify HMAC signature on all requests
    app.use((req, res, next) => {
        const result = verifier.verifyRequest(req);
        if (!result.valid) return res.status(401).json({ error: result.reason });
        req.microserviceId = result.microserviceId;
        next();
    });

    // Protected endpoint that requires valid HMAC signature
    app.get("/internal/status", (req, res) => {
        res.json({ ok: true, from: req.microserviceId });
    });

    app.listen(3009, () => console.log("Verifier running on 3009"));
};

/**
 * Sets up the HTTP client that sends HMAC-signed requests
 * Periodically makes authenticated requests to test the system
 */
const consumer = () => {
    const signer = new HmacRequestSigner({
        apiKey: "core",
        baseSecret: "super-secret-b",
    });

    // Send signed request every 5 minutes (300000000ms seems like a typo - should be 300000ms for 5min)
    setInterval(async () => {
        try {
            const url = `http://localhost:8089/api/v2/nodes?fields=["id", "label"]&params=["temp"]&filter={"type": "tag-v4"}`;
            // const url = `http://localhost:8089/api/v2//nodes/1227866527542272/filter-subtree-by-types?types=["tag-v4"]&fields=["id", "label", "parent"]&params=["type", "temp"]&includePath=true`;
            const headers = signer.sign("GET", url);
            const response = await axios.get(url, { headers });
            //console.log(response.data.data);

            // POST request to node-type-list endpoint
            const postUrl = `http://localhost:8089/node-type-list/1227866527542272`;
            const postHeaders = signer.sign("POST", postUrl);
            const postResponse = await axios.post(postUrl, {
                type: "tag-v4",
                includePath: true
            }, {
                headers: postHeaders
            });
            console.log(postResponse.data[0]);


            // const postUrl = `http://localhost:8089/api/v2/service-resource-nodes`;
            // const postHeaders = signer.sign("POST", postUrl);
            // const responsePost = await axios.post(postUrl, {
            //     source: "core",
            //     action: "loadResources",
            //     types: ["tag-v4"],
            //     fields: ["id", "label"],
            //     params: ["icon", "type", "temp"],
            //     filter: {"params.enabled": 1},
            //     includeAbsolutePath: true
            // }, {
            //     headers: postHeaders
            // });

            // console.log(responsePost.data.data);
            process.exit(0);
        } catch (error) {
            console.log(error.response.status);
        }
    }, 100);
};


receiver();
consumer();