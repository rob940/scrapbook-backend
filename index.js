// ✅ Scrapbook Films Chat Backend (Final, Robust Version)
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
        if (msg.role === 'user') { content = content.replace(/\n\[Page:.*?\]/sg, '').trim(); }
        return { role: msg.role, content: content };
    });
    res.json({ history });
  } catch (error) { console.error("History Error:", error.message); res.status(500).json({ error: "Failed to fetch history." }); }
});

app.post('/chat', async (req, res) => {
  const { assistantId, threadId, userMessage, currentPage, fullUrl } = req.body;
  try {
    let currentThreadId = threadId;
    if (!currentThreadId) {
      const thread = await openai.beta.threads.create();
      currentThreadId = thread.id;
    }

    // Check for active runs on the thread and wait for them to complete
    const runs = await openai.beta.threads.runs.list(currentThreadId, { limit: 1 });
    if (runs.data.length > 0) {
        let existingRun = runs.data[0];
        while (existingRun.status === 'in_progress' || existingRun.status === 'queued') {
            await new Promise(resolve => setTimeout(resolve, 500));
            existingRun = await openai.beta.threads.runs.retrieve(currentThreadId, existingRun.id);
        }
    }

    const contextualMessage = `${userMessage}\n[CONTEXT: On page ${currentPage || ''}]`;
    await openai.beta.threads.messages.create(currentThreadId, { role: "user", content: contextualMessage });

    const run = await openai.beta.threads.runs.create(currentThreadId, { assistant_id: assistantId });
    let runStatus = await openai.beta.threads.runs.retrieve(currentThreadId, run.id);

    while (runStatus.status === 'in_progress' || runStatus.status === 'queued' || runStatus.status === 'requires_action') {
        if (runStatus.status === 'requires_action') {
            const toolCalls = runStatus.required_action?.submit_tool_outputs?.tool_calls || [];
            const toolOutputs = [];
            for (const toolCall of toolCalls) {
                if (toolCall.function.name === 'create_contact') {
                    try {
                        const args = JSON.parse(toolCall.function.arguments);
                        await axios.post(process.env.GETFORM_URL, args, { headers: { 'Accept': 'application/json' } });
                        toolOutputs.push({ tool_call_id: toolCall.id, output: JSON.stringify({ status: 'ok', confirmation: 'Message sent successfully.' }) });
                    } catch (err) { toolOutputs.push({ tool_call_id: toolCall.id, output: JSON.stringify({ status: 'error', message: 'Failed to send.' }) }); }
                }
            }
            if (toolOutputs.length > 0) {
                await openai.beta.threads.runs.submitToolOutputs(currentThreadId, run.id, { tool_outputs: toolOutputs });
            }
        }
        await new Promise(resolve => setTimeout(resolve, 500));
        runStatus = await openai.beta.threads.runs.retrieve(currentThreadId, run.id);
    }

    const messagesAfter = await openai.beta.threads.messages.list(currentThreadId, { order: 'desc' });
    const assistantResponse = messagesAfter.data.find(m => m.run_id === run.id && m.role === 'assistant');
    const responseText = assistantResponse?.content?.[0]?.text?.value || "I'm sorry, I couldn't formulate a response. Could you try rephrasing?";
    res.json({ response: responseText, threadId: currentThreadId });
  } catch (error) { console.error("Chat Error:", error.message); res.status(500).json({ error: "I'm sorry, there was a problem connecting to the AI. Please try again later." }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
