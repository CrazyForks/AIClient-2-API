import { OAuth2Client } from 'google-auth-library';
import * as http from 'http';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';
import { API_ACTIONS, ensureRolesInContents, formatExpiryTime } from '../common.js';

// --- Constants ---
const AUTH_REDIRECT_PORT = 8085;
const CREDENTIALS_DIR = '.gemini';
const CREDENTIALS_FILE = 'oauth_creds.json';
const CODE_ASSIST_ENDPOINT = 'https://cloudcode-pa.googleapis.com';
const CODE_ASSIST_API_VERSION = 'v1internal';
const OAUTH_CLIENT_ID = '681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com';
const OAUTH_CLIENT_SECRET = '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';
const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro' , 'gemini-2.5-pro-preview-06-05'];
const ANTI_TRUNCATION_MODELS = GEMINI_MODELS.map(model => `anti-${model}`);

function is_anti_truncation_model(model) {
    return ANTI_TRUNCATION_MODELS.some(antiModel => model.includes(antiModel) || antiModel.includes(model));
}

// 从防截断模型名中提取实际模型名
function extract_model_from_anti_model(model) {
    if (model.startsWith('anti-')) {
        const originalModel = model.substring(5); // 移除 'anti-' 前缀
        if (GEMINI_MODELS.includes(originalModel)) {
            return originalModel;
        }
    }
    return model; // 如果不是anti-前缀或不在原模型列表中，则返回原模型名
}

function toGeminiApiResponse(codeAssistResponse) {
    if (!codeAssistResponse) return null;
    const compliantResponse = { candidates: codeAssistResponse.candidates };
    if (codeAssistResponse.usageMetadata) compliantResponse.usageMetadata = codeAssistResponse.usageMetadata;
    if (codeAssistResponse.promptFeedback) compliantResponse.promptFeedback = codeAssistResponse.promptFeedback;
    if (codeAssistResponse.automaticFunctionCallingHistory) compliantResponse.automaticFunctionCallingHistory = codeAssistResponse.automaticFunctionCallingHistory;
    return compliantResponse;
}

async function* apply_anti_truncation_to_stream(service, model, requestBody) {
    let currentRequest = { ...requestBody };
    let allGeneratedText = '';

    while (true) {
        // 发送请求并处理流式响应
        const apiRequest = {
            model: model,
            project: service.projectId,
            request: currentRequest
        };
        const stream = service.streamApi(API_ACTIONS.STREAM_GENERATE_CONTENT, apiRequest);

        let lastChunk = null;
        let hasContent = false;

        for await (const chunk of stream) {
            const response = toGeminiApiResponse(chunk.response);
            if (response && response.candidates && response.candidates[0]) {
                yield response;
                lastChunk = response;
                hasContent = true;
            }
        }

        // 检查是否因为达到token限制而截断
        if (lastChunk &&
            lastChunk.candidates &&
            lastChunk.candidates[0] &&
            lastChunk.candidates[0].finishReason === 'MAX_TOKENS') {

            // 提取已生成的文本内容
            if (lastChunk.candidates[0].content && lastChunk.candidates[0].content.parts) {
                const generatedParts = lastChunk.candidates[0].content.parts
                    .filter(part => part.text)
                    .map(part => part.text);

                if (generatedParts.length > 0) {
                    const currentGeneratedText = generatedParts.join('');
                    allGeneratedText += currentGeneratedText;

                    // 构建新的请求，包含之前的对话历史和继续指令
                    const newContents = [...requestBody.contents];

                    // 添加之前生成的内容作为模型响应
                    newContents.push({
                        role: 'model',
                        parts: [{ text: currentGeneratedText }]
                    });

                    // 添加继续生成的指令
                    newContents.push({
                        role: 'user',
                        parts: [{ text: 'Please continue from where you left off.' }]
                    });

                    currentRequest = {
                        ...requestBody,
                        contents: newContents
                    };

                    // 继续下一轮请求
                    continue;
                }
            }
        }

        // 如果没有截断或无法继续，则退出循环
        break;
    }
}

export class GeminiApiService {
    constructor(config) {
        this.authClient = new OAuth2Client(OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET);
        this.availableModels = [];
        this.isInitialized = false;

        this.config = config;
        this.host = config.HOST;
        this.oauthCredsBase64 = config.GEMINI_OAUTH_CREDS_BASE64;
        this.oauthCredsFilePath = config.GEMINI_OAUTH_CREDS_FILE_PATH;
        this.projectId = config.PROJECT_ID;
    }

