// ✅ Scrapbook Films Chat Backend (Final, Bulletproof Version)
const express = require('express');
const bodyParser = require('body-parser');
const OpenAI = require('openai');
const axios = require('axios');

const app = express();
app.use(bodyParser.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const allowedOrigins = ['https://scrapbookfilms.com', 'https://www.scrapbookfilms.com'];
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) { res.setHeader('Access-Control-Allow-Origin', origin); }
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

app.get('/chat-history', async (req, res) => {
    const { threadId } = req.query;
    if (!threadId) return res.status(400).json({ error: 'threadId is required' });
    try {
        const messages = await openai.beta.threads.messages.list(threadId, { order: 'asc' });
        const history = messages.data.filter(msg => msg.content?.[0]?.type === 'text').map(msg => {
            let content = msg.content[0]?.text?.value || '';
            if (msg.role === 'user') { content = content.replace(/\n\[CONTEXT:.*?\]/sg, '').trim(); }
            return { role: msg.role, content: content };
        });
        res.json({ history });
    } catch (error) { console.error("History Error:", error.message); res.status(500).json({ error: "Failed to fetch history." }); }
});

app.post('/chat', async (req, res) => {
    const { assistantId, threadId, userMessage, currentPage } = req.body;
    try {
        let currentThreadId = threadId;
        if (!currentThreadId) {
            const thread = await openai.beta.threads.create();
            currentThreadId = thread.id;
        }

        const contextualMessage = `${userMessage}\n[CONTEXT: On page ${currentPage || ''}]`;
        await openai.beta.threads.messages.create(currentThreadId, { role: "user", content: contextualMessage });

        let run = await openai.beta.threads.runs.create(currentThreadId, { assistant_id: assistantId });

        const startTime = Date.now();
        const timeout = 30000; // 30 second timeout

        while (Date.now() - startTime < timeout) {
            if (['completed', 'failed', 'cancelled', 'expired'].includes(run.status)) {
                break;
            }
            if (run.status === 'requires_action') {
                const toolCalls = run.required_action?.submit_tool_outputs?.tool_calls || [];
                const toolOutputs = [];
                for (const toolCall of toolCalls) {
                    if (toolCall.function.name === 'create_contact') {
                        try {
                            const args = JSON.parse(toolCall.function.arguments);
                            await axios.post(process.env.GETFORM_URL, args, { headers: { 'Accept': 'application/json' } });
                            toolOutputs.push({ tool_call_id: toolCall.id, output: JSON.stringify({ status: 'ok' }) });
                        } catch (err) { toolOutputs.push({ tool_call_id: toolCall.id, output: JSON.stringify({ status: 'error' }) }); }
                    }
                }
                if (toolOutputs.length > 0) {
                    await openai.beta.threads.runs.submitToolOutputs(currentThreadId, run.id, { tool_outputs: toolOutputs });
                }
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
            run = await openai.beta.threads.runs.retrieve(currentThreadId, run.id);
        }

        if (run.status === 'completed') {
            const messagesAfter = await openai.beta.threads.messages.list(currentThreadId, { order: 'desc' });
            const assistantResponse = messagesAfter.data.find(m => m.run_id === run.id && m.role === 'assistant');
            const responseText = assistantResponse?.content?.[0]?.text?.value || "I'm sorry, I couldn't formulate a response.";
            return res.json({ response: responseText, threadId: currentThreadId });
        } else {
            await openai.beta.threads.runs.cancel(currentThreadId, run.id);
            throw new Error(`Run timed out or ended with status: ${run.status}`);
        }
    } catch (error) {
        console.error("Chat Error:", error.message);
        return res.status(500).json({ error: "I'm sorry, I'm having trouble connecting right now. Please try again in a moment." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
