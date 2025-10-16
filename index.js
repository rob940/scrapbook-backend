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

// --- Chat history endpoint ---
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

// --- Helper: keyword to service mapping ---
const keywordMapping = [
    { keywords: ['birthday', 'anniversary', 'retirement', 'group gift'], services: ['Little Hellos'] },
    { keywords: ['my dad’s story', 'preserve my mom’s memories', 'capture a life story', 'interview for one person'], services: ['Mini Memoirs', 'Family Legacy'] },
    { keywords: ['wedding', 'getting married'], services: ['Journey To I Do Films'] },
    { keywords: ['my business', 'our company', 'founder'], services: ['Founder Films', 'Legacy Films for Business'] },
    { keywords: ['company history', 'organization'], services: ['Legacy Films for Business'] },
    { keywords: ['community', 'heritage'], services: ['Heritage Voices'] },
    { keywords: ['eulogy', 'memorial'], services: ['Memorial & Celebration of Life Videos', 'The Last Word'] }
];

function analyzeKeywords(userMessage) {
    const lower = userMessage.toLowerCase();
    let matchedServices = [];
    keywordMapping.forEach(mapping => {
        if (mapping.keywords.some(k => lower.includes(k.toLowerCase()))) {
            matchedServices = [...new Set([...matchedServices, ...mapping.services])];
        }
    });
    return matchedServices;
}

// --- Chat endpoint ---
app.post('/chat', async (req, res) => {
  const { assistantId, threadId, userMessage } = req.body;
  if (!userMessage || !assistantId) return res.status(400).json({ error: "Missing assistantId or userMessage." });
  
  try {
    let currentThreadId = threadId;

    if (!currentThreadId) {
      const thread = await openai.beta.threads.create();
      currentThreadId = thread.id;
    }

    // Add the user's message
    await openai.beta.threads.messages.create(currentThreadId, { role: "user", content: userMessage });

    // Check for keyword-based multi-service suggestions
    const matchedServices = analyzeKeywords(userMessage);

    let servicePrompt = '';
    if (matchedServices.length > 1) {
      servicePrompt = `Multiple Scrapbook Films services could match this story: ${matchedServices.join(' or ')}. Please provide a warm, cinematic explanation of each option and ask the user which they would like to explore.`;
    }

    // Run assistant
    const run = await openai.beta.threads.runs.create(currentThreadId, { 
        assistant_id: assistantId,
        ...(servicePrompt && { instructions: servicePrompt })
    });

    // Poll for run completion
    let runStatus = await openai.beta.threads.runs.retrieve(currentThreadId, run.id);
    while (runStatus.status === 'in_progress' || runStatus.status === 'queued') {
      await new Promise(resolve => setTimeout(resolve, 500));
      runStatus = await openai.beta.threads.runs.retrieve(currentThreadId, run.id);
    }

    // Handle required actions (tool calls)
    if (runStatus.status === 'requires_action') {
        const toolCalls = runStatus.required_action.submit_tool_outputs.tool_calls || [];
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
        if (toolOutputs.length > 0) {
          const toolRun = await openai.beta.threads.runs.submitToolOutputs(currentThreadId, run.id, { tool_outputs: toolOutputs });
          runStatus = await openai.beta.threads.runs.retrieve(currentThreadId, toolRun.id);
          while (runStatus.status === 'in_progress' || runStatus.status === 'queued') {
            await new Promise(resolve => setTimeout(resolve, 500));
            runStatus = await openai.beta.threads.runs.retrieve(currentThreadId, toolRun.id);
          }
        }
    }

    // Get assistant's final response
    const messages = await openai.beta.threads.messages.list(currentThreadId, { order: 'desc' });
    const assistantResponse = messages.data.find(m => m.run_id === run.id && m.role === 'assistant');
    const responseText = assistantResponse ? assistantResponse.content[0].text.value : "I'm sorry, there was a problem connecting to the AI. Please try again later.";

    res.json({ response: responseText, threadId: currentThreadId });

  } catch (error) {
    console.error("Chat Error:", error.message, error.response?.data || '');
    res.status(500).json({ error: "Sorry, there was a problem with the AI." });
  }
});

app.listen(3000, () => console.log('Scrapbook Films Concierge server running on port 3000'));
