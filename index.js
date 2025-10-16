const express = require('express');
const bodyParser = require('body-parser');
const OpenAI = require('openai');

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

// NEW ENDPOINT to get chat history
app.get('/chat-history', async (req, res) => {
    const { threadId } = req.query;
    if (!threadId) {
        return res.status(400).json({ error: 'threadId is required' });
    }
    try {
        const messages = await openai.beta.threads.messages.list(threadId, { order: 'asc' });
        const history = messages.data.map(msg => ({
            role: msg.role,
            content: msg.content[0].text.value
        }));
        res.json({ history });
    } catch (error) {
        console.error("History Error:", error);
        res.status(500).json({ error: "Failed to fetch history." });
    }
});

app.post('/chat', async (req, res) => {
  const { assistantId, threadId, userMessage } = req.body;
  try {
    let currentThreadId = threadId;
    if (!currentThreadId) {
      const thread = await openai.beta.threads.create();
      currentThreadId = thread.id;
    }
    await openai.beta.threads.messages.create(currentThreadId, { role: "user", content: userMessage });
    const run = await openai.beta.threads.runs.create(currentThreadId, { assistant_id: assistantId });
    let runStatus;
    do {
      await new Promise(resolve => setTimeout(resolve, 1000));
      runStatus = await openai.beta.threads.runs.retrieve(currentThreadId, run.id);
    } while (runStatus.status === 'in_progress' || runStatus.status === 'queued');

    if (runStatus.status === 'requires_action') {
        const toolCalls = runStatus.required_action.submit_tool_outputs.tool_calls;
        const toolOutputs = [];
        const axios = require('axios'); // Ensure axios is required here
        for (const toolCall of toolCalls) {
            if (toolCall.function.name === 'create_contact') {
                try {
                    const args = JSON.parse(toolCall.function.arguments);
                    await axios.post(process.env.GETFORM_URL, args, { headers: { 'Accept': 'application/json' } });
                    toolOutputs.push({ tool_call_id: toolCall.id, output: JSON.stringify({ status: 'ok' }) });
                } catch (error) {
                    toolOutputs.push({ tool_call_id: toolCall.id, output: JSON.stringify({ status: 'error' }) });
                }
            }
        }
        await openai.beta.threads.runs.submitToolOutputs(currentThreadId, run.id, { tool_outputs: toolOutputs });
        do {
          await new Promise(resolve => setTimeout(resolve, 1000));
          runStatus = await openai.beta.threads.runs.retrieve(currentThreadId, run.id);
        } while (runStatus.status === 'in_progress' || runStatus.status === 'queued');
    }

    const messages = await openai.beta.threads.messages.list(currentThreadId);
    const assistantResponse = messages.data.find(m => m.run_id === run.id && m.role === 'assistant');
    const responseText = assistantResponse.content[0].text.value;
    res.json({ response: responseText, threadId: currentThreadId });
  } catch (error) {
    console.error("Chat Error:", error);
    res.status(500).json({ error: "Sorry, there was a problem with the AI." });
  }
});

app.listen(3000, () => console.log('Server is running on port 3000'));