    async initialize() {
        if (this.isInitialized) return;
        console.log('[Gemini] Initializing Gemini API Service...');
        await this.initializeAuth();
        if (!this.projectId) {
            this.projectId = await this.discoverProjectAndModels();
        } else {
            console.log(`[Gemini] Using provided Project ID: ${this.projectId}`);
            this.availableModels = GEMINI_MODELS;
            console.log(`[Gemini] Using fixed models: [${this.availableModels.join(', ')}]`);
        }
        if (this.projectId === 'default') {
            throw new Error("Error: 'default' is not a valid project ID. Please provide a valid Google Cloud Project ID using the --project-id argument.");
        }
        this.isInitialized = true;
        console.log(`[Gemini] Initialization complete. Project ID: ${this.projectId}`);
    }

    async initializeAuth(forceRefresh = false) {
        if (this.authClient.credentials.access_token && !forceRefresh) return;

        if (this.oauthCredsBase64) {
            try {
                const decoded = Buffer.from(this.oauthCredsBase64, 'base64').toString('utf8');
                const credentials = JSON.parse(decoded);
                this.authClient.setCredentials(credentials);
                console.log('[Gemini Auth] Authentication configured successfully from base64 string.');
                return;
            } catch (error) {
                console.error('[Gemini Auth] Failed to parse base64 OAuth credentials:', error);
                throw new Error(`Failed to load OAuth credentials from base64 string.`);
            }
        }

        const credPath = this.oauthCredsFilePath || path.join(os.homedir(), CREDENTIALS_DIR, CREDENTIALS_FILE);
        try {
            const data = await fs.readFile(credPath, "utf8");
            const credentials = JSON.parse(data);
            this.authClient.setCredentials(credentials);
            console.log('[Gemini Auth] Authentication configured successfully from file.');
            if (forceRefresh) {
                console.log('[Gemini Auth] Forcing token refresh...');
                const { credentials: newCredentials } = await this.authClient.refreshAccessToken();
                this.authClient.setCredentials(newCredentials);
                await fs.writeFile(credPath, JSON.stringify(newCredentials, null, 2));
                console.log('[Gemini Auth] Token refresh response: ok');
            }
        } catch (error) {
            console.error('[Gemini Auth] Error initializing authentication:', error.code);
            if (error.code === 'ENOENT' || error.code === 400) {
                console.log(`[Gemini Auth] Credentials file '${credPath}' not found. Starting new authentication flow...`);
                const newTokens = await this.getNewToken(credPath);
                this.authClient.setCredentials(newTokens);
                console.log('[Gemini Auth] New token obtained and loaded into memory.');
            } else {
                console.error('[Gemini Auth] Failed to initialize authentication from file:', error);
                throw new Error(`Failed to load OAuth credentials.`);
            }
        }
    }

    async getNewToken(credPath) {
        let host = this.host;
        if (!host || host === 'undefined') {
            host = '127.0.0.1';
        }
        const redirectUri = `http://${host}:${AUTH_REDIRECT_PORT}`;
        this.authClient.redirectUri = redirectUri;
        return new Promise((resolve, reject) => {
            const authUrl = this.authClient.generateAuthUrl({ access_type: 'offline', scope: ['https://www.googleapis.com/auth/cloud-platform'] });
            console.log('\n[Gemini Auth] Please open this URL in your browser to authenticate:');
            console.log(authUrl, '\n');
            const server = http.createServer(async (req, res) => {
                try {
                    const url = new URL(req.url, redirectUri);
                    const code = url.searchParams.get('code');
                    const errorParam = url.searchParams.get('error');
                    if (code) {
                        console.log(`[Gemini Auth] Received successful callback from Google: ${req.url}`);
                        res.writeHead(200, { 'Content-Type': 'text/plain' });
                        res.end('Authentication successful! You can close this browser tab.');
                        server.close();
                        const { tokens } = await this.authClient.getToken(code);
                        await fs.mkdir(path.dirname(credPath), { recursive: true });
                        await fs.writeFile(credPath, JSON.stringify(tokens, null, 2));
                        console.log('[Gemini Auth] New token received and saved to file.');
                        resolve(tokens);
                    } else if (errorParam) {
                        const errorMessage = `Authentication failed. Google returned an error: ${errorParam}.`;
                        res.writeHead(400, { 'Content-Type': 'text/plain' });
                        res.end(errorMessage);
                        server.close();
                        reject(new Error(errorMessage));
                    } else {
                        console.log(`[Gemini Auth] Ignoring irrelevant request: ${req.url}`);
                        res.writeHead(204);
                        res.end();
                    }
                } catch (e) {
                    if (server.listening) server.close();
                    reject(e);
                }
            });
            server.on('error', (err) => {
                if (err.code === 'EADDRINUSE') {
                    const errorMessage = `[Gemini Auth] Port ${AUTH_REDIRECT_PORT} on ${this.host} is already in use.`;
                    console.error(errorMessage);
                    reject(new Error(errorMessage));
                } else {
                    reject(err);
                }
            });
            server.listen(AUTH_REDIRECT_PORT, this.host);
        });
    }

