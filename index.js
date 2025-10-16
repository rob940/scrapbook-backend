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
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

// --- SERVICE KEYWORDS ---
const SERVICE_KEYWORDS = [
  { keywords: ['birthday', 'anniversary', 'retirement', 'group gift'], services: ['Little Hellos'] },
  { keywords: ["my dad's story", 'preserve my mom’s memories', 'capture a life story', 'interview for one person'], services: ['Mini Memoirs'] },
  { keywords: ['wedding', 'getting married'], services: ['Journey To I Do Films'] },
  { keywords: ['my business', 'our company', 'founder'], services: ['Founder Films', 'Legacy Films for Business'] },
  { keywords: ['company history', 'organization'], services: ['Legacy Films for Business'] },
  { keywords: ['community', 'heritage'], services: ['Heritage Voices'] },
  { keywords: ['eulogy', 'memorial'], services: ['Memorial & Celebration of Life Videos', 'The Last Word'] },
];

// --- HELPER FUNCTIONS ---
function getMatchingServices(userMessage) {
  const messageLower = userMessage.toLowerCase();
  let matchedServices = [];

  for (const mapping of SERVICE_KEYWORDS) {
    if (mapping.keywords.some(keyword => messageLower.includes(keyword))) {
      matchedServices = [...matchedServices, ...mapping.services];
    }
  }

  return [...new Set(matchedServices)];
}

// --- CHAT HISTORY ---
app.get('/chat-history', async (req, res) => {
  const { threadId } = req.query;
  if (!threadId) return res.status(400).json({ error: 'threadId is required' });
  try {
    const messages = await openai.beta.threads.messages.list(threadId, { order: 'asc' });
    const history = messages.data
      .filter(msg => msg.content[0]?.type === 'text')
      .map(msg => ({
        role: msg.role,
        content: msg.content[0].text.value
      }));
    res.json({ history });
  } catch (error) {
    console.error("History Error:", error.message);
    res.status(500).json({ error: "Failed to fetch history." });
  }
});

// --- CHAT HANDLER ---
app.post('/chat', async (req, res) => {
  const { assistantId, threadId, userMessage } = req.body;

  try {
    let currentThreadId = threadId;
    if (!currentThreadId) {
      const thread = await openai.beta.threads.create();
      currentThreadId = thread.id;
    }

    // --- MULTI-SERVICE RECOMMENDATION ---
    const matchedServices = getMatchingServices(userMessage);
    let augmentedMessage = userMessage;
    if (matchedServices.length > 1) {
      augmentedMessage += `\n\nThe user is asking about this story. Suggest all relevant Scrapbook Films services among: ${matchedServices.join(', ')}. Ask which option they prefer.`;
    }

    // --- ADD USER MESSAGE ---
    await openai.beta.threads.messages.create(currentThreadId, { role: "user", content: augmentedMessage });

    // --- CREATE RUN ---
    const run = await openai.beta.threads.runs.create(currentThreadId, { assistant_id: assistantId });
    let runStatus = await openai.beta.threads.runs.retrieve(currentThreadId, run.id);

    while (runStatus.status === 'in_progress' || runStatus.status === 'queued') {
      await new Promise(resolve => setTimeout(resolve, 500));
      runStatus = await openai.beta.threads.runs.retrieve(currentThreadId, run.id);
    }

    // --- HANDLE TOOL CALLS ---
    if (runStatus.status === 'requires_action') {
      const toolCalls = runStatus.required_action.submit_tool_outputs.tool_calls;
      const toolOutputs = [];

      for (const toolCall of toolCalls) {
        if (toolCall.function.name === 'create_contact') {
          try {
            const args = JSON.parse(toolCall.function.arguments);
            await axios.post(process.env.GETFORM_URL, args, { headers: { 'Accept': 'application/json' } });
            toolOutputs.push({ tool_call_id: toolCall.id, output: JSON.stringify({ status: 'ok', confirmation: 'Message sent successfully.' }) });
          } catch (error) {
            toolOutputs.push({ tool_call_id: toolCall.id, output: JSON.stringify({ status: 'error', message: 'Failed to send.' }) });
          }
        }
      }

      const toolRun = await openai.beta.threads.runs.submitToolOutputs(currentThreadId, run.id, { tool_outputs: toolOutputs });
      runStatus = await openai.beta.threads.runs.retrieve(currentThreadId, toolRun.id);

      while (runStatus.status === 'in_progress' || runStatus.status === 'queued') {
        await new Promise(resolve => setTimeout(resolve, 500));
        runStatus = await openai.beta.threads.runs.retrieve(currentThreadId, toolRun.id);
      }
    }

    // --- FETCH ASSISTANT RESPONSE ---
    const messages = await openai.beta.threads.messages.list(currentThreadId, { order: 'desc' });
    const assistantResponse = messages.data.find(m => m.run_id === run.id && m.role === 'assistant');
    const responseText = assistantResponse.content[0].text.value;

    res.json({ response: responseText, threadId: currentThreadId });

  } catch (error) {
    console.error("Chat Error:", error.message);
    res.status(500).json({ error: "Sorry, there was a problem with the AI." });
  }
});

// --- START SERVER ---
app.listen(3000, () => console.log('Server is running on port 3000'));
