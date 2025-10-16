// ✅ Scrapbook Films Chat Backend (Super-Conservative Mode)
// ---------------------------------------------------------
const express = require('express');
const bodyParser = require('body-parser');
const OpenAI = require('openai');
const axios = require('axios');

const app = express();
app.use(bodyParser.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- CORS ---
const allowedOrigins = ['https://scrapbookfilms.com', 'https://www.scrapbookfilms.com'];
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

// --- Chat History Endpoint ---
app.get('/chat-history', async (req, res) => {
  const { threadId } = req.query;
  if (!threadId) return res.status(400).json({ error: 'threadId is required' });
  try {
    const messages = await openai.beta.threads.messages.list(threadId, { order: 'asc' });
    const history = messages.data
      .filter(msg => msg.content[0]?.type === 'text')
      .map(msg => ({ role: msg.role, content: msg.content[0].text.value }));
    res.json({ history });
  } catch (error) {
    console.error("History Error:", error.message);
    res.status(500).json({ error: "Failed to fetch history." });
  }
});

// --- Helper Function ---
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- Chat Endpoint ---
app.post('/chat', async (req, res) => {
  const { assistantId, threadId, userMessage, currentPage, fullUrl, pageTitle, serviceName } = req.body;
  try {
    let currentThreadId = threadId;
    if (!currentThreadId) {
      const thread = await openai.beta.threads.create();
      currentThreadId = thread.id;
    }

    // Check if any previous run is still active
    let lastRun = null;
    const messagesList = await openai.beta.threads.messages.list(currentThreadId, { order: 'desc' });
    if (messagesList.data.length) {
      const lastMsg = messagesList.data[0];
      if (lastMsg.run_id) lastRun = await openai.beta.threads.runs.retrieve(currentThreadId, lastMsg.run_id);
    }

    if (lastRun && (lastRun.status === 'in_progress' || lastRun.status === 'queued')) {
      // 🟡 Early return to avoid "run is active" 400 errors
      return res.json({
        response: "Sorry — I’m still processing your last message. Please try again in a few seconds.",
        threadId: currentThreadId
      });
    }

    // Add user message
    await openai.beta.threads.messages.create(currentThreadId, {
      role: "user",
      content: [
        {
          type: "text",
          text: `${userMessage}\n[Page: ${currentPage} | URL: ${fullUrl || ''} | Title: ${pageTitle || ''} | ServiceName: ${serviceName || ''}]`
        }
      ]
    });

    // Start assistant run
    const run = await openai.beta.threads.runs.create(currentThreadId, { assistant_id: assistantId });

    // Wait briefly for response, with timeout fail-safe
    const timeoutMs = 8000; // 8 seconds
    const start = Date.now();
    let runStatus = await openai.beta.threads.runs.retrieve(currentThreadId, run.id);

    while ((runStatus.status === 'in_progress' || runStatus.status === 'queued') &&
           Date.now() - start < timeoutMs) {
      await wait(500);
      runStatus = await openai.beta.threads.runs.retrieve(currentThreadId, run.id);
    }

    // Timeout: return gracefully instead of hanging
    if (runStatus.status === 'in_progress' || runStatus.status === 'queued') {
      return res.json({
        response: "Sorry — the assistant is taking a bit longer to respond. Please try again in a moment.",
        threadId: currentThreadId
      });
    }

    // Handle tools if required
    if (runStatus.status === 'requires_action') {
      const toolCalls = runStatus.required_action.submit_tool_outputs.tool_calls || [];
      const toolOutputs = [];
      for (const toolCall of toolCalls) {
        if (toolCall.function.name === 'create_contact') {
          try {
            const args = JSON.parse(toolCall.function.arguments);
            await axios.post(process.env.GETFORM_URL, args, { headers: { 'Accept': 'application/json' } });
            toolOutputs.push({
              tool_call_id: toolCall.id,
              output: JSON.stringify({ status: 'ok', confirmation: 'Message sent successfully.' })
            });
          } catch (err) {
            toolOutputs.push({
              tool_call_id: toolCall.id,
              output: JSON.stringify({ status: 'error', message: 'Failed to send.' })
            });
          }
        }
      }

      if (toolOutputs.length) {
        const toolRun = await openai.beta.threads.runs.submitToolOutputs(currentThreadId, run.id, { tool_outputs: toolOutputs });
        runStatus = await openai.beta.threads.runs.retrieve(currentThreadId, toolRun.id);
        while (runStatus.status === 'in_progress' || runStatus.status === 'queued') {
          await wait(500);
          runStatus = await openai.beta.threads.runs.retrieve(currentThreadId, runStatus.id);
        }
      }
    }

    // Fetch latest messages
    const messages = await openai.beta.threads.messages.list(currentThreadId, { order: 'desc' });
    const assistantResponse = messages.data.find(m => m.run_id === run.id && m.role === 'assistant');
    const responseText = assistantResponse?.content[0]?.text?.value || 
      "Sorry — I couldn’t generate a response right now. Please try again.";

    res.json({ response: responseText, threadId: currentThreadId });
  } catch (error) {
    console.error("Chat Error:", error.message);
    res.status(500).json({
      error: "I'm sorry, there was a problem connecting to the AI. Please try again later."
    });
  }
});

// --- Render Port ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Scrapbook Films Chat Server running on port ${PORT}`));