    async discoverProjectAndModels() {
        if (this.projectId) {
            console.log(`[Gemini] Using pre-configured Project ID: ${this.projectId}`);
            return this.projectId;
        }

        console.log('[Gemini] Discovering Project ID...');
        this.availableModels = GEMINI_MODELS;
        console.log(`[Gemini] Using fixed models: [${this.availableModels.join(', ')}]`);
        try {
            const initialProjectId = "default"
            // Prepare client metadata
            const clientMetadata = {
                ideType: "IDE_UNSPECIFIED",
                platform: "PLATFORM_UNSPECIFIED",
                pluginType: "GEMINI",
                duetProject: initialProjectId,
            }

            const loadResponse = await this.callApi('loadCodeAssist', { metadata: clientMetadata });
            if (loadResponse.cloudaicompanionProject) {
                return loadResponse.cloudaicompanionProject;
            }
            const defaultTier = loadResponse.allowedTiers?.find(tier => tier.isDefault);
            const onboardRequest = { tierId: defaultTier?.id || 'free-tier', metadata: clientMetadata , cloudaicompanionProject: initialProjectId,};
            let lro = await this.callApi('onboardUser', onboardRequest);
            while (!lro.done) {
                await new Promise(resolve => setTimeout(resolve, 2000));
                lro = await this.callApi('onboardUser', onboardRequest);
            }
            return lro.response?.cloudaicompanionProject?.id;
        } catch (error) {
            console.error('[Gemini] Failed to discover Project ID:', error.response?.data || error.message);
            throw new Error('Could not discover a valid Google Cloud Project ID.');
        }
    }

    async listModels() {
        if (!this.isInitialized) await this.initialize();
        const formattedModels = this.availableModels.map(modelId => {
            const displayName = modelId.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
            return {
                name: `models/${modelId}`, version: "1.0.0", displayName: displayName,
                description: `A generative model for text and chat generation. ID: ${modelId}`,
                inputTokenLimit: 32768, outputTokenLimit: 8192,
                supportedGenerationMethods: ["generateContent", "streamGenerateContent"],
            };
        });
        return { models: formattedModels };
    }

