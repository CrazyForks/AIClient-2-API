import { ProviderStrategy } from '../provider-strategy.js';
import { extractSystemPromptFromRequestBody, MODEL_PROTOCOL_PREFIX } from '../common.js';

/**
 * Droid (Factory.ai) provider strategy implementation
 * Follows Claude protocol since Droid uses Claude API
 */
class DroidStrategy extends ProviderStrategy {
    extractModelAndStreamInfo(req, requestBody) {
        const model = requestBody.model || 'claude-sonnet-4-5-20250929';
        const isStream = requestBody.stream === true;
        return { model, isStream };
    }

    extractResponseText(response) {
        if (response.type === 'content_block_delta' && response.delta) {
            if (response.delta.type === 'text_delta') {
                return response.delta.text;
            }
            if (response.delta.type === 'input_json_delta') {
                return response.delta.partial_json;
            }
        }
        if (response.content && Array.isArray(response.content)) {
            return response.content
                .filter(block => block.type === 'text' && block.text)
                .map(block => block.text)
                .join('');
        } else if (response.content && response.content.type === 'text') {
            return response.content.text;
        }
        return '';
    }

    extractPromptText(requestBody) {
        if (requestBody.messages && requestBody.messages.length > 0) {
            const lastMessage = requestBody.messages[requestBody.messages.length - 1];
            if (lastMessage.content && Array.isArray(lastMessage.content)) {
                return lastMessage.content.map(block => block.text || '').join('');
            }
            return lastMessage.content || '';
        }
        return '';
    }

    async applySystemPromptFromFile(config, requestBody) {
        if (!config.SYSTEM_PROMPT_FILE_PATH) {
            return requestBody;
        }

        const filePromptContent = config.SYSTEM_PROMPT_CONTENT;
        if (filePromptContent === null) {
            return requestBody;
        }

        const existingSystemText = extractSystemPromptFromRequestBody(requestBody, MODEL_PROTOCOL_PREFIX.CLAUDE);

        const newSystemText = config.SYSTEM_PROMPT_MODE === 'append' && existingSystemText
            ? `${existingSystemText}\n${filePromptContent}`
            : filePromptContent;

        requestBody.system = newSystemText;
        console.log(`[System Prompt] Applied system prompt from ${config.SYSTEM_PROMPT_FILE_PATH} in '${config.SYSTEM_PROMPT_MODE}' mode for provider 'droid'.`);

        return requestBody;
    }

    async manageSystemPrompt(requestBody) {
        const incomingSystemText = extractSystemPromptFromRequestBody(requestBody, MODEL_PROTOCOL_PREFIX.CLAUDE);
        await this._updateSystemPromptFile(incomingSystemText, 'droid');
    }
}

export { DroidStrategy };
