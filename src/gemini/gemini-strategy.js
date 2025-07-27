import { API_ACTIONS } from '../common.js';
import { ProviderStrategy } from '../provider-strategy.js';

/**
 * Gemini provider strategy implementation.
 */
class GeminiStrategy extends ProviderStrategy {
    extractModelAndStreamInfo(req, requestBody) {
        const requestUrl = new URL(req.url, `http://${req.headers.host}`);
        const urlPattern = new RegExp(`/v1beta/models/(.+?):(${API_ACTIONS.GENERATE_CONTENT}|${API_ACTIONS.STREAM_GENERATE_CONTENT})`);
        const urlMatch = requestUrl.pathname.match(urlPattern);
        const [, urlmodel, action] = urlMatch;
        const model = urlmodel;
        const isStream = action === API_ACTIONS.STREAM_GENERATE_CONTENT;
        return { model, isStream };
    }

    extractResponseText(response) {
        if (response.candidates && response.candidates.length > 0) {
            const candidate = response.candidates[0];
            if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
                return candidate.content.parts.map(part => part.text).join('');
            }
        }
        return '';
    }

    extractPromptText(requestBody) {
        if (requestBody.contents && requestBody.contents.length > 0) {
            const lastContent = requestBody.contents[requestBody.contents.length - 1];
            if (lastContent.parts && lastContent.parts.length > 0) {
                return lastContent.parts.map(part => part.text).join('');
            }
        }
        return '';
    }

    async applySystemPromptFromFile(config, requestBody) {
        console.log(`[System Prompt] Applying system prompt from ${config.SYSTEM_PROMPT_FILE_PATH} in '${config.SYSTEM_PROMPT_MODE}' mode for provider 'gemini'.`);
        if (!config.SYSTEM_PROMPT_FILE_PATH) {
            return requestBody;
        }

        const filePromptContent = config.SYSTEM_PROMPT_CONTENT;
        if (filePromptContent === null) {
            return requestBody;
        }

        let existingSystemText = '';
        const currentSystemInstruction = requestBody.system_instruction || requestBody.systemInstruction;
        if (currentSystemInstruction?.parts) {
            existingSystemText = currentSystemInstruction.parts
                .filter(p => p?.text)
                .map(p => p.text)
                .join('\n');
        }

        const newSystemText = config.SYSTEM_PROMPT_MODE === 'append' && existingSystemText
            ? `${existingSystemText}\n${filePromptContent}`
            : filePromptContent;

        requestBody.systemInstruction = { parts: [{ text: newSystemText }] };
        if (requestBody.system_instruction) {
            delete requestBody.system_instruction;
        }
        console.log(`[System Prompt] Applied system prompt from ${config.SYSTEM_PROMPT_FILE_PATH} in '${config.SYSTEM_PROMPT_MODE}' mode for provider 'gemini'.`);

        return requestBody;
    }

    async manageSystemPrompt(requestBody) {
        let incomingSystemText = '';
        const geminiSystemInstruction = requestBody.system_instruction || requestBody.systemInstruction;
        if (geminiSystemInstruction?.parts) {
            incomingSystemText = geminiSystemInstruction.parts
                .filter(p => p?.text)
                .map(p => p.text)
                .join('\n');
        }
        await this._updateSystemPromptFile(incomingSystemText, 'gemini');
    }
}

export { GeminiStrategy };