    async callApi(method, body, isRetry = false, retryCount = 0) {
        const maxRetries = this.config.REQUEST_MAX_RETRIES;
        const baseDelay = this.config.REQUEST_BASE_DELAY; // 1 second base delay

        try {
            const requestOptions = {
                url: `${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:${method}`,
                method: "POST",
                headers: { "Content-Type": "application/json" },
                responseType: "json",
                body: JSON.stringify(body),
            };
            const res = await this.authClient.request(requestOptions);
            return res.data;
        } catch (error) {
            if ((error.response?.status === 400 || error.response?.status === 401) && !isRetry) {
                console.log('[API] Received 401. Refreshing auth and retrying...');
                await this.initializeAuth(true);
                return this.callApi(method, body, true, retryCount);
            }

            // Handle 429 (Too Many Requests) with exponential backoff
            if (error.response?.status === 429 && retryCount < maxRetries) {
                const delay = baseDelay * Math.pow(2, retryCount);
                console.log(`[API] Received 429 (Too Many Requests). Retrying in ${delay}ms... (attempt ${retryCount + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return this.callApi(method, body, isRetry, retryCount + 1);
            }

            // Handle other retryable errors (5xx server errors)
            if (error.response?.status >= 500 && error.response?.status < 600 && retryCount < maxRetries) {
                const delay = baseDelay * Math.pow(2, retryCount);
                console.log(`[API] Received ${error.response.status} server error. Retrying in ${delay}ms... (attempt ${retryCount + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return this.callApi(method, body, isRetry, retryCount + 1);
            }

            throw error;
        }
    }

    async * streamApi(method, body, isRetry = false, retryCount = 0) {
        const maxRetries = this.config.REQUEST_MAX_RETRIES;
        const baseDelay = this.config.REQUEST_BASE_DELAY; // 1 second base delay

        try {
            const requestOptions = {
                url: `${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:${method}`,
                method: "POST",
                params: { alt: "sse" },
                headers: { "Content-Type": "application/json" },
                responseType: "stream",
                body: JSON.stringify(body),
            };
            const res = await this.authClient.request(requestOptions);
            if (res.status !== 200) {
                let errorBody = '';
                for await (const chunk of res.data) errorBody += chunk.toString();
                throw new Error(`Upstream API Error (Status ${res.status}): ${errorBody}`);
            }
            yield* this.parseSSEStream(res.data);
        } catch (error) {
            if ((error.response?.status === 400 || error.response?.status === 401) && !isRetry) {
                console.log('[API] Received 401 during stream. Refreshing auth and retrying...');
                await this.initializeAuth(true);
                yield* this.streamApi(method, body, true, retryCount);
                return;
            }

            // Handle 429 (Too Many Requests) with exponential backoff
            if (error.response?.status === 429 && retryCount < maxRetries) {
                const delay = baseDelay * Math.pow(2, retryCount);
                console.log(`[API] Received 429 (Too Many Requests) during stream. Retrying in ${delay}ms... (attempt ${retryCount + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                yield* this.streamApi(method, body, isRetry, retryCount + 1);
                return;
            }

            // Handle other retryable errors (5xx server errors)
            if (error.response?.status >= 500 && error.response?.status < 600 && retryCount < maxRetries) {
                const delay = baseDelay * Math.pow(2, retryCount);
                console.log(`[API] Received ${error.response.status} server error during stream. Retrying in ${delay}ms... (attempt ${retryCount + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                yield* this.streamApi(method, body, isRetry, retryCount + 1);
                return;
            }

            throw error;
        }
    }

    async * parseSSEStream(stream) {
        const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
        let buffer = [];
        for await (const line of rl) {
            if (line.startsWith("data: ")) buffer.push(line.slice(6));
            else if (line === "" && buffer.length > 0) {
                try { yield JSON.parse(buffer.join('\n')); } catch (e) { console.error("[Stream] Failed to parse JSON chunk:", buffer.join('\n')); }
                buffer = [];
            }
        }
        if (buffer.length > 0) {
            try { yield JSON.parse(buffer.join('\n')); } catch (e) { console.error("[Stream] Failed to parse final JSON chunk:", buffer.join('\n')); }
        }
    }

    async generateContent(model, requestBody) {
        console.log(`[Auth Token] Time until expiry: ${formatExpiryTime(this.authClient.credentials.expiry_date)}`);
        let selectedModel = model;
        if (!GEMINI_MODELS.includes(model)) {
            console.warn(`[Gemini] Model '${model}' not found. Using default model: '${GEMINI_MODELS[0]}'`);
            selectedModel = GEMINI_MODELS[0];
        }
        const processedRequestBody = ensureRolesInContents(requestBody);
        const apiRequest = { model: selectedModel, project: this.projectId, request: processedRequestBody };
        const response = await this.callApi(API_ACTIONS.GENERATE_CONTENT, apiRequest);
        return toGeminiApiResponse(response.response);
    }

    async * generateContentStream(model, requestBody) {
        console.log(`[Auth Token] Time until expiry: ${formatExpiryTime(this.authClient.credentials.expiry_date)}`);

        // 检查是否为防截断模型
        if (is_anti_truncation_model(model)) {
            // 从防截断模型名中提取实际模型名
            const actualModel = extract_model_from_anti_model(model);
            // 使用防截断流处理
            const processedRequestBody = ensureRolesInContents(requestBody);
            yield* apply_anti_truncation_to_stream(this, actualModel, processedRequestBody);
        } else {
            // 正常流处理
            let selectedModel = model;
            if (!GEMINI_MODELS.includes(model)) {
                console.warn(`[Gemini] Model '${model}' not found. Using default model: '${GEMINI_MODELS[0]}'`);
                selectedModel = GEMINI_MODELS[0];
            }
            const processedRequestBody = ensureRolesInContents(requestBody);
            const apiRequest = { model: selectedModel, project: this.projectId, request: processedRequestBody };
            const stream = this.streamApi(API_ACTIONS.STREAM_GENERATE_CONTENT, apiRequest);
            for await (const chunk of stream) {
                yield toGeminiApiResponse(chunk.response);
            }
        }
    }

     /**
     * Checks if the given expiry date is within the next 10 minutes from now.
     * @returns {boolean} True if the expiry date is within the next 10 minutes, false otherwise.
     */
    isExpiryDateNear() {
        try {
            const currentTime = Date.now();
            const cronNearMinutesInMillis = (this.config.CRON_NEAR_MINUTES || 10) * 60 * 1000;
            console.log(`[Gemini] Expiry date: ${this.authClient.credentials.expiry_date}, Current time: ${currentTime}, ${this.config.CRON_NEAR_MINUTES || 10} minutes from now: ${currentTime + cronNearMinutesInMillis}`);
            return this.authClient.credentials.expiry_date <= (currentTime + cronNearMinutesInMillis);
        } catch (error) {
            console.error(`[Gemini] Error checking expiry date: ${error.message}`);
            return false;
        }
    }
}
