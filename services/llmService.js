const OpenAI = require('openai');

const client = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.LLM_API_KEY,
});

const CHEAP_MODEL = 'claude-3-5-haiku-20241022';
const BEST_MODEL = 'claude-3-5-sonnet-20240620';

/**
 * Gets feedback from the LLM using the provided prompt
 * @param {string} prompt - The fully formatted prompt to send
 * @param {TokenUsage} [tokenUsage] - Optional TokenUsage tracker to update with usage data
 * @returns {Object} - Parsed JSON response with comments, hint, and proceed field
 */
exports.getLlmFeedback = async (prompt, tokenUsage) => {
  try {
    console.log('--------');
    console.log('Prompt:', prompt);
    console.log('--------');

    const response = await client.chat.completions.create({
      model: "deepseek/deepseek-chat-v3-0324:free",
      max_tokens: 1000,
      messages: [
        { role: 'user', content: prompt }
      ]
    });

    console.log('--------');
    console.log(response.choices[0].message.content);
    console.log('--------');

    // Track token usage if a tracker was provided
    if (tokenUsage) {
      tokenUsage.addUsage(
        response.usage.prompt_tokens, 
        response.usage.completion_tokens
      );
      console.log(`Token usage: ${response.usage.prompt_tokens} input, ${response.usage.completion_tokens} output`);
      console.log(`Estimated cost so far: ${tokenUsage.getFormattedCost()}`);
    }

    // Parse the JSON response (removing first and last line)
    let content = response.choices[0].message.content;
    //FIX: deepthink does not obey to no block codes directive :-(
    if (content.startsWith('```json'))
       content = content.split('\n').slice(1, -1).join('\n');
    const feedback = JSON.parse(content);

    // Ensure required fields exist
    return {
      comments: feedback.comments || 'No comments provided',
      hint: feedback.hint || 'No hint available',
      proceed: feedback.proceed || 'no'
    };
  } catch (error) {
    console.error('Error in LLM service:', error);
    throw new Error('Failed to get LLM feedback');
  }
};
