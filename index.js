const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const OpenAI = require('openai');

const app = express();
app.use(bodyParser.json());

// --- SECURITY: Initialize OpenAI with the secret key from Render's environment ---
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// --- SECURITY: CORS configuration to allow your website to connect ---
const allowedOrigins = ['https://scrapbookfilms.com', 'https://www.scrapbookfilms.com'];
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

// --- NEW ENDPOINT: Handles the entire AI conversation securely ---
app.post('/chat', async (req, res) => {
  const { assistantId, threadId, userMessage } = req.body;

  try {
    let currentThreadId = threadId;

    // 1. If no thread exists, create one
    if (!currentThreadId) {
      const thread = await openai.beta.threads.create();
      currentThreadId = thread.id;
    }

    // 2. Add the user's message to the thread
    await openai.beta.threads.messages.create(currentThreadId, {
      role: "user",
      content: userMessage,
    });

    // 3. Run the Assistant
    const run = await openai.beta.threads.runs.create(currentThreadId, {
      assistant_id: assistantId,
    });

    // 4. Poll for the run to complete
    let runStatus;
    do {
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
      runStatus = await openai.beta.threads.runs.retrieve(currentThreadId, run.id);
    } while (runStatus.status === 'in_progress' || runStatus.status === 'queued');

    // 5. Check if the run requires a tool call
    if (runStatus.status === 'requires_action') {
      const toolCalls = runStatus.required_action.submit_tool_outputs.tool_calls;
      const toolOutputs = [];

      for (const toolCall of toolCalls) {
        if (toolCall.function.name === 'create_contact') {
          try {
            const args = JSON.parse(toolCall.function.arguments);
            // Call Getform
            await axios.post(process.env.GETFORM_URL, args, { headers: { 'Accept': 'application/json' } });
            toolOutputs.push({
              tool_call_id: toolCall.id,
              output: JSON.stringify({ status: 'ok', confirmation: `Thanks, ${args.name}! Your message was sent.` }),
            });
          } catch (error) {
             toolOutputs.push({
              tool_call_id: toolCall.id,
              output: JSON.stringify({ status: 'error', message: 'Failed to send contact info.' }),
            });
          }
        }
      }
       // Submit tool outputs back to the Assistant
       await openai.beta.threads.runs.submitToolOutputs(currentThreadId, run.id, { tool_outputs: toolOutputs });
       // Poll again for the final response
        do {
          await new Promise(resolve => setTimeout(resolve, 1000));
          runStatus = await openai.beta.threads.runs.retrieve(currentThreadId, run.id);
        } while (runStatus.status === 'in_progress' || runStatus.status === 'queued');
    }

    // 6. Get the latest messages from the thread
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
