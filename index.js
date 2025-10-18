// ✅ Scrapbook Films Chat Backend (Final, Corrected Version)
// index.js
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

// --- Service URL Mapping ---
const serviceUrls = {
  "Mini Memoirs": "https://scrapbookfilms.com/services/mini-memoirs/",
  "Little Hellos": "https://scrapbookfilms.com/services/little-hellos/",
  "Family Legacy Videos": "https://scrapbookfilms.com/services/family-legacy-videos/",
  "The Heirloom Archive": "https://scrapbookfilms.com/services/the-heirloom-archive/",
  "StoryLayers": "https://scrapbookfilms.com/services/storylayers/",
  "Memorial and Celebration of Life Videos": "https://scrapbookfilms.com/services/memorial-and-celebration-of-life-videos/",
  "Heritage Voices": "https://scrapbookfilms.com/services/heritage-voices/",
  "Journey To I Do Films": "https://scrapbookfilms.com/services/journey-to-i-do-films/",
  "Legacy Films for Business": "https://scrapbookfilms.com/services/legacy-films-for-business/",
  "Founder Films": "https://scrapbookfilms.com/services/founder-films/",
  "The Last Word": "https://scrapbookfilms.com/services/the-last-word/"
};

// --- Helper to detect service URLs ---
function getServiceUrl(userMessage) {
  for (const [name, url] of Object.entries(serviceUrls)) {
    if (userMessage.toLowerCase().includes(name.toLowerCase())) {
      return url;
    }
  }
  return null;
}

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
        // **THE DEFINITIVE BUG FIX IS HERE:**
        // Clean the context string from user messages on the server before sending.
        if (msg.role === 'user') {
            content = content.replace(/\n\[Page:.*?\]/sg, '').trim();
        }
        return { role: msg.role, content: content };
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
    // --- Check for service URLs first ---
    const serviceLink = getServiceUrl(userMessage);
    if (serviceLink) {
      res.json({
        response: `You can read more about that service here: ${serviceLink}`,
        threadId: threadId || null
      });
      return;
    }

    // --- Thread management ---
    let currentThreadId = threadId;
    if (!currentThreadId) {
      const thread = await openai.beta.threads.create();
      currentThreadId = thread.id;
    }

    // --- Wait for any active run to finish ---
    let lastRun = null;
    const messagesList = await openai.beta.threads.messages.list(currentThreadId, { order: 'desc' });
    if (messagesList.data.length) {
      const lastMsg = messagesList.data[0];
      if (lastMsg.run_id) lastRun = await openai.beta.threads.runs.retrieve(currentThreadId, lastMsg.run_id);
    }
    while (lastRun && (lastRun.status === 'in_progress' || lastRun.status === 'queued')) {
      await new Promise(resolve => setTimeout(resolve, 500));
      lastRun = await openai.beta.threads.runs.retrieve(currentThreadId, lastRun.id);
    }

    // --- Add user message to thread ---
    await openai.beta.threads.messages.create(currentThreadId, {
      role: "user",
      content: [
        {
          type: "text",
          text: `${userMessage}\n[Page: ${currentPage || ''} | URL: ${fullUrl || ''} | Title: ${pageTitle || ''} | ServiceName: ${serviceName || ''}]`
        }
      ]
    });

    // --- Start assistant run ---
    const run = await openai.beta.threads.runs.create(currentThreadId, { assistant_id: assistantId });
    let runStatus = await openai.beta.threads.runs.retrieve(currentThreadId, run.id);
    while (runStatus.status === 'in_progress' || runStatus.status === 'queued') {
      await new Promise(resolve => setTimeout(resolve, 500));
      runStatus = await openai.beta.threads.runs.retrieve(currentThreadId, run.id);
    }

    // --- Handle tools if required ---
    if (runStatus.status === 'requires_action') {
      const toolCalls = runStatus.required_action?.submit_tool_outputs?.tool_calls || [];
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
          await new Promise(resolve => setTimeout(resolve, 500));
          runStatus = await openai.beta.threads.runs.retrieve(currentThreadId, toolRun.id);
        }
      }
    }

    // --- Get assistant response ---
    const messagesAfter = await openai.beta.threads.messages.list(currentThreadId, { order: 'desc' });
    const assistantResponse = messagesAfter.data.find(m => m.run_id === run.id && m.role === 'assistant');
    const responseText = assistantResponse?.content?.[0]?.text?.value || "Sorry, no response generated.";

    res.json({ response: responseText, threadId: currentThreadId });
  } catch (error) {
    console.error("Chat Error:", error.message);
    res.status(500).json({ error: "I'm sorry, there was a problem connecting to the AI. Please try again later." });
  }
});

// --- Start server ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
