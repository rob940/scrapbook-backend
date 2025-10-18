// ✅ Scrapbook Films Chat Backend (Final, Corrected Version)
const express = require('express');
const bodyParser = require('body-parser');
const OpenAI = require('openai');
const axios = require('axios'); // Axios is now required for the tool call

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
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-with, Content-Type, Accept');
  next();
});

// --- Chat History Endpoint ---
app.get('/chat-history', async (req, res) => {
  const { threadId } = req.query;
  if (!threadId) return res.status(400).json({ error: 'threadId is required' });

  try {
    const messages = await openai.beta.threads.messages.list(threadId, { order: 'asc' });
    const history = messages.data
      .filter(msg => msg.content?.[0]?.type === 'text')
      .map(msg => {
        let content = msg.content[0]?.text?.value || '';
        if (msg.role === 'user') {
          content = content.replace(/\n\[Page:.*?\]/sg, '').trim();
        }
        return { role: msg.role, content };
      });
    res.json({ history });
  } catch (error) {
    console.error("History Error:", error.message);
    res.status(500).json({ error: "Failed to fetch history." });
  }
});

// --- Chat Endpoint ---
app.post('/chat', async (req, res) => {
  const { assistantId, threadId, userMessage, currentPage, fullUrl, pageTitle, serviceName } = req.body;

  try {
    /*
    // --- BUG FIX #2 (RECOMMENDED): "Super-Conservative Mode" is disabled by default. ---
    // This entire block is commented out to fix the "lost dialogue" persistence bug.
    // All conversation logic will now go through the AI, ensuring a complete chat history.
    const serviceUrls = { "Mini Memoirs": "https://scrapbookfilms.com/services/mini-memoirs/", ... };
    function getServiceUrl(userMessage) { ... }
    const serviceLink = getServiceUrl(userMessage);
    if (serviceLink) {
      return res.json({ response: `You can read more about that service here: ${serviceLink}`, threadId });
    }
    */

    // --- Thread management ---
    let currentThreadId = threadId;
    if (!currentThreadId) {
      const thread = await openai.beta.threads.create();
      currentThreadId = thread.id;
    }

    // --- Wait for any active run to finish ---
    const existingRuns = await openai.beta.threads.runs.list(currentThreadId, { limit: 1 });
    if (existingRuns.data.length > 0) {
      let lastRun = existingRuns.data[0];
      while (lastRun.status === 'in_progress' || lastRun.status === 'queued') {
        await new Promise(resolve => setTimeout(resolve, 500));
        lastRun = await openai.beta.threads.runs.retrieve(currentThreadId, lastRun.id);
      }
    }

    // --- Add user message to thread ---
    await openai.beta.threads.messages.create(currentThreadId, {
      role: "user",
      content: `${userMessage}\n[Page: ${currentPage || ''} | URL: ${fullUrl || ''} | Title: ${pageTitle || ''} | ServiceName: ${serviceName || ''}]`
    });

    // --- Start assistant run ---
    let run = await openai.beta.threads.runs.create(currentThreadId, { assistant_id: assistantId });

    // --- Poll run until it is no longer in a transient state ---
    while (run.status === 'in_progress' || run.status === 'queued' || run.status === 'requires_action') {
      if (run.status === 'requires_action') {
        // ** BUG FIX #1: Added complete tool handling for lead capture **
        const toolCalls = run.required_action?.submit_tool_outputs?.tool_calls || [];
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
        if (toolOutputs.length > 0) {
          await openai.beta.threads.runs.submitToolOutputs(currentThreadId, run.id, { tool_outputs: toolOutputs });
        }
      }
      await new Promise(resolve => setTimeout(resolve, 500)); // poll delay
      run = await openai.beta.threads.runs.retrieve(currentThreadId, run.id);
    }

    // --- Get assistant response ---
    if (run.status === 'completed') {
      const messagesAfter = await openai.beta.threads.messages.list(currentThreadId, { order: 'desc' });
      const assistantResponse = messagesAfter.data.find(m => m.run_id === run.id && m.role === 'assistant');
      const responseText = assistantResponse?.content?.[0]?.text?.value || "I'm sorry, I couldn't formulate a response.";
      return res.json({ response: responseText, threadId: currentThreadId });
    } else {
      throw new Error(`Run ended with unhandled status: ${run.status}`);
    }
  } catch (error) {
    console.error("Chat Error:", error);
    return res.status(500).json({ error: "I'm sorry, there was a problem connecting to the AI. Please try again later." });
  }
});

// --- START SERVER ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
