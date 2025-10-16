const express = require('express');
const bodyParser = require('body-parser');
const OpenAI = require('openai');
const axios = require('axios');

const app = express();
app.use(bodyParser.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Allow only your website domains
const allowedOrigins = ['https://scrapbookfilms.com', 'https://www.scrapbookfilms.com'];
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

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

// --- CHAT ENDPOINT ---
app.post('/chat', async (req, res) => {
  const { assistantId, threadId, userMessage, currentPage, currentDate } = req.body;

  if (!assistantId || !userMessage) {
    return res.status(400).json({ error: "assistantId and userMessage are required." });
  }

  try {
    let currentThreadId = threadId;

    // Create a new thread if none exists
    if (!currentThreadId) {
      const thread = await openai.beta.threads.create();
      currentThreadId = thread.id;
    }

    // Send system message to enforce Scrapbook Films context
    await openai.beta.threads.messages.create(currentThreadId, {
      role: "system",
      content: `You are the Scrapbook Films Concierge, a warm and consultative story guide. 
      NEVER answer questions unrelated to Scrapbook Films services. 
      If the user asks about recipes, sports, tech, or anything off-topic, respond:
      "I'm here to help with Scrapbook Films and capturing memories. Could you tell me more about the story you'd like to preserve?" 
      Always reference the current page if provided: ${currentPage || 'unknown'}.`
    });

    // Send the user's message with page and date context
    await openai.beta.threads.messages.create(currentThreadId, {
      role: "user",
      content: `Page: ${currentPage || 'unknown'}
Date: ${currentDate || new Date().toISOString().split('T')[0]}
Message: ${userMessage}`
    });

    // Run the assistant
    const run = await openai.beta.threads.runs.create(currentThreadId, { assistant_id: assistantId });

    let runStatus = await openai.beta.threads.runs.retrieve(currentThreadId, run.id);
    while (runStatus.status === 'in_progress' || runStatus.status === 'queued') {
      await new Promise(resolve => setTimeout(resolve, 500));
      runStatus = await openai.beta.threads.runs.retrieve(currentThreadId, run.id);
    }

    // Handle tool calls (create_contact)
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
                } catch (error) {
                    console.error("Tool Error:", error.message);
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

    // Get assistant's final message
    const messages = await openai.beta.threads.messages.list(currentThreadId, { order: 'desc' });
    const assistantResponse = messages.data.find(m => m.run_id === run.id && m.role === 'assistant');
    const responseText = assistantResponse?.content[0]?.text?.value || "Sorry, I couldn't generate a response.";

    res.json({ response: responseText, threadId: currentThreadId });

  } catch (error) {
    console.error("Chat Error:", error.message);
    res.status(500).json({ error: "Sorry, there was a problem with the AI." });
  }
});

app.listen(3000, () => console.log('Server is running on port 3000'));
