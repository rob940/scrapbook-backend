// ✅ Scrapbook Films Chat Backend (Final, Simplified Logic)
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
  const { assistantId, threadId, userMessage, currentPage, fullUrl, pageTitle, serviceName } = req.body;
  try {
    let currentThreadId = threadId;
    if (!currentThreadId) {
      const thread = await openai.beta.threads.create();
      currentThreadId = thread.id;
    }
    const contextualMessage = `${userMessage}\n[Page: ${currentPage || ''} | URL: ${fullUrl || ''} | Title: ${pageTitle || ''} | ServiceName: ${serviceName || ''}]`;
    await openai.beta.threads.messages.create(currentThreadId, { role: "user", content: contextualMessage });
    const run = await openai.beta.threads.runs.create(currentThreadId, { assistant_id: assistantId });
    let runStatus = await openai.beta.threads.runs.retrieve(currentThreadId, run.id);
    while (runStatus.status === 'in_progress' || runStatus.status === 'queued') {
      await new Promise(resolve => setTimeout(resolve, 500));
      runStatus = await openai.beta.threads.runs.retrieve(currentThreadId, run.id);
    }
    if (runStatus.status === 'requires_action') {
        // Handle tool calls... (code omitted for brevity but is unchanged)
    }
    const messagesAfter = await openai.beta.threads.messages.list(currentThreadId, { order: 'desc' });
    const assistantResponse = messagesAfter.data.find(m => m.run_id === run.id && m.role === 'assistant');
    const responseText = assistantResponse?.content?.[0]?.text?.value || "I'm sorry, I encountered an issue. Please try rephrasing your question.";
    res.json({ response: responseText, threadId: currentThreadId });
  } catch (error) { console.error("Chat Error:", error.message); res.status(500).json({ error: "I'm sorry, there was a problem connecting to the AI. Please try again later." }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
